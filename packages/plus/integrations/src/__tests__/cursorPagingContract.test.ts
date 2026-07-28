import * as assert from 'node:assert/strict';
import { GitPullRequestMergeableState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type {
	ProviderIssue,
	ProviderPullRequest,
	ProviderReposInput,
	ProviderRepository,
} from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins the two halves of the {@link IntegrationManager} paging contract that Kepler's paging depends on:
 *
 * 1. Supplying `cursor` costs exactly ONE upstream request per scope — the facade must never walk the pages
 *    before a threaded continuation. Asserted on the upstream call COUNT, not on behavior, because a
 *    regression here shows up as latency (O(page) requests per page) rather than as a wrong result.
 * 2. Supplying only `page` (> 1) still drains internally. That drain is the supported fallback for a
 *    page-number-only caller (the first read after a refresh, where no cursor was persisted), so these tests
 *    exist to keep it from being deleted as dead code once a consumer threads cursors.
 *
 * Both are also checked against `page.currentPage`, which is positional on every read (see
 * `ProviderPageInfo.currentPage`): a cursor-paged read reports the position the caller addressed, never a
 * stuck 1.
 */

const repos = [{ namespace: 'octocat', name: 'hello' }];
const opaqueCursor = JSON.stringify({ value: 'FROM-PAGE-2', type: 'cursor' });

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

function providerPr(id: string): ProviderPullRequest {
	return {
		id: id,
		number: 1,
		title: `PR ${id}`,
		description: null,
		url: `https://example.com/pull/${id}`,
		state: GitPullRequestState.Open,
		isCrossRepository: false,
		isDraft: false,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		mergedDate: null,
		baseRef: null,
		headRef: null,
		commentCount: null,
		upvoteCount: null,
		commitCount: null,
		fileCount: null,
		additions: null,
		deletions: null,
		author: null,
		assignees: null,
		reviews: null,
		reviewDecision: null,
		repository: { id: `repo-${id}`, name: 'hello', owner: { login: 'octocat' }, remoteInfo: null },
		headRepository: null,
		headCommit: null,
		mergeableState: GitPullRequestMergeableState.Unknown,
		permissions: null,
	};
}

/** A cursor-only page: always reports another page behind a fresh opaque cursor, so a drain never terminates. */
// `T extends object` because `PagedResult.values` is `NonNullable<T>[]`; an unconstrained `T` isn't assignable to it.
function endlessCursorPage<T extends object>(values: T[], round: number): PagedResult<T> {
	return {
		values: values,
		paging: { more: true, cursor: JSON.stringify({ value: `next-${round}`, type: 'cursor' }) },
	};
}

function providerRepo(): ProviderRepository {
	return { id: 'r1', namespace: 'org', name: 'repo' } as unknown as ProviderRepository;
}

suite('cursor paging contract (#5438)', () => {
	test('listRepos: a threaded cursor issues exactly one upstream request', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const seenCursors: (string | undefined)[] = [];
		(
			gh as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = (_org, options) => {
			seenCursors.push(options?.cursor);
			return Promise.resolve({ value: endlessCursorPage([providerRepo()], 2) });
		};

		const result = await manager.listRepos({
			providerId: GitCloudHostIntegrationId.GitHub,
			org: 'org',
			page: 3,
			cursor: opaqueCursor,
		});

		assert.deepEqual(seenCursors, [opaqueCursor], 'the threaded cursor is the only upstream request');
		assert.equal(result.page.currentPage, 3, 'the caller-addressed position is reported, not a stuck 1');
		assert.equal(result.hasMore, true);

		manager.dispose();
	});

	test('listPullRequestsPage repo-scoped: a threaded cursor issues exactly one upstream request', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const seenCursors: (string | undefined)[] = [];
		stubApi(gh, {
			isRepoIdsInput: () => false,
			// PagingMode.Repos = cursor-only, the mode whose page-only reads drain internally.
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { cursor?: string }) => {
				seenCursors.push(opts?.cursor);
				return Promise.resolve(endlessCursorPage([providerPr('1')], seenCursors.length));
			},
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 3,
			cursor: opaqueCursor,
		});

		assert.deepEqual(seenCursors, [opaqueCursor], 'no pages are walked before the threaded cursor');
		assert.equal(result.page.currentPage, 3, 'the caller-addressed position is reported, not a stuck 1');
		assert.equal(result.hasMore, true);

		manager.dispose();
	});

	test('listPullRequestsPage account-wide: a threaded cursor issues exactly one upstream request', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const seenCursors: (string | undefined)[] = [];
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: (options?: {
					cursor?: string;
				}) => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = options => {
			seenCursors.push(options?.cursor);
			return Promise.resolve({ value: endlessCursorPage([providerPr('1')], seenCursors.length) });
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			page: 3,
			cursor: opaqueCursor,
		});

		assert.deepEqual(seenCursors, [opaqueCursor], 'no pages are walked before the threaded cursor');
		assert.equal(result.page.currentPage, 3, 'the caller-addressed position is reported, not a stuck 1');
		assert.equal(result.hasMore, true);

		manager.dispose();
	});

	test('listIssuesPage repo-scoped: a threaded cursor issues exactly one upstream request', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const seenCursors: (string | undefined)[] = [];
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
		});
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<IssueShape>>>;
			}
		).getMyIssuesForReposAsShapesResult = (_repos, options) => {
			seenCursors.push(options?.cursor);
			return Promise.resolve({
				value: endlessCursorPage([{ id: 'i1' } as unknown as IssueShape], seenCursors.length),
			});
		};

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 3,
			cursor: opaqueCursor,
		});

		assert.deepEqual(seenCursors, [opaqueCursor], 'no pages are walked before the threaded cursor');
		assert.equal(result.page.currentPage, 3, 'the caller-addressed position is reported, not a stuck 1');
		assert.equal(result.hasMore, true);

		manager.dispose();
	});

	test('listIssuesPage account-wide: a threaded cursor issues exactly one upstream request', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const seenCursors: (string | undefined)[] = [];
		(
			gh as unknown as {
				searchMyIssuesWithTruncationResult: (
					resources: unknown,
					cancellation: unknown,
					connectionId: unknown,
					options?: { cursor?: string },
				) => Promise<
					IntegrationResult<{
						values: IssueShape[];
						cursor?: string;
						hasMore: boolean;
						truncated: boolean;
					}>
				>;
			}
		).searchMyIssuesWithTruncationResult = (_resources, _cancellation, _connectionId, options) => {
			seenCursors.push(options?.cursor);
			return Promise.resolve({
				value: {
					values: [{ id: 'i1' } as unknown as IssueShape],
					cursor: `next-${seenCursors.length}`,
					hasMore: true,
					truncated: false,
				},
			});
		};

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			page: 3,
			cursor: opaqueCursor,
		});

		assert.deepEqual(seenCursors, [opaqueCursor], 'no pages are walked before the threaded cursor');
		assert.equal(result.page.currentPage, 3, 'the caller-addressed position is reported, not a stuck 1');
		assert.equal(result.hasMore, true);

		manager.dispose();
	});

	test('broadenIssues: a threaded cursor runs exactly one fan-out round', async () => {
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
				value: { values: [{ ...providerRepo(), namespace: org, name: `${org}-repo` }] },
			});

		const seenCursors: (string | undefined)[] = [];
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: (
					repos: ProviderReposInput,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = (_repos, options) => {
			seenCursors.push(options?.cursor);
			return Promise.resolve({
				value: endlessCursorPage([{ id: 'i1' } as unknown as ProviderIssue], seenCursors.length),
			});
		};

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
			page: 3,
			cursor: opaqueCursor,
		});

		assert.deepEqual(seenCursors, [opaqueCursor], 'the fan-out is not re-run for the pages before page 3');
		assert.equal(result.page.currentPage, 3, 'the caller-addressed position is reported');
		assert.equal(result.hasMore, true);

		manager.dispose();
	});

	test('listPullRequestsPage repo-scoped: a page-only caller still drains internally', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				return Promise.resolve(endlessCursorPage([providerPr(`page-${calls}`)], calls));
			},
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 3,
		});

		assert.equal(calls, 3, 'the page-number fallback drains pages 1..3');
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['page-3'],
			'only the requested page is returned',
		);
		assert.equal(result.page.currentPage, 3);

		manager.dispose();
	});

	test('listPullRequestsPage account-wide: a page-only caller still drains internally', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls++;
			return Promise.resolve({ value: endlessCursorPage([providerPr(`page-${calls}`)], calls) });
		};

		const result = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.GitHub, page: 3 });

		assert.equal(calls, 3, 'the page-number fallback drains pages 1..3');
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['page-3'],
			'only the requested page is returned',
		);
		assert.equal(result.page.currentPage, 3);

		manager.dispose();
	});

	test('listIssuesPage repo-scoped: a page-only caller still drains internally', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, { isRepoIdsInput: () => false, getProviderIssuesPagingMode: () => PagingMode.Repos });
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: () => Promise<IntegrationResult<PagedResult<IssueShape>>>;
			}
		).getMyIssuesForReposAsShapesResult = () => {
			calls++;
			return Promise.resolve({
				value: endlessCursorPage([{ id: `page-${calls}` } as unknown as IssueShape], calls),
			});
		};

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 3,
		});

		assert.equal(calls, 3, 'the page-number fallback drains pages 1..3');
		assert.deepEqual(
			result.items.map(issue => issue.id),
			['page-3'],
			'only the requested page is returned',
		);
		assert.equal(result.page.currentPage, 3);

		manager.dispose();
	});

	test('listIssuesPage account-wide: a page-only caller still drains internally', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: IssueShape[]; cursor?: string; hasMore: boolean; truncated: boolean }>
				>;
			}
		).searchMyIssuesWithTruncationResult = () => {
			calls++;
			return Promise.resolve({
				value: {
					values: [{ id: `page-${calls}` } as unknown as IssueShape],
					cursor: `next-${calls}`,
					hasMore: true,
					truncated: false,
				},
			});
		};

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub, page: 3 });

		assert.equal(calls, 3, 'the page-number fallback drains pages 1..3');
		assert.deepEqual(
			result.items.map(issue => issue.id),
			['page-3'],
			'only the requested page is returned',
		);
		assert.equal(result.page.currentPage, 3);

		manager.dispose();
	});

	test('broadenIssues: a page-only caller still advances the fan-out internally', async () => {
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
				value: { values: [{ ...providerRepo(), namespace: org, name: `${org}-repo` }] },
			});

		let calls = 0;
		(
			gh as unknown as {
				getMyIssuesForReposAsShapesResult: () => Promise<IntegrationResult<PagedResult<ProviderIssue>>>;
			}
		).getMyIssuesForReposAsShapesResult = () => {
			calls++;
			return Promise.resolve({
				value: endlessCursorPage([{ id: `page-${calls}` } as unknown as ProviderIssue], calls),
			});
		};

		const result = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'org' }],
			page: 3,
		});

		assert.equal(calls, 3, 'the page-number fallback re-runs the fan-out for pages 1..3');
		assert.deepEqual(
			result.items.map(issue => issue.id),
			['page-3'],
			'only the requested page is returned',
		);
		assert.equal(result.page.currentPage, 3);

		manager.dispose();
	});
});
