import * as assert from 'node:assert/strict';
import { GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationResult } from '../models/integration.js';
import type { ProviderPullRequest } from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, providerPr, stubApi } from './sweepHelpers.js';

/**
 * The sweep drain loop, once a target is selected: all-pages paging and its budget, the omissions a capped or
 * unvouched page reports, cross-page dedupe, and how a failure is attributed to the provider that caused it
 * rather than to the sweep (#5438).
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

	test('a capped page reaching the budget reports the cap beside the budget, not instead of it', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// Every page is capped by the provider AND has a usable cursor, so the drain runs to `maxPages` with
		// both facts true. They describe different parts of the read: a bigger budget returns more rows, and
		// nothing returns the capped ones. Folding them into one warning misstates one part either way — `none`
		// alone freezes a consumer on a read it could continue, `page-budget` alone promises the capped rows.
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

		assert.deepEqual(
			result.warnings.map(w => w.omission?.recovery),
			['page-budget', 'none'],
			'the budget stop and the capped part are each reported once',
		);
		assert.doesNotMatch(
			result.warnings[1].message,
			/cannot be continued/,
			'the capped part does not deny the rest',
		);

		manager.dispose();
	});

	for (const { name, moreAfterSecondPage, totalCount, expected } of [
		{
			name: 'a live cursor',
			moreAfterSecondPage: true,
			totalCount: 1393,
			expected: [
				{ kind: 'pagination-incomplete', recovery: 'page-budget' },
				{ kind: 'provider-limit', recovery: 'none', limit: 1000, totalCount: 1393, sort: 'updated:desc' },
			],
		},
		{
			name: 'a final page',
			moreAfterSecondPage: false,
			totalCount: 1393,
			expected: [
				{ kind: 'provider-limit', recovery: 'none', limit: 1000, totalCount: 1393, sort: 'updated:desc' },
			],
		},
		{
			name: 'a count within the limit',
			moreAfterSecondPage: true,
			totalCount: 900,
			expected: [
				{ kind: 'pagination-incomplete', recovery: 'page-budget' },
				{ kind: 'pagination-incomplete', recovery: 'none' },
			],
		},
	]) {
		test(`an unexplained truncation reports the omission its match count supports on ${name}`, async () => {
			const runtime = createFakeRuntime();
			const { manager, gh } = await connectedGitHub(runtime);

			let calls = 0;
			(
				gh as unknown as {
					getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
				}
			).getMyPullRequestsForUserResult = () => {
				calls += 1;
				const hasMore = calls < 2 || moreAfterSecondPage;
				return Promise.resolve({
					value: {
						values: [providerPr(`pr-${calls}`)],
						paging: {
							more: hasMore,
							cursor: hasMore ? JSON.stringify({ value: calls + 1, type: 'page' }) : '{}',
							truncated: true,
							totalCount: totalCount,
						},
					},
				});
			};

			const result = await manager.sweepPullRequests({
				providerIds: [GitCloudHostIntegrationId.GitHub],
				maxPages: 2,
			});

			assert.deepEqual(
				result.warnings.map(w => w.omission),
				expected,
			);

			manager.dispose();
		});
	}

	test('a cap reported through SDK metadata is not repeated beside the budget stop', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// GitHub's 1,000-result search cap arrives as an SDK omission, not as `paging.truncated` — the shape
		// the sibling test above does NOT cover. `assessCollectionMetadata` already warned about it, so this
		// drain adds no cap warning of its own; it reports only its own stop, which is the budget.
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

		// Raising the budget returns more of the capped set and never all of it: the SDK's `provider-limit`
		// says the second, the drain's `page-budget` says the first.
		assert.deepEqual(
			result.warnings.filter(w => w.omission != null).map(w => [w.omission!.kind, w.omission!.recovery]),
			[
				['provider-limit', 'none'],
				['pagination-incomplete', 'page-budget'],
			],
		);

		manager.dispose();
	});

	test('a GitHub facet capped at the ceiling does not hide a sibling facet the budget can continue', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// The closed-PR sweep reads `merged` and `closed` as separate searches folded into one provider page. Here
		// `merged` walks into GitHub's 1,000-result ceiling on the first page while `closed` still has a cursor, so
		// the drain's budget stop has both a capped facet and a live one. Driven down to the GraphQL response,
		// because the per-facet cursor bundle is what keeps the live facet reachable.
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);
		let closedCalls = 0;
		githubApi.graphql = (_provider: unknown, _token: unknown, _query: unknown, variables: { search: string }) => {
			if (variables.search.includes('is:merged')) {
				return Promise.resolve({
					search: { issueCount: 1005, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
				});
			}

			closedCalls++;
			return Promise.resolve({
				search: { issueCount: 1200, pageInfo: { endCursor: `c${closedCalls}`, hasNextPage: true }, nodes: [] },
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			states: ['closed', 'merged'],
			maxPages: 2,
		});

		assert.equal(closedCalls, 2, 'the live facet is followed to the budget');
		assert.equal(result.page.truncated, true);
		assert.deepEqual(
			result.warnings.map(w => w.omission),
			[
				{ kind: 'pagination-incomplete', recovery: 'page-budget' },
				{ kind: 'provider-limit', recovery: 'none', limit: 1000, totalCount: 1005, sort: 'updated:desc' },
			],
			'more `closed` rows are a bigger budget away; the `merged` rows past the ceiling are not',
		);

		manager.dispose();
	});

	test('a GitHub facet capped at the ceiling keeps its cap message when a sibling facet fails', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// The failed sibling reaches the drain as SDK metadata on the same page as the capped facet, so the page
		// counts as explained there — but that metadata says nothing about the cap.
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);
		githubApi.graphql = (_provider: unknown, _token: unknown, _query: unknown, variables: { search: string }) => {
			if (variables.search.includes('is:merged')) {
				return Promise.resolve({
					search: { issueCount: 1005, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
				});
			}

			return Promise.reject(new Error('closed facet exploded'));
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			states: ['closed', 'merged'],
			maxPages: 2,
		});

		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.every(w => w.omission == null),
			'a failed read ships no omission',
		);
		assert.ok(
			result.warnings.some(w => w.message.includes('1005') && w.message.includes('1000')),
			'the cap seen on the surviving facet is still reported',
		);

		manager.dispose();
	});

	test('a GitHub facet capped at the ceiling keeps its omission beside a sibling that lost its cursor', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// A sibling that reports another page with no cursor marks the page `partial` through SDK metadata while
		// the read still succeeds, so the cap stays an omission a consumer can act on.
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);
		githubApi.graphql = (_provider: unknown, _token: unknown, _query: unknown, variables: { search: string }) =>
			Promise.resolve({
				search: variables.search.includes('is:merged')
					? { issueCount: 1005, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] }
					: { issueCount: 400, pageInfo: { endCursor: null, hasNextPage: true }, nodes: [] },
			});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			states: ['closed', 'merged'],
			maxPages: 2,
		});

		assert.ok(!result.fetchFailed);
		assert.ok(
			result.warnings.some(
				w =>
					w.omission?.kind === 'provider-limit' &&
					w.omission.totalCount === 1005 &&
					w.omission.sort === 'updated:desc',
			),
			'the cap on the merged facet is reported beside the partial sibling',
		);

		manager.dispose();
	});

	test('a repository-scoped item total is not mistaken for a search match count', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// The repository-scoped read reports the provider's item total as `paging.totalCount`, not a search
		// `issueCount`, so a large repository must not be reported as capped.
		(
			gh as unknown as {
				getMyPullRequestsForReposResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForReposResult = () =>
			Promise.resolve({
				value: {
					values: [providerPr('pr-1')],
					paging: { more: false, cursor: '{}', truncated: true, totalCount: 1500 },
					metadata: { completeness: 'partial' },
				},
			});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [{ namespace: 'octocat', name: 'hello' }],
			maxPages: 2,
		});

		assert.ok(result.warnings.every(w => w.omission?.kind !== 'provider-limit'));

		manager.dispose();
	});

	test('a GitHub search past its 1,000-result ceiling stops at the budget before the ceiling does', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		// The cap and the budget above are both arranged at the drain. This goes through the real GitHub read,
		// down to the GraphQL response, because that is where the ceiling was reported on EVERY page once the
		// account matched more than 1,000 — latching the cap before the walk ever reached it, so a budget stop
		// with a live cursor came back `exhausted` and a consumer froze on a read it could have continued.
		const githubApi = await (
			gh as unknown as {
				authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
			}
		).authenticationService.apis.github;
		assert.ok(githubApi);
		let calls = 0;
		githubApi.graphql = () => {
			calls++;
			return Promise.resolve({
				search: { issueCount: 1005, pageInfo: { endCursor: `c${calls}`, hasNextPage: true }, nodes: [] },
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			states: ['merged'],
			maxPages: 2,
		});

		assert.equal(calls, 2, 'drained exactly maxPages pages');
		assert.equal(result.page.truncated, true);
		const truncations = result.warnings.filter(w => w.omission != null);
		assert.deepEqual(
			truncations.map(w => w.omission),
			[{ kind: 'pagination-incomplete', recovery: 'page-budget' }],
			'no page had reached the ceiling yet, so a bigger budget is what returns the rest',
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

	test('a page that fails after a capped page keeps the cap message and drops its omission', async () => {
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let calls = 0;
		(
			gh as unknown as {
				getMyPullRequestsForUserResult: () => Promise<IntegrationResult<PagedResult<ProviderPullRequest>>>;
			}
		).getMyPullRequestsForUserResult = () => {
			calls += 1;
			if (calls > 1) return Promise.reject(new Error('page 2 exploded'));

			return Promise.resolve({
				value: {
					values: [providerPr('pr-1')],
					paging: {
						more: true,
						cursor: JSON.stringify({ value: 2, type: 'page' }),
						truncated: true,
						totalCount: 1393,
					},
				},
			});
		};

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			maxPages: 5,
		});

		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.every(w => w.omission == null),
			'a failed read must ship no omission',
		);
		assert.ok(result.warnings.some(w => w.message.includes('1393') && w.message.includes('1000')));
		assert.ok(result.warnings.some(w => w.message.includes('did not complete')));

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

		await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			includeReviews: true,
		});
		assert.equal(accountWideSummary, false, 'review-aware sweeps request the full provider projection');

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
