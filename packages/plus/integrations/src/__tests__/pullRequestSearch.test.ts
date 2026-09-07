import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type {
	PullRequestSearchCapabilities,
	PullRequestSearchCriteria,
	PullRequestShape,
	PullRequestSorting,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { PullRequestFilter } from '../providerFilters.js';
import { providersMetadata } from '../providers/models.js';
import { resolvePullRequestSearchCriteria } from '../reads/filters.js';
import { createFakeRuntime } from './fakeRuntime.js';

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

type SearchPageResponse = {
	values: PullRequestShape[];
	truncated: boolean;
	hasMore: boolean;
	page: number;
	cursor?: string;
	totalCount?: number;
};

async function stubGitHubSearch(
	manager: ReturnType<typeof createIntegrationManager>,
	respond: (options: Record<string, unknown>, call: number) => SearchPageResponse | undefined,
): Promise<Record<string, unknown>[]> {
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(gh != null);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const githubApi = await (
		gh as unknown as {
			authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
		}
	).authenticationService.apis.github;
	assert.ok(githubApi != null);

	const calls: Record<string, unknown>[] = [];
	githubApi.searchPullRequestsPage = (_provider: unknown, _token: unknown, options: Record<string, unknown>) => {
		calls.push(options);
		return Promise.resolve(respond(options, calls.length));
	};
	return calls;
}

function emptyPage(overrides?: Partial<SearchPageResponse>): SearchPageResponse {
	return { values: [], truncated: false, hasMore: false, page: 1, ...overrides };
}

/** Stubs the GitHub API client's `countPullRequests`, recording the scopes the facade forwarded to it. */
async function stubGitHubCount(
	manager: ReturnType<typeof createIntegrationManager>,
	respond: (scopes: readonly Record<string, unknown>[]) => (number | undefined)[] | undefined,
): Promise<Record<string, unknown>[][]> {
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	assert.ok(gh != null);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');

	const githubApi = await (
		gh as unknown as {
			authenticationService: { apis: { github: Promise<Record<string, unknown> | undefined> } };
		}
	).authenticationService.apis.github;
	assert.ok(githubApi != null);

	const calls: Record<string, unknown>[][] = [];
	githubApi.countPullRequests = (_provider: unknown, _token: unknown, scopes: Record<string, unknown>[]) => {
		calls.push(scopes);
		return Promise.resolve(respond(scopes));
	};
	return calls;
}

suite('IntegrationManager.countPullRequests', () => {
	test('echoes each count under the caller’s own key', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubCount(manager, scopes => scopes.map((_, i) => 10 + i));

			const result = await manager.countPullRequests({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{
						key: 'authored',
						repos: [{ namespace: 'o', name: 'a' }],
						criteria: { relationships: [PullRequestFilter.Author] },
					},
					{ key: 'recent', repos: [{ namespace: 'o', name: 'a' }], criteria: { states: ['open', 'closed'] } },
				],
			});

			assert.deepEqual(
				result.items.map(i => ({ key: i.key, count: i.count })),
				[
					{ key: 'authored', count: 10 },
					{ key: 'recent', count: 11 },
				],
			);
			assert.equal(result.fetchFailed, undefined);
			assert.equal(calls.length, 1, 'both scopes share one request');
			// The provider override flattens descriptors to `namespace/name` and forwards the criteria verbatim.
			assert.deepEqual(calls[0][0].repos, ['o/a']);
			assert.deepEqual(calls[0][1].criteria, { states: ['open', 'closed'] });
		} finally {
			manager.dispose();
		}
	});

	// The count deliberately applies exactly the qualifiers the search would, so an unusable scope name made the
	// count AGREE with the wrong search rather than disagree with it: a consumer cross-checking "N matched"
	// against what it received could not detect the substitution by construction. Validated through the same
	// resolver the read uses, so the two can never drift.
	test('refuses a count scope whose organization a query cannot carry as given', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubCount(manager, scopes => scopes.map(() => 1));

			const result = await manager.countPullRequests({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'org', org: 'git"kraken' }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /cannot be used as given/);
			assert.match(result.warnings[0].message, /'org'/, 'the refusal names the offending count key');
			assert.equal(calls.length, 0, 'no count of a different scope reaches the provider');
		} finally {
			manager.dispose();
		}
	});

	// Per-scope isolation: one unusable scope must not cost the batch its other counts, which is the rule every
	// other count refusal follows.
	test('an unusable count scope drops only itself', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubCount(manager, scopes => scopes.map(() => 7));

			const result = await manager.countPullRequests({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{ key: 'bad', org: '"' },
					{ key: 'good', org: 'gitkraken' },
				],
			});

			assert.deepEqual(
				result.items.map(i => ({ key: i.key, count: i.count })),
				[{ key: 'good', count: 7 }],
			);
			assert.equal(result.fetchFailed, true);
			assert.equal(calls.length, 1);
			assert.deepEqual(
				calls[0].map(s => s.org),
				['gitkraken'],
			);
		} finally {
			manager.dispose();
		}
	});

	// A relationship set is OR-ed across independent searches, which a single count can't express; the caller is
	// asked to count each relationship as its own keyed scope. (Several STATES are fine — they are disjoint.) The
	// shared facade mechanics (empty scopes, duplicate keys, per-scope isolation) are covered by the countIssues
	// facade tests; here only the PR-specific behavior is exercised.
	test('refuses a scope requesting several relationships', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubCount(manager, scopes => scopes.map(() => 1));

			const result = await manager.countPullRequests({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [
					{
						key: 'mine',
						repos: [{ namespace: 'o', name: 'a' }],
						criteria: { relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee] },
					},
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /several relationships/);
			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('flags a count past the provider’s ceiling, so a caller can warn before fetching', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const limit = providersMetadata[GitCloudHostIntegrationId.GitHub]?.pullRequestSearchResultLimit ?? 0;
			await stubGitHubCount(manager, () => [limit + 500]);

			const result = await manager.countPullRequests({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'huge', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.equal(result.items[0].count, limit + 500);
			assert.equal(result.items[0].exceedsProviderLimit, true);
			assert.equal(result.items[0].providerLimit, limit);
		} finally {
			manager.dispose();
		}
	});

	test('an unreported count is undefined and is not flagged against the ceiling', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubCount(manager, () => [undefined]);

			const result = await manager.countPullRequests({
				providerId: GitCloudHostIntegrationId.GitHub,
				scopes: [{ key: 'unknown', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.equal(result.items[0].count, undefined);
			assert.equal(result.items[0].exceedsProviderLimit, false, 'unknown-vs-limit is not a comparison');
		} finally {
			manager.dispose();
		}
	});

	test('refuses on an issues-only host, which has no pull requests to count', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const result = await manager.countPullRequests({
				providerId: IssuesCloudHostIntegrationId.Jira,
				scopes: [{ key: 'x', repos: [{ namespace: 'o', name: 'a' }] }],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
		} finally {
			manager.dispose();
		}
	});
});

suite('IntegrationManager.searchPullRequestsPage', () => {
	test('searches account-wide when current-user relationships provide the scope', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: {
					text: 'graph performance',
					relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
				},
			});

			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
			assert.equal(calls.length, 1);
			assert.deepEqual(calls[0].criteria, {
				text: 'graph performance',
				relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
			});
			assert.equal(calls[0].repos, undefined);
		} finally {
			manager.dispose();
		}
	});

	test('forwards descriptor repo scope, org, relationship/state sets, archived mode, and page size', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: [{ namespace: 'o', name: 'a' }],
				org: 'acme',
				criteria: {
					text: 'crash',
					relationships: [PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested],
					states: ['closed', 'merged'],
					includeArchived: true,
				},
				itemsPerPage: 25,
			});

			assert.deepEqual(calls[0].repos, ['o/a']);
			assert.equal(calls[0].org, 'acme');
			assert.deepEqual(calls[0].criteria, {
				text: 'crash',
				relationships: [PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested],
				states: ['closed', 'merged'],
				includeArchived: true,
			});
			assert.equal(calls[0].pageSize, 25);
		} finally {
			manager.dispose();
		}
	});

	test('refuses an unscoped search with no repository, organization, or relationship', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash' },
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /must be scoped/);
			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	test('refuses repository ids because provider search scopes by path', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: ['1234'],
				criteria: { text: 'crash' },
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /repository id/);
			assert.equal(calls.length, 0);
		} finally {
			manager.dispose();
		}
	});

	// The boundary was checked against the value AS SUPPLIED while the query is built from the value AFTER the
	// provider sanitizes it, so a name that cannot be spelled in a query made the read a DIFFERENT read than the
	// one that was authorized — and all three outcomes looked like success:
	// - only quotes/whitespace/control characters emits NO `org:` qualifier at all. A scope is also what makes a
	//   relationship-less read legal, so the request carried neither, and every open PR on the host matched.
	// - a quote inside a real name (`git"kraken`) sanitizes to the REAL and DIFFERENT org `gitkraken`, and the
	//   answer looks entirely normal.
	// - whitespace splits the value into two tokens (`org:my org`), i.e. a search of `my` filtered by the free
	//   text `org` — a wrong NARROWING, not a widening: measured live, `org:gitkraken bar` returns 12 where
	//   `org:gitkraken` returns 379, and an unknown first word returns nothing at all.
	// Reachable wherever the value is typed or pasted rather than picked from provider-supplied descriptors.
	for (const org of ['   ', '"', '""', '\t\n', '" "', 'git"kraken', 'my org', 'a\nb']) {
		test(`refuses an organization named ${JSON.stringify(org)}, which a query cannot carry as given`, async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const calls = await stubGitHubSearch(manager, () => emptyPage());
				const result = await manager.searchPullRequestsPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					org: org,
					criteria: { text: 'crash' },
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, /cannot be used as given/);
				assert.equal(calls.length, 0, 'no wrongly-scoped search reaches the provider');
			} finally {
				manager.dispose();
			}
		});
	}

	// A `repo:` qualifier names a repository by its `namespace/name` PATH, so BOTH halves have to survive: an
	// unusable half either drops the whole qualifier — widening the read to every other repo in scope, which is
	// what a caller passing two repositories and one unusable value got — or leaves a path pointing at a
	// different repository.
	test('refuses a repository whose namespace or name a query cannot carry, rather than dropping it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: [
					{ namespace: 'gitkraken', name: 'vscode-gitlens' },
					{ namespace: '"', name: 'b' },
				],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /cannot be used as given/);
			assert.ok(
				result.warnings[0].message.includes(JSON.stringify('"/b')),
				'the refusal names the offending repository',
			);
			assert.equal(calls.length, 0, 'the usable repository is not searched as if both had been');
		} finally {
			manager.dispose();
		}
	});

	// The refusal is the caller's to resolve, so it has to NAME the value: which of the three failure modes
	// applied is not deducible from the message alone, and only the caller knows which scope it meant.
	test('names the unusable scope in the refusal', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				org: 'my org',
			});

			assert.match(result.warnings[0].message, /"my org"/);
		} finally {
			manager.dispose();
		}
	});

	// A usable name must still scope normally: the refusal has to be about the unusable value, not about the
	// organization channel itself.
	test('a normal organization name still scopes the search', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				org: 'gitkraken',
			});

			assert.equal(result.fetchFailed, undefined);
			assert.equal(result.warnings.length, 0);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].org, 'gitkraken');
		} finally {
			manager.dispose();
		}
	});

	test('refuses providers that declare no pull-request search', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitLab,
				criteria: { text: 'crash' },
			});
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /not supported/);
		} finally {
			manager.dispose();
		}
	});

	test('refuses issue trackers as a git-host-only surface', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const result = await manager.searchPullRequestsPage({
				providerId: IssuesCloudHostIntegrationId.Jira,
				criteria: { text: 'crash' },
			});
			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /git-host integration/);
		} finally {
			manager.dispose();
		}
	});

	test('validates every criteria channel against the capability table before requesting', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
		const supported = metadata.supportedPullRequestSearch;
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const cases: {
				capabilities: PullRequestSearchCapabilities;
				criteria: PullRequestSearchCriteria;
				expected: RegExp;
			}[] = [
				{
					capabilities: { ...supported!, text: false },
					criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
					expected: /text/,
				},
				{
					capabilities: { ...supported!, relationships: [PullRequestFilter.Author] },
					criteria: { relationships: [PullRequestFilter.ReviewRequested] },
					expected: /relationships:review-requested/,
				},
				{
					capabilities: { ...supported!, states: ['open'] },
					criteria: { relationships: [PullRequestFilter.Author], states: ['closed', 'merged'] },
					expected: /states:closed.*states:merged/,
				},
				{
					capabilities: { ...supported!, includeArchived: false },
					criteria: { relationships: [PullRequestFilter.Author], includeArchived: true },
					expected: /includeArchived/,
				},
				{
					capabilities: { ...supported!, draft: false },
					criteria: { relationships: [PullRequestFilter.Author], draft: true },
					expected: /draft/,
				},
				{
					capabilities: { ...supported!, updatedAfter: false },
					criteria: { relationships: [PullRequestFilter.Author], updatedAfter: '2026-05-05' },
					expected: /updatedAfter/,
				},
				{
					capabilities: { ...supported!, createdAfter: false },
					criteria: { relationships: [PullRequestFilter.Author], createdAfter: '2026-01-01' },
					expected: /createdAfter/,
				},
			];

			for (const testCase of cases) {
				metadata.supportedPullRequestSearch = testCase.capabilities;
				const result = await manager.searchPullRequestsPage({
					providerId: GitCloudHostIntegrationId.GitHub,
					criteria: testCase.criteria,
				});
				assert.equal(result.fetchFailed, true);
				assert.match(result.warnings[0].message, testCase.expected);
			}
			assert.equal(calls.length, 0);
		} finally {
			metadata.supportedPullRequestSearch = supported;
			manager.dispose();
		}
	});

	test('validates repository and organization scopes against their declared capabilities', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
		const supported = metadata.supportedPullRequestSearch;
		try {
			metadata.supportedPullRequestSearch = {
				...supported!,
				repositoryScope: false,
			};
			const calls = await stubGitHubSearch(manager, () => emptyPage());
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				repos: [{ namespace: 'o', name: 'a' }],
				criteria: { text: 'crash' },
			});

			assert.equal(result.fetchFailed, true);
			assert.match(result.warnings[0].message, /repositoryScope/);
			assert.equal(calls.length, 0);

			metadata.supportedPullRequestSearch = {
				...supported!,
				organizationScope: false,
			};
			const orgResult = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				org: 'acme',
				criteria: { text: 'crash' },
			});
			assert.equal(orgResult.fetchFailed, true);
			assert.match(orgResult.warnings[0].message, /organizationScope/);
			assert.equal(calls.length, 0);
		} finally {
			metadata.supportedPullRequestSearch = supported;
			manager.dispose();
		}
	});

	test('reports a succeeded provider-limit omission with total and limit', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubSearch(manager, () => emptyPage({ truncated: true, totalCount: 19240 }));
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
			});

			assert.equal(result.fetchFailed, undefined);
			assert.equal(result.page.truncated, true);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].omission?.kind, 'provider-limit');
			assert.equal(result.warnings[0].omission?.recovery, 'none');
			assert.equal(result.warnings[0].omission?.totalCount, 19240);
			assert.equal(result.warnings[0].omission?.limit, 1000);
			// The reachable window depends on the order, so the omission carries it and the message names it — the
			// default here, since the criteria requested none.
			assert.equal(result.warnings[0].omission?.sort, 'updated:desc');
			assert.match(result.warnings[0].message, /ordered by updated descending/);
		} finally {
			manager.dispose();
		}
	});

	test('the provider-limit omission and message reflect the requested order', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubSearch(manager, () => emptyPage({ truncated: true, totalCount: 19240 }));
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author], sort: 'created:asc' },
			});

			assert.equal(result.warnings[0].omission?.sort, 'created:asc');
			assert.match(result.warnings[0].message, /ordered by created ascending/);
		} finally {
			manager.dispose();
		}
	});

	test('uses one upstream request when the caller threads a cursor', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, () => emptyPage({ page: 2, cursor: 'next', hasMore: true }));
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
				page: 2,
				cursor: 'opaque',
			});

			assert.equal(calls.length, 1);
			assert.equal(calls[0].cursor, 'opaque');
			assert.equal(result.page.currentPage, 2);
			assert.equal(result.cursor, 'next');
		} finally {
			manager.dispose();
		}
	});

	test('walks cursor pages when only a page number is supplied', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const calls = await stubGitHubSearch(manager, (_options, call) =>
				emptyPage({
					page: call,
					hasMore: call < 3,
					cursor: call < 3 ? `c${call}` : undefined,
				}),
			);
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
				page: 3,
			});

			assert.equal(calls.length, 3);
			assert.equal(calls[1].cursor, 'c1');
			assert.equal(calls[2].cursor, 'c2');
			assert.equal(result.page.currentPage, 3);
		} finally {
			manager.dispose();
		}
	});

	test('surfaces an unimplemented provider hook as unsupported, not empty success', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			await stubGitHubSearch(manager, () => undefined);
			const result = await manager.searchPullRequestsPage({
				providerId: GitCloudHostIntegrationId.GitHub,
				criteria: { text: 'crash', relationships: [PullRequestFilter.Author] },
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
		} finally {
			manager.dispose();
		}
	});
});

