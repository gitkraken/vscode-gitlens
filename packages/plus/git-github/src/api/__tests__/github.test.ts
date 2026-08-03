import assert from 'node:assert';
import { suite, test } from 'mocha';
import { AuthenticationError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IssueSearchCriteria, IssueSearchRelationship } from '@gitlens/git/models/issue.js';
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

	test('preserves matches from earlier pages when a continuation response is unavailable', async () => {
		let request = 0;
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async () => {
				request++;
				return new Response(
					request === 1
						? JSON.stringify({
								data: {
									search: {
										pageInfo: { endCursor: 'page-2', hasNextPage: true },
										nodes: [prNode(1, 'MERGED')],
									},
								},
							})
						: JSON.stringify({ data: null }),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				);
			},
			wrapForForcedInsecureSSL: (_ignore, fn) => fn(),
		};

		const api = new GitHubApi(config);
		const results = await api.searchPullRequests(provider, token, { include: ['opened', 'merged'] });

		assert.deepStrictEqual(
			results.map(pr => pr.id),
			['1'],
		);
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

	function prNode(number: number, body: string | null = `Body ${number}`) {
		return {
			id: `pr-${number}`,
			number: number,
			title: `PR ${number}`,
			body: body,
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

	test('getPullRequest normalizes a null body to undefined', async () => {
		const { config } = captureQuery({ repository: { pullRequest: prNode(4, null) } });
		const api = new GitHubApi(config);

		const pr = await api.getPullRequest(provider, token, 'octo', 'repo', 4);

		assert.strictEqual(pr?.body, undefined);
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

	// `assignee:*` needs a SCOPE to be meaningful, but any scope will do — the source used to claim GitHub honors
	// it only for a single repository, and that claim was the standing argument for refusing a multi-repo
	// "assigned to anyone" read. Measured against the live API, a two-repo `assignee:*` returns exactly the sum of
	// the two per-repo counts, so what the request must carry is every `repo:` qualifier alongside the qualifier.
	test('keeps every repo qualifier alongside assignee:* for a multi-repo scope', async () => {
		const { config, getVariables } = captureVariables();
		const api = new GitHubApi(config);

		await api.searchMyIssues(provider, token, {
			repos: ['gitkraken/kepler', 'gitkraken/vscode-gitlens'],
			includeAllAssignees: true,
		});

		const assigned = String(getVariables().assigned);
		assert.match(assigned, /assignee:\*/, 'the assigned category broadens to has-any-assignee');
		assert.match(assigned, /repo:gitkraken\/kepler/, 'the first repo scopes the search');
		assert.match(assigned, /repo:gitkraken\/vscode-gitlens/, 'the second repo scopes it too');
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

/**
 * The filtered issue search's whole contract lives in the query string it emits: a criterion that doesn't become a
 * qualifier is silently ignored (the read returns a WIDER set than asked for, with no error), and a user-supplied
 * value that escapes its qualifier re-scopes the search. Neither failure is visible in the result shape, so these
 * assert the emitted `search` variables rather than what comes back.
 */
suite('GitHubApi.searchIssuesPage', () => {
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

	/** Captures the GraphQL variables and document, answering every alias with an empty, non-truncated result. */
	function capture(count = 0): {
		config: GitHubApiConfig;
		getVariables: () => Record<string, unknown>;
		getQuery: () => string;
	} {
		let variables: Record<string, unknown> = {};
		let query = '';
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as {
					query?: string;
					variables?: Record<string, unknown>;
				};
				variables = body.variables ?? {};
				query = body.query ?? '';
				// Answer every alias the document declared, so the aliases under test are the ones that ran.
				const aliases = Array.from(query.matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
				const data = Object.fromEntries(
					aliases.map(alias => [
						alias,
						{ issueCount: count, pageInfo: { endCursor: null, hasNextPage: false }, nodes: [] },
					]),
				);
				return new Response(JSON.stringify({ data: data }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
		} as unknown as GitHubApiConfig;
		return { config: config, getVariables: () => variables, getQuery: () => query };
	}

	test('scopes by repos and org together, and always sorts by most recently updated', async () => {
		const { config, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a', 'o/b'], org: 'acme' });

		const q = String(getVariables().matched);
		assert.match(q, /org:acme/);
		assert.match(q, /repo:o\/a/);
		assert.match(q, /repo:o\/b/, 'repos and org combine rather than one replacing the other');
		assert.match(q, /sort:updated/, 'ordering is part of the contract, not an option');
		assert.match(q, /type:issue/);
	});

	test('with no relationship, runs a single search over the scope alone', async () => {
		const { config, getQuery } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		const aliases = Array.from(getQuery().matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
		assert.deepEqual(aliases, ['matched'], 'one unaliased-by-relationship search, not three @me ones');
		assert.doesNotMatch(getQuery(), /@me/, 'nothing binds the search to the current user');
	});

	const relationships: [relationship: IssueSearchRelationship, qualifier: RegExp][] = [
		['authored', /author:@me/],
		['assigned', /assignee:@me/],
		['mentioned', /mentions:@me/],
		['any-assignee', /assignee:\*/],
		['unassigned', /no:assignee/],
	];
	for (const [relationship, qualifier] of relationships) {
		test(`maps the ${relationship} relationship to its qualifier`, async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { relationships: [relationship] },
			});

			const emitted = Object.entries(getVariables()).filter(([key]) => !key.endsWith('Cursor'));
			const queries = emitted.filter(([, v]) => typeof v === 'string').map(([, v]) => String(v));
			assert.equal(queries.length, 1, 'exactly one search runs');
			assert.match(queries[0], qualifier);
		});
	}

	test('runs one search per relationship so the set is OR-ed, not intersected', async () => {
		const { config, getQuery, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { relationships: ['authored', 'any-assignee'] },
		});

		const aliases = Array.from(getQuery().matchAll(/^\s*(\w+): search\(/gm), m => m[1]);
		assert.deepEqual(aliases, ['authored', 'anyAssignee'], 'each relationship gets its own aliased search');
		// A single query would AND the two qualifiers, returning the intersection instead of the union.
		assert.match(String(getVariables().authored), /author:@me/);
		assert.doesNotMatch(String(getVariables().authored), /assignee:\*/);
		assert.match(String(getVariables().anyAssignee), /assignee:\*/);
		assert.doesNotMatch(String(getVariables().anyAssignee), /author:@me/);
	});

	const criteriaCases: [label: string, criteria: IssueSearchCriteria, expected: RegExp][] = [
		['state closed', { state: 'closed' }, /is:closed/],
		['labels are quoted', { labels: ['needs triage'] }, /label:"needs triage"/],
		['milestone is quoted', { milestone: 'v1 0' }, /milestone:"v1 0"/],
		['updatedAfter', { updatedAfter: '2026-05-05' }, /updated:>=2026-05-05/],
		['createdAfter', { createdAfter: '2026-01-01' }, /created:>=2026-01-01/],
		['withoutLinkedPullRequest', { withoutLinkedPullRequest: true }, /-linked:pr/],
		['free text', { text: 'crash on startup' }, /crash on startup/],
	];
	for (const [label, criteria, expected] of criteriaCases) {
		test(`emits a qualifier for ${label}`, async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: criteria });

			assert.match(String(getVariables().matched), expected);
		});
	}

	test('defaults to open, non-archived issues and drops both constraints when asked', async () => {
		const { config, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });
		assert.match(String(getVariables().matched), /is:open/);
		assert.match(String(getVariables().matched), /archived:false/);

		await api.searchIssuesPage(provider, token, {
			repos: ['o/a'],
			criteria: { state: 'all', includeArchived: true },
		});
		const all = String(getVariables().matched);
		assert.doesNotMatch(all, /is:open|is:closed/, '`all` constrains no state');
		assert.doesNotMatch(all, /archived:false/);
	});

	test('emits every label as its own AND-ed qualifier', async () => {
		const { config, getVariables } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: { labels: ['bug', 'ui'] } });

		const q = String(getVariables().matched);
		assert.match(q, /label:"bug"/);
		assert.match(q, /label:"ui"/);
	});

	// GitHub search has no escape syntax, so the only safe transformation is removal. What must never survive is a
	// value that closes its own quote or reads as a qualifier: `foo" org:someone-else` would otherwise re-scope the
	// search to another organization entirely.
	suite('injection', () => {
		// The injected text still APPEARS in the query — but only ever inside its own quoted value, where GitHub
		// reads it as part of the label/milestone name rather than as a qualifier. So these assert the exact query,
		// not the absence of a substring: what matters is that the value stays quoted, and that no second
		// unquoted qualifier was created.
		test('a quote in a label cannot close its own qualifier', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { labels: ['bug" org:evil'] },
			});

			assert.equal(
				String(getVariables().matched),
				'repo:o/a type:issue is:open archived:false label:"bug org:evil" sort:updated',
				'the injected qualifier stays inside the quoted label value; no `org:` scope is added',
			);
		});

		test('a quote in a milestone cannot close its own qualifier', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { milestone: 'v1" repo:evil/x' },
			});

			assert.equal(
				String(getVariables().matched),
				'repo:o/a type:issue is:open archived:false milestone:"v1 repo:evil/x" sort:updated',
				'the injected `repo:` stays inside the quoted milestone value; the scope is still just o/a',
			);
		});

		test('a qualifier-shaped token in free text is dropped whole', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { text: 'crash org:evil is:closed' },
			});

			const q = String(getVariables().matched);
			assert.match(q, /crash/, 'the bare words survive — they are the point of free text');
			assert.doesNotMatch(q, /org:evil/);
			// `is:open` is still there from the state default; what must not appear is the injected `is:closed`.
			assert.doesNotMatch(q, /is:closed/);
		});

		test('control characters are stripped from values', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { text: 'crash\nrepo:evil/x', milestone: 'v1 ' },
			});

			const q = String(getVariables().matched);
			assert.doesNotMatch(q, /\n/);
			assert.doesNotMatch(q, /repo:evil\/x/);
			assert.match(q, /milestone:"v1"/);
		});

		test('a value emptied by sanitizing is dropped, not emitted as an empty qualifier', async () => {
			const { config, getVariables } = capture();
			const api = new GitHubApi(config);

			await api.searchIssuesPage(provider, token, {
				repos: ['o/a'],
				criteria: { labels: ['"'], milestone: '"', text: '"' },
			});

			const q = String(getVariables().matched);
			assert.doesNotMatch(q, /label:""|milestone:""/, 'GitHub would reject an empty qualifier');
		});
	});

	test('reports the total match count so a capped read can say how many were withheld', async () => {
		const { config } = capture(19240);
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		assert.equal(result?.totalCount, 19240);
		assert.equal(result?.truncated, true, 'past the 1,000-result ceiling the read cannot return everything');
	});

	test('a count within the ceiling is not reported as truncated', async () => {
		const { config } = capture(999);
		const api = new GitHubApi(config);

		const result = await api.searchIssuesPage(provider, token, { repos: ['o/a'] });

		assert.equal(result?.totalCount, 999);
		assert.equal(result?.truncated, false);
	});

	/**
	 * The capability table (`ProviderMetadata.supportedIssueSearch`) is a PROMISE that every criterion it lists
	 * reaches the provider query. Nothing else enforces that: a criterion silently dropped by the builder would
	 * still be declared supported, the read would return a wider set than asked for, and neither the result shape
	 * nor a type error would say so.
	 *
	 * So this drives every declared criterion through the builder and asserts the query CHANGED. It deliberately
	 * doesn't assert which qualifier appeared — the per-criterion tests above pin the exact syntax; this one's job
	 * is to fail when the table and the implementation drift apart.
	 */
	test('every criterion GitHub declares supported reaches the query', async () => {
		// One sample value per criterion, keyed by its capability flag. Kept here rather than imported so a
		// criterion added to the model without a value here is visible as a missing case.
		const samples: [keyof IssueSearchCriteria, IssueSearchCriteria][] = [
			['text', { text: 'crash' }],
			['labels', { labels: ['bug'] }],
			['milestone', { milestone: 'v1' }],
			['updatedAfter', { updatedAfter: '2026-05-05' }],
			['createdAfter', { createdAfter: '2026-01-01' }],
			['withoutLinkedPullRequest', { withoutLinkedPullRequest: true }],
			['state', { state: 'closed' }],
			['includeArchived', { includeArchived: true }],
			['relationships', { relationships: ['any-assignee'] }],
		];

		const { config, getVariables, getQuery } = capture();
		const api = new GitHubApi(config);

		await api.searchIssuesPage(provider, token, { repos: ['o/a'] });
		const baseline = String(getVariables().matched);

		for (const [criterion, criteria] of samples) {
			await api.searchIssuesPage(provider, token, { repos: ['o/a'], criteria: criteria });
			// The relationship case renames the alias, so read whichever search the document declared.
			const alias = Array.from(getQuery().matchAll(/^\s*(\w+): search\(/gm), m => m[1])[0];
			assert.notEqual(
				String(getVariables()[alias]),
				baseline,
				`\`${criterion}\` is declared supported but did not change the emitted query`,
			);
		}
	});
});

