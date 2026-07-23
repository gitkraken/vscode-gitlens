import * as assert from 'node:assert/strict';
import { GitPullRequestMergeableState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { AuthenticationError } from '../errors.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type {
	ProviderIssue,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepository,
} from '../providers/models.js';
import { IssueFilter, PagingMode, PullRequestFilter } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the IntegrationService ProviderBackend facade (#5438): page ↔ cursor round-trip, hasMore
 * derivation, neutral warning mapping (auth vs non-auth), and the org/project descriptor mapping.
 */

const repos = [{ namespace: 'octocat', name: 'hello' }];

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

function providerPr(id: string): ProviderPullRequest {
	return {
		id: id,
		number: Number(id),
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

function providerIssue(id: string): ProviderIssue {
	return {
		id: id,
		number: id,
		title: `Issue ${id}`,
		url: `https://github.com/o/r/issues/${id}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
	} as unknown as ProviderIssue;
}

function searchPullRequest(id: string, state: 'open' | 'closed' | 'merged'): PullRequest {
	return {
		id: id,
		nodeId: `node-${id}`,
		title: `PR ${id}`,
		url: `https://example.com/pull/${id}`,
		state: state === 'open' ? 'opened' : state,
		createdDate: new Date('2024-01-01T00:00:00Z'),
		updatedDate: new Date('2024-01-02T00:00:00Z'),
		closedDate: state === 'open' ? undefined : new Date('2024-01-03T00:00:00Z'),
		mergedDate: state === 'merged' ? new Date('2024-01-03T00:00:00Z') : undefined,
		author: { id: 'me', name: 'me', username: 'me', avatarUrl: '', url: 'https://example.com/me' },
		refs: {
			base: { owner: 'octocat', repo: 'hello', sha: 'base' },
			head: { owner: 'octocat', repo: 'hello', sha: 'head', url: 'https://example.com/head' },
			isCrossRepository: false,
		},
		reviewRequests: [],
		latestReviews: [],
		assignees: [],
		commentsCount: 0,
		thumbsUpCount: 0,
		additions: 1,
		deletions: 1,
		isDraft: false,
		provider: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
	} as unknown as PullRequest;
}

const authError = new AuthenticationError(
	{
		providerId: GitCloudHostIntegrationId.GitHub,
		microHash: undefined,
		cloud: true,
		type: 'oauth',
		scopes: ['repo'],
	},
	'auth failed',
);

suite('ProviderBackend surface facade (#5438)', () => {
	test('listPullRequestsPage drains cursor-only hosts to the requested page', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const firstPagePr = providerPr('1');
		const secondPagePrs = [providerPr('2'), providerPr('3')];
		let capturedCursor: string | undefined;
		let page = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { cursor?: string }) => {
				capturedCursor = opts.cursor;
				page += 1;
				// Second page has no more data; the opaque cursor from the first page is threaded to advance.
				return Promise.resolve({
					values: page === 1 ? [firstPagePr] : secondPagePrs,
					paging: {
						more: page === 1,
						cursor: page === 1 ? JSON.stringify({ value: 'NEXT', type: 'cursor' }) : '{}',
					},
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 2,
		});

		assert.equal(
			capturedCursor,
			JSON.stringify({ value: 'NEXT', type: 'cursor' }),
			'page 2 advanced via the opaque cursor from page 1',
		);
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['2', '3'],
			'only the requested page is returned after draining',
		);
		assert.equal(result.page.currentPage, 2, 'currentPage reflects the requested page after draining');
		assert.equal(result.page.itemsPerPage, 2, 'itemsPerPage reflects the returned page after draining');
		assert.equal(result.hasMore, false, 'hasMore reflects the final page');
		assert.equal(result.warnings.length, 0);

		manager.dispose();
	});

	test('a page-type next cursor is threaded back as an opaque continuation', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [],
					paging: { more: true, cursor: JSON.stringify({ value: 3, type: 'page' }) },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});
		assert.equal(result.hasMore, true);
		// A page/offset cursor is a valid opaque continuation and must be threaded back — reads with no
		// caller-visible page to increment (e.g. Bitbucket Server's account-wide PR read) rely on it, and
		// surfacing it never hurts a numbered-page consumer that ignores it.
		assert.equal(result.cursor, JSON.stringify({ value: 3, type: 'page' }), 'page-type cursor is surfaced');

		manager.dispose();
	});

	test('an auth failure becomes a neutral auth warning; the page fetchFailed is set', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.reject(authError),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});
		assert.equal(result.items.length, 0);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].providerId, GitCloudHostIntegrationId.GitHub);
		assert.equal(result.warnings[0].kind, 'auth');
		assert.equal(result.warnings[0].isAuth, true);
		assert.equal(result.fetchFailed, true, 'a hard read failure marks the page as fetchFailed');

		manager.dispose();
	});

	test('a generic failure becomes a non-auth warning', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.reject(new Error('rate boom')),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});
		assert.equal(result.warnings[0].kind, 'other');
		assert.equal(result.warnings[0].isAuth, false);

		manager.dispose();
	});

	test('a partial multi-repo result preserves items, emits a scope warning, and sets fetchFailed + truncation (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const pr = providerPr('1');
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			// A successful sibling repo returns a PR while another repo failed with auth: the SDK reports the
			// survivor's data plus a structured failure, not a thrown rejection.
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [pr],
					paging: { more: false, cursor: '{}' },
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: 'octocat/broken' } }],
					},
				}),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});

		assert.equal(result.items.length, 1, 'the successful sibling PR survives the failed repo');
		assert.equal(result.items[0].id, '1', 'the surviving PR is normalized to the GitLens shape');
		assert.equal(result.fetchFailed, true, 'a structured failure means the collection is incomplete');
		assert.equal(result.page.truncated, true, 'partial completeness sets terminal truncation');
		assert.equal(result.warnings.length, 1, 'one scope-aware warning, no duplicate generic truncation warning');
		assert.equal(result.warnings[0].kind, 'auth');
		assert.equal(result.warnings[0].isAuth, true);
		assert.ok(
			result.warnings[0].message.includes('octocat/broken'),
			'the failed repository scope is named in the warning',
		);

		manager.dispose();
	});

	test('listPullRequestsPage uses GitHub account-wide closed/merged search and surfaces truncation warnings', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: {
					apis: { github: Promise<Record<string, unknown> | undefined> };
				};
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seenStates: string[] = [];
		githubApi.searchMyPullRequestsPage = async (
			_provider: unknown,
			_token: unknown,
			options?: { state?: string },
		) => {
			seenStates.push(options?.state ?? 'open');
			return options?.state === 'closed'
				? { values: [searchPullRequest('1', 'closed')], hasMore: false, truncated: true }
				: { values: [searchPullRequest('2', 'merged')], hasMore: false, truncated: false };
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			states: ['closed', 'merged'],
		});

		assert.deepEqual(seenStates, ['closed', 'merged']);
		assert.equal(result.items.length, 2, 'closed and merged PRs survive the account-wide sweep');
		assert.equal(result.page.truncated, true, 'GitHub search truncation is surfaced on the page');
		assert.equal(result.warnings.length, 1, 'a generic truncation warning is emitted when no metadata explains it');
		assert.equal(result.warnings[0].kind, 'other');

		manager.dispose();
	});

	test('listPullRequestsPage preserves GitHub account-wide per-state cursors', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: {
					apis: { github: Promise<Record<string, unknown> | undefined> };
				};
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seen: { state?: string; cursor?: string }[] = [];
		githubApi.searchMyPullRequestsPage = async (
			_provider: unknown,
			_token: unknown,
			options?: { state?: string; cursor?: string },
		) => {
			seen.push({ state: options?.state, cursor: options?.cursor });
			if (options?.state === 'closed' && options.cursor == null) {
				return { values: [searchPullRequest('1', 'closed')], hasMore: true, cursor: 'closed-next' };
			}

			return {
				values: [
					options?.state === 'closed' ? searchPullRequest('3', 'closed') : searchPullRequest('2', 'merged'),
				],
				hasMore: false,
			};
		};

		const first = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			states: ['closed', 'merged'],
		});

		assert.equal(first.hasMore, true);
		assert.equal(typeof first.cursor, 'string');
		assert.deepEqual(JSON.parse(first.cursor ?? '{}'), { type: 'cursor', cursors: { closed: 'closed-next' } });

		const second = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			states: ['closed', 'merged'],
			cursor: first.cursor,
		});

		// The continuation page must only re-query the states still carrying a cursor. `merged` was exhausted
		// on the first page (no cursor in the bundle), so re-querying it would refetch PR '2' and duplicate it
		// in the sweep, which appends across pages without deduping.
		assert.deepEqual(seen, [
			{ state: 'closed', cursor: undefined },
			{ state: 'merged', cursor: undefined },
			{ state: 'closed', cursor: 'closed-next' },
		]);
		assert.deepEqual(
			second.items.map(pr => pr.id),
			['3'],
			'the continuation page returns only the closed PR, not the already-drained merged PR',
		);

		manager.dispose();
	});

	test('a malformed GitHub per-state cursor degrades to the first page instead of returning empty', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: {
					apis: { github: Promise<Record<string, unknown> | undefined> };
				};
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seen: { state?: string; cursor?: string }[] = [];
		githubApi.searchMyPullRequestsPage = async (
			_provider: unknown,
			_token: unknown,
			options?: { state?: string; cursor?: string },
		) => {
			seen.push({ state: options?.state, cursor: options?.cursor });
			const state = options?.state === 'closed' ? 'closed' : 'merged';
			return {
				values: [searchPullRequest(state === 'closed' ? '1' : '2', state)],
				hasMore: false,
			};
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			states: ['closed', 'merged'],
			cursor: JSON.stringify({ type: 'cursor', cursors: 'not-an-object' }),
		});

		assert.deepEqual(seen, [
			{ state: 'closed', cursor: undefined },
			{ state: 'merged', cursor: undefined },
		]);
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['1', '2'],
			'the malformed continuation falls back to the first page rather than short-circuiting empty',
		);

		manager.dispose();
	});

	test('a mismatched GitHub per-state cursor degrades to the first page instead of returning empty', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: {
					apis: { github: Promise<Record<string, unknown> | undefined> };
				};
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seen: { state?: string; cursor?: string }[] = [];
		githubApi.searchMyPullRequestsPage = async (
			_provider: unknown,
			_token: unknown,
			options?: { state?: string; cursor?: string },
		) => {
			seen.push({ state: options?.state, cursor: options?.cursor });
			return {
				values: [searchPullRequest('1', options?.state === 'open' ? 'open' : 'closed')],
				hasMore: false,
			};
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			states: ['open'],
			cursor: JSON.stringify({ type: 'cursor', cursors: { closed: 'closed-next' } }),
		});

		assert.deepEqual(seen, [{ state: 'open', cursor: undefined }]);
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['1'],
			'the mismatched continuation falls back to the first page rather than short-circuiting empty',
		);

		manager.dispose();
	});

	test('an empty-string GitHub per-state cursor degrades to the first page instead of being forwarded', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: {
					apis: { github: Promise<Record<string, unknown> | undefined> };
				};
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seen: { state?: string; cursor?: string }[] = [];
		githubApi.searchMyPullRequestsPage = async (
			_provider: unknown,
			_token: unknown,
			options?: { state?: string; cursor?: string },
		) => {
			seen.push({ state: options?.state, cursor: options?.cursor });
			return {
				values: [searchPullRequest('1', 'closed')],
				hasMore: false,
			};
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			states: ['closed'],
			cursor: JSON.stringify({ type: 'cursor', cursors: { closed: '' } }),
		});

		assert.deepEqual(seen, [{ state: 'closed', cursor: undefined }]);
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['1'],
		);

		manager.dispose();
	});

	test('listPullRequestsPage derives the self-managed GitHub Enterprise baseUrl for repo reads', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe.example.com');
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			cloud: false,
			domain: 'ghe.example.com',
			protocol: 'https:',
		};

		let baseUrl: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { baseUrl?: string }) => {
				baseUrl = opts.baseUrl;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});

		await manager.listPullRequestsPage({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			repos: repos,
		});

		assert.equal(baseUrl, 'https://ghe.example.com/api/v3');
		manager.dispose();
	});

	test('listIssuesPage derives the self-managed GitHub Enterprise baseUrl for repo reads', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe.example.com');
		assert.ok(gh);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			cloud: false,
			domain: 'ghe.example.com',
			protocol: 'https:',
		};

		let baseUrl: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: (_t: unknown, _r: unknown, opts: { baseUrl?: string }) => {
				baseUrl = opts.baseUrl;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});

		await manager.listIssuesPage({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			repos: repos,
		});

		assert.equal(baseUrl, 'https://ghe.example.com/api/v3');
		manager.dispose();
	});

	test('unknown completeness with no failures truncates without fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const pr = providerPr('1');
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [pr],
					paging: { more: false, cursor: '{}' },
					metadata: { completeness: 'unknown' },
				}),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});

		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].id, '1');
		assert.equal(result.fetchFailed, undefined, 'unknown without a failure is not a fetch failure');
		assert.equal(result.page.truncated, true, 'unknown completeness still cannot claim a complete read');
		assert.equal(result.warnings.length, 1, 'a single generic incompleteness warning');
		assert.equal(result.warnings[0].kind, 'other');

		manager.dispose();
	});

	test('complete metadata leaves a normal paged result unchanged (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const pr = providerPr('1');
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [pr],
					paging: { more: false, cursor: '{}' },
					metadata: { completeness: 'complete' },
				}),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});

		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].id, '1');
		assert.equal(result.fetchFailed, undefined);
		assert.equal(result.page.truncated, undefined, 'complete adds no truncation');
		assert.equal(result.warnings.length, 0);

		manager.dispose();
	});

	test('listIssuesPage drains cursor-only hosts to the requested page', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let capturedCursor: string | undefined;
		let page = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: (_t: unknown, _r: unknown, opts: { cursor?: string }) => {
				capturedCursor = opts.cursor;
				page += 1;
				return Promise.resolve({
					values: page === 1 ? [providerIssue('7')] : [providerIssue('8'), providerIssue('9')],
					paging: {
						more: page === 1,
						cursor: page === 1 ? JSON.stringify({ value: 'NEXT', type: 'cursor' }) : '{}',
					},
				} satisfies PagedResult<ProviderIssue>);
			},
		});

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 2,
		});

		assert.equal(
			capturedCursor,
			JSON.stringify({ value: 'NEXT', type: 'cursor' }),
			'page 2 advanced via the opaque cursor from page 1',
		);
		assert.deepEqual(
			result.items.map(issue => issue.id),
			['8', '9'],
			'only the requested page is returned after draining',
		);
		assert.equal(result.page.currentPage, 2, 'currentPage reflects the requested page after draining');
		assert.equal(result.page.itemsPerPage, 2, 'itemsPerPage reflects the returned page after draining');
		assert.equal(result.hasMore, false, 'hasMore reflects the final page');
		assert.equal(result.warnings.length, 0);

		manager.dispose();
	});

	test('listIssuesPage mirrors the page→cursor round-trip and warning mapping', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const issue = providerIssue('7');
		let capturedCursor: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: (_t: unknown, _r: unknown, opts: { cursor?: string }) => {
				capturedCursor = opts.cursor;
				return Promise.resolve({
					values: [issue],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderIssue>);
			},
		});

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 4,
		});
		assert.equal(capturedCursor, JSON.stringify({ value: 4, type: 'page' }));
		assert.equal(result.items.length, 1, 'the repo-scoped issue is normalized and returned');
		assert.equal(result.items[0].id, '7');
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);

		manager.dispose();
	});

	test('listIssuesPage repo-scoped truncation warning identifies an issue read, not a pull request read (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const issue = providerIssue('7');
		// A single-page repo-scoped read that can't confirm completeness sets `paging.truncated`. The facade
		// must surface it via the shared truncation-warning helper, which is also used by PR reads: the message
		// has to name the issue read, not mislabel it as a pull request read.
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: () =>
				Promise.resolve({
					values: [issue],
					paging: { more: false, cursor: '{}', truncated: true },
				} satisfies PagedResult<ProviderIssue>),
		});

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub, repos: repos });
		assert.equal(result.page.truncated, true, 'a repo-scoped read that signals truncation is reported truncated');
		const truncationWarning = result.warnings.find(w => /truncat/i.test(w.message));
		assert.ok(truncationWarning, 'a warning explains the read was truncated');
		assert.ok(
			truncationWarning.message.startsWith('Issue read'),
			'the warning names an issue read, not a pull request read',
		);

		manager.dispose();
	});

	test('listIssuesPage with no repos reads the account-wide user issues core (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let reposCoreCalled = false;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: () => {
				reposCoreCalled = true;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});
		// The account-wide core returns normalized IssueShapes with a truncation flag; stub the truncation-aware
		// model hook the empty-repos path now uses.
		(
			gh as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: IssueShape[]; truncated: boolean }>
				>;
			}
		).searchMyIssuesWithTruncationResult = () =>
			Promise.resolve({ value: { values: [{ id: 'mine' } as unknown as IssueShape], truncated: false } });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });
		assert.equal(
			reposCoreCalled,
			false,
			'no repos → the repo-scoped core (which rejects empty input) is not called',
		);
		assert.equal(result.items.length, 1, 'account-wide user issues are returned');
		assert.equal(result.items[0].id, 'mine');

		manager.dispose();
	});

	test('listIssuesPage account-wide reports truncated + a warning when the provider caps the search (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		// GitHub caps each authored/assigned/mentioned category at 100 with no cursor; when the read is capped
		// the facade must surface it as truncated + a warning, not a complete list.
		(
			gh as unknown as {
				searchMyIssuesWithTruncationResult: () => Promise<
					IntegrationResult<{ values: IssueShape[]; truncated: boolean }>
				>;
			}
		).searchMyIssuesWithTruncationResult = () =>
			Promise.resolve({ value: { values: [{ id: 'mine' } as unknown as IssueShape], truncated: true } });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });
		assert.equal(result.page.truncated, true, 'a capped account-wide read is reported truncated');
		assert.ok(
			result.warnings.some(w => /truncat/i.test(w.message)),
			'a warning explains the read was capped',
		);

		manager.dispose();
	});

	test('listIssuesPage reads GitLab account-wide issues (assigned-to-me by default) instead of reporting unsupported (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		let capturedScope: string | undefined;
		let capturedAssignee: string | undefined | 'unset' = 'unset';
		stubApi(gl, {
			getIssuesForCurrentUser: (_t: unknown, opts: { scope?: string; assigneeUsername?: string }) => {
				capturedScope = opts.scope;
				capturedAssignee = opts.assigneeUsername;
				return Promise.resolve({
					values: [
						{
							id: 'gl-1',
							number: '1',
							url: 'u',
							updatedDate: new Date(),
							labels: [],
							assignees: [],
						} as unknown as ProviderIssue,
					],
					paging: { more: false, cursor: '{}' },
				});
			},
		});
		(
			gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab });
		assert.equal(result.items.length, 1, 'GitLab account-wide issues are returned');
		assert.equal(
			result.warnings.some(w => /not supported/i.test(w.message)),
			false,
			'GitLab is no longer reported as unsupported for account-wide issues',
		);
		assert.equal(capturedScope, 'assigned_to_me', 'the default read is scoped to the current user');
		assert.equal(capturedAssignee, 'me', 'the assignee is the resolved current user');

		manager.dispose();
	});

	test('listIssuesPage broadens GitLab account-wide to scope=all with no assignee when includeAllAssignees is set (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		let capturedScope: string | undefined;
		let capturedAssignee: string | undefined | 'unset' = 'unset';
		let currentUserCalled = false;
		stubApi(gl, {
			getCurrentUser: () => {
				currentUserCalled = true;
				return Promise.resolve({ username: 'me', name: 'Me' });
			},
			getIssuesForCurrentUser: (_t: unknown, opts: { scope?: string; assigneeUsername?: string }) => {
				capturedScope = opts.scope;
				capturedAssignee = opts.assigneeUsername;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});

		await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab, includeAllAssignees: true });
		assert.equal(capturedScope, 'all', 'includeAllAssignees broadens to every visible issue');
		assert.equal(capturedAssignee, undefined, 'the all-assignees read drops the per-user assignee filter');
		assert.equal(
			currentUserCalled,
			false,
			'no current-user lookup is needed when the read is not scoped to the user',
		);

		manager.dispose();
	});

	test('listIssuesPage reports GitLab account-wide truncation when the page backstop is hit (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		// Every page reports another page, so the drain never terminates on its own and must stop at the backstop.
		let calls = 0;
		stubApi(gl, {
			getIssuesForCurrentUser: () => {
				calls++;
				return Promise.resolve({
					values: [
						{
							id: `gl-${calls}`,
							number: `${calls}`,
							url: 'u',
							updatedDate: new Date(),
							labels: [],
							assignees: [],
						} as unknown as ProviderIssue,
					],
					paging: { more: true, cursor: JSON.stringify({ value: calls, type: 'page' }) },
				});
			},
		});
		(
			gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab });
		assert.equal(result.page.truncated, true, 'an unbounded read is capped at the backstop and reported truncated');
		assert.ok(
			result.warnings.some(w => /truncat/i.test(w.message)),
			'a warning explains the read was truncated',
		);

		manager.dispose();
	});

	test('listIssuesPage marks GitLab account-wide reads truncated when the provider reports more but no usable cursor (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		let calls = 0;
		stubApi(gl, {
			getIssuesForCurrentUser: () => {
				calls++;
				return Promise.resolve({
					values: [
						{
							id: 'gl-1',
							number: '1',
							url: 'u',
							updatedDate: new Date(),
							labels: [],
							assignees: [],
						} as unknown as ProviderIssue,
					],
					paging: { more: true, cursor: '{}' },
				});
			},
		});
		(
			gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab });
		assert.equal(calls, 1, 'the drain stops immediately when no usable continuation exists');
		assert.equal(result.page.truncated, true, 'more-without-cursor is treated as an incomplete read');

		manager.dispose();
	});

	test('listIssuesPage marks GitLab account-wide reads truncated when the cursor stalls (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		let calls = 0;
		stubApi(gl, {
			getIssuesForCurrentUser: () => {
				calls++;
				return Promise.resolve({
					values: [
						{
							id: `gl-${calls}`,
							number: `${calls}`,
							url: `u-${calls}`,
							updatedDate: new Date(),
							labels: [],
							assignees: [],
						} as unknown as ProviderIssue,
					],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
				});
			},
		});
		(
			gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab });
		assert.equal(calls, 2, 'the drain stops when the provider repeats the same continuation');
		assert.equal(result.page.truncated, true, 'a stalled cursor is treated as an incomplete read');

		manager.dispose();
	});

	test('GitLab account-wide dedups by url, not the per-project issue number (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		// Two issues from different projects share iid `1` (IssueShape.id === number === iid), plus a genuine
		// cross-page duplicate by url. Dedup must key on url so the distinct same-iid issues both survive and the
		// real duplicate collapses.
		const issue = (number: string, url: string) =>
			({
				id: `gid-${url}`,
				number: number,
				url: url,
				updatedDate: new Date(),
				labels: [],
				assignees: [],
			}) as unknown as ProviderIssue;
		let call = 0;
		stubApi(gl, {
			getIssuesForCurrentUser: () => {
				call++;
				return call === 1
					? Promise.resolve({
							values: [
								issue('1', 'https://gitlab.com/a/repo/-/issues/1'),
								issue('1', 'https://gitlab.com/b/repo/-/issues/1'),
							],
							paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
						})
					: Promise.resolve({
							// Repeats the first issue's url (a cross-page duplicate) plus a new one.
							values: [
								issue('1', 'https://gitlab.com/a/repo/-/issues/1'),
								issue('7', 'https://gitlab.com/a/repo/-/issues/7'),
							],
							paging: { more: false, cursor: '{}' },
						});
			},
		});
		(
			gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab });
		const urls = result.items.map(i => i.url).sort();
		assert.deepEqual(
			urls,
			[
				'https://gitlab.com/a/repo/-/issues/1',
				'https://gitlab.com/a/repo/-/issues/7',
				'https://gitlab.com/b/repo/-/issues/1',
			],
			'same-iid issues from different repos both survive; the cross-page url duplicate is collapsed',
		);

		manager.dispose();
	});

	test('GitLab account-wide propagates a single-page SDK truncation signal (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		// A single page (no more pages) that the SDK flags as truncated (e.g. metadata incompleteness) must still
		// mark the read truncated — the backstop is not the only truncation source.
		stubApi(gl, {
			getIssuesForCurrentUser: () =>
				Promise.resolve({
					values: [
						{
							id: 'gl-1',
							number: '1',
							url: 'u',
							updatedDate: new Date(),
							labels: [],
							assignees: [],
						} as unknown as ProviderIssue,
					],
					paging: { more: false, cursor: '{}', truncated: true },
				}),
		});
		(
			gl as unknown as { getProviderCurrentAccount: () => Promise<{ username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ username: 'me' });

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitLab });
		assert.equal(result.items.length, 1, 'the page items still surface');
		assert.equal(result.page.truncated, true, 'the SDK truncation flag is propagated even without a backstop hit');

		manager.dispose();
	});

	test('listIssuesPage rejects GitHub account-wide includeAllAssignees instead of advertising an unsupported read (#5535)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let accountWideCalled = false;
		(
			gh as unknown as {
				searchProviderMyIssuesWithTruncation: (
					s: unknown,
					r: unknown,
					c: unknown,
					o?: { includeAllAssignees?: boolean },
				) => Promise<{ values: IssueShape[]; truncated: boolean }>;
			}
		).searchProviderMyIssuesWithTruncation = () => {
			accountWideCalled = true;
			return Promise.resolve({ values: [], truncated: false });
		};

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			includeAllAssignees: true,
		});
		assert.equal(
			accountWideCalled,
			false,
			'the unsupported account-wide read is rejected before the provider call',
		);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.some(w => /includeAllAssignees/i.test(w.message)));

		manager.dispose();
	});

	test('listOrgs maps issue-tracker resource descriptors to the unified org shape', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);

		const resources: ResourceDescriptor[] = [
			{ key: 'k1', id: 'id1', name: 'Name1', url: 'https://linear.app/id1' },
			{ key: 'k2' }, // bare descriptor: id/name fall back to key, url synthesized to ''
		];
		(
			linear as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: resources });

		const result = await manager.listOrgs({ providerId: IssuesCloudHostIntegrationId.Linear });
		assert.deepEqual(result.items, [
			{ id: 'id1', name: 'Name1', url: 'https://linear.app/id1' },
			{ id: 'k2', name: 'k2', url: '' },
		]);
		assert.equal(result.warnings.length, 0);

		manager.dispose();
	});

	test('listOrgs surfaces git-host collection metadata as warnings + fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		(
			bb as unknown as {
				getOrganizationsForUserResult: () => Promise<{
					value: { values: ProviderOrganization[]; metadata: { completeness: string; failures: unknown[] } };
				}>;
			}
		).getOrganizationsForUserResult = () =>
			Promise.resolve({
				value: {
					values: [{ id: 'ws-1', name: 'acme', url: 'https://bitbucket.org/acme' }],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { resourceId: 'ws-bad' } }],
					},
				},
			});

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.Bitbucket });
		assert.deepEqual(result.items, [{ id: 'ws-1', name: 'acme', url: 'https://bitbucket.org/acme' }]);
		assert.equal(result.fetchFailed, true, 'metadata failures mark the read incomplete');
		assert.ok(
			result.warnings.some(w => w.kind === 'auth'),
			'the scope failure is surfaced as an auth warning',
		);

		manager.dispose();
	});

	test('listOrgs reports a Bitbucket workspace-discovery backstop as truncated, not fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		// The workspace drain hit its page backstop (`paging.truncated`). That's truncation, not a read
		// failure: the read succeeded but stopped short. It must surface an incompleteness warning without
		// `fetchFailed`, which would otherwise flag the workspaces it did return as a broken read.
		stubApi(bb, {
			getBitbucketResourcesForCurrentUser: () =>
				Promise.resolve({
					values: [{ id: 'ws-1', slug: 'acme', name: 'Acme' }],
					paging: { cursor: '{}', more: false, truncated: true },
				}),
		});

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.Bitbucket });
		assert.deepEqual(result.items, [{ id: 'ws-1', name: 'acme', url: 'https://bitbucket.org/acme' }]);
		assert.notEqual(result.fetchFailed, true, 'a backstop is truncation, not a read failure');
		assert.ok(
			result.warnings.some(w => /incomplete|omitted|completeness/i.test(w.message)),
			'the truncation surfaces an incompleteness warning',
		);

		manager.dispose();
	});

	test('listOrgs/listProjects set fetchFailed (not just a warning) for an invalid connection (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		void linear;

		// An unresolved connectionId makes getIntegrationForRead return undefined — a broken connection, not an
		// empty account. Both list reads must surface fetchFailed alongside the no-connection warning so a
		// caller can tell them apart (parity with listRepos).
		(manager as unknown as { getIntegrationForRead: () => Promise<undefined> }).getIntegrationForRead = () =>
			Promise.resolve(undefined);

		const orgs = await manager.listOrgs({
			providerId: IssuesCloudHostIntegrationId.Linear,
			connectionId: 'ghost',
		});
		assert.equal(orgs.items.length, 0);
		assert.equal(orgs.fetchFailed, true, 'listOrgs reports fetchFailed for a broken connection');
		assert.ok(
			orgs.warnings.some(w => w.kind === 'no-connection'),
			'listOrgs still emits a no-connection warning',
		);

		const projects = await manager.listProjects({
			providerId: IssuesCloudHostIntegrationId.Linear,
			connectionId: 'ghost',
		});
		assert.equal(projects.items.length, 0);
		assert.equal(projects.fetchFailed, true, 'listProjects reports fetchFailed for a broken connection');
		assert.ok(
			projects.warnings.some(w => w.kind === 'no-connection'),
			'listProjects still emits a no-connection warning',
		);

		manager.dispose();
	});

	test('listProjects maps issue-tracker projects for a single provider', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);

		(
			linear as unknown as {
				getProjectsForUserWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForUserWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });

		const result = await manager.listProjects({ providerId: IssuesCloudHostIntegrationId.Linear });
		assert.deepEqual(result.items, [{ id: 'p1', name: 'Project One', url: '' }]);

		manager.dispose();
	});

	test('listProjects surfaces git-host project metadata as warnings + fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		(
			azure as unknown as {
				getProjectsForOrgResult: () => Promise<{
					value: { values: ProviderOrganization[]; metadata: { completeness: string; failures: unknown[] } };
				}>;
			}
		).getProjectsForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [{ id: 'p1', name: 'Proj', url: 'https://dev.azure.com/org/Proj' }],
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { projectId: 'broken' } }],
					},
				},
			});

		const result = await manager.listProjects({ providerId: GitCloudHostIntegrationId.AzureDevOps });
		assert.deepEqual(result.items, [{ id: 'p1', name: 'Proj', url: 'https://dev.azure.com/org/Proj' }]);
		assert.equal(result.fetchFailed, true, 'metadata failures mark the read incomplete');
		assert.ok(
			result.warnings.some(w => w.kind === 'auth'),
			'the scope failure is surfaced as an auth warning',
		);

		manager.dispose();
	});

	test('listProjects scopes projects to the requested org resource', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		const resources: ResourceDescriptor[] = [
			{ key: 'one', id: 'org-1', name: 'Org One' },
			{ key: 'two', id: 'org-2', name: 'Org Two' },
		];
		let capturedResources: ResourceDescriptor[] | undefined;
		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: resources });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: (
					resources: ResourceDescriptor[],
				) => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = (scopedResources: ResourceDescriptor[]) => {
			capturedResources = scopedResources;
			return Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });
		};

		const result = await manager.listProjects({ providerId: IssuesCloudHostIntegrationId.Jira, org: 'org-2' });
		assert.deepEqual(capturedResources, [resources[1]]);
		assert.deepEqual(result.items, [{ id: 'p1', name: 'Project One', url: '' }]);

		manager.dispose();
	});

	test('an unresolved connectionId yields a no-connection warning, not a silent empty read (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		// The core returns undefined (no session) for a connection that can't be resolved. Without a supplied
		// connectionId that's a legit empty read; WITH one it means the account is gone/invalid.
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.resolve(undefined),
		});
		(gh as unknown as { resolveReadSession: () => Promise<undefined> }).resolveReadSession = () =>
			Promise.resolve(undefined);

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			connectionId: 'ghost',
		});
		assert.equal(result.items.length, 0);
		assert.equal(result.warnings.length, 1, 'a broken connection surfaces a warning');
		assert.equal(result.warnings[0].kind, 'no-connection');
		assert.equal(result.warnings[0].connectionId, 'ghost');
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});

	test('a primary (no connectionId) empty read stays a silent empty result (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.resolve(undefined),
		});
		(gh as unknown as { resolveReadSession: () => Promise<undefined> }).resolveReadSession = () =>
			Promise.resolve(undefined);

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});
		assert.equal(result.items.length, 0);
		assert.equal(result.warnings.length, 0, 'no connectionId → not connected is not a warning');
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('listPullRequestsPage forwards page + pageSize to the read core for Repo-mode hosts (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		let capturedPage: number | undefined;
		let capturedPageSize: number | undefined;
		stubApi(gl, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repo,
			getCurrentUser: () => Promise.resolve({ username: 'me' }),
			// PagingMode.Repo reads per repo via getPullRequestsForRepo (singular), where the page-number cursor
			// isn't understood — the requested page/pageSize must be forwarded explicitly.
			getPullRequestsForRepo: (_t: unknown, _r: unknown, opts: { page?: number; pageSize?: number }) => {
				capturedPage = opts.page;
				capturedPageSize = opts.pageSize;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});

		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitLab,
			repos: [{ namespace: 'g', name: 'r' }],
			page: 3,
			itemsPerPage: 25,
		});
		assert.equal(capturedPage, 3, 'the requested page reaches the core (Repo-mode ignores a page cursor)');
		assert.equal(capturedPageSize, 25, 'the requested page size reaches the core');

		manager.dispose();
	});

	test('a malformed Repo-mode cursor degrades to the first page instead of throwing (#5481)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		let called = false;
		stubApi(gl, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repo,
			getCurrentUser: () => Promise.resolve({ username: 'me' }),
			getPullRequestsForRepo: () => {
				called = true;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});

		// A cursor whose `cursors` is a truthy non-array would bypass the `?? []` fallback and reach `.map()`,
		// throwing. parseCursorInfo must reject the shape so the read falls back to the first page.
		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitLab,
			repos: [{ namespace: 'g', name: 'r' }],
			cursor: JSON.stringify({ cursors: 'not-an-array' }),
		});
		assert.equal(called, true, 'the read still runs (first page) rather than throwing on the bad cursor');
		assert.equal(result.warnings.length, 0);

		manager.dispose();
	});

	test('listProjects discovers Azure DevOps projects via the git-host project hook (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		(
			azure as unknown as {
				getProjectsForOrgResult: (org?: string) => Promise<{ value: PagedResult<ProviderOrganization> }>;
			}
		).getProjectsForOrgResult = () =>
			Promise.resolve({ value: { values: [{ id: 'p1', name: 'Proj', url: 'https://dev.azure.com/org/Proj' }] } });

		const result = await manager.listProjects({ providerId: GitCloudHostIntegrationId.AzureDevOps });
		assert.deepEqual(result.items, [{ id: 'p1', name: 'Proj', url: 'https://dev.azure.com/org/Proj' }]);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage aggregates issues across an org projects for issue providers (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		const resources: ResourceDescriptor[] = [{ key: 'one', id: 'org-1', name: 'Org One' }];
		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: resources });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });
		(
			jira as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		let capturedUser: string | undefined;
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: (
					p: unknown,
					o?: { user?: string },
				) => Promise<{ value: { values: IssueShape[]; truncated: boolean } }>;
			}
		).getIssuesForProjectWithTruncationResult = (_p: unknown, o?: { user?: string }) => {
			capturedUser = o?.user;
			return Promise.resolve({ value: { values: [{ id: 'i1' } as unknown as IssueShape], truncated: false } });
		};

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });
		assert.equal(result.items.length, 1, 'issues from the org projects are aggregated');
		assert.equal(capturedUser, 'me', 'defaults to the current-user scope');

		const broadened = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});
		assert.equal(broadened.items.length, 1);
		assert.equal(capturedUser, undefined, 'includeAllAssignees drops the user scope');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage resolves the current user per resource, not just from the first one (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		const resources: ResourceDescriptor[] = [
			{ key: 'one', id: 'org-1', name: 'Org One' },
			{ key: 'two', id: 'org-2', name: 'Org Two' },
		];
		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: resources });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({
				value: {
					values: [
						{ key: 'p1', id: 'p1', name: 'Project One', resourceId: 'org-1' },
						{ key: 'p2', id: 'p2', name: 'Project Two', resourceId: 'org-2' },
					],
				},
			});
		(
			jira as unknown as {
				getAccountForResourceResult: (resource: ResourceDescriptor) => Promise<{ value: { username: string } }>;
			}
		).getAccountForResourceResult = (resource: ResourceDescriptor) => {
			const resourceId = (resource as { id?: string; key: string }).id ?? resource.key;
			return Promise.resolve({ value: { username: `${resourceId}-user` } });
		};

		const capturedReads: Array<{ projectId: string; user: string | undefined }> = [];
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: (
					p: { id: string },
					o?: { user?: string },
				) => Promise<{ value: { values: IssueShape[]; truncated: boolean } }>;
			}
		).getIssuesForProjectWithTruncationResult = (p: { id: string }, o?: { user?: string }) => {
			capturedReads.push({ projectId: p.id, user: o?.user });
			return Promise.resolve({
				value: { values: [{ id: `${p.id}-i` } as unknown as IssueShape], truncated: false },
			});
		};

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });
		assert.equal(result.items.length, 2, 'issues from both resources are aggregated');
		assert.deepEqual(capturedReads, [
			{ projectId: 'p1', user: 'org-1-user' },
			{ projectId: 'p2', user: 'org-2-user' },
		]);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage pages by project window with a next-page cursor (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		// Three projects; with itemsPerPage 2 the first page covers 2 and reports a next-page cursor.
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({
				value: {
					values: [
						{ key: 'p1', id: 'p1', name: 'P1' },
						{ key: 'p2', id: 'p2', name: 'P2' },
						{ key: 'p3', id: 'p3', name: 'P3' },
					],
				},
			});
		(
			jira as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		const readProjects: string[] = [];
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: (p: {
					id: string;
				}) => Promise<{ value: { values: IssueShape[]; truncated: boolean } }>;
			}
		).getIssuesForProjectWithTruncationResult = (p: { id: string }) => {
			readProjects.push(p.id);
			return Promise.resolve({
				value: { values: [{ id: `${p.id}-i` } as unknown as IssueShape], truncated: false },
			});
		};

		const first = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 2,
		});
		assert.deepEqual(readProjects, ['p1', 'p2'], 'first page reads the first project window');
		assert.equal(first.hasMore, true, 'more project windows remain');
		assert.ok(first.cursor != null, 'a next-page cursor is threaded');

		readProjects.length = 0;
		const second = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 2,
			cursor: first.cursor,
		});
		assert.deepEqual(readProjects, ['p3'], 'the cursor advances to the remaining project');
		assert.equal(second.hasMore, false, 'no more windows after the last');
		assert.equal(second.cursor, undefined);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage: no paging options reads every project (no silent default-window cap) (#5438)', async () => {
		// A caller that passes none of page/cursor/itemsPerPage keeps the "aggregate everything" contract:
		// all matched projects are read in one page even past the default window of 20, with hasMore false.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		const projects = Array.from({ length: 25 }, (_, i) => ({ key: `p${i}`, id: `p${i}`, name: `P${i}` }));
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () => Promise.resolve({ value: { values: projects } });
		(
			jira as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		let reads = 0;
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: (p: {
					id: string;
				}) => Promise<{ value: { values: IssueShape[]; truncated: boolean } }>;
			}
		).getIssuesForProjectWithTruncationResult = (p: { id: string }) => {
			reads += 1;
			return Promise.resolve({
				value: { values: [{ id: `${p.id}-i` } as unknown as IssueShape], truncated: false },
			});
		};

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });
		assert.equal(reads, 25, 'every matched project is read, not just the first default window');
		assert.equal(result.items.length, 25, 'issues from all projects are aggregated');
		assert.equal(result.hasMore, false, 'a non-paged read reports no further windows');
		assert.equal(result.cursor, undefined);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage: an unsupported issue filter warns + fetchFailed instead of degrading (#5438)', async () => {
		// Linear/Trello support only the Assignee filter. A caller asking for Author must not silently get an
		// Assignee-scoped (or unfiltered) set — it must be surfaced as a warning + fetchFailed.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);

		(
			linear as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			linear as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 't1', id: 't1', name: 'Team 1' }] } });
		let read = false;
		(
			linear as unknown as {
				getIssuesForProjectWithTruncationResult: () => Promise<{
					value: { values: IssueShape[]; truncated: boolean };
				}>;
			}
		).getIssuesForProjectWithTruncationResult = () => {
			read = true;
			return Promise.resolve({ value: { values: [], truncated: false } });
		};

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			filters: [IssueFilter.Author],
		});
		assert.equal(result.items.length, 0);
		assert.equal(result.fetchFailed, true, 'an unsupported filter is a failed read, not an empty result');
		assert.ok(result.warnings.length >= 1, 'a warning explains the unsupported filter');
		assert.equal(read, false, 'no project is read when the filter is unsupported');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage: an exact-boundary window (projects === itemsPerPage) is not marked hasMore (#5438)', async () => {
		// Guards the `>` vs `>=` boundary in `moreProjectWindows`: exactly itemsPerPage projects is a single
		// full page with nothing left over, so hasMore must be false and no cursor threaded.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({
				value: {
					values: [
						{ key: 'p1', id: 'p1', name: 'P1' },
						{ key: 'p2', id: 'p2', name: 'P2' },
					],
				},
			});
		(
			jira as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: (p: {
					id: string;
				}) => Promise<{ value: { values: IssueShape[]; truncated: boolean } }>;
			}
		).getIssuesForProjectWithTruncationResult = (p: { id: string }) =>
			Promise.resolve({ value: { values: [{ id: `${p.id}-i` } as unknown as IssueShape], truncated: false } });

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			itemsPerPage: 2,
		});
		assert.equal(result.items.length, 2, 'both projects fit in the single boundary page');
		assert.equal(result.hasMore, false, 'exactly itemsPerPage projects leaves nothing for a next window');
		assert.equal(result.cursor, undefined, 'no cursor when there is no next window');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage: a project filter matching nothing returns an empty page, not an error (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'p1', id: 'p1', name: 'P1' }] } });
		(
			jira as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		let issueReads = 0;
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: () => Promise<{
					value: { values: IssueShape[]; truncated: boolean };
				}>;
			}
		).getIssuesForProjectWithTruncationResult = () => {
			issueReads += 1;
			return Promise.resolve({ value: { values: [], truncated: false } });
		};

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			project: 'does-not-exist',
		});
		assert.equal(result.items.length, 0, 'no issues when the project filter matches nothing');
		assert.equal(result.hasMore, false);
		assert.equal(result.fetchFailed, undefined, 'a zero-match filter is an empty page, not a failure');
		assert.equal(issueReads, 0, 'no project is read when none match the filter');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage surfaces a failed issue read as a warning + fetchFailed, not empty (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);

		(
			linear as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			linear as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });
		(
			linear as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		// A thrown/unsupported read (Linear's not-implemented) recovers into { error } at the result core.
		(
			linear as unknown as { getIssuesForProjectWithTruncationResult: () => Promise<{ error: Error }> }
		).getIssuesForProjectWithTruncationResult = () =>
			Promise.resolve({ error: new Error('Method not implemented.') });

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Linear });
		assert.equal(result.items.length, 0);
		assert.equal(result.fetchFailed, true, 'a failed read is not silently reported as empty');
		assert.ok(result.warnings.length >= 1, 'the failure surfaces a warning');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage warns instead of broadening when the current user cannot be resolved (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });
		// Current-user lookup fails → undefined. Must NOT broaden to all-visible.
		(
			jira as unknown as { getAccountForResourceResult: () => Promise<{ value: undefined }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: undefined });
		let readCalled = false;
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: () => Promise<{
					value: { values: IssueShape[]; truncated: boolean };
				}>;
			}
		).getIssuesForProjectWithTruncationResult = () => {
			readCalled = true;
			return Promise.resolve({ value: { values: [], truncated: false } });
		};

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });
		assert.equal(readCalled, false, 'the issue read is skipped rather than run unscoped (all-visible)');
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length >= 1, 'the unresolved-user failure surfaces a warning');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage warns on includeAllAssignees combined with an author filter (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			jira as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });
		let readCalled = false;
		(
			jira as unknown as {
				getIssuesForProjectWithTruncationResult: () => Promise<{
					value: { values: IssueShape[]; truncated: boolean };
				}>;
			}
		).getIssuesForProjectWithTruncationResult = () => {
			readCalled = true;
			return Promise.resolve({ value: { values: [], truncated: false } });
		};

		// includeAllAssignees drops the user scope, but an author filter needs one; the combination would make
		// Jira fall through to an unscoped fetch returning EVERY issue. The facade must reject it, not read.
		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
			filters: [IssueFilter.Author],
		});
		assert.equal(readCalled, false, 'the read is skipped rather than run unscoped');
		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.some(w => /includeAllAssignees/i.test(w.message)),
			'the incompatible combination is surfaced as a warning',
		);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage surfaces a provider-native truncation as a warning + page.truncated, not fetchFailed (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);

		(
			linear as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		(
			linear as unknown as {
				getProjectsForResourcesWithMetadataResult: () => Promise<{ value: { values: ResourceDescriptor[] } }>;
			}
		).getProjectsForResourcesWithMetadataResult = () =>
			Promise.resolve({ value: { values: [{ key: 'proj', id: 'p1', name: 'Project One' }] } });
		(
			linear as unknown as { getAccountForResourceResult: () => Promise<{ value: { username: string } }> }
		).getAccountForResourceResult = () => Promise.resolve({ value: { username: 'me' } });
		// A provider-native cap (e.g. Trello's cards_limit) returns data but flags truncation with no cursor.
		(
			linear as unknown as {
				getIssuesForProjectWithTruncationResult: () => Promise<{
					value: { values: IssueShape[]; truncated: boolean };
				}>;
			}
		).getIssuesForProjectWithTruncationResult = () =>
			Promise.resolve({ value: { values: [{ id: 'i1' } as unknown as IssueShape], truncated: true } });

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Linear });

		assert.equal(result.items.length, 1, 'the cards the provider did return are preserved');
		assert.equal(result.page.truncated, true, 'a provider-native cap sets terminal truncation');
		assert.equal(result.hasMore, false, 'no next window — a cap is terminal, not paginated');
		assert.equal(result.cursor, undefined, 'no cursor is invented for a provider-native cap');
		assert.equal(result.fetchFailed, undefined, 'a successful-but-capped read is not a fetch failure');
		assert.equal(result.warnings.length, 1, 'a single provider-neutral incompleteness warning');
		assert.equal(result.warnings[0].kind, 'other');
		assert.ok(
			!/100 per category/i.test(result.warnings[0].message),
			'the warning is provider-neutral, not the GitHub account-wide text',
		);

		manager.dispose();
	});

	test('listPullRequestsPage warns instead of fetching all when no requested filter is supported (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		// Bitbucket's supportedPullRequestFilters is [Author, ReviewRequested] — `Assignee` is genuinely
		// unsupported, so resolvePullRequestFilters returns unsupported and the preflight guard fires. (GitLab
		// would be wrong here: it DOES support Assignee, so the guard wouldn't trigger for the right reason.)
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		let readCalled = false;
		stubApi(bb, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repo,
			getPullRequestsForRepo: () => {
				readCalled = true;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
			getPullRequestsForRepos: () => {
				readCalled = true;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			repos: [{ namespace: 'g', name: 'r' }],
			filters: [PullRequestFilter.Assignee],
		});
		assert.equal(readCalled, false, 'the read is skipped rather than run unfiltered');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'other');

		manager.dispose();
	});

	test('listRepos reports the requested page and a resumable next-page cursor for numbered-page hosts (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		// Bitbucket applies the requested page but reports no currentPage and no cursor. The facade must still
		// report the requested page (not a stuck 1) and synthesize a next-page cursor when hasMore — otherwise
		// a currentPage+1 consumer loops on page 2 forever.
		(
			bb as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [{ name: 'r', namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: true, cursor: '{}' },
				},
			});

		const result = await manager.listRepos({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			org: 'org',
			page: 2,
		});
		assert.equal(result.page.currentPage, 2, 'the requested page is reported, not a stuck 1');
		assert.equal(result.hasMore, true);
		assert.equal(
			result.cursor,
			JSON.stringify({ value: 3, type: 'page' }),
			'a resumable next-page cursor is synthesized',
		);

		manager.dispose();
	});

	test('listRepos derives currentPage from the cursor when the caller supplies only cursor (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		// A continuation that threads back only the opaque cursor (no `page`) for a numbered-page host that
		// echoes no `currentPage` must report the page encoded in the cursor, not a stuck 1 — otherwise a
		// `currentPage + 1` consumer re-requests the same page forever.
		(
			bb as unknown as {
				getRepositoriesForOrgResult: (
					org: string,
					options?: { cursor?: string },
				) => Promise<IntegrationResult<PagedResult<ProviderRepository>>>;
			}
		).getRepositoriesForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [{ name: 'r', namespace: 'org' } as unknown as ProviderRepository],
					paging: { more: true, cursor: '{}' },
				},
			});

		const result = await manager.listRepos({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			org: 'org',
			cursor: JSON.stringify({ value: 2, type: 'page' }),
		});
		assert.equal(result.page.currentPage, 2, 'the page comes from the threaded cursor, not a stuck 1');
		assert.equal(result.cursor, JSON.stringify({ value: 3, type: 'page' }), 'the next-page cursor advances');

		manager.dispose();
	});

	test('listIssuesPage reports Bitbucket issues as unsupported (deprecated in favor of Jira) (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		// Bitbucket Cloud deprecated its issue tracker; it's not an issue provider on this surface. The facade
		// must say so (warning + fetchFailed), not serve the legacy per-repo client or a silent empty page.
		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			repos: [{ namespace: 'ws', name: 'repo' }],
		});
		assert.equal(result.items.length, 0, 'no issues are returned for a non-issue provider');
		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.some(w => /not supported/i.test(w.message)),
			'issues are reported as unsupported',
		);

		manager.dispose();
	});

	test('a provider without discovery hooks (Bitbucket Data Center) reports unsupported, not empty (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bbs = await manager.get(GitSelfManagedHostIntegrationId.BitbucketServer, 'https://bb.example.com');
		(bbs as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bb.example.com',
		};

		// Bitbucket Data Center registers no org/repo discovery hook. listOrgs/listRepos must say so rather
		// than return an empty list indistinguishable from a genuinely empty account.
		const orgs = await manager.listOrgs({ providerId: GitSelfManagedHostIntegrationId.BitbucketServer });
		assert.equal(orgs.items.length, 0);
		assert.ok(
			orgs.warnings.some(w => /not supported/i.test(w.message)),
			'listOrgs reports discovery unsupported',
		);

		const repos = await manager.listRepos({
			providerId: GitSelfManagedHostIntegrationId.BitbucketServer,
			org: 'any',
		});
		assert.equal(repos.items.length, 0);
		assert.equal(repos.fetchFailed, true);
		assert.ok(
			repos.warnings.some(w => /not supported/i.test(w.message)),
			'listRepos reports discovery unsupported',
		);

		manager.dispose();
	});
});
