import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { IntegrationIds } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * `searchIssuesPage` and `countIssues` are the two reads Kepler's filtered issue explorer needs, and both make
 * promises the result shape alone can't show: a scope-less search is refused rather than answered with the whole
 * host, a criterion the provider can't express refuses the whole read rather than serving a wider set, and at the
 * provider's result ceiling the read SUCCEEDS while reporting how many matches were withheld.
 *
 * These cover the facade half of that contract — the refusals, the paging position, the cap omission, and the
 * per-scope isolation of the count probe. The query-string half (which criterion becomes which qualifier, and that
 * user input can't inject one) is asserted in `@gitlens/git-github`'s own tests, against the emitted request.
 */

function primarySession(token: string, domain = 'github.com'): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

type SearchPageResponse = {
	values: IssueShape[];
	truncated: boolean;
	hasMore: boolean;
	page: number;
	cursor?: string;
	totalCount?: number;
};

/** Stubs the GitHub API client's two new methods, recording what the facade asked it for. */
async function stubGitHubApi(
	manager: ReturnType<typeof createIntegrationManager>,
	stubs: {
		searchIssuesPage?: (options: Record<string, unknown>) => SearchPageResponse | undefined;
		countIssues?: (scopes: readonly Record<string, unknown>[]) => (number | undefined)[] | undefined;
	},
): Promise<{ searchCalls: Record<string, unknown>[]; countCalls: readonly Record<string, unknown>[][] }> {
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(gh != null);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const githubApi = await (
		gh as unknown as {
			authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
		}
	).authenticationService.apis.github;
	assert.ok(githubApi);

	const searchCalls: Record<string, unknown>[] = [];
	const countCalls: Record<string, unknown>[][] = [];
	githubApi.searchIssuesPage = (_provider: unknown, _token: unknown, options: Record<string, unknown>) => {
		searchCalls.push(options);
		return Promise.resolve(stubs.searchIssuesPage?.(options));
	};
	githubApi.countIssues = (_provider: unknown, _token: unknown, scopes: Record<string, unknown>[]) => {
		countCalls.push(scopes);
		return Promise.resolve(stubs.countIssues?.(scopes));
	};

	return { searchCalls: searchCalls, countCalls: countCalls };
}

function emptyPage(overrides?: Partial<SearchPageResponse>): SearchPageResponse {
	return { values: [], truncated: false, hasMore: false, page: 1, ...overrides };
}

suite('IntegrationManager.searchIssuesPage', () => {
	suite('scope', () => {
		test('refuses a search with no repos, no org, and no user relationship', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				const result = await manager.searchIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.equal(result.warnings.length, 1);
				assert.match(result.warnings[0].message, /must be scoped/);
				assert.equal(searchCalls.length, 0, 'the refusal costs no upstream request');
			} finally {
				manager.dispose();
			}
		});

		// `unassigned` and `any-assignee` read like constraints but describe the ISSUE, not the caller, so neither
		// reduces the search to anyone's own world: unscoped, `no:assignee` matches tens of millions of issues.
		for (const relationship of ['unassigned', 'any-assignee'] as const) {
			test(`refuses ${relationship} alone — it is not a scope`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						criteria: { relationships: [relationship] },
					});

					assert.equal(result.fetchFailed, true);
					assert.match(result.warnings[0].message, /must be scoped/);
					assert.equal(searchCalls.length, 0);
				} finally {
					manager.dispose();
				}
			});
		}

		for (const relationship of ['authored', 'assigned', 'mentioned'] as const) {
			test(`accepts ${relationship} alone as a scope — it bounds the search to the user`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						criteria: { relationships: [relationship] },
					});

					assert.equal(result.fetchFailed, undefined);
					assert.deepEqual(result.warnings, []);
					assert.equal(searchCalls.length, 1);
				} finally {
					manager.dispose();
				}
			});
		}

		test('accepts repos and org together, forwarding both', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					org: 'acme',
				});

				assert.equal(searchCalls.length, 1);
				assert.deepEqual(searchCalls[0].repos, ['o/a']);
				assert.equal(searchCalls[0].org, 'acme');
			} finally {
				manager.dispose();
			}
		});

		// A search names repositories by PATH, so ids can't scope it. Dropping them would search the whole org (or
		// the whole host) as if that had been asked for, which is why this is a refusal rather than a fallback.
		test('refuses repository ids as a scope', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: ['1234', '5678'],
				});

				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /repository id/);
				assert.equal(searchCalls.length, 0);
			} finally {
				manager.dispose();
			}
		});
	});

	suite('criteria validation', () => {
		test('refuses `any-assignee` together with `unassigned` as contradictory', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					criteria: { relationships: ['any-assignee', 'unassigned'] },
				});

				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /contradictory/);
				assert.equal(searchCalls.length, 0, 'no issue satisfies both, so nothing is worth requesting');
			} finally {
				manager.dispose();
			}
		});

		// Every non-GitHub git host declares no filtered issue search, so the read refuses rather than serving a
		// list that was never narrowed. `getSupportedFilters().issueSearch` reports this ahead of the call.
		const unsupported: IntegrationIds[] = [
			GitCloudHostIntegrationId.GitLab,
			GitCloudHostIntegrationId.AzureDevOps,
			GitCloudHostIntegrationId.Bitbucket,
		];
		for (const providerId of unsupported) {
			test(`refuses the read for '${providerId}', which declares no filtered issue search`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const result = await manager.searchIssuesPage({
						providerId: providerId,
						repos: [{ namespace: 'o', name: 'a' }],
					});

					assert.deepEqual(result.items, []);
					assert.equal(result.fetchFailed, true);
					assert.equal(result.warnings.length, 1);
				} finally {
					manager.dispose();
				}
			});
		}

		test('refuses an issue-tracker provider — this surface is git-host shaped', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const result = await manager.searchIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Jira,
					org: 'acme',
				});

				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /git-host integration/);
			} finally {
				manager.dispose();
			}
		});

		test('GitHub Enterprise shares GitHub’s capability table', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const supported = manager.getSupportedFilters(
					GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
				).issueSearch;
				assert.deepEqual(
					supported,
					manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSearch,
					'a GHE instance runs the same search syntax, so two tables could only drift',
				);
			} finally {
				manager.dispose();
			}
		});
	});

	suite('the result ceiling', () => {
		// The ceiling is an OMISSION, not a failure: the request succeeded, and what is missing is unreachable
		// rather than unfetched. So `fetchFailed` stays absent and `recovery` is `'none'` — a "load more" here
		// could never deliver — while `totalCount` is what lets a consumer say how many matches were withheld.
		test('reports a succeeded-but-capped read with the total match count', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				await stubGitHubApi(manager, {
					searchIssuesPage: () => emptyPage({ truncated: true, totalCount: 19240 }),
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
				});

				assert.equal(result.fetchFailed, undefined, 'the request succeeded');
				assert.equal(result.page.truncated, true);
				assert.equal(result.warnings.length, 1);
				const omission = result.warnings[0].omission;
				assert.ok(omission != null, 'an omission distinguishes withheld results from a failure');
				assert.equal(omission.kind, 'provider-limit');
				assert.equal(omission.recovery, 'none');
				assert.equal(omission.totalCount, 19240);
				assert.equal(omission.limit, 1000);
				assert.equal(result.warnings[0].kind, 'other');
			} finally {
				manager.dispose();
			}
		});

		test('falls back to the generic truncation warning when no total explains it', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				// Truncated with a count BELOW the ceiling: something else (an unusable continuation) cut the read
				// short, so quoting the cap would be a false explanation.
				await stubGitHubApi(manager, {
					searchIssuesPage: () => emptyPage({ truncated: true, totalCount: 12 }),
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
				});

				assert.equal(result.page.truncated, true);
				assert.equal(result.warnings.length, 1);
				assert.doesNotMatch(result.warnings[0].message, /matched 12/);
				assert.equal(result.warnings[0].omission?.kind, 'pagination-incomplete');
			} finally {
				manager.dispose();
			}
		});
	});

	suite('paging', () => {
		test('never advertises hasMore without a usable cursor', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				// A provider claiming another page while withholding its cursor is a dead end: paging on `hasMore`
				// would re-request the same page forever, so this is reported as terminal-but-incomplete.
				await stubGitHubApi(manager, {
					searchIssuesPage: () => emptyPage({ hasMore: true, cursor: undefined }),
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
				});

				assert.equal(result.hasMore, false);
				assert.equal(result.cursor, undefined);
				assert.equal(result.page.truncated, true);
			} finally {
				manager.dispose();
			}
		});

		test('walks to the requested page when given only a page number', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				let served = 0;
				const { searchCalls } = await stubGitHubApi(manager, {
					searchIssuesPage: () => {
						served++;
						return emptyPage({
							page: served,
							hasMore: served < 3,
							cursor: served < 3 ? `c${served}` : undefined,
						});
					},
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					page: 3,
				});

				assert.equal(searchCalls.length, 3, 'cursor-only, so page 3 costs three requests');
				assert.equal(result.page.currentPage, 3);
				assert.equal(searchCalls[1].cursor, 'c1');
				assert.equal(searchCalls[2].cursor, 'c2');
			} finally {
				manager.dispose();
			}
		});

		test('a page past the last one is an empty page N, never the last page relabeled', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const issue = { id: '1', url: 'https://github.com/o/a/issues/1' } as unknown as IssueShape;
				await stubGitHubApi(manager, {
					searchIssuesPage: () => emptyPage({ values: [issue], hasMore: false }),
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					page: 5,
				});

				assert.deepEqual(result.items, [], 'page 5 genuinely holds nothing');
				assert.equal(result.page.currentPage, 5, 'and says so, rather than reporting page 1');
				assert.equal(result.hasMore, false);
			} finally {
				manager.dispose();
			}
		});

		test('stops rather than looping when a provider hands back the same cursor', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, {
					searchIssuesPage: () => emptyPage({ hasMore: true, cursor: 'stuck' }),
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
					page: 4,
				});

				assert.ok(
					searchCalls.length <= 2,
					`expected to stop at the repeated cursor, made ${searchCalls.length}`,
				);
				assert.equal(result.page.truncated, true);
			} finally {
				manager.dispose();
			}
		});
	});

	test('surfaces an unsupported-search refusal when the provider returns nothing without an error', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			// An unimplemented hook resolves to `undefined` with no error, which would otherwise read as "this
			// account has no matching issues" — indistinguishable from a real empty result.
			await stubGitHubApi(manager, { searchIssuesPage: () => undefined });

			const result = await manager.searchIssuesPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: [{ namespace: 'o', name: 'a' }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
		} finally {
			manager.dispose();
		}
	});
});

