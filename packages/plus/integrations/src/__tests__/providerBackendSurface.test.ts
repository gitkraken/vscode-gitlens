import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
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
	test('listPullRequestsPage encodes page→cursor and derives hasMore + opaque cursor from the response', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		const pr = { id: '1' } as unknown as ProviderPullRequest;
		let capturedCursor: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { cursor?: string }) => {
				capturedCursor = opts.cursor;
				return Promise.resolve({
					values: [pr],
					paging: { more: true, cursor: JSON.stringify({ value: 'NEXT', type: 'cursor' }) },
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			page: 2,
		});

		assert.equal(capturedCursor, JSON.stringify({ value: 2, type: 'page' }), 'page 2 encoded as a page cursor');
		assert.deepEqual(result.items, [pr]);
		// GitHub PR search is cursor-only and reports no `currentPage`; it ignored the synthesized page-number
		// cursor and returned its first page, so the echoed page must be 1 (not the requested 2) — the opaque
		// `endCursor` is what the caller threads to actually advance.
		assert.equal(result.page.currentPage, 1);
		assert.equal(result.hasMore, true, 'hasMore reflects paging.more');
		assert.equal(
			result.cursor,
			JSON.stringify({ value: 'NEXT', type: 'cursor' }),
			'cursor-only host cursor exposed',
		);
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

	test('listIssuesPage mirrors the page→cursor round-trip and warning mapping', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		// A raw provider issue with the fields toIssueShape requires (updatedDate + url), since listIssuesPage
		// now normalizes repo-scoped results to IssueShape.
		const issue = {
			id: '7',
			number: '7',
			title: 'Issue 7',
			url: 'https://github.com/o/r/issues/7',
			createdDate: new Date(0),
			updatedDate: new Date(0),
			closedDate: null,
			author: { id: 'a', name: 'A', avatarUrl: null, url: null },
			assignees: [],
			labels: [],
		} as unknown as ProviderIssue;
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
			linear as unknown as { getProjectsForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForUserResult = () => Promise.resolve({ value: [{ key: 'proj', id: 'p1', name: 'Project One' }] });

		const result = await manager.listProjects({ providerId: IssuesCloudHostIntegrationId.Linear });
		assert.deepEqual(result.items, [{ id: 'p1', name: 'Project One', url: '' }]);

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
				getProjectsForResourcesResult: (
					resources: ResourceDescriptor[],
				) => Promise<{ value: ResourceDescriptor[] }>;
			}
		).getProjectsForResourcesResult = (scopedResources: ResourceDescriptor[]) => {
			capturedResources = scopedResources;
			return Promise.resolve({ value: [{ key: 'proj', id: 'p1', name: 'Project One' }] });
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
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () =>
			Promise.resolve({ value: [{ key: 'proj', id: 'p1', name: 'Project One' }] });
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

	test('listIssueTrackerIssuesPage pages by project window with a next-page cursor (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);

		(
			jira as unknown as { getResourcesForUserResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getResourcesForUserResult = () => Promise.resolve({ value: [{ key: 'one', id: 'org-1', name: 'Org One' }] });
		// Three projects; with itemsPerPage 2 the first page covers 2 and reports a next-page cursor.
		(
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () =>
			Promise.resolve({
				value: [
					{ key: 'p1', id: 'p1', name: 'P1' },
					{ key: 'p2', id: 'p2', name: 'P2' },
					{ key: 'p3', id: 'p3', name: 'P3' },
				],
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
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () => Promise.resolve({ value: projects });
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
			linear as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () => Promise.resolve({ value: [{ key: 't1', id: 't1', name: 'Team 1' }] });
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
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () =>
			Promise.resolve({
				value: [
					{ key: 'p1', id: 'p1', name: 'P1' },
					{ key: 'p2', id: 'p2', name: 'P2' },
				],
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
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () => Promise.resolve({ value: [{ key: 'p1', id: 'p1', name: 'P1' }] });
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
			linear as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () =>
			Promise.resolve({ value: [{ key: 'proj', id: 'p1', name: 'Project One' }] });
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
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () =>
			Promise.resolve({ value: [{ key: 'proj', id: 'p1', name: 'Project One' }] });
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
			jira as unknown as { getProjectsForResourcesResult: () => Promise<{ value: ResourceDescriptor[] }> }
		).getProjectsForResourcesResult = () =>
			Promise.resolve({ value: [{ key: 'proj', id: 'p1', name: 'Project One' }] });
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

	test('listIssuesPage({ repos }) reads Bitbucket issues via the legacy per-repo client (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		// Bitbucket registers no getIssuesForReposFn; its override reads through the legacy getUsersIssuesForRepo
		// client (which already yields IssueShape). Stub the current account and that client.
		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		let readRepo: string | undefined;
		(bb as unknown as { authenticationService: { apis: { bitbucket: Promise<unknown> } } }).authenticationService =
			{
				apis: {
					bitbucket: Promise.resolve({
						getUsersIssuesForRepo: (_p: unknown, _t: unknown, _u: string, owner: string, repo: string) => {
							readRepo = `${owner}/${repo}`;
							return Promise.resolve({
								issues: [{ id: 'bb-i1', provider: bb } as unknown as IssueShape],
								truncated: false,
							});
						},
					}),
				},
			};

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			repos: [{ namespace: 'ws', name: 'repo' }],
		});
		assert.equal(readRepo, 'ws/repo', 'the per-repo client is called with the repo owner/name');
		assert.equal(result.items.length, 1, 'the Bitbucket issue is returned through the facade');
		assert.equal(result.items[0].id, 'bb-i1');

		manager.dispose();
	});

	test('listIssuesPage forwards includeAllAssignees to the Bitbucket issue client and surfaces truncation (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const bb = await manager.get(GitCloudHostIntegrationId.Bitbucket);
		(bb as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'bitbucket.org',
		};

		(
			bb as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		let sawIncludeAllAssignees: boolean | undefined;
		(bb as unknown as { authenticationService: { apis: { bitbucket: Promise<unknown> } } }).authenticationService =
			{
				apis: {
					bitbucket: Promise.resolve({
						getUsersIssuesForRepo: (
							_p: unknown,
							_t: unknown,
							_u: string,
							_owner: string,
							_repo: string,
							_baseUrl: string,
							opts?: { includeAllAssignees?: boolean },
						) => {
							sawIncludeAllAssignees = opts?.includeAllAssignees;
							// A repo whose own page drain hit its backstop reports truncated.
							return Promise.resolve({
								issues: [{ id: 'bb-i1', provider: bb } as unknown as IssueShape],
								truncated: true,
							});
						},
					}),
				},
			};

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			repos: [{ namespace: 'ws', name: 'repo' }],
			includeAllAssignees: true,
		});
		assert.equal(sawIncludeAllAssignees, true, 'includeAllAssignees reaches the issue client (broaden path)');
		assert.equal(result.page.truncated, true, "a repo's page-drain backstop surfaces as page.truncated");

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
