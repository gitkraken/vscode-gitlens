import * as assert from 'assert';
import type { GitGraphRow, GraphReachabilityTable } from '@gitlens/git/models/graph.js';
import { GraphSyncPublisher } from '../graphSyncPublisher.js';
import type { GraphSyncDataSource, GraphSyncHost } from '../graphSyncPublisher.js';
import type { GraphPaging, GraphRowsPayload, GraphRowStats } from '../protocol.js';

function row(sha: string, options?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: sha,
		parents: [`p-${sha}`],
		author: 'Tester',
		email: 'test@example.com',
		date: 1000,
		message: `commit ${sha}`,
		kind: 'commit',
		...options,
	};
}

function rows(count: number, prefix = 'sha'): GitGraphRow[] {
	return Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
}

function reachRef(name: string): GraphReachabilityTable['dictionary'][number] {
	return { refType: 'branch', name: name, remote: false };
}

/** Mutable stand-in for the host's `_graph` — tests mutate the fields directly. */
class FakeData implements GraphSyncDataSource {
	rows: GitGraphRow[] | undefined;
	/** Accumulated-rows mirror; models the host's `_loadedRows`. Falls back to page rows when unset. */
	loadedRows: GitGraphRow[] | undefined;
	downstreams = new Map<string, string[]>();
	rowsStats = new Map<string, GraphRowStats>();
	rowsStatsLoading = false;
	rowsStatsIncluded = false;
	reachability: GraphReachabilityTable | undefined;
	paging: GraphPaging | undefined;

	getRows(): GitGraphRow[] | undefined {
		return this.rows;
	}
	getSnapshotRows(): GitGraphRow[] | undefined {
		return this.loadedRows ?? this.rows;
	}
	getDownstreams(): ReadonlyMap<string, string[]> | undefined {
		return this.downstreams;
	}
	getRowsStats(): ReadonlyMap<string, GraphRowStats> | undefined {
		return this.rowsStats;
	}
	isRowsStatsLoading(): boolean {
		return this.rowsStatsLoading;
	}
	isRowsStatsIncluded(): boolean {
		return this.rowsStatsIncluded;
	}
	getReachability(): GraphReachabilityTable | undefined {
		return this.reachability;
	}
	getPaging(): GraphPaging | undefined {
		return this.paging;
	}
}

/** Controllable transport: records every emission plus the epoch bumps interleaved between them.
 *  Mirrors the channel's contract — `send` is void, and a `newGeneration` is announced immediately. */
class FakeHost implements GraphSyncHost {
	ready = true;
	visible = true;
	readonly sent: GraphRowsPayload[] = [];
	/** One entry per emission: the epoch it was sent under. Bumped by {@link newGeneration}. */
	readonly generations: number[] = [];
	private generation = 0;

	isReady(): boolean {
		return this.ready;
	}
	isVisible(): boolean {
		return this.visible;
	}
	send(params: GraphRowsPayload): void {
		this.sent.push(params);
		this.generations.push(this.generation);
	}
	newGeneration(): void {
		this.generation++;
	}

	get last(): GraphRowsPayload {
		return this.sent.at(-1)!;
	}

	get lastGeneration(): number {
		return this.generations.at(-1)!;
	}
}

function createPublisher(): { publisher: GraphSyncPublisher; host: FakeHost; data: FakeData } {
	const host = new FakeHost();
	const data = new FakeData();
	// Large debounce so the internal timer never fires during a test — flush() is always driven explicitly.
	const publisher = new GraphSyncPublisher(host, data, { debounceMs: 1_000_000 });
	return { publisher: publisher, host: host, data: data };
}