suite('resolvePullRequestSearchCriteria sort', () => {
	// A sort the provider can't express server-side refuses the WHOLE read, folded into the same
	// `unsupported-criteria` rejection as any other channel — never silently dropped to the default, which combined
	// with the result ceiling would return a different subset than was asked for. `comments:desc` is a genuinely
	// unsupported key on GitHub (its PR search orders by created/updated only), so no capability override is needed.
	test('an unsupported sort is rejected as unsupported criteria', () => {
		assert.deepEqual(
			resolvePullRequestSearchCriteria(GitCloudHostIntegrationId.GitHub, {
				sort: 'comments:desc' as PullRequestSorting,
			}),
			{ rejection: { reason: 'unsupported-criteria', criteria: ['sort:comments:desc'] } },
		);
	});

	// The omitted (default) sort resolves to `updated:desc`, which is always in a usable search's `sorts`, so it must
	// never reject a read that otherwise asks for nothing inexpressible.
	test('omitting the sort does not reject', () => {
		assert.deepEqual(
			resolvePullRequestSearchCriteria(GitCloudHostIntegrationId.GitHub, {
				text: 'crash',
				relationships: [PullRequestFilter.Author],
			}),
			{},
		);
	});

	test('a supported sort does not reject', () => {
		assert.deepEqual(
			resolvePullRequestSearchCriteria(GitCloudHostIntegrationId.GitHub, { sort: 'created:asc' }),
			{},
		);
	});
});
