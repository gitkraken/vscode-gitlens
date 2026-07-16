import * as assert from 'node:assert/strict';
import { GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderIssue, ProviderPullRequest } from '../providers/models.js';
import { IssueFilter, PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the PR state filter (`states`), `includeAllAssignees` broadening, and `forceSync` refresh
 * wired for the ProviderBackend surface (#5438).
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

async function seedCloudConnection(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
	await runtime.storage.storeSecret(
		`integration.auth.cloud:github|${tokenId}`,
		JSON.stringify({
			id: tokenId,
			accessToken: token,
			scopes: ['repo'],
			cloud: true,
			type: 'oauth',
			domain: 'github.com',
		}),
	);
}

suite('PR state + includeAllAssignees + forceSync (#5438)', () => {
	test('sweepClosedPullRequests passes states [Closed, Merged] to the provider (cross-provider, no GitHub-only gate)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let capturedStates: GitPullRequestState[] | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { states?: GitPullRequestState[] }) => {
				capturedStates = opts.states;
				return Promise.resolve({
					values: [],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		await manager.sweepClosedPullRequests({ providerIds: [GitCloudHostIntegrationId.GitHub] });
		assert.deepEqual(capturedStates, [GitPullRequestState.Closed, GitPullRequestState.Merged]);

		manager.dispose();
	});

	test('a non-GitHub provider also receives the native state filter', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let capturedStates: GitPullRequestState[] | undefined;
		stubApi(gl, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { states?: GitPullRequestState[] }) => {
				capturedStates = opts.states;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		// The closed sweep maps the state filter for GitLab exactly as it does for GitHub — no provider gate.
		await manager.sweepClosedPullRequests({ providerIds: [GitCloudHostIntegrationId.GitLab] });
		assert.deepEqual(capturedStates, [GitPullRequestState.Closed, GitPullRequestState.Merged]);

		manager.dispose();
	});

	test('includeAllAssignees drops assigneeLogins (non-Azure branch)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let capturedAssignees: string[] | undefined | 'unset' = 'unset';
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			providerSupportsIssueFilters: () => true,
			getCurrentUser: () => Promise.resolve({ username: 'me' }),
			getIssuesForRepos: (_t: unknown, _r: unknown, opts: { assigneeLogins?: string[] }) => {
				capturedAssignees = opts.assigneeLogins;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderIssue>);
			},
		});

		await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'g', name: 'r' }],
			filters: [IssueFilter.Assignee],
			includeAllAssignees: true,
		});
		assert.equal(capturedAssignees, undefined);

		manager.dispose();
	});

	test('listPullRequestsPage forwards the public states option to the provider read core', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let capturedStates: GitPullRequestState[] | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_t: unknown, _r: unknown, opts: { states?: GitPullRequestState[] }) => {
				capturedStates = opts.states;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'g', name: 'r' }],
			states: ['closed', 'merged'],
		});
		assert.deepEqual(capturedStates, [GitPullRequestState.Closed, GitPullRequestState.Merged]);

		manager.dispose();
	});

	test('without includeAllAssignees the assignee filter is applied', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		let capturedAssignees: string[] | undefined | 'unset' = 'unset';
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			providerSupportsIssueFilters: () => true,
			getCurrentUser: () => Promise.resolve({ username: 'me' }),
			getIssuesForRepos: (_t: unknown, _r: unknown, opts: { assigneeLogins?: string[] }) => {
				capturedAssignees = opts.assigneeLogins;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderIssue>);
			},
		});

		await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'g', name: 'r' }],
			filters: [IssueFilter.Assignee],
		});
		assert.deepEqual(capturedAssignees, ['me']);

		manager.dispose();
	});

	test('forceSync forces a refresh so the read consumes the post-refresh token', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('old-token');

		// Simulate a forced cloud sync swapping in a fresh token.
		(gh as unknown as { syncCloudConnection: () => Promise<void> }).syncCloudConnection = () => {
			(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('new-token');
			return Promise.resolve();
		};

		let capturedToken: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (token: { accessToken: string }) => {
				capturedToken = token.accessToken;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'g', name: 'r' }],
			forceSync: true,
		});
		assert.equal(capturedToken, 'new-token', 'the read used the freshly synced token');

		manager.dispose();
	});

	test('a non-primary connectionId + forceSync does NOT force a refresh', async () => {
		const runtime = createFakeRuntime();
		await seedCloudConnection(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('primary');

		let synced = false;
		(gh as unknown as { syncCloudConnection: () => Promise<void> }).syncCloudConnection = () => {
			synced = true;
			return Promise.resolve();
		};

		let capturedToken: string | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (token: { accessToken: string }) => {
				capturedToken = token.accessToken;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: [{ namespace: 'g', name: 'r' }],
			forceSync: true,
			connectionId: 'sec-tok',
		});
		assert.equal(synced, false, 'a per-connection read bypasses the primary refresh machinery');
		assert.equal(capturedToken, 'token-secondary', 'the read used the connection token');

		manager.dispose();
	});
});