suite('IntegrationManager.countIssues', () => {
	test('echoes each count under the caller’s own key', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, {
				countIssues: scopes => scopes.map((_, i) => 10 + i),
			});

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{
						key: 'unassigned',
						repos: [{ namespace: 'o', name: 'a' }],
						criteria: { relationships: ['unassigned'] },
					},
					{ key: 'recent', repos: [{ namespace: 'o', name: 'a' }], criteria: { updatedAfter: '2026-05-05' } },
				],
			});

			assert.deepEqual(
				result.items.map(i => ({ key: i.key, count: i.count })),
				[
					{ key: 'unassigned', count: 10 },
					{ key: 'recent', count: 11 },
				],
			);
			assert.equal(result.fetchFailed, undefined);
			assert.equal(countCalls.length, 1, 'both scopes share one request');
		} finally {
			manager.dispose();
		}
	});

	test('an empty scope list is an empty success, not a refusal', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: () => [] });

			const result = await manager.countIssues({ providerId: GitCloudHostIntegrationId.GitHub, scopes: [] });

			assert.deepEqual(result.items, []);
			assert.deepEqual(result.warnings, [], 'nothing was asked for, so nothing is missing');
			assert.equal(result.fetchFailed, undefined);
			assert.equal(countCalls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	// `key` exists so the caller can match results without positional bookkeeping. Two results under one key make
	// that ambiguous for EVERY scope, not just the repeated one, so the whole call is refused rather than deduped.
	test('refuses the whole call on a duplicate key', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'same', repos: [{ namespace: 'o', name: 'a' }] },
					{ key: 'same', repos: [{ namespace: 'o', name: 'b' }] },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /Duplicate/);
			assert.equal(countCalls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('isolates a refused scope, still counting its siblings', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 5) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'ok', repos: [{ namespace: 'o', name: 'a' }] },
					// Unscoped: meaningless on its own, but it must not cost the sibling its count.
					{ key: 'unscoped', criteria: { relationships: ['unassigned'] } },
				],
			});

			assert.deepEqual(
				result.items.map(i => i.key),
				['ok'],
			);
			assert.equal(result.fetchFailed, true, 'part of what was asked for is missing');
			assert.equal(result.warnings.length, 1);
			assert.match(result.warnings[0].message, /unscoped/);
			assert.deepEqual(countCalls[0].length, 1, 'the refused scope never reaches the provider');
		} finally {
			manager.dispose();
		}
	});

	// A relationship set is OR-ed across searches. One count could only sum them (double-counting anything that
	// matches two) or take the max (under-reporting), so it refuses instead: a missing number beats a wrong one.
	test('refuses a scope requesting several relationships', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{
						key: 'both',
						repos: [{ namespace: 'o', name: 'a' }],
						criteria: { relationships: ['authored', 'assigned'] },
					},
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /one scope per relationship/);
		} finally {
			manager.dispose();
		}
	});

	test('flags a count past the provider’s ceiling, so a caller can warn before fetching', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: () => [19240] });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'all', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.equal(result.items[0].count, 19240);
			assert.equal(result.items[0].exceedsProviderLimit, true);
			assert.equal(result.items[0].providerLimit, 1000);
		} finally {
			manager.dispose();
		}
	});

	// `undefined` means "not reported" and must never be rendered as 0 — that would tell the user a filter matches
	// nothing when it may match thousands.
	test('an unreported count is undefined and is not flagged against the ceiling', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: () => [undefined] });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'unknown', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.equal(result.items[0].count, undefined);
			assert.equal(result.items[0].exceedsProviderLimit, false, 'unknown-vs-limit is not a comparison');
		} finally {
			manager.dispose();
		}
	});

	// The batches are independent requests, so they run concurrently — sequentially they would spend exactly the
	// resource the probe exists to conserve (measured ~2s per batch, so 10 batches would be ~20s instead of ~4s).
	test('runs its batches concurrently rather than one after another', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			let inFlight = 0;
			let maxInFlight = 0;
			const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
			assert.ok(gh != null);
			(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
			const githubApi = await (
				gh as unknown as {
					authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
				}
			).authenticationService.apis.github;
			assert.ok(githubApi);
			githubApi.countIssues = async (_p: unknown, _t: unknown, scopes: Record<string, unknown>[]) => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight--;
				return scopes.map(() => 1);
			};

			// 75 scopes ⇒ 3 batches of 25.
			await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: Array.from({ length: 75 }, (_, i) => ({
					key: `k${i}`,
					repos: [{ namespace: 'o', name: `r${i}` }],
				})),
			});

			assert.ok(maxInFlight > 1, `expected overlapping requests, saw at most ${maxInFlight} in flight`);
		} finally {
			manager.dispose();
		}
	});

	test('batches beyond the chunk size into several requests', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const { countCalls } = await stubGitHubApi(manager, { countIssues: scopes => scopes.map(() => 1) });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: Array.from({ length: 26 }, (_, i) => ({
					key: `k${i}`,
					repos: [{ namespace: 'o', name: `r${i}` }],
				})),
			});

			assert.equal(result.items.length, 26, 'every scope is answered');
			assert.deepEqual(
				countCalls.map(c => c.length),
				[25, 1],
				'chunked at 25, so a 26th scope starts a second request',
			);
		} finally {
			manager.dispose();
		}
	});

	test('a provider with no count support refuses rather than reporting zeros', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubApi(manager, { countIssues: () => undefined });

			const result = await manager.countIssues({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'a', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
		} finally {
			manager.dispose();
		}
	});
});
