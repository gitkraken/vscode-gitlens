import assert from 'node:assert';
import { suite, test } from 'mocha';
import { PullRequestFilter } from '@gitlens/git/models/pullRequest.js';
import type { PullRequestSorting } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import { toGitHubPullRequestSearchFacets, toGitHubPullRequestSortQualifier } from '../pullRequestSearchQuery.js';
import type { GitHubTokenInfo } from '../token.js';

suite('GitHubApi.searchPullRequestsPage', () => {
	const provider = {
		id: 'github',
		name: 'GitHub',
		domain: 'github.com',
		icon: 'github',
		getIgnoreSSLErrors: () => false,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	} as unknown as Provider;

	const token: GitHubTokenInfo = {
		providerId: 'github',
		accessToken: 'token',
		microHash: 'hash',
		cloud: true,
		type: undefined,
	};

	type SearchResponse = {
		issueCount?: number;
		endCursor?: string | null;
		hasNextPage?: boolean;
		nodes?: unknown[];
	};
	type SearchResponses = Record<string, SearchResponse>;
	type CapturedCall = { query: string; variables: Record<string, unknown> };

	function capture(responses: SearchResponses[] = [{}]): {
		config: GitHubApiConfig;
		getCalls: () => CapturedCall[];
	} {
		const calls: CapturedCall[] = [];
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, unknown>;
				};
				const variables = body.variables ?? {};
				const query = body.query ?? '';
				calls.push({ query: query, variables: variables });
				const response = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {};
				// A GraphQL server returns only the fields the document SELECTS. Honouring that is what lets a
				// test distinguish "the mapper reads this field" from "the query never asked for it" — a fake
				// that serves whatever the fixture holds passes either way, which is how the missing stack
				// selection survived a green suite in the first place.
				const selectsStack = query.includes('stack {');
				const asSelected = (node: unknown): unknown => {
					if (selectsStack || node == null || typeof node !== 'object') {
						return node;
					}

					const { stack: _stack, stackEntry: _stackEntry, ...rest } = node as Record<string, unknown>;
					return rest;
				};
				const data: Record<string, unknown> = {};
				for (const key of Object.keys(variables).filter(key => key.endsWith('Search'))) {
					const alias = key.slice(0, -'Search'.length);
					const category = response[alias] ?? {};
					data[alias] = {
						issueCount: category.issueCount ?? 0,
						pageInfo: {
							endCursor: category.endCursor ?? null,
							hasNextPage: category.hasNextPage ?? false,
						},
						nodes: (category.nodes ?? []).map(asSelected),
					};
				}
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return { config: config, getCalls: () => calls };
	}

	function search(call: CapturedCall, alias: string): string {
		return String(call.variables[`${alias}Search`]);
	}

	function prNode(number: number, updatedAt: string): unknown {
		return {
			id: `node-${number}`,
			number: number,
			title: `PR ${number}`,
			body: `Body ${number}`,
			permalink: `https://github.com/octo/repo/pull/${number}`,
			url: `https://github.com/octo/repo/pull/${number}`,
			state: 'OPEN',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: updatedAt,
			closedAt: null,
			mergedAt: null,
			author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
			baseRefName: 'main',
			baseRefOid: 'base',
			headRefName: 'feature',
			headRefOid: 'head',
			headRepository: {
				isFork: false,
				name: 'repo',
				owner: { login: 'octo' },
				sshUrl: 'git@github.com:octo/repo.git',
				url: 'https://github.com/octo/repo',
			},
			repository: {
				isFork: false,
				name: 'repo',
				owner: { login: 'octo' },
				sshUrl: 'git@github.com:octo/repo.git',
				url: 'https://github.com/octo/repo',
				viewerPermission: 'WRITE',
			},
			isCrossRepository: false,
			isDraft: false,
			additions: 1,
			deletions: 1,
			checksUrl: '',
			mergeable: 'MERGEABLE',
			reviewDecision: 'APPROVED',
			latestReviews: { nodes: [] },
			viewerLatestReview: null,
			reviewRequests: { nodes: [] },
			assignees: { nodes: [] },
			commits: { nodes: [] },
			totalCommentsCount: 0,
			viewerCanUpdate: true,
		};
	}

	test('unions visible relationships and terminal states in one upstream request', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			org: 'acme',
			repos: ['o/a'],
			criteria: {
				text: 'graph performance',
				relationships: [
					PullRequestFilter.Author,
					PullRequestFilter.Assignee,
					PullRequestFilter.ReviewRequested,
				],
				states: ['closed', 'merged'],
				includeArchived: true,
			},
		});

		assert.equal(getCalls().length, 1, 'every facet is aliased into one GraphQL request');
		const call = getCalls()[0];
		assert.match(search(call, 'authorClosed'), /author:@me.*is:closed is:unmerged/);
		assert.match(search(call, 'assigneeMerged'), /assignee:@me.*is:merged/);
		assert.match(search(call, 'reviewRequestedClosed'), /review-requested:@me/);
		assert.equal(Object.keys(call.variables).filter(key => key.endsWith('Search')).length, 6);
		for (const key of Object.keys(call.variables).filter(key => key.endsWith('Search'))) {
			const query = String(call.variables[key]);
			assert.match(query, /org:acme/);
			assert.match(query, /repo:o\/a/);
			assert.match(query, /graph performance/);
			assert.match(query, /sort:updated/);
			assert.doesNotMatch(query, /involves:@me|commenter:@me|archived:false/);
		}
	});

	test('omitted relationships search the whole repository scope, not involves:@me', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });

		const query = search(getCalls()[0], 'scopeOpen');
		assert.match(query, /repo:o\/a/);
		assert.match(query, /is:open/);
		assert.match(query, /archived:false/);
		assert.doesNotMatch(query, /@me/);
	});

	test('emits the draft qualifier only for the state it was set to, and never when omitted', async () => {
		const onlyDrafts = capture();
		await new GitHubApi(onlyDrafts.config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: { draft: true },
		});
		assert.match(search(onlyDrafts.getCalls()[0], 'scopeOpen'), /draft:true/);

		const readyForReview = capture();
		await new GitHubApi(readyForReview.config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: { draft: false },
		});
		const readyQuery = search(readyForReview.getCalls()[0], 'scopeOpen');
		assert.match(readyQuery, /draft:false/);
		assert.doesNotMatch(readyQuery, /draft:true/);

		const unconstrained = capture();
		await new GitHubApi(unconstrained.config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });
		assert.doesNotMatch(search(unconstrained.getCalls()[0], 'scopeOpen'), /draft:/);
	});

	test('uses a cost-safe default page size while preserving the explicit maximum', async () => {
		const { config, getCalls } = capture([{}, {}]);
		const api = new GitHubApi(config);

		await api.searchPullRequestsPage(provider, token, { repos: ['o/a'] });
		await api.searchPullRequestsPage(provider, token, { repos: ['o/a'], pageSize: 500 });

		assert.match(getCalls()[0].query, /scopeOpen: search\(first: 30,/);
		assert.match(getCalls()[1].query, /scopeOpen: search\(first: 100,/);
	});

	test('translates the declared mention relationship without widening to commenter', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			criteria: { relationships: [PullRequestFilter.Mention] },
		});

		const query = search(getCalls()[0], 'mentionOpen');
		assert.match(query, /mentions:@me/);
		assert.doesNotMatch(query, /commenter:@me|involves:@me/);
	});

	test('translates the reviewed relationship to reviewed-by', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			criteria: { relationships: [PullRequestFilter.Reviewed] },
		});

		assert.match(search(getCalls()[0], 'reviewedOpen'), /reviewed-by:@me/);
	});

	test('sanitizes free text so it cannot inject scope or state qualifiers', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			org: 'acme',
			criteria: { text: 'crash\norg:evil is:merged' },
		});

		const query = search(getCalls()[0], 'scopeOpen');
		assert.match(query, /\bcrash\b/);
		assert.match(query, /org:acme/);
		assert.doesNotMatch(query, /org:evil|is:merged/);
		assert.match(query, /is:open/, 'the structured states remain authoritative');
	});

	test('emits updated/created date qualifiers on every facet', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: {
				relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee],
				updatedAfter: '2026-05-05',
				createdAfter: '2026-01-01',
			},
		});

		for (const key of Object.keys(getCalls()[0].variables).filter(key => key.endsWith('Search'))) {
			const query = String(getCalls()[0].variables[key]);
			assert.match(query, /updated:>=2026-05-05/);
			assert.match(query, /created:>=2026-01-01/);
		}
	});

	test('drops a date qualifier emptied by sanitizing rather than emitting a bare one', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: { updatedAfter: '"\n' },
		});

		const query = search(getCalls()[0], 'scopeOpen');
		assert.doesNotMatch(query, /updated:>=/);
	});

	test('`all` subsumes every other requested state', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: { states: ['open', 'all', 'merged'] },
		});

		assert.equal(Object.keys(getCalls()[0].variables).filter(key => key.endsWith('Search')).length, 1);
		const query = search(getCalls()[0], 'scopeAll');
		assert.doesNotMatch(query, /is:open|is:closed|is:merged|is:unmerged/);
	});

	test('deduplicates facet overlap and orders the page by updated date', async () => {
		const duplicate = prNode(2, '2024-03-01T00:00:00Z');
		const { config } = capture([
			{
				authorOpen: { nodes: [prNode(1, '2024-01-01T00:00:00Z'), duplicate] },
				assigneeOpen: { nodes: [prNode(3, '2024-04-01T00:00:00Z'), duplicate] },
			},
		]);
		const result = await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			criteria: { relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee] },
		});

		assert.deepEqual(
			result?.values.map(pr => pr.title),
			['PR 3', 'PR 2', 'PR 1'],
		);
	});

	test('re-sorts the merged page by the requested key, not the hardcoded default', async () => {
		// The created order is deliberately not the updated order, so a page returned under `created:asc` proves the
		// requested sort reached the merged-page comparator rather than the always-updated-desc order it replaced.
		const withCreated = (number: number, createdAt: string, updatedAt: string): unknown => ({
			...(prNode(number, updatedAt) as Record<string, unknown>),
			createdAt: createdAt,
		});
		const { config } = capture([
			{
				authorOpen: {
					nodes: [
						withCreated(1, '2024-03-01T00:00:00Z', '2024-01-01T00:00:00Z'),
						withCreated(2, '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'),
						withCreated(3, '2024-02-01T00:00:00Z', '2024-03-01T00:00:00Z'),
					],
				},
			},
		]);
		const result = await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			criteria: { relationships: [PullRequestFilter.Author], sort: 'created:asc' },
		});

		// created ascending is 2 (Jan) < 3 (Feb) < 1 (Mar); the default updated:desc would have given 3, 2, 1.
		assert.deepEqual(
			result?.values.map(pr => pr.title),
			['PR 2', 'PR 3', 'PR 1'],
		);
	});

	test('preserves facet cursors, total count, and truncation in one request per page', async () => {
		const { config, getCalls } = capture([
			{
				authorOpen: { issueCount: 19240, endCursor: 'author-c1', hasNextPage: true },
				reviewRequestedOpen: { issueCount: 12 },
			},
			{ authorOpen: { issueCount: 19240 } },
		]);
		const api = new GitHubApi(config);
		const criteria = {
			relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		};

		const first = await api.searchPullRequestsPage(provider, token, { criteria: criteria });
		assert.equal(first?.totalCount, 19240);
		assert.equal(first?.truncated, true);
		assert.equal(first?.hasMore, true);
		assert.ok(first?.cursor != null);

		const second = await api.searchPullRequestsPage(provider, token, { criteria: criteria, cursor: first.cursor });
		assert.equal(getCalls().length, 2, 'threading one composite cursor adds exactly one HTTP request');
		assert.equal(getCalls()[1].variables.authorOpenCursor, 'author-c1');
		assert.equal(getCalls()[1].variables.includeReviewRequestedOpen, false);
		assert.equal(second?.page, 2);
		assert.equal(second?.totalCount, 19240);
		assert.equal(second?.truncated, true, 'the first-page ceiling cannot disappear on a later page');
	});

	test('reports an unusable facet continuation as terminal but truncated', async () => {
		const { config } = capture([{ scopeOpen: { issueCount: 12, hasNextPage: true, endCursor: null } }]);
		const result = await new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });

		assert.equal(result?.hasMore, false);
		assert.equal(result?.cursor, undefined);
		assert.equal(result?.truncated, true);
	});

	test('degrades a foreign cursor to page 1 without forwarding it', async () => {
		const { config, getCalls } = capture();
		const result = await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			cursor: JSON.stringify({ page: 9, cursor: 'foreign' }),
		});

		assert.equal(result?.page, 1);
		assert.equal(getCalls()[0].variables.scopeOpenCursor, undefined);
	});

	test('degrades a cursor from different criteria instead of resuming the wrong search', async () => {
		const { config, getCalls } = capture([
			{ authorOpen: { endCursor: 'c1', hasNextPage: true } },
			{ authorOpen: {} },
		]);
		const api = new GitHubApi(config);
		const relationships = [PullRequestFilter.Author];
		const first = await api.searchPullRequestsPage(provider, token, {
			criteria: { text: 'old', relationships: relationships },
		});
		assert.ok(first?.cursor != null);

		const restarted = await api.searchPullRequestsPage(provider, token, {
			criteria: { text: 'new', relationships: relationships },
			cursor: first.cursor,
		});

		assert.equal(restarted?.page, 1);
		assert.equal(getCalls()[1].variables.authorOpenCursor, undefined);
		assert.match(String(getCalls()[1].variables.authorOpenSearch), /\bnew\b/);
	});

	// This read is assembled by mapping over facets, so the stack selection has to be appended inside that
	// template — it is the one PR read where forgetting it is invisible: `stack`/`stackEntry` are optional on
	// the node type so it type-checks, and `fromGitHubPullRequestStack` returns undefined per row rather than
	// throwing. A stacked pull request then reads as unstacked here while every sibling read reports it
	// correctly, which is exactly the state this branch shipped in before it was caught.
	test('selects the stack fields on every facet, not just the first', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: {
				relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee],
				states: ['open', 'closed'],
			},
		});

		const { query } = getCalls()[0];
		const facets = Array.from(query.matchAll(/(\w+): search\(/g), m => m[1]);
		assert.equal(facets.length, 4, 'two relationships x two states');
		assert.equal(
			(query.match(/stack \{/g) ?? []).length,
			facets.length,
			'every facet selects stack, or stacked PRs silently read as unstacked on that facet',
		);
		assert.equal((query.match(/stackEntry \{/g) ?? []).length, facets.length, 'position comes from stackEntry');
	});

	test('maps the selected stack fields onto the returned pull request', async () => {
		const stacked = {
			...(prNode(1, '2024-01-02T00:00:00Z') as Record<string, unknown>),
			stack: { id: 'stack-7', number: 7, size: 3, baseRefName: 'main' },
			stackEntry: { position: 2 },
		};
		const { config } = capture([
			{ authorOpen: { issueCount: 2, nodes: [stacked, prNode(2, '2024-01-01T00:00:00Z')] } },
		]);

		const result = await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: [PullRequestFilter.Author], states: ['open'] },
		});

		assert.deepEqual(result?.values[0].stack, {
			id: 'stack-7',
			number: 7,
			size: 3,
			position: 2,
			baseRef: 'main',
		});
		assert.equal(result?.values[1].stack, undefined, 'an unstacked pull request reports no stack');
	});

	// GitHub Enterprise Server's schema has no `stack` field, and selecting it fails the WHOLE query rather
	// than the field — which would take this search down entirely on Enterprise, not just its stack info.
	test('omits the stack selection off github.com', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			baseUrl: 'https://github.acme.com/api/v3',
			criteria: { relationships: [PullRequestFilter.Author], states: ['open'] },
		});

		assert.doesNotMatch(getCalls()[0].query, /stack \{/);
	});
});

