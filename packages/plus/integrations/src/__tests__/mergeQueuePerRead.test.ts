import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { getPullRequestFieldPresence } from '../fieldPresence.js';
import type { IntegrationManager } from '../manager.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import type { GitHubPullRequestFixtureOverrides } from './githubFixtures.js';
import { gitHubPullRequest, gitHubPullRequestLite } from './githubFixtures.js';
import { connectedGitHub } from './sweepHelpers.js';

/**
 * The per-read `mergeQueue` option of the manager's uncached pull request reads, end to end: through the manager, the
 * integration and the real GitHub client to the document each read sends. A host that wants queue data on one
 * surface asks for it there; one that doesn't ask follows `getPullRequestReadOptions`. The rows follow the document:
 * GitHub answers `isMergeQueueEnabled` only to one that selects it, and a row carries `mergeQueueRequired` only then.
 */

type Node = Record<string, unknown>;

const queueFields = ['mergeQueueEntry', 'isMergeQueueEnabled', 'mergeQueueEvents'];

/** A node as GitHub answers `query`: with the merge-queue data only when the document selected it. */
function answer(query: string, node: object): Node {
	if (/\bmergeQueueEntry\b/.test(query)) {
		return { ...node, mergeQueueEntry: null, isMergeQueueEnabled: true, mergeQueueEvents: { nodes: [] } };
	}

	return Object.fromEntries(Object.entries(node).filter(([name]) => !queueFields.includes(name)));
}

const fullOverrides: GitHubPullRequestFixtureOverrides = { updatedAt: '2026-01-02T03:04:05Z', headRefOid: 'head-1' };

