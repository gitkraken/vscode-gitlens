import * as assert from 'assert';
import * as sinon from 'sinon';
import type { TestRepo } from './helpers.js';
import { addCommit, createStash, createTestRepo } from './helpers.js';

function sortedEntries<K, V>(map: Map<K, V> | undefined): [K, V][] {
	return [...(map?.entries() ?? [])].sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0));
}

function statsRunCalls(spy: sinon.SinonSpy): sinon.SinonSpyCall[] {
	return spy.getCalls().filter(c => c.args[1] === 'log' && (c.args as unknown[]).includes('--no-walk'));
}

suite('GraphSubProvider rowsStatsSeed', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'hello', 'Add file1');
		addCommit(repo.path, 'file2.txt', 'world', 'Add file2');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('fresh getGraph with stats resolves stats for every row', async () => {
		const graph = await repo.provider.graph.getGraph(repo.path, undefined, { include: { stats: true } });
		await graph.rowsStatsDeferred?.promise;

		assert.ok(graph.rows.length > 0, 'Expected at least one row');
		for (const row of graph.rows) {
			assert.ok(graph.rowsStats?.has(row.sha), `Expected stats for ${row.sha}`);
		}
	});

	test('seeded rebuild with one new commit computes only the new sha, matching an unseeded run', async () => {
		const prior = await repo.provider.graph.getGraph(repo.path, undefined, { include: { stats: true } });
		await prior.rowsStatsDeferred?.promise;

		addCommit(repo.path, 'file3.txt', 'seeded', 'Add file3');

		const runSpy = sinon.spy(repo.provider.git, 'run');
		let rebuilt;
		try {
			rebuilt = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: true },
				rowsStatsSeed: prior.rowsStats,
			});
			await rebuilt.rowsStatsDeferred?.promise;
		} finally {
			runSpy.restore();
		}

		for (const row of rebuilt.rows) {
			assert.ok(rebuilt.rowsStats?.has(row.sha), `Expected stats for ${row.sha}`);
		}
		// The stats query should have run once, against only the new (uncovered) commit.
		assert.strictEqual(statsRunCalls(runSpy).length, 1);

		const unseeded = await repo.provider.graph.getGraph(repo.path, undefined, { include: { stats: true } });
		await unseeded.rowsStatsDeferred?.promise;

		assert.deepStrictEqual(sortedEntries(rebuilt.rowsStats), sortedEntries(unseeded.rowsStats));
	});

	test('fully-seeded rebuild reuses prior stats with no stats git invocation', async () => {
		const prior = await repo.provider.graph.getGraph(repo.path, undefined, { include: { stats: true } });
		await prior.rowsStatsDeferred?.promise;

		const runSpy = sinon.spy(repo.provider.git, 'run');
		let rebuilt;
		try {
			rebuilt = await repo.provider.graph.getGraph(repo.path, undefined, {
				include: { stats: true },
				rowsStatsSeed: prior.rowsStats,
			});
			await rebuilt.rowsStatsDeferred?.promise;
		} finally {
			runSpy.restore();
		}

		assert.strictEqual(statsRunCalls(runSpy).length, 0, 'Fully seeded rebuild should not spawn a stats query');
		assert.deepStrictEqual(sortedEntries(rebuilt.rowsStats), sortedEntries(prior.rowsStats));
	});

	test('stash rows get the same stats on fresh and seeded runs', async () => {
		createStash(repo.path, 'test stash');
		// The test harness bypasses GitLens's change hooks, so force the stash cache to refresh.
		repo.provider.cache.clearCaches(repo.path, 'stashes');

		const fresh = await repo.provider.graph.getGraph(repo.path, undefined, { include: { stats: true } });
		await fresh.rowsStatsDeferred?.promise;

		const stashRow = fresh.rows.find(r => r.type === 'stash-node');
		assert.ok(stashRow, 'Expected a stash row');
		// A stash's stats are its first-parent diff (what `git stash show` reports) — deterministic,
		// unlike the old remap of the whole stash stdin, which raced on `--no-walk` commit-time ordering.
		// createStash stages one new 1-line file.
		const stashStats = fresh.rowsStats?.get(stashRow.sha);
		assert.ok(stashStats, 'Expected a stats entry for the stash row');
		assert.strictEqual(stashStats.files, 1, 'stash files');
		assert.strictEqual(stashStats.additions, 1, 'stash additions');
		assert.strictEqual(stashStats.deletions, 0, 'stash deletions');

		const rebuilt = await repo.provider.graph.getGraph(repo.path, undefined, {
			include: { stats: true },
			rowsStatsSeed: fresh.rowsStats,
		});
		await rebuilt.rowsStatsDeferred?.promise;

		const rebuiltStashRow = rebuilt.rows.find(r => r.type === 'stash-node');
		assert.ok(rebuiltStashRow, 'Expected a stash row on the seeded rebuild');
		assert.deepStrictEqual(rebuilt.rowsStats?.get(rebuiltStashRow.sha), stashStats);
	});
});
