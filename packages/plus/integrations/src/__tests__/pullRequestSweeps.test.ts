import * as assert from 'node:assert/strict';
import { GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { createManualTokenAuthProvider } from '../authentication/manualTokenProvider.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { PullRequestSweepOptions } from '../manager.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode, PullRequestFilter } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, providerPr, stubApi } from './sweepHelpers.js';

/**
 * The sweep drain loop: all-pages paging, the `truncated`/`fetchFailed` completeness signals, cross-page
 * dedupe, per-provider failure attribution, and target/connection selection (#5438).
 */

suite('pull request sweeps (#5438)', () => {
	test('sweepPullRequests drains multiple pages and marks truncated at maxPages', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				return Promise.resolve({
					values: [providerPr(`pr-${calls}`)],
					paging: { more: true, cursor: JSON.stringify({ value: calls + 1, type: 'page' }) },
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		assert.equal(result.items.length, 2, 'drained exactly maxPages pages');
		// allPages asserts completeness — false here because the drain stopped at maxPages with more available.
		assert.equal(result.page.allPages, false);
		assert.equal(result.page.truncated, true, 'stopping at maxPages with more available marks truncated');
		// A sweep exposes no resumable cursor, so incompleteness is expressed via page.truncated/allPages, never
		// as hasMore — a hasMore:true here would make a draining consumer re-run the identical sweep forever.
		assert.equal(result.hasMore, false);
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.failedProviderIds, [], 'truncation does not classify the provider as failed');
		assert.deepEqual(
			result.incompleteProviderIds,
			[GitCloudHostIntegrationId.GitHub],
			'a truncated provider slice is not authoritative',
		);
		assert.equal(calls, 2);
		// The drain spent the caller's own `maxPages` with a usable cursor still in hand, so the missing items
		// ARE reachable — this is the one shape where re-running with a higher budget returns more.
		const truncation = result.warnings.find(w => /page budget/i.test(w.message));
		assert.deepEqual(truncation?.omission, { kind: 'pagination-incomplete', recovery: 'page-budget' });

		manager.dispose();
	});

	test('a drain that reaches its budget with no usable cursor does not promise a bigger budget helps', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Bitbucket Server's shape: `more: true` with the empty-cursor sentinel when it omits `nextPageStart`.
		// The budget is reached on the SAME page that has nothing to continue from, so deciding the cause by
		// budget-first would label an unreachable tail as merely unfetched — and raising `maxPages` would
		// return the identical set.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			return Promise.resolve({
				value: {
					values: [providerPr(`pr-${calls}`)],
					paging: { more: true, cursor: calls >= 2 ? '{}' : JSON.stringify({ value: 2, type: 'page' }) },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		assert.equal(result.page.truncated, true);
		const truncation = result.warnings.find(w => w.omission != null);
		assert.equal(
			truncation?.omission?.recovery,
			'none',
			'no cursor to continue from means no budget returns the rest',
		);
		assert.doesNotMatch(truncation?.message ?? '', /raising it/, 'and the prose must not suggest one either');

		manager.dispose();
	});

	test('a capped page reaching the budget raises one warning, and the cap is what it reports', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Every page is capped by the provider AND has a usable cursor, so the drain runs to `maxPages` with
		// both facts true. They disagree about the remedy: a budget can be raised, a cap cannot. One drain must
		// raise ONE warning, and it has to be the cap — otherwise a consumer offers a "load more" that can
		// never return the capped part.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			return Promise.resolve({
				value: {
					values: [providerPr(`pr-${calls}`)],
					paging: { more: true, cursor: JSON.stringify({ value: calls + 1, type: 'page' }), truncated: true },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		const truncations = result.warnings.filter(w => /truncat|page budget/i.test(w.message));
		assert.equal(truncations.length, 1, 'two truncation warnings would contradict each other');
		assert.equal(truncations[0].omission?.recovery, 'none', 'the cap outranks the budget');

		manager.dispose();
	});

	test('a cap reported through SDK metadata still outranks the budget', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// GitHub's 1,000-result search cap arrives as an SDK omission, not as `paging.truncated` — the shape
		// the sibling test above does NOT cover. `assessCollectionMetadata` already warned about it, so this
		// drain adds no second warning; what it must not do is then report the budget as the reason, since a
		// bigger budget cannot lift a provider cap.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			return Promise.resolve({
				value: {
					values: [providerPr(`pr-${calls}`)],
					paging: { more: true, cursor: JSON.stringify({ value: calls + 1, type: 'page' }) },
					metadata: {
						completeness: 'partial',
						omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1393 }],
					},
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		// The drain also stopped at its budget, so two warnings describe this page — but they must AGREE.
		// Raising the budget would return more of the capped set and still never all of it, and the field is
		// deliberately conservative, so both report `none` and neither offers a load-more.
		assert.ok(result.warnings.length >= 2, 'the cap and the drain stop are both reported');
		assert.deepEqual(
			[...new Set(result.warnings.filter(w => w.omission != null).map(w => w.omission!.recovery))],
			['none'],
			'no warning may offer a bigger budget once the provider itself capped the results',
		);

		manager.dispose();
	});

	test('a provider that cycles its cursors is not reported as merely out of budget', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// A→B→A→B: every cursor differs from the one just used, so a one-back comparison never fires and the
		// drain walks in circles until the budget runs out. Reporting `page-budget` there would promise a
		// bigger budget helps, when nothing new is being fetched at all.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			return Promise.resolve({
				value: {
					values: [providerPr(`pr-${calls}`)],
					paging: { more: true, cursor: JSON.stringify({ value: calls % 2 === 1 ? 2 : 1, type: 'page' }) },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});

		assert.equal(calls, 3, 'the drain stops as soon as a cursor repeats, well before the budget');
		assert.equal(result.warnings.find(w => w.omission != null)?.omission?.recovery, 'none');

		manager.dispose();
	});

	test('an SDK omission from an earlier page is retracted when a later page dies', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Page 1 succeeds and its metadata names a real omission — at that moment nothing has failed, so the
		// warning correctly asserts the read succeeded. Page 2 then dies, and that assertion is now false.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			if (calls > 1) return Promise.reject(new Error('page 2 exploded'));

			return Promise.resolve({
				value: {
					values: [providerPr('pr-1')],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
					metadata: {
						completeness: 'partial',
						omissions: [{ kind: 'provider-limit', limit: 1000, totalCount: 1393 }],
					},
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.some(w => w.message.includes('matched 1393 results')),
			'the cap is still worth reporting — only its success claim is retracted',
		);
		assert.ok(
			result.warnings.every(w => w.omission == null),
			'no warning on a failed read may assert the request succeeded',
		);

		manager.dispose();
	});

	test('an omission emitted before a later page died is retracted, not left asserting success', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Page 1 reports its own truncation (a composite account-wide read where one facet stalled) — at that
		// moment nothing has failed, so an omission is emitted. Page 2 then dies. A per-warning decision cannot
		// see that future, so the aggregate has to be reconciled: `fetchFailed` and an omission asserting the
		// request succeeded must never ship together.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			if (calls > 1) return Promise.reject(new Error('page 2 exploded'));

			return Promise.resolve({
				value: {
					values: [providerPr('pr-1')],
					paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }), truncated: true },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 5,
		});

		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.every(w => w.omission == null),
			'a failed read must ship no omission, whenever in the drain it was raised',
		);

		manager.dispose();
	});

	test('a drain that latched a scope failure before its backstop reports no omission', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Same backstop as above, but a per-scope failure rides along in the SDK metadata. The tail is unread
		// either way — what differs is that this request did NOT succeed, so a retry can still recover the
		// failed scope. An unconditional omission would tell the consumer the opposite.
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () => {
			calls += 1;
			return Promise.resolve({
				value: {
					values: [providerPr(`pr-${calls}`)],
					paging: { more: true, cursor: JSON.stringify({ value: calls + 1, type: 'page' }) },
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'provider', scope: { repositoryId: 'octocat/broken' }, message: '500' }],
					},
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		assert.equal(result.fetchFailed, true, 'the scope failure makes the sweep a fetch failure');
		assert.equal(result.page.truncated, true, 'and the backstop still leaves pages unread');
		assert.ok(
			result.warnings.every(w => w.omission == null),
			'no warning on a failed read may assert the request succeeded',
		);

		manager.dispose();
	});

	test('sweepPullRequests stops cleanly when the provider runs out of pages', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				return Promise.resolve({
					values: [providerPr(`pr-${calls}`)],
					paging: {
						more: calls < 2,
						cursor: calls < 2 ? JSON.stringify({ value: calls + 1, type: 'page' }) : '{}',
					},
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});
		assert.equal(result.items.length, 2);
		// A clean drain normalizes `truncated` to undefined (not an explicit false), matching every other
		// read method so consumers can treat "absent or falsy" as "not truncated" uniformly.
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);

		manager.dispose();
	});

	test('sweepPullRequests preserves truncation reported before the terminal page', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls += 1;
			return Promise.resolve({
				value: {
					values: [providerPr(`pr-${calls}`)],
					paging: calls === 1 ? { more: true, cursor: 'next' } : { more: false, cursor: '{}' },
					metadata:
						calls === 1
							? { completeness: 'partial', failures: [] }
							: { completeness: 'complete', failures: [] },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
		});

		assert.equal(calls, 2);
		assert.equal(result.items.length, 2);
		assert.equal(result.page.truncated, true);
		assert.equal(result.page.allPages, false);

		manager.dispose();
	});

	test('sweepPullRequests deduplicates a PR across pages and keeps its latest representation', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls++;
			const latest = calls === 2;
			return Promise.resolve({
				value: {
					values: [
						providerPr('duplicate', {
							url: 'https://example.com/pull/shared',
							title: latest ? 'merged representation' : 'closed representation',
							state: latest ? GitPullRequestState.Merged : GitPullRequestState.Closed,
						}),
					],
					paging: latest ? { more: false, cursor: '{}' } : { more: true, cursor: 'next' },
				},
			});
		};

		const result = await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
		});

		assert.equal(calls, 2);
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].title, 'merged representation');
		assert.equal(result.items[0].state, 'merged');

		manager.dispose();
	});

	test('sweepPullRequests falls back to URL identity when repository metadata is absent', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls++;
			const duplicate = providerPr('duplicate', {
				url: 'https://example.com/pull/shared',
				title: calls === 1 ? 'first representation' : 'latest representation',
			});
			(duplicate as unknown as { repository?: unknown }).repository = undefined;
			return Promise.resolve({
				value: {
					values: [duplicate],
					paging: calls === 1 ? { more: true, cursor: 'next' } : { more: false, cursor: '{}' },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
		});

		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].title, 'latest representation');

		manager.dispose();
	});

	test('sweepPullRequests deduplicates URL-less PRs by repository identity', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);
		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls += 1;
			const duplicate = providerPr('42', {
				url: calls === 1 ? null : 'https://example.com/pull/42',
				title: calls === 1 ? 'first representation' : 'latest representation',
				repository: { id: 'repo-one', name: 'one', owner: { login: 'acme' }, remoteInfo: null },
			});
			return Promise.resolve({
				value: {
					values:
						calls === 1
							? [duplicate]
							: [
									duplicate,
									providerPr('42', {
										url: null,
										repository: {
											id: 'repo-two',
											name: 'two',
											owner: { login: 'acme' },
											remoteInfo: null,
										},
									}),
								],
					paging: calls === 1 ? { more: true, cursor: 'next' } : { more: false, cursor: '{}' },
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
		});

		assert.equal(result.items.length, 2, 'same-repo duplicates collapse without losing another repo');
		assert.ok(result.items.some(item => item.title === 'latest representation'));
		assert.ok(!result.items.some(item => item.title === 'first representation'));

		manager.dispose();
	});

	test('a page that throws mid-drain sets fetchFailed while keeping earlier pages', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				if (calls === 1) {
					return Promise.resolve({
						values: [providerPr('pr-1')],
						paging: { more: true, cursor: JSON.stringify({ value: 2, type: 'page' }) },
					} satisfies PagedResult<ProviderPullRequest>);
				}
				return Promise.reject(new Error('page 2 down'));
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});
		assert.equal(result.items.length, 1, 'keeps the page fetched before the failure');
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].providerId, GitCloudHostIntegrationId.GitHub);
		assert.deepEqual(
			result.failedProviderIds,
			[],
			'a later-page failure keeps the usable provider slice out of failedProviderIds',
		);
		assert.deepEqual(
			result.incompleteProviderIds,
			[GitCloudHostIntegrationId.GitHub],
			'a later-page failure identifies the provider whose returned slice is incomplete',
		);

		manager.dispose();
	});

	test('a first-page provider rejection is attributed through failedProviderIds', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.reject(new Error('provider down')),
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.deepEqual(result.incompleteProviderIds, []);

		manager.dispose();
	});

	test('a later-page rejection after an empty first page is not attributed as a provider failure', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				calls++;
				if (calls === 1) {
					return Promise.resolve({
						values: [],
						paging: { more: true, cursor: 'next' },
					});
				}
				return Promise.reject(new Error('provider down'));
			},
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, []);
		assert.deepEqual(result.incompleteProviderIds, [GitCloudHostIntegrationId.GitHub]);

		manager.dispose();
	});

	test('an implicit sweep attributes a session lost after its first page as incomplete', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<
					IntegrationResult<PagedResult<ProviderPullRequest> | undefined>
				>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls++;
			if (calls === 1) {
				return Promise.resolve({
					value: {
						values: [providerPr('pr-before-session-loss')],
						paging: { more: true, cursor: 'next' },
					},
				});
			}

			return Promise.resolve(undefined);
		};

		const result = await manager.sweepPullRequests();

		assert.equal(calls, 2);
		assert.deepEqual(
			result.items.map(pr => pr.id),
			['pr-before-session-loss'],
			'the usable page survives the session loss',
		);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.page.truncated, true);
		assert.equal(result.page.allPages, false);
		assert.deepEqual(result.failedProviderIds, []);
		assert.deepEqual(result.incompleteProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.ok(
			result.warnings.some(
				warning => warning.kind === 'no-connection' && warning.providerId === GitCloudHostIntegrationId.GitHub,
			),
		);

		manager.dispose();
	});

	test('an explicitly requested provider with no active session is attributed as failed', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
		});
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.deepEqual(result.incompleteProviderIds, []);
		assert.equal(result.warnings[0]?.kind, 'no-connection');

		manager.dispose();
	});

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

	test('a sweep with SDK metadata failures reports allPages: false and preserves fetched items (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			// A single terminal page (no `more`) that still reports a structured failure: the successful sibling
			// PR must survive, but the sweep cannot claim it read every page.
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('pr-good')],
					paging: { more: false, cursor: '{}' },
					metadata: {
						completeness: 'partial',
						failures: [{ kind: 'authentication', scope: { repositoryId: 'octocat/broken' } }],
					},
				}),
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 10,
		});

		assert.deepEqual(
			result.items.map(pr => pr.id),
			['pr-good'],
			'the successful sibling PR survives the failed scope',
		);
		assert.equal(result.fetchFailed, true, 'a structured SDK failure means the slice is incomplete');
		assert.equal(result.page.allPages, false, 'allPages is false after any SDK failure');
		assert.equal(result.page.truncated, true);
		assert.deepEqual(
			result.failedProviderIds,
			[],
			'a partial SDK scope failure is not a top-level provider rejection',
		);
		assert.deepEqual(result.incompleteProviderIds, [GitCloudHostIntegrationId.GitHub]);
		assert.equal(
			result.warnings.some(w => w.kind === 'auth'),
			true,
			'the auth scope failure is surfaced',
		);

		manager.dispose();
	});

	test('sweepPullRequests with no repos reads the account-wide user PRs core (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let reposCalled = false;
		let accountWideStates: string[] | undefined | 'unset' = 'unset';
		let accountWideSummary: boolean | undefined;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => {
				reposCalled = true;
				return Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } });
			},
		});
		// The account-wide core is provider-specific; stub the model hook the sweep routes to for empty repos.
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: (o?: {
					state?: string[];
					summary?: boolean;
				}) => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = (o?: { state?: string[]; summary?: boolean }) => {
			accountWideStates = o?.state;
			accountWideSummary = o?.summary;
			return Promise.resolve({
				value: {
					values: [providerPr('mine')],
					paging: { more: false, cursor: '{}' },
				},
			});
		};

		const result = await manager.sweepClosedPullRequests({ providerIds: [GitCloudHostIntegrationId.GitHub] });
		assert.equal(reposCalled, false, 'no repos → the repo-scoped core is not called');
		assert.equal(result.items.length, 1, 'account-wide user PRs are returned');
		assert.equal(result.items[0].id, 'mine', 'the account-wide PR is normalized to the GitLens shape');
		assert.deepEqual(
			accountWideStates,
			['closed', 'merged'],
			'the closed sweep state reaches the account-wide core',
		);
		assert.equal(accountWideSummary, true, 'aggregate sweeps request the provider summary shape');

		manager.dispose();
	});

	test('sweepPullRequests reports issue providers as unsupported instead of dropping them silently', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			isRepoIdsInput: () => false,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('1')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub, IssuesCloudHostIntegrationId.Jira],
			repos: [{ namespace: 'octocat', name: 'hello' }],
		});

		assert.deepEqual(
			result.items.map(pr => pr.id),
			['1'],
		);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(result.failedProviderIds, [IssuesCloudHostIntegrationId.Jira]);
		assert.ok(result.warnings.some(w => /pull request sweeps is not supported/i.test(w.message)));

		manager.dispose();
	});

	test('a paging truncation is not masked by an explicit false top-level signal (#5438)', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Top-level and paging truncation are independent signals. An explicit false on the former must not
		// mask a true paging signal (e.g. Bitbucket/Azure fan-outs), or the sweep would claim allPages.
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<
					IntegrationResult<PagedResult<ProviderPullRequest> & { truncated?: boolean }>
				>;
			}
		).getMyPullRequestsForUserResult = () =>
			Promise.resolve({
				value: {
					values: [providerPr('pr')],
					truncated: false,
					paging: { more: false, cursor: '{}', truncated: true },
				},
			});

		const result = await manager.sweepClosedPullRequests({ providerIds: [GitCloudHostIntegrationId.GitHub] });
		assert.equal(result.page.truncated, true, 'truncation is surfaced');
		assert.equal(result.page.allPages, false, 'a truncated sweep is not reported as fully drained');
		// A sweep exposes no cursor to resume, so `hasMore` must be false even when incomplete — the
		// incompleteness is expressed through page.truncated + allPages:false + a warning, not a fake next page.
		assert.equal(result.hasMore, false, 'a cursorless sweep never advertises a resumable next page');
		// A consumer that only inspects `warnings` must also see the read was partial.
		assert.ok(
			result.warnings.some(w => /truncat/i.test(w.message)),
			'a truncated drain pushes a warning, not just a boolean',
		);

		manager.dispose();
	});
});
