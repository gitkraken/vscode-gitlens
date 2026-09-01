import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderIssueSearchPage } from '../models/issueReads.js';
import type { ProviderIssue, ProviderReposInput, ProviderRepository } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, connectedGitLab, primarySession } from './sweepHelpers.js';

/**
 * The issue-broadening fan-out: per-org aggregation and warning isolation, `broadenedProviderIds`,
 * `fanOutCount`, and the per-org opaque cursors a multi-org round trip threads back (#5438).
 *
 * The fan-out runs on TWO ENGINES (#5804), so the fixtures below are picked to exercise the right one rather
 * than for convenience: GitHub declares a filtered issue search and so reads each org through the ORG-SCOPED
 * SEARCH (one request per page), while GitLab declares none and so falls back to the REPOSITORY DRAIN plus the
 * SDK's repo-scoped read. Every bookkeeping rule below the engine — continuation, retry slot, attribution,
 * exhaustion, warning dedupe — is shared, and the suite asserts it on both.
 */

/** One page of the org-scoped search, in the shape `searchIssuesPageResult` returns. */
function searchPage(overrides?: Partial<ProviderIssueSearchPage>): ProviderIssueSearchPage {
	return { values: [], hasMore: false, page: 1, truncated: false, ...overrides };
}

/** Swaps the org-scoped issue search a git-host integration reads through. */
function stubIssueSearch(
	integration: GitHostIntegration,
	fn: (
		options: { org?: string; cursor?: string; criteria?: unknown },
		cancellation: AbortSignal | undefined,
		connectionId: string | undefined,
	) => Promise<IntegrationResult<ProviderIssueSearchPage | undefined>>,
): void {
	(
		integration as unknown as {
			searchIssuesPageResult: (
				options: { org?: string; cursor?: string; criteria?: unknown },
				cancellation?: AbortSignal,
				connectionId?: string,
			) => Promise<IntegrationResult<ProviderIssueSearchPage | undefined>>;
		}
	).searchIssuesPageResult = fn;
}

/** Swaps the org repository listing the repository-drain engine walks. */
function stubOrgRepos(
	integration: GitHostIntegration,
	fn: (
		org: string,
		options?: { cursor?: string },
	) => Promise<IntegrationResult<PagedResult<ProviderRepository> & { truncated?: boolean }> | undefined>,
): void {
	(
		integration as unknown as {
			getRepositoriesForOrgResult: (
				org: string,
				options?: { cursor?: string },
			) => Promise<IntegrationResult<PagedResult<ProviderRepository> & { truncated?: boolean }> | undefined>;
		}
	).getRepositoriesForOrgResult = fn;
}

/** Swaps the SDK repo-scoped issue read the repository-drain engine finishes on. */
function stubReposIssues(
	integration: GitHostIntegration,
	fn: (
		repos: ProviderReposInput,
		options?: { cursor?: string },
		connectionId?: string,
	) => Promise<
		IntegrationResult<(PagedResult<ProviderIssue> & { metadata?: CollectionMetadata }) | undefined> | undefined
	>,
): void {
	(
		integration as unknown as {
			getMyIssuesForReposAsShapesResult: (
				repos: ProviderReposInput,
				options?: { cursor?: string },
				connectionId?: string,
			) => Promise<
				| IntegrationResult<(PagedResult<ProviderIssue> & { metadata?: CollectionMetadata }) | undefined>
				| undefined
			>;
		}
	).getMyIssuesForReposAsShapesResult = fn;
}