/** Let queued microtasks (a trailing flush kicked off in a `.finally`) settle. */
async function tick(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

suite('graphSyncPublisher', () => {
	test('flush while hidden marks dirty; a single delta flushes on visible', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		// Initial sync is always a snapshot.
		await publisher.flush();
		assert.strictEqual(host.sent.length, 1);
		assert.strictEqual(host.last.snapshot, true);

		host.visible = false;
		data.downstreams.set('origin/main', ['origin/feature']);
		publisher.mark('downstreams');
		publisher.mark('downstreams'); // coalesces
		await publisher.flush();
		assert.strictEqual(host.sent.length, 1, 'no emission while hidden');

		host.visible = true;
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2, 'exactly one delta once visible');
		assert.strictEqual(host.last.snapshot ?? false, false, 'delta, not a snapshot');
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });

		publisher.dispose();
	});

	test('a snapshot reseeds all cursors: a no-op follow-up sends nothing; a rows change splices', async () => {
		const { publisher, host, data } = createPublisher();
		// A well-under-1000-row window — the splice must fire here on relative reuse alone, not because
		// the window happens to clear some flat absolute floor.
		const base = rows(500);
		data.rows = base;

		await publisher.flush(); // snapshot seeds the ledger with the full rows
		assert.strictEqual(host.sent.length, 1);
		assert.strictEqual(host.last.snapshot, true);

		// Nothing changed and nothing marked → no emission at all.
		await publisher.flush();
		assert.strictEqual(host.sent.length, 1, 'a no-op flush emits nothing');

		// Prepend a commit → the whole prior window is reusable → a head-only splice.
		data.rows = [row('new0'), ...base];
		publisher.mark('rows');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2);
		const splice = host.last.rowsSplice;
		assert.ok(splice, 'expected a splice against the reseeded ledger');
		assert.deepStrictEqual(host.last.rows, [], 'spliced push carries no full rows');
		assert.deepStrictEqual(
			splice.head.map(r => r.sha),
			['new0'],
		);
		assert.strictEqual(splice.reusedCount, 500);

		publisher.dispose();
	});

	test('a snapshot after paging ships the full accumulated window, not just the last page', async () => {
		const { publisher, host, data } = createPublisher();

		// Initial cursor-less window of 800 rows.
		const initial = rows(800);
		data.rows = initial;
		data.loadedRows = initial;
		await publisher.flush(); // snapshot #1
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.last.rows?.length, 800);

		// Page in 800 more rows: `_graph.rows` (getRows) is now the PAGE only; the mirror holds the full
		// 1600-row window (getSnapshotRows).
		const page = rows(800, 'page');
		const full = [...initial, ...page];
		data.rows = page;
		data.loadedRows = full;
		data.paging = { startingCursor: 'sha799', hasMore: true };
		publisher.mark('rows');
		await publisher.flush(); // page-append delta ships only the page
		assert.strictEqual(host.last.snapshot ?? false, false);
		assert.strictEqual(host.last.rows?.length, 800, 'the page-append delta ships only the page');
		assert.strictEqual(host.last.paging?.startingCursor, 'sha799');

		// A recovery snapshot (resync / broken send / webview reload) REPLACES the webview's rows — it MUST
		// carry the full 1600-row accumulated window, or the loaded window is silently truncated to the page.
		publisher.requireSnapshot();
		await publisher.flush();
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.last.rows?.length, 1600, 'the snapshot ships the FULL accumulated window');
		assert.deepStrictEqual(
			host.last.rows.map(r => r.sha),
			full.map(r => r.sha),
		);

		// The ledger was reseeded to the full window: a cursor-less flush with the unchanged full rows reuses
		// everything (empty-head splice, no rows shipped).
		data.rows = full;
		data.loadedRows = full;
		data.paging = { startingCursor: undefined, hasMore: false };
		publisher.mark('rows');
		await publisher.flush();
		const noop = host.last.rowsSplice;
		assert.ok(noop, 'a cursor-less flush splices against the reseeded ledger');
		assert.deepStrictEqual(host.last.rows, [], 'no full rows shipped — everything reused');
		assert.deepStrictEqual(noop.head, [], 'nothing changed → empty head');
		assert.strictEqual(noop.reusedCount, 1600, 'the whole full window is reused (ledger reseeded to it)');

		// A follow-up prepend splices against the FULL 1600-row window (head-only + full reuse).
		data.rows = [row('new0'), ...full];
		data.loadedRows = data.rows;
		publisher.mark('rows');
		await publisher.flush();
		const splice = host.last.rowsSplice;
		assert.ok(splice, 'the prepend splices against the reseeded full-window ledger');
		assert.deepStrictEqual(
			splice.head.map(r => r.sha),
			['new0'],
		);
		assert.strictEqual(splice.reusedCount, 1600, 'the full window below the prepend is reused');

		publisher.dispose();
	});

	test('a graph identity change bumps the epoch BEFORE the snapshot it forces', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(3);

		await publisher.flush(); // snapshot in the initial epoch
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.lastGeneration, 0);

		data.downstreams.set('origin/main', ['origin/feature']);
		publisher.mark('downstreams');
		await publisher.flush(); // delta, same epoch
		assert.strictEqual(host.last.snapshot ?? false, false);
		assert.strictEqual(host.lastGeneration, 0);

		// The bump must land before the emission it forces, so the new epoch's first message is the
		// snapshot (the channel's seq 0) and nothing from the old repo can be mistaken for it.
		publisher.onGraphIdentityChanged();
		await publisher.flush();
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.lastGeneration, 1, 'the snapshot went out under the NEW epoch');

		publisher.dispose();
	});

	test('resync bumps the epoch and re-ships a full snapshot', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		data.downstreams.set('origin/main', ['origin/feature']);
		publisher.mark('downstreams');
		await publisher.flush(); // delta
		assert.strictEqual(host.sent.length, 2);
		assert.strictEqual(host.lastGeneration, 0);

		// The webview reported a gap (or a failed splice guard) — the ONE recovery.
		await publisher.resync();
		assert.strictEqual(host.sent.length, 3);
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.lastGeneration, 1, 'the recovery snapshot opens a fresh epoch');
		assert.strictEqual(host.last.rows?.length, 5, 'the snapshot re-ships the full window');

		publisher.dispose();
	});

	test('a resync while hidden latches the snapshot for the next flush', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		host.visible = false;
		await publisher.resync();
		assert.strictEqual(host.sent.length, 1, 'nothing ships while hidden');
		assert.strictEqual(publisher.snapshotRequired, true, 'the requirement is latched');

		host.visible = true;
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2);
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.lastGeneration, 1, 'the epoch bumped when resync was called, not when it shipped');

		publisher.dispose();
	});

	test('N marks coalesce into a single flush', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		data.downstreams.set('origin/main', ['origin/feature']);
		data.rowsStats.set('sha0', { additions: 1, deletions: 0, files: 1 });
		publisher.mark('downstreams');
		publisher.mark('rowsStats');
		publisher.mark('downstreams');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2, 'three marks produced a single delta');
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });
		assert.ok(host.last.rowsStats?.sha0, 'the coalesced delta carries every dirty channel');

		publisher.dispose();
	});

	test('riders ride the next emission and clear once it goes out', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot, no riders attached
		assert.strictEqual(host.last.selectedRows, undefined);

		data.downstreams.set('origin/main', ['origin/feature']);
		publisher.attachRiders({ selectedRows: { sha0: true } });
		publisher.mark('downstreams');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2);
		assert.deepStrictEqual(host.last.selectedRows, { sha0: true }, 'the rider travels with the delta');

		// Cleared by that emission — the next one carries no stale envelope.
		data.downstreams.set('origin/other', ['origin/topic']);
		publisher.mark('downstreams');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 3);
		assert.strictEqual(host.last.selectedRows, undefined, 'riders cleared once carried');

		publisher.dispose();
	});

	test('a rider with no dirty channel still flushes (the envelope needs a carrier)', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		// No channel marked — only a selection rider. It must still ship (as a delta carrier).
		publisher.attachRiders({ selectedRows: { sha1: true } });
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2, 'a lone rider produces a carrier emission');
		assert.strictEqual(host.last.snapshot ?? false, false, 'delta, not a snapshot');
		assert.deepStrictEqual(host.last.selectedRows, { sha1: true });

		publisher.dispose();
	});

	test('an empty flush ships nothing', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		// Nothing marked, no riders — a page that added no rows leaves exactly this state, and it must
		// stay silent: re-shipping the window as a REPLACE re-fires the virtualizer's `rangeChanged` and
		// restarts the very prefetch the page was answering. Callers settle on the RPC promise instead.
		await publisher.flush();
		assert.strictEqual(host.sent.length, 1);

		publisher.dispose();
	});

	test('a snapshot is deferred while there is no graph (deferred bootstrap) — no empty-rows flash', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = undefined; // deferred bootstrap: webview ready before the graph build lands

		await publisher.flush();
		assert.strictEqual(host.sent.length, 0, 'no empty snapshot while the graph is still building');
		assert.strictEqual(publisher.snapshotRequired, true, 'the snapshot requirement persists');

		data.rows = rows(5);
		publisher.mark('rows');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 1, 'the snapshot ships once rows exist');
		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.last.rows?.length, 5);

		publisher.dispose();
	});

	test('a generation bump clears any pending riders (stale repo-A envelope never rides repo-B)', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		await publisher.flush();

		publisher.attachRiders({ selectedRows: { sha0: true } });
		// A repo swap bumps the generation before the riders ever shipped.
		publisher.onGraphIdentityChanged();
		await publisher.flush(); // gen-1 snapshot

		assert.strictEqual(host.last.snapshot, true);
		assert.strictEqual(host.last.selectedRows, undefined, 'stale riders do not ride the new-repo snapshot');

		publisher.dispose();
	});

	test('hold defers marks + a required snapshot; release flushes exactly once with held-attached riders', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		// Hold BEFORE the first flush — even the required initial snapshot is deferred.
		publisher.hold();
		await publisher.flush();
		assert.strictEqual(host.sent.length, 0, 'nothing ships while held');
		assert.strictEqual(publisher.snapshotRequired, true, 'the snapshot requirement persists across the hold');

		publisher.release();
		await tick();
		assert.strictEqual(host.sent.length, 1, 'release ships the deferred snapshot exactly once');
		assert.strictEqual(host.last.snapshot, true);

		// Now a held multi-step delta: marks + riders coalesce into one release-driven emission.
		publisher.hold();
		data.downstreams.set('origin/main', ['origin/feature']);
		data.rowsStats.set('sha0', { additions: 1, deletions: 0, files: 1 });
		publisher.mark('downstreams');
		publisher.mark('rowsStats');
		publisher.attachRiders({ selectedRows: { sha0: true } });
		await publisher.flush(); // no-op while held
		assert.strictEqual(host.sent.length, 1);

		publisher.release();
		await tick();
		assert.strictEqual(host.sent.length, 2, 'release flushes exactly once');
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });
		assert.ok(host.last.rowsStats?.sha0, 'the coalesced delta carries every held mark');
		assert.deepStrictEqual(
			host.last.selectedRows,
			{ sha0: true },
			'the rider attached during the hold rides the release flush',
		);

		publisher.dispose();
	});

	test('hold is re-entrant: only the depth-zero release flushes', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		publisher.hold();
		publisher.hold();
		data.downstreams.set('origin/main', ['origin/feature']);
		publisher.mark('downstreams');

		publisher.release(); // depth 1 — still held
		await tick();
		assert.strictEqual(host.sent.length, 1, 'a nested hold keeps deferring');

		publisher.release(); // depth 0 — flush
		await tick();
		assert.strictEqual(host.sent.length, 2, 'the outermost release flushes once');
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });

		publisher.dispose();
	});

	test('a rowsStats-only delta omits downstreams; rows-bearing ticks and snapshots ship it', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		data.downstreams.set('origin/main', ['origin/feature']);
		await publisher.flush(); // snapshot always ships downstreams
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });

		// Enrichment-only tick (rowsStats marked) → downstreams omitted so the webview keeps its prior map.
		data.rowsStats.set('sha0', { additions: 1, deletions: 0, files: 1 });
		publisher.mark('rowsStats');
		await publisher.flush();
		assert.strictEqual(host.last.snapshot ?? false, false);
		assert.ok(host.last.rowsStats?.sha0);
		assert.strictEqual(host.last.downstreams, undefined, 'no downstreams on an enrichment-only tick');

		// A rebuild that marks the downstreams channel (rows + downstreams) re-ships the full map.
		data.rows = [row('new0'), ...rows(5)];
		publisher.mark('rows');
		publisher.mark('downstreams');
		await publisher.flush();
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });

		publisher.dispose();
	});

	test('a rows-only tick omits downstreams — the channel is shipped only when marked', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		data.downstreams.set('origin/main', ['origin/feature']);
		await publisher.flush(); // snapshot ships downstreams
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });

		// A refresh that added rows but did NOT change the upstream→branches map marks ONLY rows: downstreams
		// is omitted (the webview keeps its prior map). Previously a rows mark force-shipped the full map.
		data.rows = [row('new0'), ...rows(5)];
		publisher.mark('rows');
		await publisher.flush();
		assert.strictEqual(host.last.snapshot ?? false, false, 'a delta, not a snapshot');
		assert.ok(
			host.last.rowsSplice != null || (host.last.rows?.length ?? 0) > 0,
			'the rows delta shipped rows (splice or full)',
		);
		assert.strictEqual(host.last.downstreams, undefined, 'a rows-only tick no longer re-ships downstreams');

		// Marking the downstreams channel explicitly ships the full current map.
		data.downstreams.set('origin/main', ['origin/feature', 'origin/other']);
		publisher.mark('downstreams');
		await publisher.flush();
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature', 'origin/other'] });

		publisher.dispose();
	});

	suite('rowsStats channel', () => {
		const stat = (n: number): GraphRowStats => ({ additions: n, deletions: 0, files: 1 });

		test('a growing map ships only the entries added since the last send', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.rowsStats = new Map<string, GraphRowStats>([['sha0', stat(1)]]);
			await publisher.flush(); // snapshot seeds the sent-shas set with {sha0}
			assert.deepStrictEqual(host.last.rowsStats, { sha0: stat(1) });

			// The map grows by one sha → the delta ships only the newly-added entry.
			data.rowsStats = new Map<string, GraphRowStats>([
				['sha0', stat(1)],
				['sha1', stat(2)],
			]);
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.deepStrictEqual(host.last.rowsStats, { sha1: stat(2) }, 'only the newly-added entry');

			publisher.dispose();
		});

		test('a same-size head refresh (membership swapped) ships exactly the new entry', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.rowsStats = new Map<string, GraphRowStats>([
				['sha0', stat(1)],
				['sha1', stat(2)],
			]);
			await publisher.flush(); // snapshot seeds {sha0, sha1}

			// At-limit head refresh: the session REBUILDS the stats map to the trimmed window — same SIZE, but
			// sha0 (bottom) drops and sha2 (new head) is added. A size watermark would ship nothing; sha-tracking
			// ships exactly sha2.
			data.rowsStats = new Map<string, GraphRowStats>([
				['sha1', stat(2)],
				['sha2', stat(3)],
			]);
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.strictEqual(host.last.snapshot ?? false, false, 'a delta, not a snapshot');
			assert.deepStrictEqual(host.last.rowsStats, { sha2: stat(3) }, 'exactly the swapped-in entry');

			publisher.dispose();
		});

		test('a rowsStats tick with nothing new since the snapshot ships nothing', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.rowsStats = new Map<string, GraphRowStats>([['sha0', stat(1)]]);
			await publisher.flush(); // snapshot seeds {sha0}

			// Mark rowsStats (riding a downstreams tick) but the map is unchanged → no rowsStats payload.
			data.downstreams.set('origin/main', ['origin/feature']);
			publisher.mark('downstreams');
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.strictEqual(host.last.snapshot ?? false, false);
			assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });
			assert.strictEqual(
				host.last.rowsStats,
				undefined,
				'no rowsStats payload when nothing new since the snapshot',
			);

			publisher.dispose();
		});

		test('a snapshot reseeds the sent-shas set from the current map', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.rowsStats = new Map<string, GraphRowStats>([['sha0', stat(1)]]);
			await publisher.flush(); // snapshot seeds {sha0}

			data.rowsStats = new Map<string, GraphRowStats>([
				['sha0', stat(1)],
				['sha1', stat(2)],
			]);
			publisher.mark('rowsStats');
			await publisher.flush(); // delta ships sha1; set now {sha0, sha1}
			assert.deepStrictEqual(host.last.rowsStats, { sha1: stat(2) });

			// A recovery snapshot ships the FULL map AND reseeds the set to its keys.
			publisher.requireSnapshot();
			await publisher.flush();
			assert.strictEqual(host.last.snapshot, true);
			assert.deepStrictEqual(host.last.rowsStats, { sha0: stat(1), sha1: stat(2) });

			// A follow-up no-op tick ships nothing (set reseeded to {sha0, sha1}).
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.strictEqual(host.last.rowsStats, undefined, 'set reseeded — nothing new to ship');

			publisher.dispose();
		});

		test('invalidateRowsStats forces a resend of recomputed values (parent-rewriting refresh)', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.rowsStats = new Map<string, GraphRowStats>([['sha0', stat(1)]]);
			await publisher.flush(); // snapshot seeds {sha0}
			assert.deepStrictEqual(host.last.rowsStats, { sha0: stat(1) });

			// The data source recomputes sha0's value (e.g. an unshallow fallback) WITHOUT invalidation —
			// the dedupe correctly skips an already-sent sha, so the new value never ships.
			data.rowsStats = new Map<string, GraphRowStats>([['sha0', stat(99)]]);
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.strictEqual(host.last.snapshot ?? false, false);
			assert.strictEqual(host.last.rowsStats, undefined, 'documents the dedupe: sha0 not reshipped');

			// invalidateRowsStats() clears the sent-set — the next delta reships sha0 with the new value.
			publisher.invalidateRowsStats();
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.deepStrictEqual(host.last.rowsStats, { sha0: stat(99) }, 'sha0 reshipped with the recomputed value');

			publisher.dispose();
		});
	});

	suite('reachability channel', () => {
		test('a same-id tick ships only the newly-appended dictionary/sets entries', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.reachability = { id: 1, dictionary: [reachRef('a'), reachRef('b')], sets: ['x'] };
			await publisher.flush(); // snapshot seeds the reachability cursor with the full table
			assert.deepStrictEqual(host.last.reachabilityTable, {
				id: 1,
				dictionary: [reachRef('a'), reachRef('b')],
				sets: ['x'],
			});

			// Grow the SAME table (same id) — the delta ships only the appended tail.
			data.reachability = { id: 1, dictionary: [reachRef('a'), reachRef('b'), reachRef('c')], sets: ['x', 'y'] };
			publisher.mark('reachability');
			await publisher.flush();
			assert.deepStrictEqual(host.last.reachabilityTable, { id: 1, dictionary: [reachRef('c')], sets: ['y'] });

			publisher.dispose();
		});

		test('a new-id table ships the full table', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.reachability = { id: 1, dictionary: [reachRef('a')], sets: ['x'] };
			await publisher.flush(); // snapshot

			data.reachability = { id: 2, dictionary: [reachRef('p'), reachRef('q')], sets: ['z'] };
			publisher.mark('reachability');
			await publisher.flush();
			assert.deepStrictEqual(host.last.reachabilityTable, {
				id: 2,
				dictionary: [reachRef('p'), reachRef('q')],
				sets: ['z'],
			});

			publisher.dispose();
		});

		test('a no-append reachability tick ships nothing on that channel', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.reachability = { id: 1, dictionary: [reachRef('a')], sets: ['x'] };
			await publisher.flush(); // snapshot

			// Mark reachability but nothing appended → payload undefined (cursor kept), even though the delta emits.
			publisher.mark('reachability');
			await publisher.flush();
			assert.strictEqual(host.last.snapshot ?? false, false);
			assert.strictEqual(host.last.reachabilityTable, undefined, 'no reachability payload when nothing appended');

			publisher.dispose();
		});

		test('a snapshot reseeds the reachability cursor', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.reachability = { id: 1, dictionary: [reachRef('a'), reachRef('b')], sets: ['x'] };
			await publisher.flush(); // snapshot #1

			data.reachability = { id: 1, dictionary: [reachRef('a'), reachRef('b'), reachRef('c')], sets: ['x', 'y'] };
			publisher.mark('reachability');
			await publisher.flush(); // delta ships [c]/[y], cursor now at 3/2

			// A recovery snapshot ships the FULL table AND reseeds the cursor to it.
			publisher.requireSnapshot();
			await publisher.flush();
			assert.strictEqual(host.last.snapshot, true);
			assert.deepStrictEqual(host.last.reachabilityTable, {
				id: 1,
				dictionary: [reachRef('a'), reachRef('b'), reachRef('c')],
				sets: ['x', 'y'],
			});

			// A follow-up no-append reachability tick ships nothing (cursor matches the reseeded table).
			publisher.mark('reachability');
			await publisher.flush();
			assert.strictEqual(host.last.reachabilityTable, undefined, 'cursor reseeded — nothing to append');

			publisher.dispose();
		});
	});
});
