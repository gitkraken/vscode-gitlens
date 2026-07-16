import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError } from '../errors.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderIssue, ProviderPullRequest } from '../providers/models.js';
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
});
