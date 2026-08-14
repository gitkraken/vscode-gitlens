import assert from 'node:assert';
import { suite, test } from 'mocha';
import { PullRequestFilter } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
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
				calls.push({ query: body.query ?? '', variables: variables });
				const response = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {};
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
						nodes: category.nodes ?? [],
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
});