suite('broaden issues fan-out (#5438)', () => {
	test('broadenIssues aggregates per-org, isolates a failing org into a warning, and reports fanOutCount', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Both orgs resolve to the same GitHub integration; behavior differs by org name.
		const issue = { id: 'i-1' } as unknown as IssueShape;
		stubIssueSearch(gh, options => {
			if (options.org === 'org-fail') return Promise.resolve({ error: new Error('issues boom') });
			return Promise.resolve({ value: searchPage({ values: [issue] }) });
		});

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
		assert.deepEqual(result.failedProviderIds, []);
		assert.deepEqual(
			result.incompleteProviderIds,
			[GitCloudHostIntegrationId.GitHub],
			'a provider with one healthy org and one failed org is incomplete, not wholly failed',
		);
		assert.equal(result.fanOutCount, 2, 'fanOutCount counts every org work item');

		manager.dispose();
	});

	test('broadenIssues attributes an explicit cloud org with no session as failed', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		(
			github as unknown as {
				getRepositoriesForOrgResult: () => Promise<
					IntegrationResult<PagedResult<ProviderRepository>> | undefined
				>;
			}
		).getRepositoriesForOrgResult = () => Promise.resolve(undefined);

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' }],
			page: 1,
		});

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.deepEqual(result.incompleteProviderIds, []);
		assert.ok(result.warnings.some(warning => warning.kind === 'no-connection'));

		manager.dispose();
	});

	test('broadenIssues attributes a session lost after repository discovery as failed', async () => {
		const runtime = createFakeRuntime();
		// GitLab: no filtered issue search, so this exercises the repository-drain engine — the one where a
		// session can be lost BETWEEN discovering the repositories and reading their issues.
		const { manager, gl } = await connectedGitLab(runtime);
		stubOrgRepos(gl, () =>
			Promise.resolve({
				value: {
					values: [{ id: 'repo', name: 'repo', namespace: 'acme' } as unknown as ProviderRepository],
				},
			}),
		);
		stubReposIssues(gl, () => Promise.resolve(undefined));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'acme' }],
			page: 1,
		});

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitLab]);
		assert.ok(result.warnings.some(warning => warning.kind === 'no-connection'));

		manager.dispose();
	});

	test('broadenIssues retains a failed page without advertising retry-only progress', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let failingOrgCalls = 0;
		const captured: Array<{ org: string; cursor?: string }> = [];
		stubIssueSearch(gh, options => {
			const org = options.org!;
			captured.push({ org: org, cursor: options.cursor });
			if (org === 'org-fail' && failingOrgCalls++ === 0) {
				return Promise.resolve({ error: new Error('temporary issue read failure') });
			}
			return Promise.resolve({
				value: searchPage({ values: [{ id: `${org}-issue` } as unknown as IssueShape] }),
			});
		});

		const orgs = [
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-ok' },
			{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-fail' },
		];
		const first = await manager.broadenIssues({ orgs: orgs, page: 1 });
		assert.equal(first.hasMore, false, 'a failed org alone cannot drive an automatic next-page loop');
		assert.deepEqual(JSON.parse(first.cursor!), {
			cursors: [
				{
					providerId: GitCloudHostIntegrationId.GitHub,
					org: 'org-fail',
					retryPage: 1,
				},
			],
			exhausted: [{ providerId: GitCloudHostIntegrationId.GitHub, org: 'org-ok' }],
		});

		const second = await manager.broadenIssues({ orgs: orgs, page: 2, cursor: first.cursor });
		assert.deepEqual(
			second.items.map(item => item.id),
			['org-fail-issue'],
		);
		assert.equal(second.hasMore, false);
		assert.deepEqual(captured, [
			{ org: 'org-ok', cursor: undefined },
			{ org: 'org-fail', cursor: undefined },
			{ org: 'org-fail', cursor: JSON.stringify({ value: 1, type: 'page' }) },
		]);

		manager.dispose();
	});

	test('broadenIssues drains paginated repositories under an org', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);

		let calls = 0;
		stubOrgRepos(gl, (_org, options) => {
			calls++;
			const page = options?.cursor != null ? 2 : 1;
			return Promise.resolve({
				value: {
					values: [{ name: `repo-${page}`, namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: page === 1, cursor: JSON.stringify({ value: page + 1, type: 'page' }) },
				},
			});
		});

		const issue = { id: 'i-1' } as unknown as ProviderIssue;
		stubReposIssues(gl, repos => {
			assert.deepEqual(repos, [
				{ namespace: 'org', name: 'repo-1' },
				{ namespace: 'org', name: 'repo-2' },
			]);
			return Promise.resolve({ value: { values: [issue] } });
		});

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
			page: 1,
		});

		assert.equal(calls, 2, 'drains until the provider stops paging');
		assert.deepEqual(result.items, [issue]);

		manager.dispose();
	});

	test('broadenIssues preserves repositories and reports a missing continuation page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);

		let calls = 0;
		stubOrgRepos(gl, (_org, options) => {
			calls++;
			if (options?.cursor != null) {
				return Promise.resolve(undefined);
			}

			return Promise.resolve({
				value: {
					values: [{ name: 'repo-1', namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
				},
			});
		});

		const issue = { id: 'i-1' } as unknown as ProviderIssue;
		stubReposIssues(gl, repos => {
			assert.deepEqual(repos, [{ namespace: 'org', name: 'repo-1' }]);
			return Promise.resolve({ value: { values: [issue] } });
		});

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
			page: 1,
		});

		assert.equal(calls, 2);
		assert.deepEqual(result.items, [issue]);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.page.truncated, true);
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test('broadenIssues maps repo-discovery metadata failures to warnings + fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);

		stubOrgRepos(gl, org =>
			Promise.resolve({
				value: {
					values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: `${org}/bad` } }],
					},
				},
			}),
		);
		stubReposIssues(gl, () => Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } }));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
			page: 1,
		});

		assert.deepEqual(result.items, [{ id: 'i-1' }], 'the successful issues survive the partial repo discovery');
		assert.equal(result.fetchFailed, true, 'repo-discovery metadata failures mark the broadened slice incomplete');
		assert.equal(result.page.truncated, true, 'repo-discovery partial completeness is surfaced as truncation');
		assert.ok(
			result.warnings.some(w => w.kind === 'auth'),
			'the repo-discovery scope failure is surfaced as an auth warning',
		);

		manager.dispose();
	});

	test('broadenIssues maps issue-read metadata failures to warnings + fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);

		stubOrgRepos(gl, org =>
			Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			}),
		);
		stubReposIssues(gl, () =>
			Promise.resolve({
				value: {
					values: [{ id: 'i-1' } as unknown as ProviderIssue],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: 'org/bad' } }],
					},
				},
			}),
		);

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
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
		const { manager, gl } = await connectedGitLab(runtime);

		// The repo drain always claims more but never returns an advancing cursor, so drainRepositories stops
		// at its backstop with `truncated` and no resumable repo cursor. That incompleteness must surface as a
		// terminal page.truncated, NOT hasMore:true with no cursor (which would re-drain the same repos).
		stubOrgRepos(gl, () =>
			Promise.resolve({
				value: {
					values: [{ name: 'r', namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: true, cursor: '{}' },
				},
			}),
		);
		stubReposIssues(gl, () => Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } }));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
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

		let round = 0;
		const capturedCursors: Record<number, Record<string, string | undefined>> = {};
		stubIssueSearch(gh, options => {
			const org = options.org!;
			capturedCursors[round] ??= {};
			capturedCursors[round][org] = options.cursor;
			return Promise.resolve({
				value: searchPage({
					values: [{ id: `${org}-${round}` } as unknown as IssueShape],
					...(round === 0
						? { hasMore: true, cursor: JSON.stringify({ value: `next-${org}`, type: 'cursor' }) }
						: { hasMore: false, cursor: '{}' }),
				}),
			});
		});

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

	test('broadenIssues advances cursor-only providers when the caller supplies only page N', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const capturedCursors: Array<string | undefined> = [];
		stubIssueSearch(gh, options => {
			capturedCursors.push(options.cursor);
			const secondPage = options.cursor != null;
			return Promise.resolve({
				value: searchPage({
					values: [{ id: secondPage ? 'page-2' : 'page-1' } as unknown as IssueShape],
					...(secondPage
						? { hasMore: false, cursor: '{}' }
						: { hasMore: true, cursor: JSON.stringify({ value: 'next', type: 'cursor' }) }),
				}),
			});
		});

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
			page: 2,
		});
		assert.deepEqual(capturedCursors, [undefined, JSON.stringify({ value: 'next', type: 'cursor' })]);
		assert.deepEqual(
			result.items.map(issue => issue.id),
			['page-2'],
			'only the requested page is returned',
		);
		assert.equal(result.page.currentPage, 2);

		manager.dispose();
	});

	test('broadenIssues keeps per-connection cursors separate for two accounts sharing an org name (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Track which connection each read ran under, keyed by the connectionId threaded to the read.
		let round = 0;
		const capturedCursorByConnection: Record<number, Record<string, string | undefined>> = {};
		stubIssueSearch(gh, (options, _cancellation, connectionId) => {
			capturedCursorByConnection[round] ??= {};
			capturedCursorByConnection[round][connectionId ?? 'primary'] = options.cursor;
			return Promise.resolve({
				value: searchPage({
					values: [{ id: `${connectionId}` } as unknown as IssueShape],
					hasMore: true,
					cursor: JSON.stringify({ value: `next-${connectionId}`, type: 'cursor' }),
				}),
			});
		});

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

	test('broadenIssues keeps cursors separate for same-named orgs on different self-managed hosts', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const providerId = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		const gheA = await manager.get(providerId, 'https://ghe-a.example.com/api/v3');
		const gheB = await manager.get(providerId, 'https://ghe-b.example.com/api/v3');
		assert.ok(gheA);
		assert.ok(gheB);

		let round = 0;
		const captured: Record<number, Record<string, string | undefined>> = {};
		const connect = (integration: GitHostIntegration, domain: string) => {
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession(`token-${domain}`),
				domain: domain,
			};
			stubIssueSearch(integration, options => {
				(captured[round] ??= {})[domain] = options.cursor;
				return Promise.resolve({
					value: searchPage({
						hasMore: true,
						cursor: JSON.stringify({ value: `next-${domain}`, type: 'cursor' }),
					}),
				});
			});
		};
		connect(gheA, 'ghe-a.example.com');
		connect(gheB, 'ghe-b.example.com');

		const orgs = [
			{ providerId: providerId, name: 'acme', domain: 'https://ghe-a.example.com/api/v3' },
			{ providerId: providerId, name: 'acme', domain: 'https://ghe-b.example.com/api/v3' },
		];
		const first = await manager.broadenIssues({ orgs: orgs, page: 1 });
		const parsed = JSON.parse(first.cursor!) as {
			cursors: { domain?: string; cursor: string }[];
		};
		assert.deepEqual(parsed.cursors.map(entry => entry.domain).sort(), ['ghe-a.example.com', 'ghe-b.example.com']);

		round = 1;
		await manager.broadenIssues({ orgs: orgs, page: 2, cursor: first.cursor });
		assert.equal(
			captured[1]['ghe-a.example.com'],
			JSON.stringify({ value: 'next-ghe-a.example.com', type: 'cursor' }),
		);
		assert.equal(
			captured[1]['ghe-b.example.com'],
			JSON.stringify({ value: 'next-ghe-b.example.com', type: 'cursor' }),
		);

		manager.dispose();
	});

	test('broadenIssues skips an exhausted org on later rounds instead of re-fetching its first page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let round = 0;
		const reads: Record<number, string[]> = {};
		stubIssueSearch(gh, options => {
			const org = options.org!;
			(reads[round] ??= []).push(org);
			// org-a is exhausted after round 0 (no more); org-b keeps paging into round 1.
			const more = org === 'org-b' && round === 0;
			return Promise.resolve({
				value: searchPage({
					values: [{ id: `${org}-${round}` } as unknown as IssueShape],
					...(more
						? { hasMore: true, cursor: JSON.stringify({ value: `next-${org}`, type: 'cursor' }) }
						: { hasMore: false, cursor: '{}' }),
				}),
			});
		});

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

	test('broadenIssues reports issue providers as unsupported instead of dropping them silently', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.broadenIssues({
			orgs: [{ providerId: IssuesCloudHostIntegrationId.Linear, name: 'linear-org' }],
			page: 1,
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.broadenedProviderIds, []);
		assert.ok(result.warnings.some(w => /issue broadening is not supported/i.test(w.message)));

		manager.dispose();
	});

	test('broadenIssues preserves paging truncation when repo discovery reports top-level false (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);

		stubOrgRepos(gl, () =>
			Promise.resolve({
				value: {
					values: [{ name: 'r', namespace: 'org' } as unknown as ProviderRepository],
					truncated: false,
					paging: { more: false, cursor: '{}', truncated: true },
				},
			}),
		);
		stubReposIssues(gl, () => Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } }));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
			page: 1,
		});

		assert.deepEqual(result.items, [{ id: 'i-1' }]);
		assert.equal(result.page.truncated, true, 'paging truncation survives an explicit false top-level flag');
		assert.equal(result.hasMore, false, 'the incomplete terminal result does not advertise a dead continuation');

		manager.dispose();
	});

	test('broadenIssues preserves repository truncation from a non-terminal page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);
		let repoPage = 0;

		stubOrgRepos(gl, () => {
			repoPage++;
			return Promise.resolve({
				value: {
					values: [
						{
							id: `repo-${repoPage}`,
							name: `repo-${repoPage}`,
							namespace: 'org',
						} as unknown as ProviderRepository,
					],
					truncated: repoPage === 1,
					paging:
						repoPage === 1
							? { more: true, cursor: 'next', truncated: false }
							: { more: false, cursor: '{}', truncated: false },
				},
			});
		});
		stubReposIssues(gl, () => Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } }));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
			page: 1,
		});

		assert.equal(repoPage, 2);
		assert.deepEqual(result.items, [{ id: 'i-1' }]);
		assert.equal(result.page.truncated, true, 'page-1 truncation survives a clean terminal page');

		manager.dispose();
	});

	test('the repository drain collapses the identical soft warning it saw on every page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gl } = await connectedGitLab(runtime);
		let repoPage = 0;

		// A soft warning (`{ value, error }`) repeats verbatim on each page that hits the same condition; the
		// drain accumulates across pages, so it must dedupe like every other accumulation there.
		stubOrgRepos(gl, () => {
			repoPage++;
			return Promise.resolve({
				value: {
					values: [
						{
							id: `repo-${repoPage}`,
							name: `repo-${repoPage}`,
							namespace: 'org',
						} as unknown as ProviderRepository,
					],
					paging:
						repoPage < 3
							? { more: true, cursor: `next-${repoPage}`, truncated: false }
							: { more: false, cursor: '{}', truncated: false },
				},
				error: new Error('partial repository listing'),
			});
		});
		stubReposIssues(gl, () => Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } }));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'org' }],
			page: 1,
		});

		assert.equal(repoPage, 3, 'the drain read every page');
		assert.equal(
			result.warnings.filter(w => w.message.includes('partial repository listing')).length,
			1,
			'the same soft warning on three pages reports once',
		);

		manager.dispose();
	});

	test('broadenIssues collapses the identical warning several orgs of one provider produced', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// One expired token fails every org the same way, so each slice builds a warning with the same
		// provider/domain/kind/message — the case `appendDedupedWarning` exists to collapse.
		stubIssueSearch(gh, () => Promise.resolve({ error: new Error('token expired') }));

		const result = await manager.broadenIssues({
			orgs: [
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-a' },
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-b' },
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org-c' },
			],
			page: 1,
		});

		assert.equal(result.warnings.length, 1, 'three orgs failing identically report one warning, not three');
		assert.equal(result.fanOutCount, 3, 'the fan-out still counted every org');

		manager.dispose();
	});

	// The engine switch itself (#5804): which read runs, what it is asked for, and that the choice is made from
	// what the provider DECLARES rather than from what a stub happens to answer.

	test('broadenIssues reads a GitHub org through the org-scoped search, with no repository drain', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// The drain is stubbed to a value that would SUCCEED, so a call reaching it can't be mistaken for the
		// engine falling back after a failure: it is proof the search path didn't run.
		let repoDrains = 0;
		stubOrgRepos(gh, org => {
			repoDrains++;
			return Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			});
		});
		stubReposIssues(gh, () =>
			Promise.resolve({ value: { values: [{ id: 'from-drain' } as unknown as ProviderIssue] } }),
		);

		let searches = 0;
		const searchOptions: { org?: string; cursor?: string; criteria?: unknown }[] = [];
		stubIssueSearch(gh, options => {
			searches++;
			searchOptions.push(options);
			return Promise.resolve({
				value: searchPage({ values: [{ id: 'from-search' } as unknown as IssueShape] }),
			});
		});

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' }],
			page: 1,
		});

		assert.equal(repoDrains, 0, 'the org is never enumerated: the search reaches it by name');
		assert.equal(searches, 1, 'one request serves the page');
		assert.deepEqual(
			result.items.map(i => i.id),
			['from-search'],
			'the issues come from the search, not the SDK repo-scoped read',
		);
		assert.deepEqual(result.broadenedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		// `criteria` OMITTED is what drops the assignee constraint — the substitution `includeAllAssignees: true`
		// performs on the read this replaces. `['any-assignee']` would mean "assigned to somebody" and exclude
		// every unassigned issue, which is the opposite of broadening.
		assert.deepEqual(searchOptions, [{ org: 'acme', cursor: undefined }]);

		manager.dispose();
	});

	test('broadenIssues falls back to the repository drain for a provider with no filtered issue search', async () => {
		const runtime = createFakeRuntime();
		// GitLab declares no `supportedIssueSearch`, so refusing its orgs would be a regression rather than a
		// saving — the fan-out must keep reading them the way it always has.
		const { manager, gl } = await connectedGitLab(runtime);

		let repoDrains = 0;
		stubOrgRepos(gl, org => {
			repoDrains++;
			return Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			});
		});
		const capturedIssueOptions: ({ cursor?: string } | undefined)[] = [];
		stubReposIssues(gl, (_repos, options) => {
			capturedIssueOptions.push(options);
			return Promise.resolve({ value: { values: [{ id: 'from-drain' } as unknown as ProviderIssue] } });
		});
		let searches = 0;
		stubIssueSearch(gl, () => {
			searches++;
			return Promise.resolve({ value: searchPage() });
		});

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitLab, name: 'acme' }],
			page: 1,
		});

		assert.equal(searches, 0, 'a provider without the capability is never asked to search');
		assert.equal(repoDrains, 1, 'its org is still enumerated');
		assert.deepEqual(
			result.items.map(i => i.id),
			['from-drain'],
		);
		assert.deepEqual(result.broadenedProviderIds, [GitCloudHostIntegrationId.GitLab]);
		// Broaden means ALL VISIBLE on this engine too, which is what `includeAllAssignees` expresses here.
		assert.deepEqual(capturedIssueOptions, [{ includeAllAssignees: true, cursor: undefined }]);

		manager.dispose();
	});

	test('broadenIssues mixes both engines in one fan-out, attributing each provider separately', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		stubIssueSearch(gh, () =>
			Promise.resolve({ value: searchPage({ values: [{ id: 'gh-1' } as unknown as IssueShape] }) }),
		);
		stubOrgRepos(gl, org =>
			Promise.resolve({
				value: { values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository] },
			}),
		);
		stubReposIssues(gl, () => Promise.resolve({ value: { values: [{ id: 'gl-1' } as unknown as ProviderIssue] } }));

		const result = await manager.broadenIssues({
			orgs: [
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' },
				{ providerId: GitCloudHostIntegrationId.GitLab, name: 'acme' },
			],
			page: 1,
		});

		assert.deepEqual(
			result.items.map(i => i.id).sort(),
			['gh-1', 'gl-1'],
			'both engines contribute to the same logical page',
		);
		assert.deepEqual(
			[...result.broadenedProviderIds].sort(),
			[GitCloudHostIntegrationId.GitHub, GitCloudHostIntegrationId.GitLab].sort(),
		);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(result.fanOutCount, 2);

		manager.dispose();
	});

	test('broadenIssues reports the search result ceiling as a quantified omission rather than walking it', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Past GitHub's 1.000-result ceiling the search SUCCEEDS and says how much was withheld — the behavior
		// this replaced the 128-request per-repository recovery walk with (#5804). `truncated` with a
		// `totalCount` over the provider's limit is exactly that case.
		stubIssueSearch(gh, () =>
			Promise.resolve({
				value: searchPage({
					values: [{ id: 'i-1' } as unknown as IssueShape],
					truncated: true,
					totalCount: 19_240,
				}),
			}),
		);

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' }],
			page: 1,
		});

		assert.deepEqual(
			result.items.map(i => i.id),
			['i-1'],
			'the reachable window is still served',
		);
		assert.equal(result.fetchFailed, undefined, 'the ceiling is an omission, not a failure');
		assert.equal(result.page.truncated, true);
		assert.equal(result.hasMore, false, 'the withheld items are unreachable, so no continuation is offered');
		const omission = result.warnings.find(w => w.omission != null)?.omission;
		assert.equal(omission?.kind, 'provider-limit');
		assert.equal(omission?.totalCount, 19_240, 'the consumer can say how many matched');
		assert.equal(omission?.recovery, 'none', 'nothing this read exposes would return them');
		assert.equal(omission?.sort, 'updated:desc', 'the window is named with the order it was selected under');

		manager.dispose();
	});

	test('broadenIssues reports a declared-but-unimplemented search as unsupported, not as an empty org', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// A provider hook that isn't implemented answers `undefined` with no error. Left alone that is
		// indistinguishable from an org with no issues, so it must surface as an explicit failure.
		stubIssueSearch(gh, () => Promise.resolve({ value: undefined }));

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' }],
			page: 1,
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.broadenedProviderIds, []);
		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.ok(result.warnings.some(w => /not supported/i.test(w.message)));

		manager.dispose();
	});

	// An org name that carries nothing is DROPPED by the provider's scope translation rather than rejected
	// (`toGitHubIssueSearchScopeQualifiers` emits no bare `org:`, which GitHub rejects), so an unguarded search
	// of one emits NO scope qualifier and matches every issue on the host — measured at 52 million. A bare
	// `length > 0` check does not catch it: whitespace and quotes are exactly what a name pasted from a config
	// or a URL degrades to, and they sanitize away to nothing.
	for (const name of ['', '   ', '"', '""', '\t\n']) {
		test(`broadenIssues does not search an org named ${JSON.stringify(name)}, which would search the whole host`, async () => {
			const runtime = createFakeRuntime();
			const { manager, gh } = await connectedGitHub(runtime);

			let searches = 0;
			stubIssueSearch(gh, () => {
				searches++;
				return Promise.resolve({ value: searchPage() });
			});
			stubOrgRepos(gh, () => Promise.resolve({ value: { values: [] } }));

			const result = await manager.broadenIssues({
				orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: name }],
				page: 1,
			});

			assert.equal(searches, 0, 'an unscopable org never reaches the search');
			assert.deepEqual(result.items, []);

			manager.dispose();
		});
	}
});
