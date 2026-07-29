import * as assert from 'node:assert/strict';
import { GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { BitbucketServerIntegration } from '../providers/bitbucket-server.js';
import type { ProviderIssue, ProviderPullRequest } from '../providers/models.js';
import { IssueFilter, PagingMode, PullRequestFilter } from '../providers/models.js';
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

		await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});
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
		await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitLab],
			repos: [{ namespace: 'g', name: 'r' }],
		});
		assert.deepEqual(capturedStates, [GitPullRequestState.Closed, GitPullRequestState.Merged]);

		manager.dispose();
	});

	test('a per-facet filtered fan-out resolves the current user once, not once per facet', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		// Turning a filter into a provider login needs the current user, and `ProvidersApi.getCurrentUser` is an
		// uncached round trip. A consumer that serves ONE page as several filtered reads — one per user facet,
		// which is how a repo-scoped "my PRs" view is assembled, since the filters compose with AND — therefore
		// paid an identity request per facet, per page, all resolving the same account. They must share one.
		let currentUserCalls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			providerSupportsPullRequestFilters: () => true,
			getCurrentUser: () => {
				currentUserCalls++;
				return Promise.resolve({ id: 'me', username: 'me' });
			},
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const repos = [{ namespace: 'octocat', name: 'hello' }];
		const facets = [PullRequestFilter.Author, PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested];
		// Concurrent, as the fan-out actually issues them: the memo caches the in-flight promise, so the facets
		// share one request instead of racing into three.
		await Promise.all(
			facets.map(filter =>
				manager.listPullRequestsPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: repos,
					filters: [filter],
				}),
			),
		);
		assert.equal(currentUserCalls, 1, 'three concurrent filtered reads share one identity lookup');

		// And the memo survives across page turns, so paging doesn't re-pay it either.
		await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			filters: [PullRequestFilter.Author],
			page: 2,
		});
		assert.equal(currentUserCalls, 1, 'a later page reuses the memoized identity');

		manager.dispose();
	});

	test("GitLab's ACCOUNT-WIDE sweep forwards states to the SDK aggregator", async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		// The account-wide read (no `repos`) fans out through the generic per-association SDK primitive. Every
		// facet must receive the requested states; otherwise a closed/merged sweep silently falls back to open.
		//
		// Before that it accepted no `states` at all, so every query fell back to `state: opened` and a
		// closed/merged request came back with only OPEN merge requests — which this read had to refuse outright,
		// because post-filtering them produced an empty page the sweep would publish as a complete, successful,
		// genuinely-empty result (the Kanban "done" column silently showed nothing for GitLab).
		let capturedStates: GitPullRequestState[] | undefined | 'unset' = 'unset';
		stubApi(gl, {
			isRepoIdsInput: () => false,
			getCurrentUser: () => Promise.resolve({ username: 'me', id: 'me' }),
			getGitLabPullRequestsForUserAssociation: (
				_t: unknown,
				_u: unknown,
				_association: unknown,
				opts: { states?: GitPullRequestState[] },
			) => {
				capturedStates = opts.states;
				return Promise.resolve({ values: [], paging: undefined } satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitLab],
		});

		assert.deepEqual(
			capturedStates,
			[GitPullRequestState.Closed, GitPullRequestState.Merged],
			'the terminal state set reaches the provider instead of being refused',
		);
		assert.equal(result.fetchFailed, undefined, 'and the slice is a real read, not a reported failure');
		assert.deepEqual(result.failedProviderIds, []);

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

	test('GitHub account-wide PR read treats an empty state array as no filter, not zero states (#5438)', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

		// An empty `state: []` must fall through to the account-wide `involves:` path (getPullRequestsForUser),
		// not resolve the per-state Promise.all([]) to an empty result.
		let perStateSearchCalls = 0;
		let accountWideCalled = false;
		(
			gh as unknown as { getProviderCurrentAccount: () => Promise<{ id: string; username: string }> }
		).getProviderCurrentAccount = () => Promise.resolve({ id: 'u1', username: 'me' });
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);
		githubApi.searchMyPullRequestsPage = () => {
			perStateSearchCalls++;
			return Promise.resolve({ values: [], hasMore: false, truncated: false });
		};
		stubApi(gh, {
			getPullRequestsForUser: () => {
				accountWideCalled = true;
				return Promise.resolve({
					values: [
						{
							id: '1',
							url: 'https://github.com/o/r/pull/1',
							state: 'open',
						} as unknown as ProviderPullRequest,
					],
					paging: { more: false, cursor: '{}' },
				});
			},
		});

		const result = await (
			gh as unknown as {
				getProviderMyPullRequestsForUser: (
					session: ProviderAuthenticationSession,
					options?: { state?: ('open' | 'closed' | 'merged')[]; cursor?: string },
				) => Promise<PagedResult<ProviderPullRequest> | undefined>;
			}
		).getProviderMyPullRequestsForUser(primarySession('t'), { state: [] });

		assert.equal(perStateSearchCalls, 0, 'an empty state array does not take the per-state search path');
		assert.equal(accountWideCalled, true, 'an empty state array falls through to the account-wide read');
		assert.equal(result?.values.length, 1, 'the account-wide PRs are returned rather than an empty result');

		manager.dispose();
	});

	test('GitHub forwards the aggregate summary hint to each state search', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seen: Array<{ state?: string; summary?: boolean }> = [];
		githubApi.searchMyPullRequestsPage = (
			_provider: unknown,
			_token: unknown,
			options?: { state?: string; summary?: boolean },
		) => {
			seen.push(options ?? {});
			return Promise.resolve({ values: [], hasMore: false, truncated: false });
		};

		await (
			gh as unknown as {
				getProviderMyPullRequestsForUser: (
					session: ProviderAuthenticationSession,
					options: { state: ('closed' | 'merged')[]; summary: boolean },
				) => Promise<PagedResult<ProviderPullRequest> | undefined>;
			}
		).getProviderMyPullRequestsForUser(primarySession('t'), {
			state: ['closed', 'merged'],
			summary: true,
		});

		assert.deepEqual(seen, [
			{ baseUrl: undefined, state: 'closed', cursor: undefined, summary: true },
			{ baseUrl: undefined, state: 'merged', cursor: undefined, summary: true },
		]);

		manager.dispose();
	});

	test('GitHub account-wide filters use exact relationship facets and resume only active facets', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);

		const seen: Array<{ search?: string; cursor?: string; includeDefaultInvolvement?: boolean }> = [];
		githubApi.searchMyPullRequestsPage = (
			_provider: unknown,
			_token: unknown,
			options?: { search?: string; cursor?: string; includeDefaultInvolvement?: boolean },
		) => {
			seen.push(options ?? {});
			const authorFacet = options?.search === 'author:@me';
			return Promise.resolve({
				values: [],
				hasMore: authorFacet,
				cursor: authorFacet ? 'author-next' : undefined,
				truncated: false,
			});
		};

		const first = await (
			gh as unknown as {
				getProviderMyPullRequestsForUser: (
					session: ProviderAuthenticationSession,
					options: {
						state: ['open'];
						filters: PullRequestFilter[];
						cursor?: string;
					},
				) => Promise<PagedResult<ProviderPullRequest> | undefined>;
			}
		).getProviderMyPullRequestsForUser(primarySession('t'), {
			state: ['open'],
			filters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		});

		assert.deepEqual(
			seen.map(call => ({
				search: call.search,
				cursor: call.cursor,
				includeDefaultInvolvement: call.includeDefaultInvolvement,
			})),
			[
				{ search: 'author:@me', cursor: undefined, includeDefaultInvolvement: false },
				{ search: 'review-requested:@me', cursor: undefined, includeDefaultInvolvement: false },
			],
		);
		assert.equal(first?.paging?.more, true);

		seen.length = 0;
		await (
			gh as unknown as {
				getProviderMyPullRequestsForUser: (
					session: ProviderAuthenticationSession,
					options: {
						state: ['open'];
						filters: PullRequestFilter[];
						cursor?: string;
					},
				) => Promise<PagedResult<ProviderPullRequest> | undefined>;
			}
		).getProviderMyPullRequestsForUser(primarySession('t'), {
			state: ['open'],
			filters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
			cursor: first?.paging?.cursor,
		});

		assert.deepEqual(
			seen.map(call => ({ search: call.search, cursor: call.cursor })),
			[{ search: 'author:@me', cursor: 'author-next' }],
			'an exhausted relationship facet is not restarted on the next page',
		);

		manager.dispose();
	});

	test('GitHub account-wide facets mark missing and stalled continuations incomplete', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);
		const target = gh as unknown as {
			getProviderMyPullRequestsForUser: (
				session: ProviderAuthenticationSession,
				options: { state: ['open']; filters: PullRequestFilter[]; cursor?: string },
			) => Promise<{
				paging?: { cursor?: string; more?: boolean; truncated?: boolean };
				metadata?: { completeness: string };
			}>;
		};

		githubApi.searchMyPullRequestsPage = () =>
			Promise.resolve({ values: [], hasMore: true, cursor: undefined, truncated: false });
		const missing = await target.getProviderMyPullRequestsForUser(primarySession('t'), {
			state: ['open'],
			filters: [PullRequestFilter.Author],
		});
		assert.equal(missing.paging?.more, false);
		assert.equal(missing.paging?.truncated, true);
		assert.equal(missing.metadata?.completeness, 'partial');

		githubApi.searchMyPullRequestsPage = () =>
			Promise.resolve({ values: [], hasMore: true, cursor: 'same', truncated: false });
		const first = await target.getProviderMyPullRequestsForUser(primarySession('t'), {
			state: ['open'],
			filters: [PullRequestFilter.Author],
		});
		const stalled = await target.getProviderMyPullRequestsForUser(primarySession('t'), {
			state: ['open'],
			filters: [PullRequestFilter.Author],
			cursor: first.paging?.cursor,
		});
		assert.equal(stalled.paging?.more, false);
		assert.equal(stalled.paging?.truncated, true);
		assert.equal(stalled.metadata?.completeness, 'partial');
		manager.dispose();
	});

	test('Bitbucket Data Center refuses filtered PRs when the current account cannot be resolved', async () => {
		const integration = Object.create(BitbucketServerIntegration.prototype) as Record<string, unknown>;
		Object.assign(integration, {
			id: GitSelfManagedHostIntegrationId.BitbucketServer,
			_domain: 'bitbucket.example.com',
			_session: primarySession('t'),
			getProvidersApi: () =>
				Promise.resolve({
					getBitbucketServerPullRequestsForCurrentUser: () => Promise.resolve({ data: [], hasMore: false }),
				}),
			getProviderCurrentAccount: () => Promise.resolve(undefined),
		});

		await assert.rejects(
			() =>
				(
					integration as unknown as {
						getProviderMyPullRequestsForUser: (
							session: ProviderAuthenticationSession,
							options: { filters: PullRequestFilter[] },
						) => Promise<PagedResult<ProviderPullRequest> | undefined>;
					}
				).getProviderMyPullRequestsForUser(primarySession('t'), {
					filters: [PullRequestFilter.Author],
				}),
			/current Bitbucket Data Center account/,
		);
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

	test('a non-primary connectionId + forceSync refreshes only that connection', async () => {
		const runtime = createFakeRuntime();
		runtime.account.getAccount = async () => ({ id: 'me' });
		await seedCloudConnection(runtime, 'sec-tok', 'stale-secondary');
		const backendPaths: string[] = [];
		runtime.account.fetchGkApi = path => {
			backendPaths.push(path);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						data: {
							tokenId: 'sec-tok',
							accessToken: 'fresh-secondary',
							expiresIn: 3600,
							scopes: 'repo',
							type: 'oauth',
							domain: 'github.com',
						},
					}),
					{ status: 200 },
				),
			);
		};
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
		assert.equal(capturedToken, 'fresh-secondary', 'the read used the freshly fetched secondary token');
		assert.deepEqual(backendPaths, ['v1/provider-tokens/tokens/sec-tok']);
		assert.equal(
			(gh as unknown as { _session: ProviderAuthenticationSession })._session.accessToken,
			'primary',
			'the primary integration session was not mutated',
		);

		manager.dispose();
	});
});