suite('toGitHubPullRequestSearchFacets ordering', () => {
	// The sort qualifier is emitted LAST so it reads the same across facets regardless of how many other qualifiers
	// each carries, and so an exact-query assertion can pin it at the tail.
	test('an omitted sort emits the historical default as the last qualifier of every facet', () => {
		const facets = toGitHubPullRequestSearchFacets(undefined);

		assert.ok(facets.length > 0);
		for (const facet of facets) {
			assert.strictEqual(facet.qualifiers.at(-1), 'sort:updated', 'the default is the bare `sort:updated`');
		}
	});

	// One facet per relationship × state, and each must carry the EXPLICIT ordering last: without it that facet
	// answers in relevance order, so which of its rows land inside the result ceiling would shift with nothing
	// changed upstream. Per-key qualifier mapping is pinned separately by the `toGitHubPullRequestSortQualifier` suite.
	test('an explicit sort is the last element of every relationship × state facet', () => {
		const facets = toGitHubPullRequestSearchFacets({
			relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee],
			states: ['open', 'closed'],
			sort: 'created:desc',
		});

		assert.equal(facets.length, 4, 'two relationships times two states');
		for (const facet of facets) {
			assert.strictEqual(facet.qualifiers.at(-1), 'sort:created-desc', `${facet.alias} carries the ordering`);
		}
	});

	// A key GitHub can't express is REFUSED, not silently emitted as the default `sort:updated`: a fallback order
	// would ship one order in the query while the merged-page comparator applied another (or none), the exact
	// approximation the ceiling contract forbids. Unreachable through the typed union — every `PullRequestSorting`
	// maps — so a cast stands in for a runtime value that reached this exported builder past the facade's check.
	test('refuses a sort GitHub cannot express rather than falling back to the default order', () => {
		assert.throws(
			() => toGitHubPullRequestSearchFacets({ sort: 'relevance:desc' as PullRequestSorting }),
			/cannot order a pull request search by 'relevance:desc'/,
		);
	});
});

