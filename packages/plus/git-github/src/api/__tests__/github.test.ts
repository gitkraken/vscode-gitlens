import assert from 'node:assert';
import { suite, test } from 'mocha';
import { AuthenticationError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { PullRequestState } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { filterPullRequestsBySearchState, GitHubApi, toGitHubSearchStateQualifier } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

suite('toGitHubSearchStateQualifier', () => {
	const cases: [label: string, include: PullRequestState[] | undefined, expected: string][] = [
		['undefined -> open-only default', undefined, 'is:open'],
		['empty -> open-only default', [], 'is:open'],
		['opened', ['opened'], 'is:open'],
		['merged', ['merged'], 'is:merged'],
		['closed (not merged)', ['closed'], 'is:closed is:unmerged'],
		['closed + merged', ['closed', 'merged'], 'is:closed'],
		['opened + closed', ['opened', 'closed'], 'is:unmerged'],
		['opened + merged (not expressible, no qualifier)', ['opened', 'merged'], ''],
		['all states -> no qualifier', ['opened', 'closed', 'merged'], ''],
	];

	for (const [label, include, expected] of cases) {
		test(label, () => {
			assert.strictEqual(toGitHubSearchStateQualifier(include), expected);
		});
	}

	test('is order-independent', () => {
		assert.strictEqual(toGitHubSearchStateQualifier(['merged', 'closed']), 'is:closed');
		assert.strictEqual(toGitHubSearchStateQualifier(['closed', 'opened']), 'is:unmerged');
	});
});

suite('filterPullRequestsBySearchState', () => {
	const prs: { id: string; state: PullRequestState }[] = [
		{ id: '1', state: 'opened' },
		{ id: '2', state: 'closed' },
		{ id: '3', state: 'merged' },
	];

	const ids = (include: PullRequestState[] | undefined) =>
		filterPullRequestsBySearchState(prs, include).map(pr => pr.id);

	test('defaults to open-only', () => {
		assert.deepStrictEqual(ids(undefined), ['1']);
		assert.deepStrictEqual(ids([]), ['1']);
	});

	test('filters non-exact GitHub search combinations', () => {
		assert.deepStrictEqual(ids(['opened', 'merged']), ['1', '3']);
		assert.deepStrictEqual(ids(['opened', 'closed', 'merged']), ['1', '2', '3']);
	});

	test('ignores duplicate states when deciding to skip filtering', () => {
		assert.deepStrictEqual(ids(['opened', 'opened', 'closed']), ['1', '2']);
	});
});

suite('GitHubApi.searchPullRequests', () => {
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

	function prNode(number: number, state: 'OPEN' | 'CLOSED' | 'MERGED') {
		return {
			id: `pr-${number}`,
			number: number,
			title: `PR ${number}`,
			body: `Body ${number}`,
			permalink: `https://github.com/octo/repo/pull/${number}`,
			url: `https://github.com/octo/repo/pull/${number}`,
			state: state,
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-02T00:00:00Z',
			closed: state !== 'OPEN',
			closedAt: state === 'OPEN' ? null : '2024-01-03T00:00:00Z',
			mergedAt: state === 'MERGED' ? '2024-01-03T00:00:00Z' : null,
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

	function createConfig(
		pages: { requestCursor?: string; nextCursor?: string; hasNextPage: boolean; nodes: unknown[] }[],
		seenCursors: string[],
	) {
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url, init) => {
				const body = JSON.parse(String(init?.body ?? '{}')) as { variables?: { cursor?: string } };
				const cursor = body.variables?.cursor;
				seenCursors.push(cursor ?? '');
				const page = pages.find(p => p.requestCursor === cursor) ?? pages[0];
				return new Response(
					JSON.stringify({
						data: {
							search: {
								pageInfo: {
									endCursor: page.hasNextPage ? (page.nextCursor ?? null) : null,
									hasNextPage: page.hasNextPage,
								},
								nodes: page.nodes,
							},
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => fn(),
		};
		return config;
	}

	test('paginates when include requests opened + merged', async () => {
		const seenCursors: string[] = [];
		const api = new GitHubApi(
			createConfig(
				[
					{
						requestCursor: undefined,
						nextCursor: 'page-2',
						hasNextPage: true,
						nodes: Array.from({ length: 10 }, (_, i) => prNode(i + 1, 'CLOSED')),
					},
					{
						requestCursor: 'page-2',
						hasNextPage: false,
						nodes: [prNode(11, 'OPEN'), prNode(12, 'MERGED')],
					},
				],
				seenCursors,
			),
		);

		const results = await api.searchPullRequests(provider, token, { search: 'fix', include: ['opened', 'merged'] });

		assert.deepStrictEqual(
			results.map(pr => pr.id),
			['11', '12'],
		);
		assert.deepStrictEqual(seenCursors, ['', 'page-2']);
	});

	test('stops at the page backstop when matches never fill the page', async () => {
		const seenCursors: string[] = [];
		// Every page is full of non-matching PRs and always reports another page, so results never reach the
		// page-size cap and `hasNextPage` never goes false. The only thing that can end the drain is the 20-page
		// backstop. More pages exist than the cap to prove it truncates rather than running away.
		const pages = Array.from({ length: 25 }, (_, i) => ({
			requestCursor: i === 0 ? undefined : `cursor-${i}`,
			nextCursor: `cursor-${i + 1}`,
			hasNextPage: true,
			nodes: Array.from({ length: 10 }, (_, j) => prNode(i * 100 + j + 1, 'CLOSED')),
		}));

		const api = new GitHubApi(createConfig(pages, seenCursors));

		const results = await api.searchPullRequests(provider, token, { search: 'fix', include: ['opened', 'merged'] });

		assert.deepStrictEqual(results, []);
		assert.strictEqual(seenCursors.length, 20);
	});
});

suite('GitHubApi.searchMyPullRequestsPage summaries', () => {
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

	test('keeps list fields and branch refs while omitting expensive enrichment fields', async () => {
		let query = '';
		const node = {
			id: 'node-1',
			number: 1,
			title: 'Closed PR',
			body: 'Summary body',
			permalink: 'https://github.com/octo/repo/pull/1',
			url: 'https://github.com/octo/repo/pull/1',
			state: 'CLOSED',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-02T00:00:00Z',
			closed: true,
			closedAt: '2024-01-03T00:00:00Z',
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
		};
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url, init) => {
				query = (JSON.parse(String(init?.body ?? '{}')) as { query?: string }).query ?? '';
				return new Response(
					JSON.stringify({
						data: {
							search: {
								issueCount: 1,
								pageInfo: { endCursor: null, hasNextPage: false },
								nodes: [node],
							},
						},
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => fn(),
		};
		const api = new GitHubApi(config);

		const result = await api.searchMyPullRequestsPage(provider, token, {
			state: 'closed',
			summary: true,
		});

		assert.match(query, /\bbody\b/);
		assert.match(query, /\bheadRefName\b/);
		assert.doesNotMatch(query, /\blatestReviews\b/);
		assert.doesNotMatch(query, /\bstatusCheckRollup\b/);
		assert.equal(result.values[0].body, 'Summary body');
		assert.equal(result.values[0].refs?.head.branch, 'feature');
	});
});

suite('GitHubApi direct pull request lookups', () => {
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

	function prNode(number: number) {
		return {
			id: `pr-${number}`,
			number: number,
			title: `PR ${number}`,
			body: `Body ${number}`,
			permalink: `https://github.com/octo/repo/pull/${number}`,
			url: `https://github.com/octo/repo/pull/${number}`,
			state: 'OPEN',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-02T00:00:00Z',
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

	function captureQuery(data: unknown): { config: GitHubApiConfig; getQuery: () => string } {
		let query = '';
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url, init) => {
				const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string };
				query = body.query ?? '';
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => fn(),
		};
		return { config: config, getQuery: () => query };
	}

	test('getPullRequest requests and maps the body', async () => {
		const { config, getQuery } = captureQuery({ repository: { pullRequest: prNode(1) } });
		const api = new GitHubApi(config);

		const pr = await api.getPullRequest(provider, token, 'octo', 'repo', 1);

		assert.match(getQuery(), /\bbody\b/);
		assert.strictEqual(pr?.body, 'Body 1');
	});

	test('getPullRequestForBranch requests and maps the body', async () => {
		const { config, getQuery } = captureQuery({
			repository: { ref: { associatedPullRequests: { nodes: [prNode(2)] } } },
		});
		const api = new GitHubApi(config);

		const pr = await api.getPullRequestForBranch(provider, token, 'octo', 'repo', 'feature');

		assert.match(getQuery(), /\bbody\b/);
		assert.strictEqual(pr?.body, 'Body 2');
	});

	test('getPullRequestForCommit requests and maps the body', async () => {
		const { config, getQuery } = captureQuery({
			repository: { object: { associatedPullRequests: { nodes: [prNode(3)] } } },
		});
		const api = new GitHubApi(config);

		const pr = await api.getPullRequestForCommit(provider, token, 'octo', 'repo', 'deadbeef');

		assert.match(getQuery(), /\bbody\b/);
		assert.strictEqual(pr?.body, 'Body 3');
	});
});

suite('GitHubApi.searchMyIssues', () => {
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

	// Captures the GraphQL variables of the single searchMyIssues request and returns empty result sets so the
	// method resolves; each category exposes `issueCount: 0` so the read is never reported truncated.
	function captureVariables(): { config: GitHubApiConfig; getVariables: () => Record<string, unknown> } {
		let variables: Record<string, unknown> = {};
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: Record<string, unknown> };
				variables = body.variables ?? {};
				const empty = {
					issueCount: 0,
					pageInfo: { endCursor: null, hasNextPage: false },
					nodes: [],
				};
				return new Response(JSON.stringify({ data: { authored: empty, assigned: empty, mentioned: empty } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return { config: config, getVariables: () => variables };
	}

	test('binds the assigned category to the current user by default', async () => {
		const { config, getVariables } = captureVariables();
		const api = new GitHubApi(config);

		await api.searchMyIssues(provider, token, {});

		const vars = getVariables();
		assert.match(String(vars.assigned), /assignee:@me/);
		assert.match(String(vars.authored), /author:@me/);
		assert.match(String(vars.mentioned), /mentions:@me/);
	});

	test('broadens the assigned category to any assignee when includeAllAssignees is set, keeping authored/mentioned user-relative', async () => {
		const { config, getVariables } = captureVariables();
		const api = new GitHubApi(config);

		await api.searchMyIssues(provider, token, { includeAllAssignees: true });

		const vars = getVariables();
		assert.match(String(vars.assigned), /assignee:\*/, 'assigned broadens to has-any-assignee');
		assert.doesNotMatch(
			String(vars.assigned),
			/assignee:@me/,
			'the @me binding is dropped from the assigned category',
		);
		assert.match(String(vars.authored), /author:@me/, 'authored stays user-relative');
		assert.match(String(vars.mentioned), /mentions:@me/, 'mentioned stays user-relative');
	});

	test('pages each issue category independently with an opaque composite cursor', async () => {
		const variables: Record<string, unknown>[] = [];
		let request = 0;
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: Record<string, unknown> };
				variables.push(body.variables ?? {});
				const terminal = {
					issueCount: 0,
					pageInfo: { endCursor: null, hasNextPage: false },
					nodes: [],
				};
				const data =
					request++ === 0
						? {
								authored: terminal,
								assigned: {
									issueCount: 101,
									pageInfo: { endCursor: 'assigned-next', hasNextPage: true },
									nodes: [],
								},
								mentioned: terminal,
							}
						: {
								assigned: {
									issueCount: 101,
									pageInfo: { endCursor: null, hasNextPage: false },
									nodes: [],
								},
							};
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		const api = new GitHubApi(config);

		const first = await api.searchMyIssues(provider, token, {});
		assert.equal(first?.hasMore, true);
		assert.equal(first?.page, 1);
		assert.ok(first?.cursor);

		const second = await api.searchMyIssues(provider, token, { cursor: first?.cursor });
		assert.equal(second?.hasMore, false);
		assert.equal(second?.page, 2);
		assert.equal(variables[1].assignedCursor, 'assigned-next');
		assert.equal(variables[1].includeAssigned, true);
		assert.equal(variables[1].includeAuthored, false);
		assert.equal(variables[1].includeMentioned, false);
	});
});

// GitHub documents "a `403` or `429` response" for BOTH its primary and secondary rate limits
// (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). Only 403 was handled: `case 429`
// was commented out, so a throttled request fell through to the generic 4xx branch and surfaced as a
// `RequestClientError`. Downstream that reads as a generic failure rather than a retryable throttle — it drops
// the "temporary" framing and, in consumers that hold a snapshot on retryable failures, discards a good one.
suite('GitHubApi rate limit classification', () => {
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

	function failingConfig(status: number, body: unknown, headers?: Record<string, string>): GitHubApiConfig {
		return {
			isWeb: false,
			fetch: async () =>
				new Response(JSON.stringify(body), {
					status: status,
					headers: { 'content-type': 'application/json', ...headers },
				}),
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
	}

	async function captureError(config: GitHubApiConfig): Promise<unknown> {
		const api = new GitHubApi(config);
		try {
			await api.getPullRequest(provider, token, 'octo', 'repo', 1);
			return undefined;
		} catch (ex) {
			return ex;
		}
	}

	test('maps a 429 to a rate limit rather than a generic client error', async () => {
		const ex = await captureError(
			failingConfig(429, { message: 'You have exceeded a secondary rate limit' }, { 'retry-after': '60' }),
		);

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('maps a 429 even when the body says nothing about a rate limit', async () => {
		// 429 is unambiguous — unlike 403 it is never a permission failure — so it must not depend on the wording.
		const ex = await captureError(failingConfig(429, { message: 'Too Many Requests' }));

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('prefers retry-after over x-ratelimit-reset for the reset time', async () => {
		const before = Math.floor(Date.now() / 1000);
		const ex = await captureError(
			failingConfig(
				429,
				{ message: 'rate limit' },
				// A stale reset epoch alongside a fresh retry-after: GitHub's guidance is that retry-after wins.
				{ 'retry-after': '60', 'x-ratelimit-reset': '1' },
			),
		);

		assert.ok(ex instanceof RequestRateLimitError);
		assert.ok(
			ex.resetAt != null && ex.resetAt >= before + 60 && ex.resetAt <= before + 61 + 2,
			`resetAt was ${String(ex.resetAt)}, expected ~${before + 60}`,
		);
	});

	test('falls back to x-ratelimit-reset when retry-after is absent', async () => {
		const ex = await captureError(
			failingConfig(429, { message: 'rate limit' }, { 'x-ratelimit-reset': '1893456000' }),
		);

		assert.ok(ex instanceof RequestRateLimitError);
		assert.equal(ex.resetAt, 1893456000);
	});

	test('leaves resetAt undefined for an unusable header rather than an elapsed epoch', async () => {
		// A NaN or negative parse used to become a reset time in the past, which reads as "retry immediately".
		const cases: Record<string, string>[] = [{ 'x-ratelimit-reset': 'soon' }, { 'x-ratelimit-reset': '-5' }, {}];
		for (const headers of cases) {
			const ex = await captureError(failingConfig(429, { message: 'rate limit' }, headers));

			assert.ok(ex instanceof RequestRateLimitError);
			assert.equal(ex.resetAt, undefined, `headers ${JSON.stringify(headers)}`);
		}
	});

	test('still classifies the 403 form of a rate limit', async () => {
		const ex = await captureError(
			failingConfig(
				403,
				{ message: 'API rate limit exceeded for user ID 1' },
				{ 'x-ratelimit-reset': '1893456000' },
			),
		);

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
		assert.equal(ex.resetAt, 1893456000);
	});

	test('still treats a plain 403 as an authentication failure', async () => {
		// The 429 case must not widen what counts as a throttle: a permission failure still has to reach the
		// reconnect path.
		const ex = await captureError(failingConfig(403, { message: 'Resource not accessible by integration' }));

		assert.ok(ex instanceof AuthenticationError, `expected AuthenticationError, got ${String(ex)}`);
	});
});
