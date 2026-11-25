import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { encodePullRequestActivityCursor } from '@gitlens/git-github/api/pullRequestActivity.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitHub, connectedGitLab } from './sweepHelpers.js';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

suite('IntegrationManager.getPullRequestActivity', () => {
	test('answers each target under its key, marks a missing pull request notFound, and drops only the target whose read failed', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(
				json(200, {
					data: {
						p0: {
							pullRequest: {
								createdAt: '2026-11-01T08:00:00Z',
								timelineItems: {
									pageInfo: { hasNextPage: false, endCursor: null },
									nodes: [
										{
											__typename: 'IssueComment',
											id: 'C1',
											url: 'https://github.com/o/r/pull/1#C1',
											body: 'hi',
											publishedAt: '2026-11-10T12:00:00Z',
											createdAt: '2026-11-10T12:00:00Z',
											viewerDidAuthor: false,
											isMinimized: false,
											author: {
												__typename: 'User',
												login: 'alice',
												url: 'https://github.com/alice',
											},
										},
									],
								},
							},
						},
						p1: { pullRequest: null },
						p2: null,
					},
					errors: [
						{
							type: 'NOT_FOUND',
							path: ['p1', 'pullRequest'],
							message: 'Could not resolve to a PullRequest',
						},
						{ type: 'FORBIDDEN', path: ['p2'], message: 'Resource protected by SAML enforcement' },
					],
				}),
			);
		};
		const { manager } = await connectedGitHub(runtime);
		const sent = encodePullRequestActivityCursor({ t: '2026-11-09T00:00:00.000Z', ids: [] });

		const result = await manager.getPullRequestActivity({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [
				{ key: 'pr', owner: 'o', repo: 'r', number: 1, cursor: sent },
				{ key: 'gone', owner: 'o', repo: 'r', number: 2, cursor: '' },
				{ key: 'saml', owner: 'locked', repo: 'r', number: 3 },
			],
		});

		assert.equal(requests, 1);
		assert.deepEqual(result.items, [
			{
				key: 'pr',
				items: [
					{
						kind: 'comment',
						id: 'C1',
						url: 'https://github.com/o/r/pull/1#C1',
						author: { login: 'alice', url: 'https://github.com/alice', isBot: false },
						publishedAt: new Date('2026-11-10T12:00:00Z'),
						byViewer: false,
						isMinimized: false,
						body: 'hi',
					},
				],
				cursor: encodePullRequestActivityCursor({ t: '2026-11-10T12:00:00.000Z', ids: ['C1'] }),
				hasMore: false,
			},
			{ key: 'gone', items: [], cursor: '', hasMore: false, notFound: true },
		]);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.deepEqual(result.warnings[0].targetKeys, ['saml']);

		manager.dispose();
	});

	test('reads more than 25 pull requests as one aliased request per 25, answering every target', async () => {
		const runtime = createFakeRuntime();
		const requests: { query: string; variables: Record<string, unknown> }[] = [];
		runtime.http.fetch = (_url, init) => {
			const body = init?.body;
			assert.ok(typeof body === 'string');
			const request = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
			requests.push(request);
			const aliases = Object.keys(request.variables).filter(k => /^o\d+$/.test(k));
			return Promise.resolve(
				json(200, {
					data: Object.fromEntries(
						aliases.map(k => [
							`p${k.slice(1)}`,
							{
								pullRequest: {
									createdAt: '2026-11-01T08:00:00Z',
									timelineItems: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
								},
							},
						]),
					),
				}),
			);
		};
		const { manager } = await connectedGitHub(runtime);

		const result = await manager.getPullRequestActivity({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: Array.from({ length: 27 }, (_, i) => ({ key: `pr${i}`, owner: 'o', repo: 'r', number: i + 1 })),
		});

		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(
			result.items.map(i => i.key),
			Array.from({ length: 27 }, (_, i) => `pr${i}`),
		);
		assert.deepEqual(
			requests.map(r => Object.keys(r.variables).filter(k => /^k\d+$/.test(k)).length).sort((a, b) => a - b),
			[2, 25],
		);
		assert.deepEqual(
			requests
				.flatMap(r => Object.entries(r.variables).flatMap(([k, v]) => (/^k\d+$/.test(k) ? [v] : [])))
				.sort((a, b) => Number(a) - Number(b)),
			Array.from({ length: 27 }, (_, i) => i + 1),
		);

		manager.dispose();
	});

	test('refuses the whole call, without a request, on a duplicate key, a bad target, an undecodable cursor or a bad limit', async () => {
		const runtime = createFakeRuntime();
		let requests = 0;
		runtime.http.fetch = () => {
			requests++;
			return Promise.resolve(json(500, {}));
		};
		const { manager } = await connectedGitHub(runtime);
		const target = { key: 'a', owner: 'o', repo: 'r', number: 1 };
		type Options = Parameters<typeof manager.getPullRequestActivity>[0];
		const github = GitCloudHostIntegrationId.GitHub;

		const calls: [Options, RegExp][] = [
			[{ providerId: github, targets: [target, target] }, /Duplicate pull request activity/],
			[{ providerId: github, targets: [{ ...target, owner: ' ' }] }, /non-empty owner and repo/],
			[{ providerId: github, targets: [{ ...target, number: 0 }] }, /positive integer/],
			[{ providerId: github, targets: [{ ...target, cursor: 'not a cursor' }] }, /cursor 'not a cursor'/],
			...[0, 101, 2.5].map((limit): [Options, RegExp] => [
				{ providerId: github, targets: [target], limit: limit },
				/limit/,
			]),
		];
		for (const [options, message] of calls) {
			const result = await manager.getPullRequestActivity(options);
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings.length, 1);
			assert.equal(result.warnings[0].kind, 'other');
			assert.match(result.warnings[0].message, message);
		}
		assert.equal(requests, 0);

		manager.dispose();
	});

	test('refuses every provider but GitHub and GitHub Enterprise as unsupported', async () => {
		const { manager } = await connectedGitLab(createFakeRuntime());
		const targets = [{ key: 'a', owner: 'o', repo: 'r', number: 1 }];

		for (const providerId of [GitCloudHostIntegrationId.GitLab, IssuesCloudHostIntegrationId.Jira]) {
			const result = await manager.getPullRequestActivity({ providerId: providerId, targets: targets });
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings[0].kind, 'unsupported');
			assert.match(result.warnings[0].message, /not supported/);
		}

		manager.dispose();
	});
});
