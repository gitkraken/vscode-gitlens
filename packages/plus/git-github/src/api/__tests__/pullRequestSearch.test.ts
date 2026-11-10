import assert from 'node:assert';
import { suite, test } from 'mocha';
import { PullRequestFilter, PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import type { PullRequestSorting } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import { toGitHubPullRequestSearchFacets, toGitHubPullRequestSortQualifier } from '../pullRequestSearchQuery.js';
import type { GitHubTokenInfo } from '../token.js';
import { gitHubPullRequest } from './fixtures.js';

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
				const selectsMergeQueue = query.includes('mergeQueueEntry {');
				const asSelected = (node: unknown): unknown => {
					if (node == null || typeof node !== 'object') return node;

					const { stack, stackEntry, mergeQueueEntry, ...rest } = node as Record<string, unknown>;
					return {
						...rest,
						...(selectsStack ? { stack: stack, stackEntry: stackEntry } : {}),
						...(selectsMergeQueue ? { mergeQueueEntry: mergeQueueEntry } : {}),
					};
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
			getPullRequestReadOptions: () => ({ mergeQueue: true }),
		} as unknown as GitHubApiConfig;
		return { config: config, getCalls: () => calls };
	}

	function search(call: CapturedCall, alias: string): string {
		return String(call.variables[`${alias}Search`]);
	}

	function prNode(number: number, updatedAt: string): unknown {
		return gitHubPullRequest(
			number,
			{ createdAt: '2024-01-01T00:00:00Z', updatedAt: updatedAt },
			{ owner: 'octo', name: 'repo' },
		);
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

	test('caps a full page at the budget GitHub can build in time, whatever size is asked for', async () => {
		// Why 20: see `fullPullRequestSearchPageBudget`. An explicit 100 used to be sent as asked and failed every
		// time on a busy scope (#5978); a page that can't be built is no use to the caller that asked for it.
		const { config, getCalls } = capture([{}, {}, {}]);
		const api = new GitHubApi(config);

		await api.searchPullRequestsPage(provider, token, { repos: ['o/a'] });
		await api.searchPullRequestsPage(provider, token, { repos: ['o/a'], pageSize: 500 });
		await api.searchPullRequestsPage(provider, token, { repos: ['o/a'], pageSize: 7 });

		assert.match(getCalls()[0].query, /scopeOpen: search\(first: 20,/);
		assert.match(getCalls()[1].query, /scopeOpen: search\(first: 20,/);
		assert.match(getCalls()[2].query, /scopeOpen: search\(first: 7,/, 'a smaller size is still honoured');
	});

	test('splits the full page budget across the active facets of one document', async () => {
		// Kepler's visible-PR preset: three relationships in one document, which at 30 each was 90 full nodes.
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			pageSize: 30,
			criteria: {
				relationships: [
					PullRequestFilter.Author,
					PullRequestFilter.Assignee,
					PullRequestFilter.ReviewRequested,
				],
			},
		});

		assert.equal(getCalls()[0].query.match(/search\(first: 6,/g)?.length, 3);
	});

	test('gives every facet at least one row when there are more facets than the budget', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: {
				relationships: [
					PullRequestFilter.Author,
					PullRequestFilter.Assignee,
					PullRequestFilter.ReviewRequested,
					PullRequestFilter.Reviewed,
					PullRequestFilter.Mention,
				],
				states: ['open', 'closed', 'merged'],
			},
		});

		assert.equal(getCalls()[0].query.match(/search\(first: 1,/g)?.length, 15);
	});

	test('selects the lite fragment and the maximum default page size for a summary read', async () => {
		// Why the lite fragment is worth a separate projection, and why the default size follows it:
		// see the `summary` option's doc on `GitHubApi.searchPullRequestsPage`.
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			summary: true,
		});

		const query = getCalls()[0].query;
		assert.match(query, /scopeOpen: search\(first: 100,/);
		// Review/check/diff selections are what the lite shape drops.
		assert.doesNotMatch(query, /latestReviews/);
		assert.doesNotMatch(query, /reviewRequests/);
		assert.doesNotMatch(query, /statusCheckRollup/);
		// What its consumers DO read must survive.
		assert.match(query, /baseRefName/);
		assert.match(query, /headRefName/);
		assert.match(query, /body/);
		// The lite mapper reads stack, and stack absence is a NEGATIVE fact (a stacked PR would read as
		// unstacked); the summary projection is about what costs server time, not about dropping this.
		assert.match(query, /stack \{/);
		assert.match(query, /stackEntry \{/);
	});

	test('shares the summary default page budget across active facets', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			summary: true,
			criteria: {
				relationships: [
					PullRequestFilter.Author,
					PullRequestFilter.Assignee,
					PullRequestFilter.ReviewRequested,
					PullRequestFilter.Reviewed,
					PullRequestFilter.Mention,
				],
				states: ['open', 'closed', 'merged'],
			},
		});

		assert.equal(getCalls()[0].query.match(/search\(first: 6,/g)?.length, 15);
	});

	test('keeps the full fragment and its budget when summary is not requested', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });

		const query = getCalls()[0].query;
		assert.match(query, /scopeOpen: search\(first: 20,/);
		assert.match(query, /latestReviews/);
	});

	test('caps an explicit summary size at the summary budget split across the facets', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			summary: true,
			pageSize: 100,
			criteria: { states: ['open', 'merged'] },
		});

		assert.equal(getCalls()[0].query.match(/search\(first: 50,/g)?.length, 2);
	});

	test('honours an explicit page size on the summary path too', async () => {
		// Only the DEFAULT follows the projection; an explicit preference is still the caller's.
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			summary: true,
			pageSize: 10,
		});

		assert.match(getCalls()[0].query, /scopeOpen: search\(first: 10,/);
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

	// Same shape of risk as the stack selection: `mergeQueueEntry` is optional on the node type, so a facet that
	// forgets it type-checks and silently reports a queued pull request as not queued.
	test('selects the merge queue entry on every facet, not just the first', async () => {
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
			(query.match(/mergeQueueEntry \{/g) ?? []).length,
			facets.length,
			'every facet selects the merge queue entry, or queued PRs silently read as not queued on that facet',
		);
		assert.equal((query.match(/\bisMergeQueueEnabled\b/g) ?? []).length, facets.length);
		assert.equal(
			(
				query.match(
					/mergeQueueEvents: timelineItems\(last: 1, itemTypes: \[ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT\]\)/g,
				) ?? []
			).length,
			facets.length,
			'every facet selects the latest merge-queue event, and only the latest',
		);
	});

	test('maps the selected merge queue entry onto the returned pull request', async () => {
		const queued = {
			...(prNode(1, '2024-01-02T00:00:00Z') as Record<string, unknown>),
			mergeQueueEntry: {
				state: 'QUEUED',
				enqueuedAt: '2024-01-02T00:00:00Z',
				estimatedTimeToMerge: null,
				mergeQueue: { url: 'https://github.com/octo/repo/queue/main' },
				position: 2,
			},
			isMergeQueueEnabled: true,
			mergeQueueEvents: { nodes: [{ __typename: 'AddedToMergeQueueEvent' }] },
		};
		const removed = {
			...(prNode(2, '2024-01-01T00:00:00Z') as Record<string, unknown>),
			mergeQueueEntry: null,
			isMergeQueueEnabled: true,
			mergeQueueEvents: {
				nodes: [
					{
						__typename: 'RemovedFromMergeQueueEvent',
						createdAt: '2024-01-01T01:00:00Z',
						reason: 'failed_checks',
					},
				],
			},
		};
		const { config } = capture([{ authorOpen: { issueCount: 2, nodes: [queued, removed] } }]);

		const result = await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: [PullRequestFilter.Author], states: ['open'] },
		});

		assert.deepEqual(result?.values[0].mergeQueue, {
			state: PullRequestMergeQueueState.Queued,
			enqueuedAt: new Date('2024-01-02T00:00:00Z'),
			estimatedMergeAt: undefined,
			url: 'https://github.com/octo/repo/queue/main',
			position: 2,
		});
		assert.equal(result?.values[0].mergeQueueRequired, true);
		assert.equal(result?.values[0].mergeQueueRemoval, undefined, 'it rejoined since any removal');
		assert.equal(result?.values[1].mergeQueue, undefined, 'a pull request not in the queue reports no entry');
		assert.deepEqual(result?.values[1].mergeQueueRemoval, {
			reason: 'failed_checks',
			removedAt: new Date('2024-01-01T01:00:00Z'),
		});
	});

	// GitHub Enterprise Server's schema isn't verified to have `mergeQueueEntry`, and an unknown field fails the
	// WHOLE query, so it is gated exactly like the stack selection.
	test('omits the merge queue selection off github.com', async () => {
		const { config, getCalls } = capture();
		await new GitHubApi(config).searchPullRequestsPage(provider, token, {
			repos: ['o/a'],
			baseUrl: 'https://github.acme.com/api/v3',
			criteria: { relationships: [PullRequestFilter.Author], states: ['open'] },
		});

		assert.doesNotMatch(getCalls()[0].query, /mergeQueueEntry|isMergeQueueEnabled|MERGE_QUEUE_EVENT/);
	});

	/**
	 * GitHub answers a page it takes too long to build with a 502/504 HTML gateway page after ~11s (#5978). These tests
	 * serve a fake GitHub that pages each facet over a fixed list honouring `first`/`after`, and answers that gateway
	 * page whenever the document selects more nodes than it can "build in time".
	 */
	suite('gateway timeouts', () => {
		type Request = { firsts: number[]; status: number };

		/**
		 * `rows[alias]` is the facet's full result, newest first. A document whose `first`s sum past `maxNodes` gets the
		 * gateway page; so does every request `fail` names (by request index), whatever its size. `served[alias]` records
		 * every row each facet served, in order, so a test can tell a facet repeating a row from two facets sharing one.
		 */
		function serve(options: {
			rows: Record<string, number[]>;
			maxNodes?: number;
			fail?: (index: number) => boolean;
			status?: number;
			onResponded?: (index: number) => void;
		}): { config: GitHubApiConfig; requests: Request[]; served: Record<string, number[]> } {
			const requests: Request[] = [];
			const served: Record<string, number[]> = {};
			const respond = (index: number, response: Response): Response => {
				options.onResponded?.(index);
				return response;
			};
			const config = {
				isWeb: false,
				fetch: (_url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
					const index = requests.length;
					const body = JSON.parse(init?.body ?? '{}') as {
						query: string;
						variables: Record<string, unknown>;
					};
					const active = Array.from(
						body.query.matchAll(/(\w+): search\(first: (\d+),/g),
						m => [m[1], Number(m[2])] as const,
					).filter(([alias]) => body.variables[includeVar(alias)] === true);
					const nodes = active.reduce((sum, [, first]) => sum + first, 0);
					if (init?.signal?.aborted) {
						return Promise.reject(
							Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
						);
					}

					if (options.fail?.(index) === true || (options.maxNodes != null && nodes > options.maxNodes)) {
						const status = options.status ?? 504;
						requests.push({ firsts: active.map(([, first]) => first), status: status });
						return Promise.resolve(
							respond(
								index,
								new Response(`<html><body><h1>${status} Gateway Time-out</h1></body></html>`, {
									status: status,
									headers: { 'content-type': 'text/html' },
								}),
							),
						);
					}

					requests.push({ firsts: active.map(([, first]) => first), status: 200 });
					const data: Record<string, unknown> = {};
					for (const [alias, first] of active) {
						const all = options.rows[alias] ?? [];
						const after = body.variables[`${alias}Cursor`];
						const start = typeof after === 'string' ? Number(after) : 0;
						const slice = all.slice(start, start + first);
						const end = start + slice.length;
						(served[alias] ??= []).push(...slice);
						data[alias] = {
							issueCount: all.length,
							pageInfo: {
								endCursor: slice.length > 0 ? String(end) : null,
								hasNextPage: end < all.length,
							},
							nodes: slice.map(n =>
								gitHubPullRequest(
									n,
									{ updatedAt: new Date(Date.UTC(2024, 0, 1) + (1000 - n) * 60_000).toISOString() },
									{ owner: 'octo', name: 'repo' },
								),
							),
						};
					}
					return Promise.resolve(
						respond(
							index,
							new Response(JSON.stringify({ data: data }), {
								status: 200,
								headers: { 'content-type': 'application/json' },
							}),
						),
					);
				},
				wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
			} as unknown as GitHubApiConfig;
			return { config: config, requests: requests, served: served };
		}

		function includeVar(alias: string): string {
			return `include${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;
		}

		function range(from: number, to: number): number[] {
			return Array.from({ length: to - from + 1 }, (_, i) => from + i);
		}

		async function walk(
			api: GitHubApi,
			options: Parameters<GitHubApi['searchPullRequestsPage']>[2],
		): Promise<{ numbers: number[]; sizes: number[] }> {
			const numbers: number[] = [];
			const sizes: number[] = [];
			let cursor: string | undefined;
			for (let i = 0; i < 50; i++) {
				const page = await api.searchPullRequestsPage(provider, token, { ...options, cursor: cursor });
				assert.ok(page != null);
				numbers.push(...page.values.map(pr => Number(pr.id.replace(/\D/g, ''))));
				sizes.push(page.values.length);
				if (!page.hasMore) return { numbers: numbers, sizes: sizes };

				assert.ok(page.cursor != null, 'a page with more to read always carries a cursor');
				cursor = page.cursor;
			}
			assert.fail('the walk did not end');
		}

		/** Every facet served each of its rows exactly once, in its own order, and nothing else. */
		function assertEveryFacetServedOnce(served: Record<string, number[]>, rows: Record<string, number[]>): void {
			for (const [alias, all] of Object.entries(rows)) {
				assert.deepEqual(served[alias] ?? [], all, `${alias} served each of its rows once, in order`);
			}
		}

		const threeRelationships = {
			criteria: {
				relationships: [
					PullRequestFilter.Author,
					PullRequestFilter.Assignee,
					PullRequestFilter.ReviewRequested,
				],
			},
		};

		test('retries a gateway timeout once at half the size instead of identically', async () => {
			const { config, requests } = serve({ rows: { scopeOpen: range(1, 50) }, maxNodes: 10 });

			const page = await new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });

			assert.deepEqual(
				requests.map(r => [r.status, ...r.firsts]),
				[
					[504, 20],
					[200, 10],
				],
			);
			assert.equal(page?.values.length, 10);
			assert.equal(page?.hasMore, true, 'a smaller page is not the last one');
			assert.equal(page?.truncated, false, 'a smaller page is not an incomplete one');
			assert.ok(page?.cursor != null);
		});

		test('fails after two attempts when the halved page times out too', async () => {
			const { config, requests } = serve({ rows: { scopeOpen: range(1, 50) }, fail: () => true, status: 502 });

			await assert.rejects(
				new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] }),
				(ex: { status?: number }) => ex.status === 502,
			);
			assert.deepEqual(
				requests.map(r => [r.status, ...r.firsts]),
				[
					[502, 20],
					[502, 10],
				],
				'never a third, identical request',
			);
		});

		test('retries a page already at one row per facet once, unchanged, rather than not at all', async () => {
			// Twelve facets split the full budget of 20 to one row each, so there is nothing left to halve.
			const relationships = [
				PullRequestFilter.Author,
				PullRequestFilter.Assignee,
				PullRequestFilter.ReviewRequested,
				PullRequestFilter.Reviewed,
			];
			const { config, requests } = serve({ rows: {}, fail: index => index === 0 });

			const page = await new GitHubApi(config).searchPullRequestsPage(provider, token, {
				repos: ['o/a'],
				criteria: { relationships: relationships, states: ['open', 'closed', 'merged'] },
			});

			assert.deepEqual(
				requests.map(r => [r.status, r.firsts.length, Math.max(...r.firsts)]),
				[
					[504, 12, 1],
					[200, 12, 1],
				],
			);
			assert.equal(page?.hasMore, false);
		});

		test('keeps retrying a transient failure that is not a gateway timeout as before', async () => {
			const { config, requests } = serve({
				rows: { scopeOpen: range(1, 5) },
				fail: index => index < 2,
				status: 503,
			});

			const page = await new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });

			assert.deepEqual(
				requests.map(r => [r.status, ...r.firsts]),
				[
					[503, 20],
					[503, 20],
					[200, 20],
				],
			);
			assert.equal(page?.values.length, 5);
		});

		test('walks a reduced search to the end with every facet serving each row exactly once', async () => {
			// Three facets that overlap, so deduplication and per-facet continuation both matter.
			const rows = { authorOpen: range(1, 23), assigneeOpen: range(10, 30), reviewRequestedOpen: range(40, 44) };
			const { config, requests, served } = serve({ rows: rows, maxNodes: 9 });

			const { numbers, sizes } = await walk(new GitHubApi(config), threeRelationships);

			assertEveryFacetServedOnce(served, rows);
			const expected = [...new Set([...rows.authorOpen, ...rows.assigneeOpen, ...rows.reviewRequestedOpen])];
			assert.deepEqual(
				[...new Set(numbers)].sort((a, b) => a - b),
				expected.sort((a, b) => a - b),
				'no pull request is skipped',
			);
			assert.equal(requests.filter(r => r.status !== 200).length, 1, 'only the first page timed out');
			assert.deepEqual(requests[0].firsts, [6, 6, 6]);
			assert.deepEqual(requests[1].firsts, [3, 3, 3], 'the retry halves every facet');
			assert.ok(
				requests.slice(2).every(r => r.firsts.reduce((a, b) => a + b, 0) <= 9),
				'later pages keep the reduced budget instead of timing out again first',
			);
			assert.ok(sizes.every(size => size > 0));
		});

		test('halves again on a later page after facets ran out, and keeps every row exactly once', async () => {
			// The first timeout reduces the walk to 9 (3 per facet), which drains the review-requested facet on the first
			// page; the two facets left then split those 9 (4 each), and a second timeout on a later page halves them to 2.
			const rows = {
				authorOpen: range(1, 23),
				assigneeOpen: range(100, 120),
				reviewRequestedOpen: range(200, 202),
			};
			const { config, requests, served } = serve({
				rows: rows,
				fail: index => index === 0 || index === 3,
			});

			const { numbers } = await walk(new GitHubApi(config), threeRelationships);

			assertEveryFacetServedOnce(served, rows);
			assert.equal(new Set(numbers).size, numbers.length, 'disjoint facets never repeat a row');
			assert.deepEqual(
				requests.slice(0, 5).map(r => [r.status, ...r.firsts]),
				[
					[504, 6, 6, 6],
					[200, 3, 3, 3],
					[200, 4, 4],
					[504, 4, 4],
					[200, 2, 2],
				],
			);
			assert.ok(
				requests.slice(5).every(r => r.firsts.reduce((a, b) => a + b, 0) <= 4),
				'the walk keeps the second reduction',
			);
		});

		test('re-splits a reduced budget over the facets that are left, never past it', async () => {
			// Once two facets run out, the one left gets the whole reduced budget rather than its old share.
			const rows = {
				authorOpen: range(1, 30),
				assigneeOpen: range(100, 101),
				reviewRequestedOpen: range(200, 201),
			};
			const { config, requests, served } = serve({ rows: rows, maxNodes: 9 });

			const { numbers } = await walk(new GitHubApi(config), threeRelationships);

			assertEveryFacetServedOnce(served, rows);
			assert.equal(numbers.length, 34, 'disjoint facets never repeat a row');
			assert.ok(requests.every(r => r.status === 200 || r === requests[0]));
			assert.ok(requests.every(r => r.firsts.reduce((a, b) => a + b, 0) <= 18));
			assert.deepEqual(requests.at(-1)?.firsts, [9], 'the last facet gets the whole reduced budget');
		});

		test('serves an empty search and a last page without asking for more', async () => {
			const empty = serve({ rows: { scopeOpen: [] } });
			const none = await new GitHubApi(empty.config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });
			assert.deepEqual(none?.values, []);
			assert.equal(none?.hasMore, false);
			assert.equal(none?.cursor, undefined);

			const exact = serve({ rows: { scopeOpen: range(1, 20) } });
			const only = await new GitHubApi(exact.config).searchPullRequestsPage(provider, token, { repos: ['o/a'] });
			assert.equal(only?.values.length, 20);
			assert.equal(only?.hasMore, false);
			assert.equal(exact.requests.length, 1);
		});

		test('keeps the summary shape at a hundred rows a page', async () => {
			const { config, requests } = serve({ rows: { scopeOpen: range(1, 250) } });

			const { sizes } = await walk(new GitHubApi(config), { repos: ['o/a'], summary: true, pageSize: 100 });

			assert.deepEqual(sizes, [100, 100, 50]);
			assert.ok(requests.every(r => r.firsts[0] === 100));
		});

		test('ignores a reduced budget a cursor carries that is not a positive number', async () => {
			const { config, requests } = serve({ rows: { scopeOpen: range(1, 50) } });
			const api = new GitHubApi(config);
			const first = await api.searchPullRequestsPage(provider, token, { repos: ['o/a'] });
			assert.ok(first?.cursor != null);

			const tampered = JSON.stringify({ ...(JSON.parse(first.cursor) as object), budget: -4 });
			await api.searchPullRequestsPage(provider, token, { repos: ['o/a'], cursor: tampered });

			assert.deepEqual(requests[1].firsts, [20]);
		});

		test('a server error that lands after cancellation spends no strike and shows no notice', async () => {
			// A 503 would otherwise be reported against the connection; cancelled, nobody is waiting for the read.
			const controller = new AbortController();
			let strikes = 0;
			let notices = 0;
			const counting = { ...provider, trackRequestException: () => void strikes++ } as unknown as Provider;
			const { config } = serve({
				rows: { scopeOpen: range(1, 5) },
				fail: () => true,
				status: 503,
				onResponded: () => controller.abort(),
			});
			const notifying: GitHubApiConfig = { ...config, onRequestError: () => void notices++ };

			await assert.rejects(
				new GitHubApi(notifying).searchPullRequestsPage(counting, token, { repos: ['o/a'] }, controller.signal),
				(ex: Error) => isCancellationError(ex),
			);
			assert.equal(strikes, 0);
			assert.equal(notices, 0);
		});

		test('cancellation as a gateway failure is answered sends no smaller retry', async () => {
			const controller = new AbortController();
			const { config, requests } = serve({
				rows: { scopeOpen: range(1, 50) },
				fail: index => index === 0,
				onResponded: index => {
					if (index === 0) {
						controller.abort();
					}
				},
			});

			await assert.rejects(
				new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] }, controller.signal),
				(ex: Error) => isCancellationError(ex),
			);
			assert.equal(requests.length, 1);
		});

		test('cancellation during the backoff of another transient failure sends nothing more', async () => {
			// Aborted as the 503 is answered, so the abort lands while the retry waits out its backoff (at least 150ms)
			// whatever the event loop does in between.
			const controller = new AbortController();
			const { config, requests } = serve({
				rows: { scopeOpen: range(1, 50) },
				fail: index => index === 0,
				status: 503,
				onResponded: index => {
					if (index === 0) {
						setTimeout(() => controller.abort(), 20);
					}
				},
			});

			await assert.rejects(
				new GitHubApi(config).searchPullRequestsPage(provider, token, { repos: ['o/a'] }, controller.signal),
				(ex: Error) => isCancellationError(ex),
			);
			assert.equal(requests.length, 1);
		});

		test('reports only the gateway failure it gives up on, not one it recovered from', async () => {
			// GitHub's 502 for a timeout is reported against the connection and notified (see `handleRequestError`);
			// the one the smaller retry recovers from must not be.
			let strikes = 0;
			let notices = 0;
			const counting = { ...provider, trackRequestException: () => void strikes++ } as unknown as Provider;
			const timedOut = (fail: (index: number) => boolean): { api: GitHubApi; requests: Request[] } => {
				const { config, requests } = serve({ rows: { scopeOpen: range(1, 50) }, fail: fail, status: 502 });
				const fetch = config.fetch;
				const api = new GitHubApi({
					...config,
					// The HTML gateway page, as a message that names the timeout.
					fetch: async (url, init) => {
						const rsp = await fetch(url, init);
						return rsp.status === 502 ? new Response('upstream request timeout', { status: 502 }) : rsp;
					},
					onRequestError: () => void notices++,
				});
				return { api: api, requests: requests };
			};
			const reportsDuring = async (read: () => Promise<unknown>): Promise<[number, number]> => {
				const [strikesBefore, noticesBefore] = [strikes, notices];
				await read();
				return [strikes - strikesBefore, notices - noticesBefore];
			};

			const recovered = timedOut(index => index === 0);
			assert.deepEqual(
				await reportsDuring(() => recovered.api.searchPullRequestsPage(counting, token, { repos: ['o/a'] })),
				[0, 0],
				'a recovered page reports nothing',
			);

			const failed = timedOut(() => true);
			assert.deepEqual(
				await reportsDuring(() =>
					assert.rejects(failed.api.searchPullRequestsPage(counting, token, { repos: ['o/a'] })),
				),
				[1, 1],
				'a page given up on reports once',
			);

			// Identical concurrent searches share both requests, so they share the one failure they give up on too.
			const shared = timedOut(() => true);
			let results: PromiseSettledResult<unknown>[] = [];
			assert.deepEqual(
				await reportsDuring(async () => {
					results = await Promise.allSettled([
						shared.api.searchPullRequestsPage(counting, token, { repos: ['o/a'] }),
						shared.api.searchPullRequestsPage(counting, token, { repos: ['o/a'] }),
					]);
				}),
				[1, 1],
				'a failure two searches share is reported once',
			);
			assert.deepEqual(
				results.map(r => r.status),
				['rejected', 'rejected'],
			);
			assert.equal(shared.requests.length, 2, 'both searches shared the page and its smaller retry');
		});

		test('shares one request between identical concurrent searches', async () => {
			const { config, requests } = serve({ rows: { scopeOpen: range(1, 50) } });
			const api = new GitHubApi(config);

			const [a, b] = await Promise.all([
				api.searchPullRequestsPage(provider, token, { repos: ['o/a'] }),
				api.searchPullRequestsPage(provider, token, { repos: ['o/a'] }),
			]);

			assert.equal(requests.length, 1);
			assert.deepEqual(a?.cursor, b?.cursor);
		});
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
