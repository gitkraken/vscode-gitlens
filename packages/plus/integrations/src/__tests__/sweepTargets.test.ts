import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { createManualTokenAuthProvider } from '../authentication/manualTokenProvider.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { PullRequestSweepOptions } from '../manager.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode, PullRequestFilter } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, providerPr, stubApi } from './sweepHelpers.js';

/**
 * Which connection a sweep target selects and what it refuses: per-provider connections in one cross-provider
 * sweep, per-target filter overrides, and the self-managed host resolution that decides a token belongs to the
 * host being read — a token bound elsewhere is refused rather than used (#5438).
 */

suite('pull request sweep target selection (#5438)', () => {
	test('sweep targets select a different connection for each provider', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|github-secondary',
			JSON.stringify({
				id: 'github-secondary',
				accessToken: 'github-token',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
			}),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:gitlab|gitlab-secondary',
			JSON.stringify({
				id: 'gitlab-secondary',
				accessToken: 'gitlab-token',
				scopes: ['api'],
				cloud: true,
				type: 'oauth',
				domain: 'gitlab.com',
			}),
		);

		const manager = createIntegrationManager(runtime);
		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		const gitlab = await manager.get(GitCloudHostIntegrationId.GitLab);
		const usedTokens: Array<{ providerId: IntegrationIds; token: string }> = [];

		for (const [integration, providerId, prId] of [
			[github, GitCloudHostIntegrationId.GitHub, 'github-1'],
			[gitlab, GitCloudHostIntegrationId.GitLab, 'gitlab-2'],
		] as const) {
			stubApi(integration, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: (token: { accessToken: string }) => {
					usedTokens.push({ providerId: providerId, token: token.accessToken });
					return Promise.resolve({
						values: [providerPr(prId)],
						paging: { more: false, cursor: '{}' },
					} satisfies PagedResult<ProviderPullRequest>);
				},
			});
		}

		const result = await manager.sweepPullRequests({
			targets: [
				{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'github-secondary' },
				{ providerId: GitCloudHostIntegrationId.GitLab, connectionId: 'gitlab-secondary' },
			],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.deepEqual(
			usedTokens.sort((a, b) => a.providerId.localeCompare(b.providerId)),
			[
				{ providerId: GitCloudHostIntegrationId.GitHub, token: 'github-token' },
				{ providerId: GitCloudHostIntegrationId.GitLab, token: 'gitlab-token' },
			],
		);
		assert.deepEqual(result.items.map(pr => pr.provider.id).sort(), [
			GitCloudHostIntegrationId.GitHub,
			GitCloudHostIntegrationId.GitLab,
		]);
		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.failedProviderIds, []);

		manager.dispose();
	});

	test('a sweep target can override the shared account-wide relationship union', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let receivedFilters: PullRequestFilter[] | undefined;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: (options?: {
					filters?: PullRequestFilter[];
				}) => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = options => {
			receivedFilters = options?.filters;
			return Promise.resolve({ value: { values: [providerPr('target-filter')] } });
		};

		const result = await manager.sweepPullRequests({
			targets: [
				{
					providerId: GitCloudHostIntegrationId.GitHub,
					filters: [PullRequestFilter.Author, PullRequestFilter.Assignee],
				},
			],
			filters: [PullRequestFilter.Mention],
		});

		assert.deepEqual(receivedFilters, [PullRequestFilter.Author, PullRequestFilter.Assignee]);
		assert.equal(result.page.allPages, true);

		manager.dispose();
	});

	test('a cloud per-connection read preserves provider-level warning metadata', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|github-secondary',
			JSON.stringify({
				id: 'github-secondary',
				accessToken: 'github-token',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const github = await manager.get(GitCloudHostIntegrationId.GitHub);
		stubApi(github, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.reject(new Error('provider down')),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			connectionId: 'github-secondary',
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].domain, undefined);
		assert.equal(result.warnings[0].connectionId, 'github-secondary');

		manager.dispose();
	});

	test('an explicit domain is inert for a cloud provider', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			domain: 'ignored.example.com',
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.deepEqual(result.items, []);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('a sweep target resolves a self-managed manual-token host from its fallback domain', async () => {
		const runtime = createFakeRuntime();
		runtime.hooks!.createAuthenticationProvider = ({ id }) =>
			Promise.resolve(
				createManualTokenAuthProvider({
					id: id,
					token: 'ghe-token',
					account: { id: 'me', label: 'me' },
					domain: 'https://ghe.example.com',
				}),
			);
		const manager = createIntegrationManager(runtime);
		assert.deepEqual(
			manager.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise),
			[],
			'the manual-token bridge has no configured connection to resolve the host from',
		);

		const getTarget = manager as unknown as {
			get(id: IntegrationIds, domain?: string): Promise<GitHostIntegration | undefined>;
		};
		const originalGet = getTarget.get.bind(manager);
		let resolvedDomain: string | undefined;
		let usedToken: string | undefined;
		let baseUrl: string | undefined;
		getTarget.get = async (id, domain) => {
			resolvedDomain = domain;
			const integration = await originalGet(id, domain);
			assert.ok(integration);
			stubApi(integration, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: (
					token: { accessToken: string },
					_repos: unknown,
					options: { baseUrl?: string },
				) => {
					usedToken = token.accessToken;
					baseUrl = options.baseUrl;
					return Promise.resolve({
						values: [providerPr('ghe-1')],
						paging: { more: false, cursor: '{}' },
					} satisfies PagedResult<ProviderPullRequest>);
				},
			});
			return integration;
		};

		const result = await manager.sweepPullRequests({
			targets: [
				{
					providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'https://ghe.example.com/api/v3',
				},
			],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.equal(resolvedDomain, 'ghe.example.com');
		assert.equal(usedToken, 'ghe-token');
		assert.equal(baseUrl, 'https://ghe.example.com/api/v3');
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].provider.domain, 'ghe.example.com');
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('a self-managed target rejects a manual token bound to another host', async () => {
		const runtime = createFakeRuntime();
		runtime.hooks!.createAuthenticationProvider = ({ id }) =>
			Promise.resolve(
				createManualTokenAuthProvider({
					id: id,
					token: 'trusted-token',
					account: { id: 'me', label: 'me' },
					domain: 'https://trusted.example.com',
				}),
			);
		const manager = createIntegrationManager(runtime);
		const getTarget = manager as unknown as {
			get(id: IntegrationIds, domain?: string): Promise<GitHostIntegration | undefined>;
		};
		const originalGet = getTarget.get.bind(manager);
		let requests = 0;
		getTarget.get = async (id, domain) => {
			const integration = await originalGet(id, domain);
			assert.ok(integration);
			stubApi(integration, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: () => {
					requests++;
					return Promise.resolve({
						values: [providerPr('unexpected')],
						paging: { more: false, cursor: '{}' },
					} satisfies PagedResult<ProviderPullRequest>);
				},
			});
			return integration;
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			connectionId: 'secondary',
			domain: 'https://untrusted.example.com/api/v3',
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.equal(requests, 0, 'a token must never be sent to a different self-managed host');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'no-connection');
		assert.equal(result.warnings[0].domain, 'untrusted.example.com');
		assert.equal(result.warnings[0].connectionId, 'secondary');

		manager.dispose();
	});

	test('a self-managed target rejects a cloud token returned for another host', async () => {
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		const cloudPaths: string[] = [];
		runtime.account.fetchGkApi = path => {
			cloudPaths.push(path);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						data: {
							tokenId: 'trusted',
							accessToken: 'trusted-token',
							expiresIn: 3600,
							scopes: 'repo',
							type: 'oauth',
							domain: 'https://trusted.example.com',
						},
					}),
					{ status: 200 },
				),
			);
		};

		const manager = createIntegrationManager(runtime);
		const getTarget = manager as unknown as {
			get(id: IntegrationIds, domain?: string): Promise<GitHostIntegration | undefined>;
		};
		const originalGet = getTarget.get.bind(manager);
		let requests = 0;
		getTarget.get = async (id, domain) => {
			const integration = await originalGet(id, domain);
			assert.ok(integration);
			stubApi(integration, {
				isRepoIdsInput: () => false,
				getProviderPullRequestsPagingMode: () => PagingMode.Repos,
				getPullRequestsForRepos: () => {
					requests++;
					return Promise.resolve({
						values: [providerPr('unexpected')],
						paging: { more: false, cursor: '{}' },
					} satisfies PagedResult<ProviderPullRequest>);
				},
			});
			return integration;
		};

		const result = await manager.listPullRequestsPage({
			providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			domain: 'https://untrusted.example.com/api/v3',
			repos: [{ namespace: 'octocat', name: 'hello' }],
			forceSync: true,
		});

		assert.deepEqual(cloudPaths, ['v1/provider-tokens/githubEnterprise']);
		assert.equal(requests, 0, 'a cloud token must never be sent to a different self-managed host');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'no-connection');
		assert.equal(result.warnings[0].domain, 'untrusted.example.com');

		manager.dispose();
	});

	test('sweep targets reject legacy selectors and duplicate providers', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		await assert.rejects(
			manager.sweepPullRequests({
				targets: [{ providerId: GitCloudHostIntegrationId.GitHub }],
				providerIds: [GitCloudHostIntegrationId.GitLab],
			} as unknown as PullRequestSweepOptions),
			/targets.*cannot be combined/,
		);
		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitCloudHostIntegrationId.GitHub },
					{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'secondary' },
				],
			}),
			/at most one target per provider/,
		);

		manager.dispose();
	});
});