suite('GitHubApi.countIssues', () => {
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

	function capture(counts: number[]): {
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
				const data = Object.fromEntries(counts.map((c, i) => [`s${i}`, { issueCount: c }]));
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

	test('counts several scopes in one request, transferring no issues', async () => {
		const { config, getQuery, getRequestCount } = capture([111, 133]);
		const api = new GitHubApi(config);

		const counts = await api.countIssues(provider, token, [{ repos: ['o/a'] }, { repos: ['o/b'] }]);

		assert.deepEqual(counts, [111, 133], 'counts come back positionally, one per scope');
		assert.equal(getRequestCount(), 1, 'both scopes share a single request');
		// `first: 0` is what makes the probe cheap; a node selection would defeat its entire purpose.
		assert.match(getQuery(), /first: 0/);
		assert.doesNotMatch(getQuery(), /nodes/, 'no issue data is requested');
	});

	test('generates its own aliases, never deriving them from caller-controlled values', async () => {
		const { config, getQuery } = capture([1]);
		const api = new GitHubApi(config);

		await api.countIssues(provider, token, [{ org: 'acme' }]);

		const aliases = Array.from(getQuery().matchAll(/(\w+): search\(/g), m => m[1]);
		assert.deepEqual(aliases, ['s0'], 'positional and generated, so no caller text can break the document');
	});

	test('applies the same criteria as the read it previews', async () => {
		const { config, getVariables } = capture([42]);
		const api = new GitHubApi(config);

		await api.countIssues(provider, token, [
			{ repos: ['o/a'], criteria: { relationships: ['unassigned'], updatedAfter: '2026-05-05' } },
		]);

		const q = String(getVariables().q0);
		assert.match(q, /repo:o\/a/);
		assert.match(q, /no:assignee/);
		assert.match(q, /updated:>=2026-05-05/);
	});

	test('an empty scope list makes no request', async () => {
		const { config, getRequestCount } = capture([]);
		const api = new GitHubApi(config);

		assert.deepEqual(await api.countIssues(provider, token, []), []);
		assert.equal(getRequestCount(), 0);
	});

	test('an alias the response omits is undefined, not zero', async () => {
		// Only `s0` comes back; `s1` is missing, which means "not reported" and must not read as no matches.
		const { config } = capture([7]);
		const api = new GitHubApi(config);

		const counts = await api.countIssues(provider, token, [{ repos: ['o/a'] }, { repos: ['o/b'] }]);

		assert.deepEqual(counts, [7, undefined]);
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
