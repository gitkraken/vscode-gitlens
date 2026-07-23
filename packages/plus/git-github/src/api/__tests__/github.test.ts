import assert from 'node:assert';
import { suite, test } from 'mocha';
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
	function captureVariables(): { config: GitHubApiConfig; getVariables: () => Record<string, string> } {
		let variables: Record<string, string> = {};
		const config: GitHubApiConfig = {
			isWeb: false,
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { variables?: Record<string, string> };
				variables = body.variables ?? {};
				const empty = { issueCount: 0, nodes: [] };
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
		assert.match(vars.assigned, /assignee:@me/);
		assert.match(vars.authored, /author:@me/);
		assert.match(vars.mentioned, /mentions:@me/);
	});

	test('broadens the assigned category to any assignee when includeAllAssignees is set, keeping authored/mentioned user-relative', async () => {
		const { config, getVariables } = captureVariables();
		const api = new GitHubApi(config);

		await api.searchMyIssues(provider, token, { includeAllAssignees: true });

		const vars = getVariables();
		assert.match(vars.assigned, /assignee:\*/, 'assigned broadens to has-any-assignee');
		assert.doesNotMatch(vars.assigned, /assignee:@me/, 'the @me binding is dropped from the assigned category');
		assert.match(vars.authored, /author:@me/, 'authored stays user-relative');
		assert.match(vars.mentioned, /mentions:@me/, 'mentioned stays user-relative');
	});
});
