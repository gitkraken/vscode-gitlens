import assert from 'node:assert';
import { suite, test } from 'mocha';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import { GitHubApi } from '../github.js';
import type { GitHubPullRequestActivityCursor } from '../pullRequestActivity.js';
import { decodePullRequestActivityCursor } from '../pullRequestActivity.js';
import type { GitHubTokenInfo } from '../token.js';

suite('GitHubApi pull request activity', () => {
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

	type GraphqlRequest = { query: string; variables: Record<string, unknown> };

	function serve(answer: (request: GraphqlRequest) => unknown): { api: GitHubApi; requests: GraphqlRequest[] } {
		const requests: GraphqlRequest[] = [];
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_ignore: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const request = JSON.parse(init?.body ?? '{}') as GraphqlRequest;
				requests.push(request);
				return new Response(JSON.stringify(answer(request)), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
		return { api: new GitHubApi(config), requests: requests };
	}

	function comment(id: string, publishedAt: string, extra?: Record<string, unknown>): Record<string, unknown> {
		return {
			__typename: 'IssueComment',
			id: id,
			url: `https://github.com/o/r/pull/1#${id}`,
			body: id,
			publishedAt: publishedAt,
			createdAt: publishedAt,
			viewerDidAuthor: false,
			isMinimized: false,
			author: { __typename: 'User', login: 'alice', url: 'https://github.com/alice' },
			...extra,
		};
	}

	function pullRequest(nodes: unknown[], hasNextPage = false, endCursor = 'X'): unknown {
		return {
			pullRequest: {
				createdAt: '2026-11-01T08:00:00Z',
				timelineItems: { pageInfo: { hasNextPage: hasNextPage, endCursor: endCursor }, nodes: nodes },
			},
		};
	}

	function cursor(t: string, ids: string[]): GitHubPullRequestActivityCursor {
		return { t: t, ids: ids };
	}

	function decoded(encoded: string): GitHubPullRequestActivityCursor {
		const decodedCursor = decodePullRequestActivityCursor(encoded);
		assert.ok(decodedCursor != null, `undecodable cursor ${encoded}`);
		return decodedCursor;
	}

	test('builds one aliased query for its targets, declaring only the variables each alias uses', async () => {
		const { api, requests } = serve(request => ({
			data: Object.fromEntries(
				Object.keys(request.variables).flatMap(k =>
					k.startsWith('o') ? [[`p${k.slice(1)}`, pullRequest([])]] : [],
				),
			),
		}));

		const targets = Array.from({ length: 25 }, (_, i) => ({
			owner: 'o',
			repo: 'r',
			number: i + 1,
			cursor: i % 2 === 1 ? cursor('2026-11-10T12:00:00Z', ['a', 'b']) : undefined,
		}));
		const slots = await api.getPullRequestActivity(provider, token, targets, { limit: 30 });

		assert.strictEqual(slots.length, 25);
		assert.strictEqual(requests.length, 1);
		for (const { query, variables } of requests) {
			const header = query.slice(0, query.indexOf(')'));
			const body = query.slice(query.indexOf(')'));
			const declared = Array.from(header.matchAll(/\$(\w+):/g), m => m[1]);
			for (const name of declared) {
				assert.match(body, new RegExp(`\\$${name}\\b`), `$${name} is declared but unused`);
			}
			assert.deepStrictEqual(
				declared.sort(),
				Object.keys(variables)
					.filter(k => k !== 'baseUrl')
					.sort(),
			);
		}

		const [first] = requests;
		assert.match(
			first.query,
			/p0: repository\(owner: \$o0, name: \$n0\) \{\s*pullRequest\(number: \$k0\) \{\s*createdAt\s*timelineItems\(last: 30, itemTypes: \[PULL_REQUEST_REVIEW, ISSUE_COMMENT\]\)/,
		);
		assert.match(
			first.query,
			/timelineItems\(first: 32, since: \$s1, itemTypes: \[PULL_REQUEST_REVIEW, ISSUE_COMMENT\]\)/,
		);
		assert.doesNotMatch(first.query, /\$s0\b/);
		assert.strictEqual(first.variables.s1, '2026-11-10T11:59:59.000Z');
		assert.deepStrictEqual([first.variables.o0, first.variables.n0, first.variables.k0], ['o', 'r', 1]);
		assert.strictEqual(first.variables.k24, 25);
	});

	test('flattens reviews into their inline comments, skips pending reviews, and maps authors, states and truncation', async () => {
		const review = {
			__typename: 'PullRequestReview',
			id: 'R1',
			url: 'https://github.com/o/r/pull/1#R1',
			body: 'Looks off',
			state: 'CHANGES_REQUESTED',
			publishedAt: '2026-11-09T10:00:00Z',
			submittedAt: '2026-11-10T10:00:00Z',
			createdAt: '2026-11-09T10:00:00Z',
			viewerDidAuthor: true,
			isMinimized: false,
			commit: { oid: 'abc' },
			author: { __typename: 'User', login: 'me', url: 'https://github.com/me' },
			comments: {
				totalCount: 3,
				nodes: [
					{
						id: 'RC2',
						url: 'u2',
						body: 'also here',
						path: 'b.ts',
						line: null,
						startLine: null,
						originalLine: 4,
						outdated: true,
						publishedAt: '2026-11-10T10:00:01Z',
						createdAt: '2026-11-09T10:00:01Z',
						viewerDidAuthor: true,
						isMinimized: false,
						replyTo: { id: 'RC0' },
						commit: null,
						author: { __typename: 'User', login: 'me', url: 'https://github.com/me' },
					},
					{
						id: 'RC1',
						url: 'u1',
						body: 'here',
						path: 'a.ts',
						line: 12,
						startLine: 10,
						originalLine: 12,
						outdated: false,
						publishedAt: '2026-11-10T10:00:00Z',
						createdAt: '2026-11-09T10:00:00Z',
						viewerDidAuthor: true,
						isMinimized: false,
						replyTo: null,
						commit: { oid: 'abc' },
						author: { __typename: 'User', login: 'me', url: 'https://github.com/me' },
					},
				],
			},
		};
		const pending = { ...review, id: 'R2', state: 'PENDING', publishedAt: null, submittedAt: null };
		const odd = {
			...review,
			id: 'R3',
			state: 'SOMETHING_NEW',
			body: '',
			submittedAt: '2026-11-10T11:00:00Z',
			comments: { totalCount: 0, nodes: [] },
			commit: null,
		};
		const { api } = serve(() => ({
			data: {
				p0: pullRequest([
					comment('C1', '2026-11-08T09:00:00Z', {
						author: { __typename: 'Bot', login: 'ci[bot]', url: null },
					}),
					review,
					pending,
					comment('C2', '2026-11-10T10:30:00Z', { author: null, isMinimized: true }),
					odd,
				]),
			},
		}));

		const [slot] = await api.getPullRequestActivity(provider, token, [{ owner: 'o', repo: 'r', number: 1 }], {
			limit: 30,
		});

		assert.strictEqual(slot.status, 'fulfilled');
		const page = slot.value!;
		assert.strictEqual(page.hasMore, false);
		assert.deepStrictEqual(page.items, [
			{
				kind: 'comment',
				id: 'C1',
				url: 'https://github.com/o/r/pull/1#C1',
				author: { login: 'ci[bot]', isBot: true },
				publishedAt: new Date('2026-11-08T09:00:00Z'),
				byViewer: false,
				isMinimized: false,
				body: 'C1',
			},
			{
				kind: 'review',
				id: 'R1',
				url: 'https://github.com/o/r/pull/1#R1',
				author: { login: 'me', url: 'https://github.com/me', isBot: false },
				publishedAt: new Date('2026-11-10T10:00:00Z'),
				byViewer: true,
				isMinimized: false,
				state: 'changes-requested',
				body: 'Looks off',
				commitSha: 'abc',
				commentsTruncated: true,
			},
			{
				kind: 'review-comment',
				id: 'RC1',
				url: 'u1',
				author: { login: 'me', url: 'https://github.com/me', isBot: false },
				publishedAt: new Date('2026-11-10T10:00:00Z'),
				byViewer: true,
				isMinimized: false,
				reviewId: 'R1',
				body: 'here',
				path: 'a.ts',
				line: 12,
				startLine: 10,
				originalLine: 12,
				outdated: false,
				commitSha: 'abc',
			},
			{
				kind: 'review-comment',
				id: 'RC2',
				url: 'u2',
				author: { login: 'me', url: 'https://github.com/me', isBot: false },
				publishedAt: new Date('2026-11-10T10:00:00Z'),
				byViewer: true,
				isMinimized: false,
				reviewId: 'R1',
				body: 'also here',
				path: 'b.ts',
				originalLine: 4,
				outdated: true,
				inReplyTo: 'RC0',
			},
			{
				kind: 'comment',
				id: 'C2',
				url: 'https://github.com/o/r/pull/1#C2',
				publishedAt: new Date('2026-11-10T10:30:00Z'),
				byViewer: false,
				isMinimized: true,
				body: 'C2',
			},
			{
				kind: 'review',
				id: 'R3',
				url: 'https://github.com/o/r/pull/1#R1',
				author: { login: 'me', url: 'https://github.com/me', isBot: false },
				publishedAt: new Date('2026-11-10T11:00:00Z'),
				byViewer: true,
				isMinimized: false,
				state: 'commented',
				body: '',
			},
		]);
		assert.deepStrictEqual(decodePullRequestActivityCursor(page.cursor), {
			t: '2026-11-10T11:00:00.000Z',
			ids: ['R3'],
		});
	});

	test('resumes after a cursor without repeating an item, keeping a new one published in the boundary second', async () => {
		const t = '2026-11-10T12:00:00Z';
		let nodes: unknown[] = [];
		let hasNextPage = false;
		const { api, requests } = serve(() => ({ data: { p0: pullRequest(nodes, hasNextPage) } }));
		const read = async (from: GitHubPullRequestActivityCursor, limit: number) => {
			const [slot] = await api.getPullRequestActivity(
				provider,
				token,
				[{ owner: 'o', repo: 'r', number: 1, cursor: from }],
				{ limit: limit },
			);
			assert.strictEqual(slot.status, 'fulfilled');
			return slot.value!;
		};

		nodes = [comment('A', t), comment('B', t), comment('C', t), comment('D', '2026-11-10T12:00:05Z')];
		hasNextPage = true;
		const first = await read(cursor(t, ['A']), 2);
		assert.match(requests[0].query, /first: 3,/);
		assert.deepStrictEqual(
			first.items.map(i => i.id),
			['B', 'C'],
		);
		assert.strictEqual(first.hasMore, true);
		assert.deepStrictEqual(decodePullRequestActivityCursor(first.cursor), {
			t: '2026-11-10T12:00:00.000Z',
			ids: ['A', 'B', 'C'],
		});

		const second = await read(decoded(first.cursor), 2);
		assert.match(requests[1].query, /first: 5,/);
		assert.deepStrictEqual(
			second.items.map(i => i.id),
			['D'],
		);
		assert.strictEqual(second.hasMore, true);
		assert.deepStrictEqual(decodePullRequestActivityCursor(second.cursor), {
			t: '2026-11-10T12:00:05.000Z',
			ids: ['D'],
		});

		nodes = [comment('D', '2026-11-10T12:00:05Z'), comment('E', '2026-11-11T09:00:00Z')];
		hasNextPage = false;
		const later = await read(decoded(second.cursor), 2);
		assert.strictEqual(requests[2].variables.s0, '2026-11-10T12:00:04.000Z');
		assert.deepStrictEqual(
			later.items.map(i => i.id),
			['E'],
		);
		assert.strictEqual(later.hasMore, false);

		nodes = [comment('E', '2026-11-11T09:00:00Z')];
		const idle = await read(decoded(later.cursor), 2);
		assert.deepStrictEqual(idle.items, []);
		assert.strictEqual(idle.cursor, later.cursor);
	});

	test('times a review by its submission and resumes a cut page from its last item, so a review drafted early is neither lost nor repeated', async () => {
		const drafted = {
			...comment('R', '2026-11-09T10:13:48Z'),
			__typename: 'PullRequestReview',
			state: 'COMMENTED',
			submittedAt: '2026-11-10T09:37:07Z',
			commit: null,
			comments: { totalCount: 0, nodes: [] },
		};
		const c1 = comment('C1', '2026-11-09T13:00:00Z');
		let response = pullRequest([drafted, c1], true);
		const { api, requests } = serve(() => ({ data: { p0: response } }));
		const read = async (from: GitHubPullRequestActivityCursor) => {
			const [slot] = await api.getPullRequestActivity(
				provider,
				token,
				[{ owner: 'o', repo: 'r', number: 1, cursor: from }],
				{ limit: 2 },
			);
			assert.strictEqual(slot.status, 'fulfilled');
			return slot.value!;
		};

		const first = await read(cursor('2026-11-09T12:00:00Z', []));
		assert.deepStrictEqual(
			first.items.map(i => [i.id, i.publishedAt.toISOString()]),
			[
				['R', '2026-11-10T09:37:07.000Z'],
				['C1', '2026-11-09T13:00:00.000Z'],
			],
		);
		assert.strictEqual(first.hasMore, true);
		assert.deepStrictEqual(decodePullRequestActivityCursor(first.cursor), {
			t: '2026-11-09T13:00:00.000Z',
			ids: ['R', 'C1'],
		});

		response = pullRequest([
			drafted,
			c1,
			comment('C2', '2026-11-09T14:00:00Z'),
			comment('C3', '2026-11-11T08:00:00Z'),
		]);
		const second = await read(decoded(first.cursor));
		assert.strictEqual(requests[1].variables.s0, '2026-11-09T12:59:59.000Z');
		assert.deepStrictEqual(
			second.items.map(i => i.id),
			['C2', 'C3'],
		);
		assert.strictEqual(second.hasMore, false);
		assert.deepStrictEqual(decodePullRequestActivityCursor(second.cursor), {
			t: '2026-11-11T08:00:00.000Z',
			ids: ['C3'],
		});
	});

	test('reads past a page holding nothing new in the same call', async () => {
		const t = '2026-11-10T12:00:00Z';
		const { api, requests } = serve(request => ({
			data: {
				p0:
					request.variables.a0 == null
						? pullRequest([comment('X', '2026-11-10T11:59:59Z'), comment('Y', t)], true, 'E1')
						: pullRequest([comment('Z', '2026-11-10T12:00:01Z')]),
			},
		}));

		const [slot] = await api.getPullRequestActivity(
			provider,
			token,
			[{ owner: 'o', repo: 'r', number: 1, cursor: cursor(t, ['Y']) }],
			{ limit: 1 },
		);

		assert.strictEqual(slot.status, 'fulfilled');
		assert.deepStrictEqual(
			slot.value!.items.map(i => i.id),
			['Z'],
		);
		assert.strictEqual(slot.value!.hasMore, false);
		assert.strictEqual(requests.length, 2);
		assert.match(requests[1].query, /after: \$a0,/);
		assert.strictEqual(requests[1].variables.a0, 'E1');
	});

	test('resumes a cut page ending on a review drafted earlier from its drafting, so an item created between is not skipped', async () => {
		const review = {
			...comment('R', '2026-11-09T13:30:00Z'),
			__typename: 'PullRequestReview',
			state: 'COMMENTED',
			submittedAt: '2026-11-09T15:00:00Z',
			commit: null,
			comments: { totalCount: 0, nodes: [] },
		};
		let response = pullRequest([comment('C1', '2026-11-09T13:00:00Z'), review], true);
		const { api } = serve(() => ({ data: { p0: response } }));
		const read = async (from: GitHubPullRequestActivityCursor) => {
			const [slot] = await api.getPullRequestActivity(
				provider,
				token,
				[{ owner: 'o', repo: 'r', number: 1, cursor: from }],
				{ limit: 2 },
			);
			assert.strictEqual(slot.status, 'fulfilled');
			return slot.value!;
		};

		const first = await read(cursor('2026-11-09T12:00:00Z', []));
		assert.deepStrictEqual(
			first.items.map(i => i.id),
			['C1', 'R'],
		);
		assert.strictEqual(first.hasMore, true);
		assert.strictEqual(decodePullRequestActivityCursor(first.cursor)?.t, '2026-11-09T13:30:00.000Z');

		response = pullRequest([review, comment('C2', '2026-11-09T14:00:00Z')]);
		const second = await read(decoded(first.cursor));
		assert.deepStrictEqual(
			second.items.map(i => i.id),
			['C2'],
		);
	});

	test('answers a baseline with no activity from the pull request creation, a missing pull request as absent, and fails only an alias that errored', async () => {
		const { api } = serve(() => ({
			data: { p0: pullRequest([]), p1: { pullRequest: null }, p2: null, p3: null },
			errors: [
				{ type: 'NOT_FOUND', path: ['p1', 'pullRequest'], message: 'Could not resolve to a PullRequest' },
				{ type: 'NOT_FOUND', path: ['p2'], message: 'Could not resolve to a Repository' },
				{ type: 'FORBIDDEN', path: ['p3'], message: 'Resource protected by SAML enforcement' },
			],
		}));

		const slots = await api.getPullRequestActivity(
			provider,
			token,
			[1, 2, 3, 4].map(n => ({ owner: 'o', repo: 'r', number: n })),
			{ limit: 30 },
		);

		assert.strictEqual(slots[0].status, 'fulfilled');
		assert.deepStrictEqual(slots[0].value!.items, []);
		assert.deepStrictEqual(decodePullRequestActivityCursor(slots[0].value!.cursor), {
			t: '2026-11-01T08:00:00.000Z',
			ids: [],
		});
		assert.deepStrictEqual(slots.slice(1, 3), [
			{ status: 'fulfilled', value: undefined },
			{ status: 'fulfilled', value: undefined },
		]);
		assert.strictEqual(slots[3].status, 'rejected');
	});
});