suite('toGitHubPullRequestSortQualifier', () => {
	const cases: [sort: PullRequestSorting, qualifier: string][] = [
		['created:asc', 'sort:created-asc'],
		['created:desc', 'sort:created-desc'],
		['updated:asc', 'sort:updated-asc'],
		// The bare `sort:updated`, not `sort:updated-desc`: the two are the same query to GitHub, but the bare form is
		// what this read has always emitted, so the default stays byte-identical to today's query.
		['updated:desc', 'sort:updated'],
	];

	for (const [sort, qualifier] of cases) {
		test(`translates ${sort} to its own qualifier`, () => {
			assert.strictEqual(toGitHubPullRequestSortQualifier(sort), qualifier);
		});
	}

	test('reports no qualifier for an absent key', () => {
		assert.strictEqual(toGitHubPullRequestSortQualifier(undefined), undefined);
	});
});

suite('GitHubApi.countPullRequests', () => {
	const provider = {
		id: 'github',
		name: 'GitHub',
		domain: 'github.com',
		icon: 'github',
		getIgnoreSSLErrors: () => false,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	} as unknown as Provider;

	const token: GitHubTokenInfo = {
		providerId: 'github',
		accessToken: 'token',
		microHash: 'hash',
		cloud: true,
		type: undefined,
	};

	/**
	 * Answers each `s{scope}f{facet}` alias with the count in `countsByAlias`; an alias absent from the record is
	 * OMITTED from the response, which is how "not reported" is exercised (distinct from a reported zero).
	 */
	function capture(countsByAlias: Record<string, number>): {
		config: GitHubApiConfig;
		getQuery: () => string;
		getVariables: () => Record<string, unknown>;
		getRequestCount: () => number;
	} {
		let query = '';
		let variables: Record<string, unknown> = {};
		let requests = 0;
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				requests++;
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, unknown>;
				};
				query = body.query ?? '';
				variables = body.variables ?? {};
				const data: Record<string, unknown> = {};
				for (const alias of Object.keys(variables).filter(key => /^s\d+f\d+$/.test(key))) {
					if (alias in countsByAlias) {
						data[alias] = { issueCount: countsByAlias[alias] };
					}
				}
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return {
			config: config,
			getQuery: () => query,
			getVariables: () => variables,
			getRequestCount: () => requests,
		};
	}

	test('counts several scopes in one request, transferring no pull requests', async () => {
		const { config, getQuery, getRequestCount } = capture({ s0f0: 111, s1f0: 133 });
		const api = new GitHubApi(config);

		const counts = await api.countPullRequests(provider, token, [{ repos: ['o/a'] }, { repos: ['o/b'] }]);

		assert.deepEqual(counts, [111, 133], 'counts come back positionally, one per scope');
		assert.equal(getRequestCount(), 1, 'both scopes share a single request');
		// `first: 0` is what makes the probe cheap; a node selection would defeat its entire purpose.
		assert.match(getQuery(), /first: 0/);
		assert.doesNotMatch(getQuery(), /nodes/, 'no pull-request data is requested');
	});

	test('scopes every count to pull requests with is:pr', async () => {
		const { config, getVariables } = capture({ s0f0: 1 });
		await new GitHubApi(config).countPullRequests(provider, token, [{ repos: ['o/a'] }]);

		assert.match(String(getVariables().s0f0), /is:pr/);
	});

	test('generates its own aliases, never deriving them from caller-controlled values', async () => {
		const { config, getQuery } = capture({ s0f0: 1 });
		await new GitHubApi(config).countPullRequests(provider, token, [{ org: 'acme' }]);

		const aliases = Array.from(getQuery().matchAll(/(\w+): search\(/g), m => m[1]);
		assert.deepEqual(aliases, ['s0f0'], 'positional and generated, so no caller text can break the document');
	});

	// The count only means anything if it applies the SAME qualifiers the search would. Both go through one facet
	// builder; this pins that a default (open) scope's count query is byte-identical to the read's `scopeOpen` facet.
	test('emits the same qualifiers as the search it previews', async () => {
		let facetQuery = '';
		const searchConfig: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: Record<string, string> };
				facetQuery = body.variables?.scopeOpenSearch ?? '';
				return new Response(
					JSON.stringify({
						data: {
							scopeOpen: { issueCount: 0, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		await new GitHubApi(searchConfig).searchPullRequestsPage(provider, token, {
			org: 'acme',
			repos: ['o/a', 'o/b'],
		});

		const { config, getVariables } = capture({ s0f0: 1 });
		await new GitHubApi(config).countPullRequests(provider, token, [{ org: 'acme', repos: ['o/a', 'o/b'] }]);

		assert.equal(String(getVariables().s0f0), facetQuery);
	});

	test('a multi-state scope reports the largest of its per-state counts, not their sum', async () => {
		// open=40, closed=90 → the read surfaces the max (90) as its total, so the count must agree; summing (130)
		// would claim a total the read never returns.
		const { config, getRequestCount } = capture({ s0f0: 40, s0f1: 90 });
		const api = new GitHubApi(config);

		const counts = await api.countPullRequests(provider, token, [
			{ repos: ['o/a'], criteria: { states: ['open', 'closed'] } },
		]);

		assert.deepEqual(counts, [90]);
		assert.equal(getRequestCount(), 1, 'both state facets share the one request');
	});

	test('an empty scope list makes no request', async () => {
		const { config, getRequestCount } = capture({});
		const api = new GitHubApi(config);

		assert.deepEqual(await api.countPullRequests(provider, token, []), []);
		assert.equal(getRequestCount(), 0);
	});

	test('a scope the response reports no facet for is undefined, not zero', async () => {
		// `s0f0` comes back; `s1f0` is missing, which means "not reported" and must not read as no matches.
		const { config } = capture({ s0f0: 7 });
		const api = new GitHubApi(config);

		const counts = await api.countPullRequests(provider, token, [{ repos: ['o/a'] }, { repos: ['o/b'] }]);

		assert.deepEqual(counts, [7, undefined]);
	});
});
