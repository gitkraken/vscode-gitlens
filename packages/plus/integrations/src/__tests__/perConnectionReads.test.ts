import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Account } from '@gitlens/git/models/author.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies that reads (issues/PRs) can target a SPECIFIC connection (multi-account) via a `connectionId`,
 * reading with that connection's token rather than the provider's primary — mirroring gkcli's
 * `--connection <tokenId>` and the token backend's `GET /v1/provider-tokens/tokens/{tokenId}`.
 */
async function seedConnectionSecret(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
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

async function seedPrimaryConnection(runtime: ReturnType<typeof createFakeRuntime>, tokenId: string, token: string) {
	await runtime.storage.store('integrations:configured', {
		github: [{ id: tokenId, cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
	});
	await seedConnectionSecret(runtime, tokenId, token);
}

suite('per-connection reads (#5430)', () => {
	test('getCurrentAccount reads with the specified connection token and caches per connection', async () => {
		const runtime = createFakeRuntime();
		await seedPrimaryConnection(runtime, 'primary-tok', 'token-primary');
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const lookups: string[] = [];
		(
			gh as unknown as {
				getProviderCurrentAccount: (session: ProviderAuthenticationSession) => Promise<Account | undefined>;
			}
		).getProviderCurrentAccount = session => {
			lookups.push(session.accessToken);
			return Promise.resolve({ id: session.accessToken, username: session.accessToken } as Account);
		};

		const primary = await gh.getCurrentAccount();
		const secondary = await gh.getCurrentAccount({ connectionId: 'sec-tok' });
		const primaryAgain = await gh.getCurrentAccount();

		assert.equal(primary?.username, 'token-primary', 'primary lookup uses the primary session');
		assert.equal(secondary?.username, 'token-secondary', 'secondary lookup uses the specified connection');
		assert.equal(primaryAgain?.username, 'token-primary', 'primary cache remains distinct after a secondary read');
		assert.deepEqual(
			lookups,
			['token-primary', 'token-secondary'],
			'provider lookups are cached separately for the primary and requested connection',
		);

		manager.dispose();
	});

	test('getCurrentAccount invalidates a cached secondary identity when that connection token changes', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary-1');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const lookups: string[] = [];
		(
			gh as unknown as {
				getProviderCurrentAccount: (session: ProviderAuthenticationSession) => Promise<Account | undefined>;
			}
		).getProviderCurrentAccount = session => {
			lookups.push(session.accessToken);
			return Promise.resolve({ id: session.accessToken, username: session.accessToken } as Account);
		};

		const first = await gh.getCurrentAccount({ connectionId: 'sec-tok' });
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary-2');
		const second = await gh.getCurrentAccount({ connectionId: 'sec-tok' });

		assert.equal(first?.username, 'token-secondary-1');
		assert.equal(second?.username, 'token-secondary-2');
		assert.deepEqual(
			lookups,
			['token-secondary-1', 'token-secondary-2'],
			'the same connection id refetches after its session token changes',
		);

		manager.dispose();
	});

	test('getMyCurrentAccounts threads connectionId to the account lookup', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let capturedToken: string | undefined;
		(
			gh as unknown as {
				getProviderCurrentAccount: (session: ProviderAuthenticationSession) => Promise<Account | undefined>;
			}
		).getProviderCurrentAccount = session => {
			capturedToken = session.accessToken;
			return Promise.resolve({ id: 'me', username: 'secondary-user' } as Account);
		};

		const accounts = await manager.getMyCurrentAccounts([GitCloudHostIntegrationId.GitHub], 'sec-tok');

		assert.equal(
			capturedToken,
			'token-secondary',
			'service routed the account lookup through the requested connection',
		);
		assert.equal(
			accounts.get(GitCloudHostIntegrationId.GitHub)?.username,
			'secondary-user',
			'service returns the requested connection account',
		);

		manager.dispose();
	});

	test('getMyCurrentAccounts resolves the self-managed host for the requested connection', async () => {
		const runtime = createFakeRuntime();
		await runtime.storage.store('integrations:configured', {
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: [
				{
					id: 'ghe-a1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-a.example.com',
					scopes: 'repo',
					primary: true,
				},
				{
					id: 'ghe-b1',
					cloud: true,
					integrationId: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
					domain: 'ghe-b.example.com',
					scopes: 'repo',
					primary: true,
				},
			],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-a1',
			JSON.stringify({
				id: 'ghe-a1',
				accessToken: 'token-a',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-a.example.com',
			}),
		);
		await runtime.storage.storeSecret(
			'integration.auth.cloud:cloud-github-enterprise|ghe-b1',
			JSON.stringify({
				id: 'ghe-b1',
				accessToken: 'token-b',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'ghe-b.example.com',
			}),
		);

		const manager = createIntegrationManager(runtime);
		const gheA = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe-a.example.com');
		const gheB = await manager.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe-b.example.com');

		const lookups: Array<{ domain: string; token: string }> = [];
		for (const integration of [gheA, gheB]) {
			(
				integration as unknown as {
					domain: string;
					getProviderCurrentAccount: (session: ProviderAuthenticationSession) => Promise<Account | undefined>;
				}
			).getProviderCurrentAccount = session => {
				lookups.push({
					domain: (integration as unknown as { domain: string }).domain,
					token: session.accessToken,
				});
				return Promise.resolve({ id: session.accessToken, username: session.accessToken } as Account);
			};
		}

		const accounts = await manager.getMyCurrentAccounts(
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise],
			'ghe-b1',
		);

		assert.deepEqual(lookups, [{ domain: 'ghe-b.example.com', token: 'token-b' }]);
		assert.equal(
			accounts.get(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise)?.username,
			'token-b',
			'the requested self-managed connection account is returned',
		);

		manager.dispose();
	});

	test('searchMyIssues reads with the specified connection token, not the primary', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		await runtime.storage.storeSecret(
			'integration.auth:github|sec-tok',
			JSON.stringify({
				id: 'sec-tok',
				accessToken: 'token-local-pat',
				scopes: ['repo'],
				cloud: false,
				type: 'pat',
				domain: 'github.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let capturedToken: string | undefined;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = session => {
			capturedToken = session.accessToken;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'sec-tok');

		assert.deepEqual(result, [], 'returns the specified connection results');
		assert.equal(capturedToken, 'token-secondary', 'read used the specified cloud connection token');

		manager.dispose();
	});

	test('searchMyPullRequests reads with the specified connection token', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let capturedToken: string | undefined;
		(
			gh as unknown as {
				searchProviderMyPullRequests: (session: ProviderAuthenticationSession) => Promise<PullRequest[]>;
			}
		).searchProviderMyPullRequests = session => {
			capturedToken = session.accessToken;
			return Promise.resolve([]);
		};

		await gh.searchMyPullRequests(undefined, undefined, undefined, 'sec-tok');

		assert.equal(capturedToken, 'token-secondary', 'PR read used the specified connection token');

		manager.dispose();
	});

	test('a network failure resolving the connection degrades to undefined instead of throwing', async () => {
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		// The stored secondary session is expired, so resolving it triggers a refresh…
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|exp-tok',
			JSON.stringify({
				id: 'exp-tok',
				accessToken: 'stale',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			}),
		);
		// …and the refresh hits the backend, which fails.
		runtime.account.fetchGkApi = () => Promise.reject(new Error('network down'));
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let called = false;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = () => {
			called = true;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'exp-tok');

		assert.equal(result, undefined, 'a failed connection resolution yields no results (no throw)');
		assert.equal(called, false, 'provider read not attempted when the session can’t be resolved');

		manager.dispose();
	});

	test('a read for an unknown connection degrades to undefined without calling the provider', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let called = false;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = () => {
			called = true;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'does-not-exist');

		assert.equal(result, undefined, 'unresolvable connection yields no results');
		assert.equal(called, false, 'provider read not attempted without a session');

		manager.dispose();
	});

	test('a locally disconnected provider blocks per-connection reads even when the secret remains', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		await runtime.storage.storeWorkspace('connected:github', false);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		let called = false;
		(
			gh as unknown as {
				searchProviderMyIssues: (session: ProviderAuthenticationSession) => Promise<IssueShape[]>;
			}
		).searchProviderMyIssues = () => {
			called = true;
			return Promise.resolve([]);
		};

		const result = await gh.searchMyIssues(undefined, undefined, 'sec-tok');

		assert.equal(result, undefined, 'locally disconnected provider yields no results');
		assert.equal(called, false, 'provider read not attempted while locally disconnected');

		manager.dispose();
	});

	// The paginated reads (getMy*ForRepos) resolve their token INSIDE ProvidersApi rather than from a
	// session passed in, so we intercept the provider function table on the real ProvidersApi instance and
	// capture the token it was invoked with. Overriding both the *Repos and *Repo variants keeps the test
	// robust regardless of the provider's paging mode.
	type CapturingProvider = Record<string, (input: unknown, options?: { token?: string }) => Promise<unknown>>;
	async function captureReposApiToken(
		gh: Awaited<ReturnType<ReturnType<typeof createIntegrationManager>['get']>>,
		fnNames: string[],
		ref: { token?: string; called: boolean },
	): Promise<void> {
		const api = await (
			gh as unknown as { getProvidersApi(): Promise<{ providers: Record<string, unknown> }> }
		).getProvidersApi();
		const provider = api.providers.github as CapturingProvider;
		for (const fnName of fnNames) {
			provider[fnName] = (_input, options) => {
				ref.called = true;
				ref.token = options?.token;
				return Promise.resolve({ data: [], pageInfo: undefined });
			};
		}
	}

	test('getMyPullRequestsForRepos reads with the specified connection token, not the primary', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured = { token: undefined as string | undefined, called: false };
		await captureReposApiToken(gh, ['getPullRequestsForReposFn', 'getPullRequestsForRepoFn'], captured);

		await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

		assert.equal(captured.called, true, 'the paginated PR read reached the provider');
		assert.equal(captured.token, 'token-secondary', 'PR read used the specified connection token');

		manager.dispose();
	});

	test('getMyIssuesForRepos reads with the specified connection token, not the primary', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured = { token: undefined as string | undefined, called: false };
		await captureReposApiToken(gh, ['getIssuesForReposFn', 'getIssuesForRepoFn'], captured);

		await (
			gh as unknown as {
				getMyIssuesForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

		assert.equal(captured.called, true, 'the paginated issue read reached the provider');
		assert.equal(captured.token, 'token-secondary', 'issue read used the specified connection token');

		manager.dispose();
	});

	test('getMyPullRequestsForRepos on an unknown connection degrades to undefined without calling the provider', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured = { token: undefined as string | undefined, called: false };
		await captureReposApiToken(gh, ['getPullRequestsForReposFn', 'getPullRequestsForRepoFn'], captured);

		const result = await (
			gh as unknown as {
				getMyPullRequestsForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyPullRequestsForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'does-not-exist');

		assert.equal(result, undefined, 'unresolvable connection yields no results');
		assert.equal(captured.called, false, 'provider read not attempted without a session');

		manager.dispose();
	});

	test('getMyIssuesForRepos is blocked when the provider is locally disconnected even if the secret remains', async () => {
		const runtime = createFakeRuntime();
		await seedConnectionSecret(runtime, 'sec-tok', 'token-secondary');
		await runtime.storage.storeWorkspace('connected:github', false);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured = { token: undefined as string | undefined, called: false };
		await captureReposApiToken(gh, ['getIssuesForReposFn', 'getIssuesForRepoFn'], captured);

		const result = await (
			gh as unknown as {
				getMyIssuesForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], undefined, 'sec-tok');

		assert.equal(result, undefined, 'locally disconnected provider yields no results');
		assert.equal(captured.called, false, 'provider read not attempted while locally disconnected');

		manager.dispose();
	});

	test('getMyIssuesForRepos treats an empty-string connectionId as the primary when refreshing', async () => {
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		await runtime.storage.store('integrations:configured', {
			github: [{ id: 'primary-tok', cloud: true, integrationId: 'github', scopes: 'repo', primary: true }],
		});
		await runtime.storage.storeSecret(
			'integration.auth.cloud:github|primary-tok',
			JSON.stringify({
				id: 'primary-tok',
				accessToken: 'stale-primary',
				scopes: ['repo'],
				cloud: true,
				type: 'oauth',
				domain: 'github.com',
				expiresAt: new Date(Date.now() - 60_000).toISOString(),
			}),
		);

		const fetches: string[] = [];
		runtime.account.fetchGkApi = (path: string) => {
			fetches.push(path);
			if (path === 'v1/provider-tokens/github') {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							data: {
								tokenId: 'primary-tok',
								accessToken: 'fresh-primary',
								expiresIn: 3600,
								scopes: 'repo',
								type: 'oauth',
								domain: 'github.com',
							},
						}),
						{ status: 200 },
					),
				);
			}

			return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected path' }), { status: 404 }));
		};

		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);

		const captured = { token: undefined as string | undefined, called: false };
		await captureReposApiToken(gh, ['getIssuesForReposFn', 'getIssuesForRepoFn'], captured);

		await (
			gh as unknown as {
				getMyIssuesForRepos: (
					repos: { namespace: string; name: string }[],
					options: undefined,
					connectionId: string,
				) => Promise<unknown>;
			}
		).getMyIssuesForRepos([{ namespace: 'octo', name: 'repo' }], undefined, '');

		assert.equal(captured.called, true, 'the paginated issue read reached the provider');
		assert.equal(captured.token, 'fresh-primary', 'empty-string connectionId falls back to the primary token');
		assert.deepEqual(fetches, ['v1/provider-tokens/github'], 'refresh stayed on the provider-primary path');

		manager.dispose();
	});

	test('GitLab PR search resolves the username from the read session, not the primary account', async () => {
		const runtime = createFakeRuntime();
		// A secondary GitLab connection whose token differs from the (absent) primary.
		await runtime.storage.storeSecret(
			'integration.auth.cloud:gitlab|sec-tok',
			JSON.stringify({
				id: 'sec-tok',
				accessToken: 'token-secondary',
				scopes: ['api'],
				cloud: true,
				type: 'oauth',
				domain: 'gitlab.com',
			}),
		);
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);

		// Capture the session the account lookup receives. GitLab used to call the primary-scoped
		// getCurrentAccount(); the fix routes through getProviderCurrentAccount(session).
		let accountLookupToken: string | undefined;
		(
			gl as unknown as {
				getProviderCurrentAccount: (session: ProviderAuthenticationSession) => Promise<Account | undefined>;
			}
		).getProviderCurrentAccount = session => {
			accountLookupToken = session.accessToken;
			return Promise.resolve(undefined); // undefined username → method returns [] before hitting the API
		};

		// searchMyPullRequests wraps its result in an IntegrationResult ({ value, duration }).
		const result = await gl.searchMyPullRequests(undefined, undefined, undefined, 'sec-tok');

		assert.deepEqual(result?.value, [], 'no username resolves to empty results without an API call');
		assert.equal(accountLookupToken, 'token-secondary', 'username resolved from the read session token');

		manager.dispose();
	});
});
