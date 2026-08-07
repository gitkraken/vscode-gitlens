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
import type { ProviderIssue, ProviderReposInput, ProviderRepository } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, primarySession } from './sweepHelpers.js';

/**
 * The issue-broadening fan-out: per-org aggregation and warning isolation, `broadenedProviderIds`,
 * `fanOutCount`, and the per-org opaque cursors a multi-org round trip threads back (#5438).
 */

suite('broaden issues fan-out (#5438)', () => {
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
		const manager = createIntegrationManager(runtime);
		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		(
			github as unknown as {
				getRepositoriesForOrgResult: () => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [{ id: 'repo', name: 'repo', namespace: 'acme' } as unknown as ProviderRepository],
				},
			});
		(
			github as unknown as {
				getMyIssuesForReposAsShapesResult: () => Promise<
					IntegrationResult<PagedResult<ProviderIssue>> | undefined
				>;
			}
		).getMyIssuesForReposAsShapesResult = () => Promise.resolve(undefined);

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' }],
			page: 1,
		});

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.ok(result.warnings.some(warning => warning.kind === 'no-connection'));

		manager.dispose();
	});

	test('broadenIssues retains a failed page without advertising retry-only progress', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = org =>
			Promise.resolve({
				value: {
					values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository],
				},
			});

		let failingOrgCalls = 0;
		const captured: Array<{ org: string; cursor?: string }> = [];
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (repos, options) => {
			const org = (repos as { namespace: string }[])[0].namespace;
			captured.push({ org: org, cursor: options?.cursor });
			if (org === 'org-fail' && failingOrgCalls++ === 0) {
				return Promise.resolve({
					error: new Error('temporary issue read failure'),
				} satisfies IntegrationResult<PagedResult<ProviderIssue>>);
			}
			return Promise.resolve({
				value: {
					values: [{ id: `${org}-issue` } as unknown as ProviderIssue],
					paging: { more: false, cursor: '{}' },
				},
			} satisfies IntegrationResult<PagedResult<ProviderIssue>>);
		};

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

	test('broadenIssues preserves repositories and reports a missing continuation page', async () => {
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
			if (options?.cursor != null) {
				return Promise.resolve(undefined);
			}

			return Promise.resolve({
				value: {
					values: [{ name: 'repo-1', namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
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
			assert.deepEqual(repos, [{ namespace: 'org', name: 'repo-1' }]);
			return Promise.resolve({ value: { values: [issue] } });
		};

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
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
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
				) => Promise<IntegrationResult<PagedResult<ProviderRepository> & { metadata?: CollectionMetadata }>>;
			}
		).getRepositoriesForOrgResult = (org: string) =>
			Promise.resolve({
				value: {
					values: [{ name: `${org}-repo`, namespace: org } as unknown as ProviderRepository],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: `${org}/bad` } }],
					},
				},
			});

		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (_repos: ProviderReposInput) =>
			Promise.resolve({ value: { values: [{ id: 'i-1' } as unknown as ProviderIssue] } });

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
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

	test('broadenIssues advances cursor-only providers when the caller supplies only page N', async () => {
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

		const capturedCursors: Array<string | undefined> = [];
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (_repos, options) => {
			capturedCursors.push(options?.cursor);
			const secondPage = options?.cursor != null;
			return Promise.resolve({
				value: {
					values: [{ id: secondPage ? 'page-2' : 'page-1' } as unknown as ProviderIssue],
					paging: secondPage
						? { more: false, cursor: '{}' }
						: { more: true, cursor: JSON.stringify({ value: 'next', type: 'cursor' }) },
				},
			});
		};

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

	test('broadenIssues keeps cursors separate for same-named orgs on different self-managed hosts', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const providerId = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		const gheA = await manager.get(providerId, 'https://ghe-a.example.com/api/v3');
		const gheB = await manager.get(providerId, 'https://ghe-b.example.com/api/v3');
		assert.ok(gheA);
		assert.ok(gheB);

		for (const [integration, domain] of [
			[gheA, 'ghe-a.example.com'],
			[gheB, 'ghe-b.example.com'],
		] as const) {
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession(`token-${domain}`),
				domain: domain,
			};
			(
				integration as unknown as {
					getRepositoriesForOrgResult: (
						org: string,
					) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
				}
			).getRepositoriesForOrgResult = org =>
				Promise.resolve({
					value: {
						values: [
							{
								id: `${domain}-repo`,
								name: 'repo',
								namespace: org,
								webUrl: null,
								httpsUrl: null,
								sshUrl: null,
								defaultBranch: null,
								permissions: null,
							} satisfies ProviderRepository,
						],
					},
				});
		}

		let round = 0;
		const captured: Record<number, Record<string, string | undefined>> = {};
		const stubIssues = (integration: GitHostIntegration, domain: string) => {
			(
				integration as unknown as {
					getMyIssuesForReposAsShapesResult: (
						repos: ProviderReposInput,
						options?: { cursor?: string },
					) => Promise<IntegrationResult<PagedResult<IssueShape>>>;
				}
			).getMyIssuesForReposAsShapesResult = (_repos, options) => {
				(captured[round] ??= {})[domain] = options?.cursor;
				return Promise.resolve({
					value: {
						values: [],
						paging: {
							more: true,
							cursor: JSON.stringify({ value: `next-${domain}`, type: 'cursor' }),
						},
					},
				});
			};
		};
		stubIssues(gheA, 'ghe-a.example.com');
		stubIssues(gheB, 'ghe-b.example.com');

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
		const { manager, gh } = await connectedGitHub(runtime);

		(
			gh as unknown as {
				getRepositoriesForOrgResult: () => Promise<
					IntegrationResult<PagedResult<ProviderRepository> & { truncated?: boolean }>
				>;
			}
		).getRepositoriesForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [{ name: 'r', namespace: 'org' } as unknown as ProviderRepository],
					truncated: false,
					paging: { more: false, cursor: '{}', truncated: true },
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

		assert.deepEqual(result.items, [{ id: 'i-1' }]);
		assert.equal(result.page.truncated, true, 'paging truncation survives an explicit false top-level flag');
		assert.equal(result.hasMore, false, 'the incomplete terminal result does not advertise a dead continuation');

		manager.dispose();
	});

	test('broadenIssues preserves repository truncation from a non-terminal page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		let repoPage = 0;

		(
			gh as unknown as {
				getRepositoriesForOrgResult: () => Promise<
					IntegrationResult<PagedResult<ProviderRepository> & { truncated?: boolean }>
				>;
			}
		).getRepositoriesForOrgResult = () => {
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
		};
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

		assert.equal(repoPage, 2);
		assert.deepEqual(result.items, [{ id: 'i-1' }]);
		assert.equal(result.page.truncated, true, 'page-1 truncation survives a clean terminal page');

		manager.dispose();
	});
});
