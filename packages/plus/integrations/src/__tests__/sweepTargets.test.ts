import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { createManualTokenAuthProvider } from '../authentication/manualTokenProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { ProviderSweepTargetEvent, PullRequestSweepOptions } from '../manager.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode, PullRequestFilter } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, primarySession, providerPr, stubApi } from './sweepHelpers.js';

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

	test('sweep targets reject legacy selectors', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		await assert.rejects(
			manager.sweepPullRequests({
				targets: [{ providerId: GitCloudHostIntegrationId.GitHub }],
				providerIds: [GitCloudHostIntegrationId.GitLab],
			} as unknown as PullRequestSweepOptions),
			/targets.*cannot be combined/,
		);

		manager.dispose();
	});

	test('several targets of one provider are accepted when each names its connection', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		for (const targets of [
			[
				{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'a' },
				{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'b' },
			],
			[
				{ providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, domain: 'ghe-a.example.com' },
				{ providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, domain: 'ghe-b.example.com' },
			],
			// The same connection id on different providers is two targets, not a repeat.
			[
				{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'a' },
				{ providerId: GitCloudHostIntegrationId.GitLab, connectionId: 'a' },
			],
		]) {
			const result = await manager.sweepPullRequests({ targets: targets });
			assert.deepEqual(result.items, []);
		}

		manager.dispose();
	});

	test('an exact repeat of a target rejects the sweep', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'a' },
					{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'a' },
				],
			}),
			/duplicate 'github' target \(connectionId 'a'\)/,
		);
		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, domain: 'ghe.example.com' },
					{ providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, domain: 'ghe.example.com' },
				],
			}),
			/duplicate 'cloud-github-enterprise' target \(domain 'ghe.example.com'\)/,
		);
		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, domain: 'ghe.example.com' },
					{
						providerId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
						domain: 'https://GHE.example.com/',
					},
				],
			}),
			/duplicate 'cloud-github-enterprise' target/,
		);
		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitCloudHostIntegrationId.GitHub },
					{ providerId: GitCloudHostIntegrationId.GitHub },
				],
			}),
			/duplicate 'github' target/,
		);

		manager.dispose();
	});

	test('an unnamed target beside a named one of the same provider rejects the sweep', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitCloudHostIntegrationId.GitHub },
					{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'secondary' },
				],
			}),
			/'github' must each name a connectionId or domain/,
		);
		// A cloud provider's read ignores `domain`, so it names no connection there.
		await assert.rejects(
			manager.sweepPullRequests({
				targets: [
					{ providerId: GitCloudHostIntegrationId.GitHub, domain: 'a.example.com' },
					{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: 'secondary' },
				],
			}),
			/'github' must each name a connectionId or domain/,
		);

		manager.dispose();
	});

	test('a single unnamed target per provider still reads the primary connection', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('primary-1')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const result = await manager.sweepPullRequests({
			targets: [{ providerId: GitCloudHostIntegrationId.GitHub }],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.equal(result.items.length, 1);
		assert.deepEqual(result.failedProviderIds, []);
		assert.deepEqual(result.incompleteProviderIds, []);
		assert.deepEqual(result.failedTargets, []);
		assert.deepEqual(result.incompleteTargets, []);

		manager.dispose();
	});

	suite('several connections of one self-managed provider', () => {
		const provider = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
		const hosts = [
			{ id: 'ghe-a', host: 'ghe-a.example.com', token: 'token-a' },
			{ id: 'ghe-b', host: 'ghe-b.example.com', token: 'token-b' },
		] as const;

		/** Two configured GitHub Enterprise connections, each its own host with its own token and instance. */
		async function connectTwoServers(
			runtime: ReturnType<typeof createFakeRuntime>,
			read: (
				host: string,
				token: string,
				repos: unknown,
			) => Promise<PagedResult<ProviderPullRequest>> | PagedResult<ProviderPullRequest>,
		) {
			await runtime.storage.store('integrations:configured', {
				[provider]: hosts.map((h, i) => ({
					id: h.id,
					cloud: true,
					integrationId: provider,
					domain: h.host,
					scopes: 'repo',
					primary: i === 0,
				})),
			});
			for (const h of hosts) {
				await runtime.storage.storeSecret(
					`integration.auth.cloud:${provider}|${h.id}`,
					JSON.stringify({
						id: h.id,
						accessToken: h.token,
						scopes: ['repo'],
						cloud: true,
						type: 'oauth',
						domain: h.host,
					}),
				);
			}

			const manager = createIntegrationManager(runtime);
			for (const h of hosts) {
				const integration = await manager.get(provider, h.host);
				assert.ok(integration != null);
				stubApi(integration, {
					isRepoIdsInput: () => false,
					getProviderPullRequestsPagingMode: () => PagingMode.Repos,
					getPullRequestsForRepos: async (
						token: { accessToken: string },
						repos: unknown,
						options: { baseUrl?: string },
					) => {
						assert.ok(
							options.baseUrl?.includes(h.host),
							`a request for ${h.host} went to ${options.baseUrl}`,
						);
						return read(h.host, token.accessToken, repos);
					},
				});
			}
			return manager;
		}

		const page = (...ids: string[]): PagedResult<ProviderPullRequest> => ({
			values: ids.map(id => providerPr(id)),
			paging: { more: false, cursor: '{}' },
		});
		const repoA = { namespace: 'team-a', name: 'one' };
		const repoB = { namespace: 'team-b', name: 'two' };

		test('each target reads only its own repos through its own connection', async () => {
			const requests: Array<{ host: string; token: string; repos: unknown }> = [];
			const manager = await connectTwoServers(createFakeRuntime(), (host, token, repos) => {
				requests.push({ host: host, token: token, repos: repos });
				return page(`${host}-1`);
			});

			const events: ProviderSweepTargetEvent[] = [];
			const result = await manager.sweepPullRequests({
				targets: [
					{ providerId: provider, connectionId: 'ghe-a', repos: [repoA] },
					{ providerId: provider, connectionId: 'ghe-b', repos: [repoB] },
				],
				onTargetSettled: e => void events.push(e),
			});

			assert.deepEqual(
				requests.sort((x, y) => x.host.localeCompare(y.host)),
				[
					{ host: 'ghe-a.example.com', token: 'token-a', repos: [repoA] },
					{ host: 'ghe-b.example.com', token: 'token-b', repos: [repoB] },
				],
			);
			assert.deepEqual(result.items.map(pr => pr.id).sort(), ['ghe-a.example.com-1', 'ghe-b.example.com-1']);
			assert.deepEqual(result.warnings, []);
			assert.deepEqual(
				events
					.map(e => ({ connectionId: e.connectionId, domain: e.domain, count: e.count, outcome: e.outcome }))
					.sort((x, y) => String(x.connectionId).localeCompare(String(y.connectionId))),
				[
					{ connectionId: 'ghe-a', domain: 'ghe-a.example.com', count: 1, outcome: 'ok' },
					{ connectionId: 'ghe-b', domain: 'ghe-b.example.com', count: 1, outcome: 'ok' },
				],
			);
			assert.deepEqual(result.failedProviderIds, []);
			assert.deepEqual(result.incompleteProviderIds, []);

			manager.dispose();
		});

		test('one failing connection leaves the provider incomplete and names the target', async () => {
			const manager = await connectTwoServers(createFakeRuntime(), (host, _token, _repos) =>
				host === 'ghe-b.example.com' ? Promise.reject(new Error('server down')) : page('ghe-a-1'),
			);

			const result = await manager.sweepPullRequests({
				targets: [
					{ providerId: provider, connectionId: 'ghe-a', repos: [repoA] },
					{ providerId: provider, connectionId: 'ghe-b', repos: [repoB] },
				],
			});

			assert.deepEqual(
				result.items.map(pr => pr.id),
				['ghe-a-1'],
			);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(result.failedTargets, [
				{ providerId: provider, connectionId: 'ghe-b', domain: 'ghe-b.example.com' },
			]);
			assert.deepEqual(result.incompleteTargets, []);
			assert.deepEqual(result.failedProviderIds, []);
			assert.deepEqual(result.incompleteProviderIds, [provider]);

			manager.dispose();
		});

		test('every connection failing fails the provider with both targets named', async () => {
			const manager = await connectTwoServers(createFakeRuntime(), () => Promise.reject(new Error('down')));

			const result = await manager.sweepPullRequests({
				targets: [
					{ providerId: provider, connectionId: 'ghe-a', repos: [repoA] },
					{ providerId: provider, connectionId: 'ghe-b', repos: [repoB] },
				],
			});

			assert.deepEqual(result.items, []);
			assert.deepEqual(result.failedProviderIds, [provider]);
			assert.deepEqual(result.incompleteProviderIds, []);
			assert.deepEqual(
				result.failedTargets.sort((x, y) => String(x.connectionId).localeCompare(String(y.connectionId))),
				[
					{ providerId: provider, connectionId: 'ghe-a', domain: 'ghe-a.example.com' },
					{ providerId: provider, connectionId: 'ghe-b', domain: 'ghe-b.example.com' },
				],
			);
			assert.deepEqual(result.incompleteTargets, []);

			manager.dispose();
		});

		test('a truncated connection is incomplete, not failed', async () => {
			const manager = await connectTwoServers(createFakeRuntime(), host =>
				host === 'ghe-a.example.com'
					? {
							values: [providerPr('ghe-a-1')],
							paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
						}
					: page('ghe-b-1'),
			);

			const result = await manager.sweepPullRequests({
				targets: [
					{ providerId: provider, connectionId: 'ghe-a', repos: [repoA] },
					{ providerId: provider, connectionId: 'ghe-b', repos: [repoB] },
				],
				maxPages: 1,
			});

			assert.deepEqual(result.failedTargets, []);
			assert.deepEqual(result.incompleteTargets, [
				{ providerId: provider, connectionId: 'ghe-a', domain: 'ghe-a.example.com' },
			]);
			assert.deepEqual(result.failedProviderIds, []);
			assert.deepEqual(result.incompleteProviderIds, [provider]);

			manager.dispose();
		});
	});

	test('a single target per provider keeps the provider arrays and adds matching target arrays', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			scopes: ['api'],
			domain: 'gitlab.com',
		};
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.reject(new Error('provider down')),
		});
		stubApi(gl, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('gl-1')],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub, GitCloudHostIntegrationId.GitLab],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 1,
		});

		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.deepEqual(result.incompleteProviderIds, [GitCloudHostIntegrationId.GitLab]);
		assert.deepEqual(result.failedTargets, [
			{ providerId: GitCloudHostIntegrationId.GitHub, connectionId: undefined, domain: undefined },
		]);
		assert.deepEqual(result.incompleteTargets, [
			{ providerId: GitCloudHostIntegrationId.GitLab, connectionId: undefined, domain: undefined },
		]);

		manager.dispose();
	});

	test('a target-level repos overrides the sweep-level repos, and an empty one reads account-wide', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			scopes: ['api'],
			domain: 'gitlab.com',
		};

		const received: Record<string, unknown> = {};
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_token: unknown, repos: unknown) => {
				received.github = repos;
				return Promise.resolve({
					values: [providerPr('gh-1')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});
		// GitLab's empty `repos` falls back to its account-wide read, which a repo-scoped read would never reach.
		(
			gl as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			received.gitlab = 'account-wide';
			return Promise.resolve({ value: { values: [providerPr('gl-1')] } });
		};

		const result = await manager.sweepPullRequests({
			targets: [
				{ providerId: GitCloudHostIntegrationId.GitHub, repos: [{ namespace: 'own', name: 'repo' }] },
				{ providerId: GitCloudHostIntegrationId.GitLab, repos: [] },
			],
			repos: [{ namespace: 'shared', name: 'repo' }],
		});

		assert.deepEqual(received.github, [{ namespace: 'own', name: 'repo' }]);
		assert.equal(received.gitlab, 'account-wide');
		assert.equal(result.items.length, 2);

		manager.dispose();
	});
});
