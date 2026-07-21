import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason, RequestRateLimitError } from '../errors.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type {
	ProviderApiPagedResult,
	ProviderIssue,
	ProviderPullRequest,
	ProviderReposInput,
	ProviderRepository,
} from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the sweep drain loop (all-pages, `truncated`/`fetchFailed` signals) and the broaden fan-out
 * (per-org warning isolation, `broadenedProviderIds`, `fanOutCount`) for the ProviderBackend surface (#5438).
 */

function primarySession(token: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: 'github.com',
	};
}

function stubApi(gh: GitHostIntegration, api: Record<string, unknown>): void {
	(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () => Promise.resolve(api);
}

async function connectedGitHub(runtime: ReturnType<typeof createFakeRuntime>) {
	const manager = createIntegrationManager(runtime);
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
	return { manager: manager, gh: gh };
}

suite('sweep + broaden (#5438)', () => {
	test('sweepPullRequests drains multiple pages and marks truncated at maxPages', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				return Promise.resolve({
					values: [{ id: `pr-${calls}` } as unknown as ProviderPullRequest],
					paging: { more: true, cursor: JSON.stringify({ value: calls + 1, type: 'page' }) },
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		assert.equal(result.items.length, 2, 'drained exactly maxPages pages');
		// allPages asserts completeness — false here because the drain stopped at maxPages with more available.
		assert.equal(result.page.allPages, false);
		assert.equal(result.page.truncated, true, 'stopping at maxPages with more available marks truncated');
		// A sweep exposes no resumable cursor, so incompleteness is expressed via page.truncated/allPages, never
		// as hasMore — a hasMore:true here would make a draining consumer re-run the identical sweep forever.
		assert.equal(result.hasMore, false);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(calls, 2);

		manager.dispose();
	});

	test('sweepPullRequests stops cleanly when the provider runs out of pages', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				return Promise.resolve({
					values: [{ id: `pr-${calls}` } as unknown as ProviderPullRequest],
					paging: {
						more: calls < 2,
						cursor: calls < 2 ? JSON.stringify({ value: calls + 1, type: 'page' }) : '{}',
					},
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});
		assert.equal(result.items.length, 2);
		assert.equal(result.page.truncated, false);
		assert.equal(result.hasMore, false);

		manager.dispose();
	});

	test('a page that throws mid-drain sets fetchFailed while keeping earlier pages', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				if (calls === 1) {
					return Promise.resolve({
						values: [{ id: 'pr-1' } as unknown as ProviderPullRequest],
						paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
					} satisfies PagedResult<ProviderPullRequest>);
				}
				return Promise.reject(new Error('page 2 down'));
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});
		assert.equal(result.items.length, 1, 'keeps the page fetched before the failure');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].providerId, GitCloudHostIntegrationId.GitHub);

		manager.dispose();
	});

	test('a sweep with SDK metadata failures reports allPages: false and preserves fetched items (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			// A single terminal page (no `more`) that still reports a structured failure: the successful sibling
			// PR must survive, but the sweep cannot claim it read every page.
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [{ id: 'pr-good' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}' },
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: 'octocat/broken' } }],
					},
				}),
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});

		assert.deepEqual(
			result.items.map(pr => pr.id),
			['pr-good'],
			'the successful sibling PR survives the failed scope',
		);
		assert.equal(result.fetchFailed, true, 'a structured SDK failure means the slice is incomplete');
		assert.equal(result.page.allPages, false, 'allPages is false after any SDK failure');
		assert.equal(result.page.truncated, true);
		assert.equal(
			result.warnings.some(w => w.kind === 'auth'),
			true,
			'the auth scope failure is surfaced',
		);

		manager.dispose();
	});

	test('broadenIssues aggregates per-org, isolates a failing org into a warning, and reports fanOutCount', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Both orgs resolve to the same GitHub integration; behavior differs by org name.
		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (org: string) =>
			Promise.resolve({
				value: {
					values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository],
				},
			});

		const issue = { id: 'i-1' } as unknown as ProviderIssue;
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (repos: ProviderReposInput) => {
			const ns = (repos as { namespace: string }[])[0]?.namespace;
			if (ns === 'org-fail') return Promise.resolve({ error: new Error('issues boom') });
			return Promise.resolve({ value: { values: [issue] } });
		};

		const result = await manager.broadenIssues({
			orgs: [
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-ok' },
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-fail' },
			],
			page: 1,
		});

		assert.deepEqual(result.items, [issue], 'only the successful org contributed issues');
		assert.equal(result.warnings.length, 1, 'the failing org produced a warning without failing the fan-out');
		assert.deepEqual(result.broadenedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.equal(result.fanOutCount, 2, 'fanOutCount counts every org work item');

		manager.dispose();
	});

	test('broadenIssues drains paginated repositories under an org', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (_org: string, options?: { cursor?: string }) => {
			calls++;
			const page = options?.cursor != null ? 2 : 1;
			return Promise.resolve({
				value: {
					values: [{ name: `repo-${page}`, namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: page === 1, cursor: JSON.stringify({ value: page + 1, type: 'page' }) },
				},
			});
		};

		const issue = { id: 'i-1' } as unknown as ProviderIssue;
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (repos: ProviderReposInput) => {
			assert.deepEqual(repos, [
				{ namespace: 'org', name: 'repo-1' },
				{ namespace: 'org', name: 'repo-2' },
			]);
			return Promise.resolve({ value: { values: [issue] } });
		};

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
			page: 1,
		});

		assert.equal(calls, 2, 'drains until the provider stops paging');
		assert.deepEqual(result.items, [issue]);

		manager.dispose();
	});

	test('broadenIssues maps issue-read metadata failures to warnings + fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (org: string) =>
			Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			});

		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue> & { metadata?: CollectionMetadata }>>;
			}
		).getMyIssuesForReposAsShapesResult = (_repos: ProviderReposInput) =>
			Promise.resolve({
				value: {
					values: [{ id: 'i-1' } as unknown as ProviderIssue],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: 'org/bad' } }],
					},
				},
			});

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
			page: 1,
		});

		assert.deepEqual(result.items, [{ id: 'i-1' }], 'the successful issues survive the partial read');
		assert.equal(result.fetchFailed, true, 'metadata failures mark the broadened slice incomplete');
		assert.equal(result.page.truncated, true, 'partial completeness is surfaced as truncation');
		assert.ok(
			result.warnings.some(w => w.kind === 'auth'),
			'the scope failure is surfaced as an auth warning',
		);

		manager.dispose();
	});

	test('broadenIssues surfaces repo-drain truncation as page.truncated, not an uncontinuable hasMore (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// The repo drain always claims more but never returns an advancing cursor, so drainRepositories stops
		// at its backstop with `truncated` and no resumable repo cursor. That incompleteness must surface as a
		// terminal page.truncated, NOT hasMore:true with no cursor (which would re-drain the same repos).
		(
			gh as unknown as {
				getRepositoriesForOrgResult: () => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [{ name: 'r', namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: true, cursor: '{}' },
				},
			});
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: () => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = () =>
			Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } });

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
			page: 1,
		});
		assert.equal(result.page.truncated, true, 'repo-drain truncation is surfaced');
		assert.equal(result.hasMore, false, 'truncation is not advertised as a resumable next page');
		assert.equal(result.cursor, undefined, 'no cursor is emitted for an uncontinuable truncation');

		manager.dispose();
	});

	test('broadenIssues returns and reuses per-org opaque cursors for multi-org fan-out', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (org: string) =>
			Promise.resolve({
				value: {
					values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository],
				},
			});

		let round = 0;
		const capturedCursors: Record<number, Record<string, string | undefined>> = {};
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (repos: ProviderReposInput, options?: { cursor?: string }) => {
			const org = (repos as { namespace: string }[])[0]?.namespace;
			capturedCursors[round] ??= {};
			capturedCursors[round][org] = options?.cursor;
			return Promise.resolve({
				value: {
					values: [{ id: `${org}-${round}` } as unknown as ProviderIssue],
					paging:
						round === 0
							? { more: true, cursor: JSON.stringify({ value: `next-${org}`, type: 'cursor' }) }
							: { more: false, cursor: '{}' },
				},
			});
		};

		const orgs = [
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-a' },
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-b' },
		] as const;

		const first = await manager.broadenIssues({ orgs: [...orgs], page: 1 });
		assert.equal(first.hasMore, true);
		assert.deepEqual(capturedCursors[0], { 'org-a': undefined, 'org-b': undefined });
		assert.deepEqual(JSON.parse(first.cursor!), {
			cursors: [
				{
					providerId: GitCloudHostIntegrationId.GitHub,
					org: 'org-a',
					cursor: JSON.stringify({ value: 'next-org-a', type: 'cursor' }),
				},
				{
					providerId: GitCloudHostIntegrationId.GitHub,
					org: 'org-b',
					cursor: JSON.stringify({ value: 'next-org-b', type: 'cursor' }),
				},
			],
			// Both orgs still had more this round, so none is recorded as exhausted.
			exhausted: [],
		});

		round = 1;
		const second = await manager.broadenIssues({ orgs: [...orgs], page: 2, cursor: first.cursor });
		assert.equal(second.hasMore, false);
		assert.deepEqual(capturedCursors[1], {
			'org-a': JSON.stringify({ value: 'next-org-a', type: 'cursor' }),
			'org-b': JSON.stringify({ value: 'next-org-b', type: 'cursor' }),
		});

		manager.dispose();
	});

	test('broadenIssues keeps per-connection cursors separate for two accounts sharing an org name (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (org: string) =>
			Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			});

		// Track which connection each read ran under, keyed by the connectionId threaded to the read.
		let round = 0;
		const capturedCursorByConnection: Record<number, Record<string, string | undefined>> = {};
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
					options?: { cursor?: string },
					connectionId?: string,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (
			_repos: ProviderReposInput,
			options?: { cursor?: string },
			connectionId?: string,
		) => {
			capturedCursorByConnection[round] ??= {};
			capturedCursorByConnection[round][connectionId ?? 'primary'] = options?.cursor;
			return Promise.resolve({
				value: {
					values: [{ id: `${connectionId}` } as unknown as ProviderIssue],
					paging: { more: true, cursor: JSON.stringify({ value: `next-${connectionId}`, type: 'cursor' }) },
				},
			});
		};

		// Two orgs with the SAME name but different connections — the pre-fix cursor keying (providerId+org
		// only) would have applied one account's cursor to the other.
		const orgs = [
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme', connectionId: 'a' },
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme', connectionId: 'b' },
		] as const;

		const first = await manager.broadenIssues({ orgs: [...orgs], page: 1 });
		const parsed = JSON.parse(first.cursor!) as {
			cursors: { org: string; connectionId?: string; cursor: string }[];
		};
		// Each connection has its own cursor entry despite sharing the org name.
		const a = parsed.cursors.find(c => c.connectionId === 'a');
		const b = parsed.cursors.find(c => c.connectionId === 'b');
		assert.equal(a?.cursor, JSON.stringify({ value: 'next-a', type: 'cursor' }));
		assert.equal(b?.cursor, JSON.stringify({ value: 'next-b', type: 'cursor' }));

		round = 1;
		await manager.broadenIssues({ orgs: [...orgs], page: 2, cursor: first.cursor });
		// Round 2: each connection gets ITS OWN cursor back, not the other's.
		assert.equal(capturedCursorByConnection[1]?.a, JSON.stringify({ value: 'next-a', type: 'cursor' }));
		assert.equal(capturedCursorByConnection[1]?.b, JSON.stringify({ value: 'next-b', type: 'cursor' }));

		manager.dispose();
	});

	test('broadenIssues skips an exhausted org on later rounds instead of re-fetching its first page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (org: string) =>
			Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			});

		let round = 0;
		const reads: Record<number, string[]> = {};
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (repos: ProviderReposInput) => {
			const org = (repos as { namespace: string }[])[0]?.namespace;
			(reads[round] ??= []).push(org);
			// org-a is exhausted after round 0 (no more); org-b keeps paging into round 1.
			const more = org === 'org-b' && round === 0;
			return Promise.resolve({
				value: {
					values: [{ id: `${org}-${round}` } as unknown as ProviderIssue],
					paging: more
						? { more: true, cursor: JSON.stringify({ value: `next-${org}`, type: 'cursor' }) }
						: { more: false, cursor: '{}' },
				},
			});
		};

		const orgs = [
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-a' },
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-b' },
		];

		const first = await manager.broadenIssues({ orgs: [...orgs], page: 1 });
		assert.deepEqual(reads[0].sort(), ['org-a', 'org-b'], 'both orgs read on the first round');
		assert.deepEqual(JSON.parse(first.cursor!).exhausted, [
			{ providerId: GitCloudHostIntegrationId.GitHub, org: 'org-a' },
		]);

		round = 1;
		await manager.broadenIssues({ orgs: [...orgs], page: 2, cursor: first.cursor });
		assert.deepEqual(reads[1], ['org-b'], 'the exhausted org-a is skipped, only org-b is re-read');

		manager.dispose();
	});

	test('sweepPullRequests with no repos reads the account-wide user PRs core (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let reposCalled = false;
		let accountWideStates: string[] | undefined | 'unset' = 'unset';
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				reposCalled = true;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});
		// The account-wide core is provider-specific; stub the model hook the sweep routes to for empty repos.
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: (o?: {
					state?: string[];
				}) => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = (o?: { state?: string[] }) => {
			accountWideStates = o?.state;
			return Promise.resolve({
				value: {
					values: [{ id: 'mine' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}' },
				},
			});
		};

		const result = await manager.sweepClosedPullRequests({ providerIds: [GitCloudHostIntegrationId.GitHub] });
		assert.equal(reposCalled, false, 'no repos → the repo-scoped core is not called');
		assert.deepEqual(result.items, [{ id: 'mine' }], 'account-wide user PRs are returned');
		assert.deepEqual(
			accountWideStates,
			['closed', 'merged'],
			'the closed sweep state reaches the account-wide core',
		);

		manager.dispose();
	});

	test('a single-page account-wide read that signals truncation is not reported as complete (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// A provider whose account-wide read returns one page it can't confirm is complete sets
		// `paging.truncated` (e.g. Bitbucket/Azure fan-outs). The sweep must surface that, not claim allPages.
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () =>
			Promise.resolve({
				value: {
					values: [{ id: 'pr' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}', truncated: true },
				},
			});

		const result = await manager.sweepClosedPullRequests({ providerIds: [GitCloudHostIntegrationId.GitHub] });
		assert.equal(result.page.truncated, true, 'truncation is surfaced');
		assert.equal(result.page.allPages, false, 'a truncated sweep is not reported as fully drained');
		// A sweep exposes no cursor to resume, so `hasMore` must be false even when incomplete — the
		// incompleteness is expressed through page.truncated + allPages:false + a warning, not a fake next page.
		assert.equal(result.hasMore, false, 'a cursorless sweep never advertises a resumable next page');
		// A consumer that only inspects `warnings` must also see the read was partial.
		assert.ok(
			result.warnings.some(w => /truncat/i.test(w.message)),
			'a truncated drain pushes a warning, not just a boolean',
		);

		manager.dispose();
	});

	test('Bitbucket account-wide PR read drains all workspace pages (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		let calls = 0;
		stubApi(bb, {
			getBitbucketPullRequestsAuthoredByUserForWorkspace: (
				_t: unknown,
				_u: string,
				_ws: string,
				o?: { page?: number },
			) => {
				calls += 1;
				const page = o?.page ?? 1;
				// Two pages: page 1 hasMore, page 2 terminal.
				return Promise.resolve({
					data: [{ id: `pr-${page}` } as unknown as ProviderPullRequest],
					hasMore: page < 2,
					nextPage: page < 2 ? page + 1 : null,
				});
			},
			// The reviewer slice now enumerates the workspace's repos and drains each; return no repos so it
			// contributes nothing here, keeping the test focused on the authored drain.
			getReposForBitbucketWorkspace: () => Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } }),
			getPullRequestsForRepo: () => Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } }),
		});
		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		// Single workspace so the drain is deterministic.
		(
			bb as unknown as {
				getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
			}
		).getProviderResourcesForCurrentUser = () => Promise.resolve({ values: [{ id: 'w1', slug: 'ws' }] });

		// Call the account-wide core directly to assert the per-workspace drain (avoids the sweep wrapper).
		const result = await (
			bb as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		assert.equal(calls, 2, 'both workspace pages are drained');
		assert.equal(result?.value?.values.length, 2, 'PRs from both pages are returned');
		assert.equal(result?.value?.paging?.truncated, undefined, 'a fully drained workspace is not marked truncated');

		manager.dispose();
	});

	test('Bitbucket account-wide PR read includes review-requested PRs via reviewerId, not a text query (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		let reviewerIdArg: string | undefined;
		let queryArg: string | undefined;
		let reviewerReposCalled = false;
		stubApi(bb, {
			getBitbucketPullRequestsAuthoredByUserForWorkspace: () =>
				Promise.resolve({
					data: [{ id: 'authored', url: 'u/authored' } as unknown as ProviderPullRequest],
					hasMore: false,
					nextPage: null,
				}),
			// The reviewer slice now enumerates the workspace's repos, then drains each repo's PRs by reviewerId.
			getReposForBitbucketWorkspace: () =>
				Promise.resolve({
					values: [{ id: 'r1', namespace: 'ws', name: 'repo' } as unknown as ProviderRepository],
					paging: { more: false, cursor: '{}' },
				}),
			getPullRequestsForRepo: (_t: unknown, _repo: unknown, o?: { reviewerId?: string; query?: string }) => {
				reviewerIdArg = o?.reviewerId;
				queryArg = o?.query;
				return Promise.resolve({
					values: [{ id: 'reviewing', url: 'u/reviewing' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}' },
				});
			},
			// The aggregate getPullRequestsForRepos must NOT be used for the reviewer slice anymore (it's not
			// resumable); flag if it's called so the test fails loudly on a regression.
			getPullRequestsForRepos: () => {
				reviewerReposCalled = true;
				return Promise.resolve({ values: [] });
			},
		});
		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		(
			bb as unknown as {
				getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
			}
		).getProviderResourcesForCurrentUser = () => Promise.resolve({ values: [{ id: 'w1', slug: 'ws' }] });

		const result = await (
			bb as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		// The reviewer read goes through the per-repo paged method with the dedicated reviewerId input, not the
		// aggregate getPullRequestsForRepos (which is not resumable) nor a text `query`.
		assert.equal(reviewerReposCalled, false, 'the non-resumable aggregate getPullRequestsForRepos is not used');
		assert.equal(reviewerIdArg, 'u1', 'the reviewer read uses reviewerId');
		assert.equal(queryArg, undefined, 'the reviewer clause is not passed as a text query');
		const urls = (result?.value?.values ?? []).map(pr => pr.url).sort();
		assert.deepEqual(urls, ['u/authored', 'u/reviewing'], 'both authored and review-requested PRs are returned');

		manager.dispose();
	});

	/**
	 * Helper: wire a Bitbucket integration for the reviewer-slice tests, stubbing account/workspaces and the
	 * authored drain (empty) so each test only exercises the repo-discovery + per-repo reviewer drain.
	 */
	async function bitbucketForReviewerSlice(
		runtime: ReturnType<typeof createFakeRuntime>,
		api: Record<string, unknown>,
	) {
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};
		stubApi(bb, {
			// Authored drain contributes nothing; the tests target the reviewer slice.
			getBitbucketPullRequestsAuthoredByUserForWorkspace: () =>
				Promise.resolve({ data: [], hasMore: false, nextPage: null }),
			...api,
		});
		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		(
			bb as unknown as {
				getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
			}
		).getProviderResourcesForCurrentUser = () => Promise.resolve({ values: [{ id: 'w1', slug: 'ws' }] });
		return { manager: manager, bb: bb };
	}

	function callAccountWide(bb: GitHostIntegration) {
		return (
			bb as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
	}

	test('Bitbucket reviewer PRs are returned for a repo with no open local remote (#5438)', async () => {
		const runtime = createFakeRuntime();
		// No getOpenRemotes stub — the new reviewer slice enumerates workspace repos instead of open remotes.
		const { manager, bb } = await bitbucketForReviewerSlice(runtime, {
			getReposForBitbucketWorkspace: () =>
				Promise.resolve({
					values: [{ id: 'r1', namespace: 'ws', name: 'repo' } as unknown as ProviderRepository],
					paging: { more: false, cursor: '{}' },
				}),
			getPullRequestsForRepo: () =>
				Promise.resolve({
					values: [{ id: 'rev', url: 'u/rev' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}' },
				}),
		});

		const result = await callAccountWide(bb);
		assert.deepEqual(
			(result?.value?.values ?? []).map(pr => pr.url),
			['u/rev'],
			'a reviewer PR on a repo with no open remote is discovered via the workspace repo list',
		);

		manager.dispose();
	});

	test('Bitbucket reviewer slice drains all pages of a repo with multiple PR pages (#5438)', async () => {
		const runtime = createFakeRuntime();
		let prCalls = 0;
		const { manager, bb } = await bitbucketForReviewerSlice(runtime, {
			getReposForBitbucketWorkspace: () =>
				Promise.resolve({
					values: [{ id: 'r1', namespace: 'ws', name: 'repo' } as unknown as ProviderRepository],
					paging: { more: false, cursor: '{}' },
				}),
			getPullRequestsForRepo: (_t: unknown, _repo: unknown, o?: { cursor?: string }) => {
				prCalls += 1;
				const page = o?.cursor == null || o.cursor === '{}' ? 1 : Number(JSON.parse(o.cursor).value);
				return Promise.resolve({
					values: [{ id: `rev-${page}`, url: `u/rev-${page}` } as unknown as ProviderPullRequest],
					paging: {
						more: page < 2,
						cursor: page < 2 ? JSON.stringify({ value: page + 1, type: 'page' }) : '{}',
					},
				});
			},
		});

		const result = await callAccountWide(bb);
		assert.equal(prCalls, 2, 'both PR pages of the repo are drained');
		assert.deepEqual(
			(result?.value?.values ?? []).map(pr => pr.url).sort(),
			['u/rev-1', 'u/rev-2'],
			'PRs from both pages are returned',
		);

		manager.dispose();
	});

	test('Bitbucket reviewer slice preserves siblings and warns when one repo fails with auth (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, bb } = await bitbucketForReviewerSlice(runtime, {
			getReposForBitbucketWorkspace: () =>
				Promise.resolve({
					values: [
						{ id: 'r1', namespace: 'ws', name: 'good' } as unknown as ProviderRepository,
						{ id: 'r2', namespace: 'ws', name: 'bad' } as unknown as ProviderRepository,
					],
					paging: { more: false, cursor: '{}' },
				}),
			getPullRequestsForRepo: (_t: unknown, repo: { name: string }) => {
				if (repo.name === 'bad') {
					return Promise.reject(
						new AuthenticationError(
							{
								providerId: GitCloudHostIntegrationId.Bitbucket,
								microHash: undefined,
								cloud: true,
								type: 'oauth',
								scopes: [],
							},
							AuthenticationErrorReason.Unauthorized,
						),
					);
				}
				return Promise.resolve({
					values: [{ id: 'good-pr', url: 'u/good' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}' },
				});
			},
		});

		// An auth failure on one repo is recorded as a structured scope failure (not re-thrown, which would
		// discard the good repo's PR), so the facade maps it to an actionable auth warning + fetchFailed while
		// the good repo's reviewer PR still survives.
		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.Bitbucket],
			connectionId: undefined,
		});

		assert.deepEqual(
			result.items.map(pr => pr.url),
			['u/good'],
			"the good repo's reviewer PR survives the bad repo's auth failure",
		);
		assert.equal(result.fetchFailed, true, 'the auth failure marks the slice incomplete');
		assert.ok(
			result.warnings.some(w => w.kind === 'auth'),
			'the repo auth failure is surfaced as an actionable auth warning',
		);

		manager.dispose();
	});

	test('Bitbucket reviewer slice dedupes authored/reviewer PRs by URL (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};
		stubApi(bb, {
			// The same PR is both authored by and review-requested from the user; it must collapse to one entry.
			getBitbucketPullRequestsAuthoredByUserForWorkspace: () =>
				Promise.resolve({
					data: [{ id: 'shared', url: 'u/shared' } as unknown as ProviderPullRequest],
					hasMore: false,
					nextPage: null,
				}),
			getReposForBitbucketWorkspace: () =>
				Promise.resolve({
					values: [{ id: 'r1', namespace: 'ws', name: 'repo' } as unknown as ProviderRepository],
					paging: { more: false, cursor: '{}' },
				}),
			getPullRequestsForRepo: () =>
				Promise.resolve({
					values: [{ id: 'shared', url: 'u/shared' } as unknown as ProviderPullRequest],
					paging: { more: false, cursor: '{}' },
				}),
		});
		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		(
			bb as unknown as {
				getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
			}
		).getProviderResourcesForCurrentUser = () => Promise.resolve({ values: [{ id: 'w1', slug: 'ws' }] });

		const result = await callAccountWide(bb);
		assert.deepEqual(
			(result?.value?.values ?? []).map(pr => pr.url),
			['u/shared'],
			'an authored PR that is also review-requested collapses to a single entry by URL',
		);

		manager.dispose();
	});

	test('Bitbucket reviewer slice marks truncated when repo discovery hits its backstop (#5438)', async () => {
		const runtime = createFakeRuntime();
		let discoveryCalls = 0;
		const { manager, bb } = await bitbucketForReviewerSlice(runtime, {
			// Repo discovery always reports another page → the drain stops at its backstop and flags truncation.
			getReposForBitbucketWorkspace: (_t: unknown, _ws: string, o?: { cursor?: string }) => {
				discoveryCalls += 1;
				const page = o?.cursor == null || o.cursor === '{}' ? 1 : Number(JSON.parse(o.cursor).value);
				return Promise.resolve({
					values: [
						{ id: `r${page}`, namespace: 'ws', name: `repo-${page}` } as unknown as ProviderRepository,
					],
					paging: { more: true, cursor: JSON.stringify({ value: page + 1, type: 'page' }) },
				});
			},
			getPullRequestsForRepo: () => Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } }),
		});

		const result = await callAccountWide(bb);
		assert.equal(discoveryCalls, 20, 'repo discovery stops at the maxReposPagesPerWorkspace backstop');
		assert.equal(result?.value?.paging?.truncated, true, 'a backstopped repo discovery marks the slice truncated');

		manager.dispose();
	});

	test('Bitbucket account-wide PR read marks truncated when a workspace hits the page backstop (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		// Every page claims there's more, so the drain runs until the maxPagesPerWorkspace (20) backstop and
		// reports truncated rather than looping unbounded.
		let calls = 0;
		stubApi(bb, {
			getBitbucketPullRequestsAuthoredByUserForWorkspace: (
				_t: unknown,
				_u: string,
				_ws: string,
				o?: { page?: number },
			) => {
				calls += 1;
				const page = o?.page ?? 1;
				return Promise.resolve({
					data: [{ id: `pr-${page}` } as unknown as ProviderPullRequest],
					hasMore: true,
					nextPage: page + 1,
				});
			},
		});
		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		(
			bb as unknown as {
				getProviderResourcesForCurrentUser: () => Promise<{ values: { id: string; slug: string }[] }>;
			}
		).getProviderResourcesForCurrentUser = () => Promise.resolve({ values: [{ id: 'w1', slug: 'ws' }] });

		const result = await (
			bb as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		assert.equal(calls, 20, 'the drain stops at the maxPagesPerWorkspace backstop');
		assert.equal(result?.value?.paging?.truncated, true, 'a backstopped workspace is reported as truncated');

		manager.dispose();
	});

	test("Azure account-wide PR read: one project's failure does not discard the others (#5438)", async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// The 'bad' project's read throws (e.g. a 429/403 mid-sweep); the 'good' project drains cleanly. The
		// fan-out must be settled per-project so the failure doesn't take down the good project's PRs.
		stubApi(azure, {
			getPullRequestsForAzureProject: (_t: unknown, project: { project: string }) => {
				if (project.project === 'bad') return Promise.reject(new Error('boom'));
				return Promise.resolve({
					data: [{ id: `pr-${project.project}` } as unknown as ProviderPullRequest],
					hasMore: false,
					nextPage: null,
				});
			},
		});
		(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount =
			() => Promise.resolve({ id: 'guid-1' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ resourceName: 'org-1', name: 'good' },
					{ resourceName: 'org-1', name: 'bad' },
				],
			});

		const result = await (
			azure as unknown as {
				getMyPullRequestsForUserResult: () => Promise<
					IntegrationResult<ProviderApiPagedResult<ProviderPullRequest>>
				>;
			}
		).getMyPullRequestsForUserResult();
		const ids = result?.value?.values.map(pr => pr.id) ?? [];
		assert.deepEqual(ids, ['pr-good'], "the good project's PRs survive the bad project's failure");
		// A dropped project makes the aggregate incomplete: instead of re-throwing (which would discard the good
		// project's PRs) or a silent flatSettled, the failure is preserved as a structured per-scope failure in
		// the SDK metadata, which the facade then maps to a warning + fetchFailed.
		const failures = result?.value?.metadata?.failures ?? [];
		assert.equal(failures.length, 2, 'both filter reads for the bad project are recorded as scope failures');
		assert.ok(
			failures.every(f => f.scope?.projectId === 'bad'),
			'the failure is attributed to the bad project scope',
		);
		assert.equal(result?.value?.metadata?.completeness, 'partial', 'the aggregate is marked partial');

		manager.dispose();
	});

	test('Azure account-wide PR read dedupes by URL so cross-org id collisions are kept (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// Both orgs surface a PR whose Azure pullRequestId is "42" (ids are only org-unique). Keyed by id one
		// would be dropped; keyed by the org-qualified url both survive.
		stubApi(azure, {
			getPullRequestsForAzureProject: (_t: unknown, project: { namespace: string; project: string }) =>
				Promise.resolve({
					data: [
						{
							id: '42',
							url: `https://dev.azure.com/${project.namespace}/_git/pr/42`,
						} as unknown as ProviderPullRequest,
					],
					hasMore: false,
					nextPage: null,
				}),
		});
		(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount =
			() => Promise.resolve({ id: 'guid-1' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () =>
			Promise.resolve([
				{ id: 'org-a', name: 'Org A' },
				{ id: 'org-b', name: 'Org B' },
			]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ resourceName: 'org-a', name: 'p' },
					{ resourceName: 'org-b', name: 'p' },
				],
			});

		const result = await (
			azure as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		const urls = (result?.value?.values ?? []).map(pr => pr.url).sort();
		assert.deepEqual(
			urls,
			['https://dev.azure.com/org-a/_git/pr/42', 'https://dev.azure.com/org-b/_git/pr/42'],
			'both cross-org PRs with the same numeric id are kept',
		);

		manager.dispose();
	});

	test('Azure account-wide PR read marks truncated when a project hits the page backstop (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// Every page claims more, so each project's drain runs until the maxPagesPerProject (20) backstop.
		// A single project fans out into an authored + assigned read, so 2 × 20 = 40 calls for one project.
		let calls = 0;
		stubApi(azure, {
			getPullRequestsForAzureProject: (_t: unknown, project: { project: string }, o?: { page?: number }) => {
				calls += 1;
				const page = o?.page ?? 1;
				return Promise.resolve({
					data: [{ id: `pr-${project.project}-${page}` } as unknown as ProviderPullRequest],
					hasMore: true,
					nextPage: page + 1,
				});
			},
		});
		(azure as unknown as { getProviderCurrentAccount: () => Promise<{ id: string }> }).getProviderCurrentAccount =
			() => Promise.resolve({ id: 'guid-1' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({ values: [{ resourceName: 'org-1', name: 'good' }] });

		const result = await (
			azure as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult();
		assert.equal(calls, 40, 'both scoped drains stop at the maxPagesPerProject backstop');
		assert.equal(result?.value?.paging?.truncated, true, 'a backstopped project is reported as truncated');

		manager.dispose();
	});

	test('Azure account-wide issue read drains every page per project/filter (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// Two pages threaded by the SDK cursor; the read must follow paging.more/cursor to the end, not stop at
		// the first page (the old `.values`-only read silently capped at page 1).
		const seenCursors: (string | undefined)[] = [];
		stubApi(azure, {
			getIssuesForAzureProject: (_t: unknown, _ns: string, _p: string, options?: { cursor?: string }) => {
				seenCursors.push(options?.cursor);
				const page = options?.cursor == null ? 1 : Number(options.cursor);
				return Promise.resolve({
					values: [
						{
							id: `i${page}`,
							url: `https://x/i${page}`,
							updatedDate: new Date(0),
						} as unknown as ProviderIssue,
					],
					paging: { more: page < 2, cursor: page < 2 ? String(page + 1) : '{}' },
				});
			},
		});
		(
			azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{ values: { resourceName: string; name: string }[] }>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({ values: [{ resourceName: 'org-1', name: 'proj' }] });

		const result = await (
			azure as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: unknown[]; truncated: boolean }>
				>;
			}
		).searchMyIssuesWithTruncationResult();
		// One project × two filters (assignee + author) run concurrently, each drained to page 2. Order across
		// the two drains is not deterministic, so assert counts: two first-page reads (undefined) and two
		// second-page reads ('2').
		assert.equal(seenCursors.length, 4, 'both filters drain both pages');
		assert.equal(seenCursors.filter(c => c == null).length, 2, 'two first-page reads');
		assert.equal(seenCursors.filter(c => c === '2').length, 2, 'two second-page reads (the cursor is threaded)');
		assert.equal(result?.value?.truncated, false, 'a fully drained read is not truncated');

		manager.dispose();
	});

	test('Azure account-wide issue read preserves siblings and records an auth/rate-limit rejection as a scope failure (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		// A 429 on the 'bad' project must NOT re-throw (that would discard the 'good' project's issues) nor
		// collapse into a generic truncation. It's preserved as a structured rate-limit scope failure in the
		// metadata, which the facade maps to a rate-limit warning + fetchFailed, while the good issues survive.
		stubApi(azure, {
			getIssuesForAzureProject: (_t: unknown, _org: string, project: string) => {
				if (project === 'bad') {
					return Promise.reject(new RequestRateLimitError(new Error('429'), undefined, undefined));
				}
				return Promise.resolve({ values: [{ id: 'i-good' }], paging: { more: false, cursor: '{}' } });
			},
		});
		(
			azure as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });
		(
			azure as unknown as { getProviderResourcesForUser: () => Promise<{ id: string; name: string }[]> }
		).getProviderResourcesForUser = () => Promise.resolve([{ id: 'org-1', name: 'Org One' }]);
		(
			azure as unknown as {
				getProviderProjectsForResources: () => Promise<{
					values: { resourceId: string; resourceName: string; name: string }[];
				}>;
			}
		).getProviderProjectsForResources = () =>
			Promise.resolve({
				values: [
					{ resourceId: 'org-1', resourceName: 'org-1', name: 'good' },
					{ resourceId: 'org-1', resourceName: 'org-1', name: 'bad' },
				],
			});

		const result = await (
			azure as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: unknown[]; truncated: boolean; metadata?: CollectionMetadata }>
				>;
			}
		).searchMyIssuesWithTruncationResult();
		assert.equal(result?.error, undefined, 'a partial read is not surfaced as a hard error');
		assert.equal(result?.value?.values.length, 1, "the good project's issues survive");
		const failures = result?.value?.metadata?.failures ?? [];
		assert.ok(
			failures.some(f => f.kind === 'rate-limit' && f.scope?.projectId === 'bad'),
			'the rate-limit rejection is recorded as a scope failure on the bad project',
		);

		manager.dispose();
	});
});