/** Answers every GraphQL document these reads send, with one pull request per slot, and records each. */
function serve(runtime: FakeRuntime): string[] {
	const queries: string[] = [];
	runtime.http.fetch = (_input, init) => {
		const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
			query: string;
			variables: Record<string, unknown>;
		};
		const query = body.query;
		queries.push(query);

		const data: Record<string, unknown> = {};
		const full = (number: number, extra?: GitHubPullRequestFixtureOverrides): Node =>
			answer(query, gitHubPullRequest(number, { ...fullOverrides, ...extra }, { owner: 'o', name: 'r' }));

		if (query.startsWith('query getPullRequestsBatch(')) {
			for (const [name, value] of Object.entries(body.variables)) {
				const match = /^k(\d+)$/.exec(name);
				if (match != null) {
					data[`p${match[1]}`] = { pullRequest: full(value as number) };
				}
			}
		} else if (query.startsWith('query getPullRequestsEtagFieldsBatch(')) {
			for (const [name, value] of Object.entries(body.variables)) {
				const match = /^k(\d+)$/.exec(name);
				if (match != null) {
					const node = full(value as number);
					data[`p${match[1]}`] = {
						pullRequest: {
							id: node.id,
							number: node.number,
							state: node.state,
							isDraft: node.isDraft,
							updatedAt: node.updatedAt,
							headRefOid: node.headRefOid,
							...(/\bmergeQueueEntry\b/.test(query)
								? {
										mergeQueueEntry: null,
										mergeQueueEvents: { nodes: [] },
										isMergeQueueEnabled: true,
									}
								: {}),
						},
					};
				}
			}
		} else if (query.startsWith('query getPullRequestsForBranches(')) {
			for (const [name, value] of Object.entries(body.variables)) {
				const match = /^h(\d+)$/.exec(name);
				if (match != null) {
					data[`b${match[1]}`] = {
						pullRequests: {
							totalCount: 1,
							nodes: [full(Number(match[1]) + 1, { headRefName: value as string })],
						},
					};
				}
			}
		} else if (query.startsWith('query searchPullRequestsPage(')) {
			for (const match of query.matchAll(/^\s*(\w+): search\(/gm)) {
				data[match[1]] = {
					issueCount: 1,
					pageInfo: { endCursor: null, hasNextPage: false },
					nodes: [full(1)],
				};
			}
		} else if (query.startsWith('query searchMyPullRequests(')) {
			data.search = {
				issueCount: 1,
				pageInfo: { endCursor: null, hasNextPage: false },
				nodes: [answer(query, gitHubPullRequestLite(1))],
			};
		}

		return Promise.resolve(
			new Response(JSON.stringify({ data: data }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
	};
	return queries;
}

type Read = {
	name: string;
	run: (manager: IntegrationManager, mergeQueue: boolean | undefined) => Promise<PullRequestShape[]>;
};

const providerId = GitCloudHostIntegrationId.GitHub;

const reads: Read[] = [
	{
		name: 'getPullRequestsForBranches',
		run: async (manager, mergeQueue) => {
			const result = await manager.getPullRequestsForBranches({
				providerId: providerId,
				targets: [{ key: 'a', owner: 'o', repo: 'r', branch: 'feature' }],
				mergeQueue: mergeQueue,
			});
			assert.equal(result.fetchFailed, undefined);
			return result.items.flatMap(i => i.pullRequests);
		},
	},
	{
		name: 'searchPullRequestsPage',
		run: async (manager, mergeQueue) => {
			const result = await manager.searchPullRequestsPage({
				providerId: providerId,
				repos: [{ namespace: 'o', name: 'r' }],
				criteria: { states: ['open'] },
				mergeQueue: mergeQueue,
			});
			assert.equal(result.fetchFailed, undefined);
			return result.items;
		},
	},
	{
		name: 'getPullRequestsBatch',
		run: async (manager, mergeQueue) => {
			const result = await manager.getPullRequestsBatch({
				providerId: providerId,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1 }],
				mergeQueue: mergeQueue,
			});
			assert.equal(result.fetchFailed, undefined);
			return result.items.flatMap(i => (i.pullRequest != null ? [i.pullRequest] : []));
		},
	},
	{
		name: 'listPullRequestsPage (account-wide)',
		run: async (manager, mergeQueue) => {
			const result = await manager.listPullRequestsPage({ providerId: providerId, mergeQueue: mergeQueue });
			assert.equal(result.fetchFailed, undefined);
			return result.items;
		},
	},
	{
		name: 'sweepPullRequests (account-wide)',
		run: async (manager, mergeQueue) => {
			const result = await manager.sweepPullRequests({ providerIds: [providerId], mergeQueue: mergeQueue });
			assert.equal(result.fetchFailed, undefined);
			return result.items;
		},
	},
	{
		name: 'sweepClosedPullRequests (account-wide)',
		run: async (manager, mergeQueue) => {
			const result = await manager.sweepClosedPullRequests({ providerIds: [providerId], mergeQueue: mergeQueue });
			assert.equal(result.fetchFailed, undefined);
			return result.items;
		},
	},
];

async function readWith(
	read: Read,
	host: boolean,
	mergeQueue: boolean | undefined,
): Promise<{ selected: boolean; rows: PullRequestShape[] }> {
	const runtime = createFakeRuntime({ mergeQueue: host });
	const queries = serve(runtime);
	const { manager, gh } = await connectedGitHub(runtime);
	(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
		Promise.resolve(undefined);
	try {
		const rows = await read.run(manager, mergeQueue);
		assert.ok(queries.length > 0, `${read.name} sent no request`);
		assert.ok(rows.length > 0, `${read.name} returned no row`);

		const selected = queries.map(q => /\bmergeQueueEntry\b/.test(q));
		assert.ok(
			selected.every(s => s === selected[0]),
			`${read.name} sent documents that disagree on the merge-queue data`,
		);
		return { selected: selected[0], rows: rows };
	} finally {
		manager.dispose();
	}
}

suite('Per-read merge-queue selection on the manager reads', () => {
	for (const read of reads) {
		test(`${read.name}: mergeQueue: true selects the data and the rows carry it, with no host opt-in`, async () => {
			const { selected, rows } = await readWith(read, false, true);

			assert.equal(selected, true);
			for (const row of rows) {
				assert.equal(row.mergeQueueRequired, true);
			}
		});

		test(`${read.name}: mergeQueue: false selects nothing and the rows carry none, whatever the host opts in to`, async () => {
			const { selected, rows } = await readWith(read, true, false);

			assert.equal(selected, false);
			for (const row of rows) {
				assert.equal(row.mergeQueueRequired, undefined);
				assert.equal(getPullRequestFieldPresence(row)?.mergeQueue ?? 'not-requested', 'not-requested');
			}
		});

		test(`${read.name}: omitted follows the host, on`, async () => {
			const { selected, rows } = await readWith(read, true, undefined);

			assert.equal(selected, true);
			for (const row of rows) {
				assert.equal(row.mergeQueueRequired, true);
			}
		});

		test(`${read.name}: omitted follows the host, off`, async () => {
			const { selected, rows } = await readWith(read, false, undefined);

			assert.equal(selected, false);
			for (const row of rows) {
				assert.equal(row.mergeQueueRequired, undefined);
			}
		});
	}

	test('getPullRequestsBatch: a row read with the data is `fetched` for the merge-queue group, one without is not', async () => {
		const batch = reads.find(r => r.name === 'getPullRequestsBatch');
		assert.ok(batch != null);

		const withData = await readWith(batch, false, true);
		assert.equal(getPullRequestFieldPresence(withData.rows[0])?.mergeQueue, 'fetched');

		const without = await readWith(batch, true, false);
		assert.equal(getPullRequestFieldPresence(without.rows[0])?.mergeQueue, 'not-requested');
	});

	test('getPullRequestsBatch: the cheap check and the full read select the same data, so the etags agree', async () => {
		for (const [host, mergeQueue, expected] of [
			[false, true, true],
			[true, false, false],
			[true, undefined, true],
			[false, undefined, false],
		] as const) {
			const runtime = createFakeRuntime({ mergeQueue: host });
			const queries = serve(runtime);
			const { manager, gh } = await connectedGitHub(runtime);
			(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
				Promise.resolve(undefined);
			const targets = [{ key: 'a', owner: 'o', repo: 'r', number: 1 }];

			try {
				const first = await manager.getPullRequestsBatch({
					providerId: providerId,
					targets: targets,
					mergeQueue: mergeQueue,
				});
				const second = await manager.getPullRequestsBatch({
					providerId: providerId,
					targets: targets.map(t => ({ ...t, etag: first.items[0].etag })),
					mergeQueue: mergeQueue,
				});

				const label = `host ${host}, read ${mergeQueue}`;
				assert.equal(second.items[0].unchanged, true, label);
				assert.deepEqual(
					queries.map(q => /\bmergeQueueEntry\b/.test(q)),
					[expected, expected],
					`${label}: the full read and the cheap check`,
				);
			} finally {
				manager.dispose();
			}
		}
	});

	test('getPullRequestsBatch: the host setting is read once per call, so documents built in one call agree even when it changes mid-call', async () => {
		const runtime = createFakeRuntime({ mergeQueue: true });
		const queries = serve(runtime);
		const { manager, gh } = await connectedGitHub(runtime);
		(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
			Promise.resolve(undefined);

		try {
			const held = await manager.getPullRequestsBatch({
				providerId: providerId,
				targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1 }],
			});

			// From here on, every read of the host's setting answers the opposite of the one before it.
			let next = false;
			runtime.config.getPullRequestReadOptions = () => {
				const answer = next;
				next = !next;
				return { mergeQueue: answer };
			};
			queries.length = 0;

			// The cheap check of the held target and the full read of the bare one start together, and the held one,
			// whose etag carries the marker of a read with the data, is then read in full too.
			const result = await manager.getPullRequestsBatch({
				providerId: providerId,
				targets: [
					{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: held.items[0].etag },
					{ key: 'b', owner: 'o', repo: 'r', number: 2 },
				],
			});

			assert.equal(result.fetchFailed, undefined);
			const selected = queries.map(q => /\bmergeQueueEntry\b/.test(q));
			assert.equal(selected.length, 3, 'the cheap check, the bare target, and the held one read in full');
			assert.ok(
				selected.every(s => s === selected[0]),
				`documents built in one call disagree on the merge-queue data: ${selected.join(', ')}`,
			);
			for (const item of result.items) {
				assert.equal(item.pullRequest?.mergeQueueRequired != null, selected[0], item.key);
			}
		} finally {
			manager.dispose();
		}
	});

	test('getPullRequestsBatch: an etag from a read with the data is read in full by one without, and the other way round', async () => {
		const runtime = createFakeRuntime();
		const queries = serve(runtime);
		const { manager, gh } = await connectedGitHub(runtime);
		(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
			Promise.resolve(undefined);
		const targets = [{ key: 'a', owner: 'o', repo: 'r', number: 1 }];
		const batch = async (mergeQueue: boolean, etag?: string) =>
			(
				await manager.getPullRequestsBatch({
					providerId: providerId,
					targets: targets.map(t => ({ ...t, etag: etag })),
					mergeQueue: mergeQueue,
				})
			).items[0];

		try {
			const without = await batch(false);
			const withData = await batch(true);
			assert.notEqual(
				without.etag,
				withData.etag,
				'a never-queued pull request, whose state is otherwise identical',
			);

			// Asking for the data of a row held without it reads it in full, which now carries it.
			queries.length = 0;
			const upgraded = await batch(true, without.etag);
			assert.equal(upgraded.unchanged, undefined);
			assert.equal(upgraded.pullRequest?.mergeQueueRequired, true);
			assert.equal(upgraded.etag, withData.etag);
			assert.ok(queries.some(q => q.startsWith('query getPullRequestsBatch(')));

			// And dropping it reads a row held with it in full once, then it matches.
			const downgraded = await batch(false, withData.etag);
			assert.equal(downgraded.unchanged, undefined);
			assert.equal(downgraded.pullRequest?.mergeQueueRequired, undefined);
			assert.equal(downgraded.etag, without.etag);
			assert.equal((await batch(false, downgraded.etag)).unchanged, true);
		} finally {
			manager.dispose();
		}
	});
});
