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
import { providersMetadata } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';
import type { SearchPageResponse } from './issueSearchHelpers.js';
import { primarySession, stubGitHubApi } from './issueSearchHelpers.js';

/**
 * `searchIssuesPage` makes promises the result shape alone can't show: a scope-less search is refused rather than
 * answered with the whole host, a scope name the provider query cannot carry AS GIVEN is refused rather than
 * sanitized into a different scope, a criterion the provider can't express refuses the whole read rather than
 * serving a wider set, and at the provider's result ceiling the read SUCCEEDS while reporting how many matches
 * were withheld.
 *
 * These cover the facade half of that contract — the refusals, the paging position and the cap omission. The
 * count probe's own half lives in `issueCounts.test.ts`; the query-string half (which criterion becomes which
 * qualifier, and that user input can't inject one) is asserted in `@gitlens/git-github`'s own tests, against the
 * emitted request.
 */

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

		// A scope name is validated for reaching the provider UNCHANGED, not for being non-empty: the boundary is
		// checked against the value as supplied while the query is built from the value AFTER sanitizing, so any
		// gap between the two is a read that is no longer the read that was authorized. Three outcomes, all of
		// which looked like success:
		// - only quotes/whitespace/control characters emits no `org:` qualifier at all, leaving a search of the
		//   entire host — measured at 52 million issues across unrelated accounts.
		// - a quote inside a real name sanitizes to the REAL and DIFFERENT org, whose answer looks normal.
		// - whitespace splits the value into two tokens (`org:my org`): a search of `my` filtered by the free
		//   text `org`, i.e. a wrong NARROWING rather than a widening.
		// Whitespace and quotes are what a name pasted from a config or a URL degrades to, so this needs no
		// adversarial input.
		for (const org of ['   ', '"', '""', '\t\n', '" "', 'git"kraken', 'my org', 'a\nb']) {
			test(`refuses an org named ${JSON.stringify(org)}, which a query cannot carry as given`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						org: org,
					});

					assert.deepEqual(result.items, []);
					assert.equal(result.fetchFailed, true);
					assert.match(result.warnings[0].message, /cannot be used as given/);
					assert.equal(searchCalls.length, 0, 'no wrongly-scoped search reaches the provider');
				} finally {
					manager.dispose();
				}
			});
		}

		// EDGE whitespace and control characters are what a sanitizer removes WITHOUT changing which scope the
		// query names: it maps a control character to a space, then collapses and trims, so `'gitkraken\n'` and
		// `'gitkraken\u0000'` alike emit `org:gitkraken` — the scope that was asked for. Refusing either would
		// reject a name the provider would have resolved correctly, and staying no stricter than the provider's
		// own sanitizing is the invariant that makes this refusal safe to add. Note `String.trim()` alone does
		// NOT cover the control-character half, which is why the predicate strips a wider edge class.
		for (const org of [
			'gitkraken ',
			' gitkraken',
			'gitkraken\n',
			'\tgitkraken\t',
			'gitkraken\u0000',
			'\u0000gitkraken',
			'gitkraken\u007f',
			'gitkraken \u0000',
		]) {
			test(`accepts an org named ${JSON.stringify(org)}, whose edges a sanitizer merely trims`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						org: org,
					});

					assert.equal(result.fetchFailed, undefined);
					assert.deepEqual(result.warnings, []);
					assert.equal(searchCalls.length, 1, 'the scope is usable, so the search runs');
					// Not just "a search ran": the org has to reach the provider, or accepting the value would be
					// indistinguishable from accepting it and losing it.
					assert.equal(searchCalls[0].org, org);
				} finally {
					manager.dispose();
				}
			});
		}

		// A `repo:` qualifier names the JOINED `namespace/name` path, so the COMPOSITE is what has to be usable.
		// Testing the halves separately is weaker in the direction that matters: edge characters are stripped
		// from a scope value because a sanitizer removes them, but an edge of a HALF is an INTERIOR character of
		// the path, which a sanitizer collapses rather than removes — `{ namespace: 'git ', name: 'kraken' }`
		// would pass both halves and emit `repo:git /kraken`, i.e. `repo:git` plus the free text `/kraken`. That
		// is the split this rule exists to prevent, and the edge relaxation is exactly what could reopen it.
		for (const repo of [
			{ namespace: 'git ', name: 'kraken' },
			{ namespace: 'git', name: ' kraken' },
			{ namespace: 'git\u0000', name: 'kraken' },
		]) {
			test(`refuses ${JSON.stringify(repo)}, whose halves join into a split path`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						repos: [repo],
					});

					assert.deepEqual(result.items, []);
					assert.equal(result.fetchFailed, true);
					assert.match(result.warnings[0].message, /cannot be used as given/);
					assert.equal(searchCalls.length, 0);
				} finally {
					manager.dispose();
				}
			});
		}

		// The composite catches every character-level offender but cannot see an EMPTY half — `'/a'` is a
		// perfectly spellable qualifier that simply names no repository, and GitHub answers it as free text.
		// A BLANK half is the same case and the trap the edge-stripping sets: `' /a'` strips to `'/a'`, so the
		// composite alone accepts it. Each half is therefore measured after the same stripping.
		for (const repo of [
			{ namespace: '', name: 'a' },
			{ namespace: 'o', name: '' },
			{ namespace: ' ', name: 'a' },
			{ namespace: 'o', name: ' ' },
			{ namespace: '\n', name: 'a' },
			{ namespace: '\u0000', name: 'a' },
		]) {
			test(`refuses ${JSON.stringify(repo)}, which names no repository`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						repos: [repo],
					});

					assert.equal(result.fetchFailed, true);
					assert.match(result.warnings[0].message, /cannot be used as given/);
					assert.equal(searchCalls.length, 0);
				} finally {
					manager.dispose();
				}
			});
		}

		// Edge characters on the COMPOSITE are still accepted, since a sanitizer trims them off the joined value
		// without changing which repository is named — the same invariant the org cases pin.
		test('accepts a repository whose joined path merely has edges to trim', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: ' gitkraken', name: 'vscode-gitlens ' }],
				});

				assert.equal(result.fetchFailed, undefined);
				assert.deepEqual(result.warnings, []);
				assert.equal(searchCalls.length, 1);
				// Same reason the org twin asserts the value reaches the provider: accepting the descriptor and
				// then dropping or rewriting it would be indistinguishable from accepting it.
				assert.deepEqual(searchCalls[0].repos, [' gitkraken/vscode-gitlens ']);
			} finally {
				manager.dispose();
			}
		});

		// The descriptor form is narrowed out of a union by an element-type check, which passes a half-built
		// descriptor through. It must refuse rather than throw: this facade reports refusals as warnings, and an
		// exception out of it is not a shape any consumer handles.
		test('refuses a half-built repository descriptor rather than throwing', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ name: 'a' } as unknown as { namespace: string; name: string }],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /cannot be used as given/);
				assert.equal(searchCalls.length, 0);
			} finally {
				manager.dispose();
			}
		});

		// The wider edge strip must not reach INSIDE the name: an inner control character sanitizes to a space,
		// which splits the value into two tokens exactly as an inner space does — a search of the first word
		// filtered by the rest as free text. Pins that relaxing the edges did not relax the rule.
		for (const org of ['git\u0000kraken', 'a\u0000b']) {
			test(`still refuses an org named ${JSON.stringify(org)}, whose inner control character splits it`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

					const result = await manager.searchIssuesPage({
						providerId: GitCloudHostIntegrationId.GitHub,
						org: org,
					});

					assert.deepEqual(result.items, []);
					assert.equal(result.fetchFailed, true);
					assert.match(result.warnings[0].message, /cannot be used as given/);
					assert.equal(searchCalls.length, 0);
				} finally {
					manager.dispose();
				}
			});
		}

		// A `repo:` qualifier names a repository by its `namespace/name` PATH, so both halves have to survive.
		// Dropping the unusable one would widen the read to every other repository in scope and report it as if
		// both had been searched.
		test('refuses a repository whose namespace or name a query cannot carry, rather than dropping it', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const { searchCalls } = await stubGitHubApi(manager, { searchIssuesPage: () => emptyPage() });

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [
						{ namespace: 'gitkraken', name: 'vscode-gitlens' },
						{ namespace: 'o', name: '"' },
					],
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /cannot be used as given/);
				assert.ok(
					result.warnings[0].message.includes(JSON.stringify('o/"')),
					'the refusal names the offending repository',
				);
				assert.equal(searchCalls.length, 0, 'the usable repository is not searched as if both had been');
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

		// "This provider has no filtered issue search" is the more fundamental refusal than "your scope name is
		// malformed", so the criteria/existence check runs FIRST. Telling an Azure DevOps caller its project name
		// is unusable — by a rule derived from GitHub's query language, for a provider that declares no search at
		// all — names the wrong defect, and Azure project names legitimately contain spaces.
		for (const providerId of unsupported) {
			test(`reports no filtered issue search for '${providerId}' even when the scope is also unusable`, async () => {
				const manager = createIntegrationManager(createFakeRuntime());
				try {
					const result = await manager.searchIssuesPage({ providerId: providerId, org: 'my org' });

					assert.deepEqual(result.items, []);
					assert.equal(result.fetchFailed, true);
					assert.equal(result.warnings.length, 1);
					assert.doesNotMatch(
						result.warnings[0].message,
						/cannot be used as given/,
						'the scope refusal must not pre-empt the unsupported-search one',
					);
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

		// The cap warning quotes a limit, so it can only be built for a provider that DECLARES one. A provider with
		// a filtered issue search but no declared ceiling (nothing forces the two metadata fields to travel
		// together) must fall through to the generic wording rather than quoting an invented limit or, worse,
		// reporting the truncation with no warning at all.
		test('falls back to the generic warning when the provider declares no ceiling', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
			const limit = metadata.issueSearchResultLimit;
			try {
				delete metadata.issueSearchResultLimit;
				await stubGitHubApi(manager, {
					searchIssuesPage: () => emptyPage({ truncated: true, totalCount: 19240 }),
				});

				const result = await manager.searchIssuesPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					repos: [{ namespace: 'o', name: 'a' }],
				});

				assert.equal(result.page.truncated, true);
				assert.equal(result.warnings.length, 1, 'the truncation is still reported');
				assert.doesNotMatch(result.warnings[0].message, /19240|at most/, 'but no limit is quoted');
				assert.equal(result.warnings[0].omission?.kind, 'pagination-incomplete');
				assert.equal(result.warnings[0].omission?.limit, undefined);
			} finally {
				metadata.issueSearchResultLimit = limit;
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
