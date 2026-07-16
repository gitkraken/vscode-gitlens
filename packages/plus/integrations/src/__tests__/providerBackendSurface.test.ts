import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError } from '../errors.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderIssue, ProviderOrganization, ProviderPullRequest } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
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
		assert.equal(result.page.currentPage, 2);
		assert.equal(result.hasMore, true, 'hasMore reflects paging.more');
		assert.equal(
			result.cursor,
			JSON.stringify({ value: 'NEXT', type: 'cursor' }),
			'cursor-only host cursor exposed',
		);
		assert.equal(result.warnings.length, 0);

		manager.dispose();
	});

	test('a page-type next cursor sets hasMore but is not surfaced as an opaque cursor', async () => {
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
		assert.equal(result.cursor, undefined, 'page-based next is not an opaque cursor');

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

		const issue = { id: '7' } as unknown as ProviderIssue;
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
		assert.deepEqual(result.items, [issue]);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);

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
		(jira as unknown as { getAccountForResource: () => Promise<{ username: string }> }).getAccountForResource =
			() => Promise.resolve({ username: 'me' });
		let capturedUser: string | undefined;
		(
			jira as unknown as {
				getIssuesForProject: (p: unknown, o?: { user?: string }) => Promise<IssueShape[]>;
			}
		).getIssuesForProject = (_p: unknown, o?: { user?: string }) => {
			capturedUser = o?.user;
			return Promise.resolve([{ id: 'i1' } as unknown as IssueShape]);
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
});
