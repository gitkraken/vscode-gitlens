import * as assert from 'assert';
import type { GitGraphRow, GraphReachabilityTable } from '@gitlens/git/models/graph.js';
import { GraphSyncPublisher } from '../graphSyncPublisher.js';
import type { GraphSyncDataSource, GraphSyncHost } from '../graphSyncPublisher.js';
import type {
	DidChangeRowsParams,
	DidSearchParams,
	GraphPaging,
	GraphRefMetadata,
	GraphRowStats,
} from '../protocol.js';

function row(sha: string, options?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: sha,
		parents: [`p-${sha}`],
		author: 'Tester',
		email: 'test@example.com',
		date: 1000,
		message: `commit ${sha}`,
		type: 'commit-node',
		...options,
	};
}

function rows(count: number, prefix = 'sha'): GitGraphRow[] {
	return Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
}

function reachRef(name: string): GraphReachabilityTable['dictionary'][number] {
	return { refType: 'branch', name: name, remote: false };
}

/** Mutable stand-in for the host's `_graph`/`_refsMetadata` — tests mutate the fields directly. */
class FakeData implements GraphSyncDataSource {
	rows: GitGraphRow[] | undefined;
	/** Accumulated-rows mirror; models the host's `_loadedRows`. Falls back to page rows when unset. */
	loadedRows: GitGraphRow[] | undefined;
	avatars = new Map<string, string>();
	downstreams = new Map<string, string[]>();
	rowsStats = new Map<string, GraphRowStats>();
	rowsStatsLoading = false;
	rowsStatsIncluded = false;
	reachability: GraphReachabilityTable | undefined;
	paging: GraphPaging | undefined;
	refsMetadata: ReadonlyMap<string, GraphRefMetadata> | null | undefined = null;
	refsMetadataEnabled = false;

	getRows(): GitGraphRow[] | undefined {
		return this.rows;
	}
	getSnapshotRows(): GitGraphRow[] | undefined {
		return this.loadedRows ?? this.rows;
	}
	getAvatars(): ReadonlyMap<string, string> | undefined {
		return this.avatars;
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
	getRefsMetadata(): ReadonlyMap<string, GraphRefMetadata> | null | undefined {
		return this.refsMetadata;
	}
	isRefsMetadataEnabled(): boolean {
		return this.refsMetadataEnabled;
	}
}

/** Controllable transport: records every emission, can fail or hold `notify` pending. */
class FakeHost implements GraphSyncHost {
	ready = true;
	visible = true;
	ok = true;
	gate = false;
	readonly sent: DidChangeRowsParams[] = [];
	private pending: ((ok: boolean) => void) | undefined;

	isReady(): boolean {
		return this.ready;
	}
	isVisible(): boolean {
		return this.visible;
	}
	notify(params: DidChangeRowsParams): Promise<boolean> {
		this.sent.push(params);
		if (this.gate) {
			return new Promise<boolean>(resolve => {
				this.pending = resolve;
			});
		}
		return Promise.resolve(this.ok);
	}

	release(ok = true): void {
		const resolve = this.pending;
		this.pending = undefined;
		resolve?.(ok);
	}

	get last(): DidChangeRowsParams {
		return this.sent.at(-1)!;
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
		assert.strictEqual(host.last.sync?.snapshot, true);

		host.visible = false;
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		publisher.mark('avatars'); // coalesces
		await publisher.flush();
		assert.strictEqual(host.sent.length, 1, 'no emission while hidden');

		host.visible = true;
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2, 'exactly one delta once visible');
		assert.strictEqual(host.last.sync?.snapshot ?? false, false, 'delta, not a snapshot');
		assert.deepStrictEqual(host.last.avatars, { 'a@example.com': 'url-a' });

		publisher.dispose();
	});

	test('delivery failure marks broken so the next flush is a snapshot', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		host.ok = false;
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2);
		assert.strictEqual(host.last.sync?.snapshot ?? false, false, 'the failed emission was a delta');
		assert.strictEqual(publisher.snapshotRequired, true, 'a failed delivery requires a snapshot');

		host.ok = true;
		await publisher.flush();
		assert.strictEqual(host.sent.length, 3);
		assert.strictEqual(host.last.sync?.snapshot, true, 'recovery is a snapshot');

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
		assert.strictEqual(host.last.sync?.snapshot, true);

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
		assert.strictEqual(host.last.sync?.snapshot, true);
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
		assert.strictEqual(host.last.sync?.snapshot ?? false, false);
		assert.strictEqual(host.last.rows?.length, 800, 'the page-append delta ships only the page');
		assert.strictEqual(host.last.paging?.startingCursor, 'sha799');

		// A recovery snapshot (resync / broken send / webview reload) REPLACES the webview's rows — it MUST
		// carry the full 1600-row accumulated window, or the loaded window is silently truncated to the page.
		publisher.requireSnapshot();
		await publisher.flush();
		assert.strictEqual(host.last.sync?.snapshot, true);
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

	test('a generation bump emits a snapshot with a rebased seq', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(3);

		await publisher.flush(); // snapshot: gen 0, seq 0
		assert.deepStrictEqual({ ...host.last.sync }, { generation: 0, seq: 0, snapshot: true });

		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		await publisher.flush(); // delta: gen 0, seq 1
		assert.strictEqual(host.last.sync?.generation, 0);
		assert.strictEqual(host.last.sync?.seq, 1);

		publisher.onGraphIdentityChanged();
		assert.strictEqual(publisher.generation, 1);
		await publisher.flush();
		assert.deepStrictEqual({ ...host.last.sync }, { generation: 1, seq: 0, snapshot: true });

		publisher.dispose();
	});

	test('snapshot refsMetadata is authoritative: full / null / empty', () => {
		const { publisher, data } = createPublisher();

		// Feature off → explicit null (webview resets, stops requesting).
		data.refsMetadataEnabled = false;
		data.refsMetadata = null;
		assert.strictEqual(publisher.buildSnapshot().refsMetadata, null);

		// Enabled but uninitialized → empty object, never undefined.
		data.refsMetadataEnabled = true;
		data.refsMetadata = undefined;
		assert.deepStrictEqual(publisher.buildSnapshot().refsMetadata, {});

		// Enabled + populated → the full map (never a delta).
		data.refsMetadata = new Map<string, GraphRefMetadata>([
			['branch-1', null],
			['branch-2', null],
		]);
		assert.deepStrictEqual(publisher.buildSnapshot().refsMetadata, { 'branch-1': null, 'branch-2': null });

		publisher.dispose();
	});

	test('N marks coalesce into a single flush', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		data.avatars.set('a@example.com', 'url-a');
		data.rowsStats.set('sha0', { additions: 1, deletions: 0, files: 1 });
		publisher.mark('avatars');
		publisher.mark('rowsStats');
		publisher.mark('avatars');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2, 'three marks produced a single delta');
		assert.deepStrictEqual(host.last.avatars, { 'a@example.com': 'url-a' });
		assert.ok(host.last.rowsStats?.sha0, 'the coalesced delta carries every dirty channel');

		publisher.dispose();
	});

	test('riders ride the next emission and persist until a successful send', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot, no riders attached
		assert.strictEqual(host.last.search, undefined);
		assert.strictEqual(host.last.selectedRows, undefined);

		const search: DidSearchParams = { search: { query: 'foo' }, results: undefined, searchId: 1 };

		// A failed delta carries the riders but must NOT clear them (the send failed).
		host.ok = false;
		data.avatars.set('a@example.com', 'url-a');
		publisher.attachRiders({ search: search, selectedRows: { sha0: true } });
		publisher.mark('avatars');
		await publisher.flush();
		assert.strictEqual(host.sent.length, 2);
		assert.deepStrictEqual(host.last.selectedRows, { sha0: true });
		assert.deepStrictEqual(host.last.search, search);
		assert.strictEqual(publisher.snapshotRequired, true, 'the failed send marked broken');

		// The recovery snapshot re-carries the same riders...
		host.ok = true;
		await publisher.flush();
		assert.strictEqual(host.last.sync?.snapshot, true);
		assert.deepStrictEqual(host.last.selectedRows, { sha0: true }, 'riders re-ride the recovery snapshot');
		assert.deepStrictEqual(host.last.search, search);

		// ...and are cleared after the successful emission.
		data.avatars.set('b@example.com', 'url-b');
		publisher.mark('avatars');
		await publisher.flush();
		assert.strictEqual(host.last.selectedRows, undefined, 'riders cleared after a successful send');
		assert.strictEqual(host.last.search, undefined);

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
		assert.strictEqual(host.last.sync?.snapshot ?? false, false, 'delta, not a snapshot');
		assert.deepStrictEqual(host.last.selectedRows, { sha1: true });

		publisher.dispose();
	});

	test('onResyncRequest no-ops when the webview is already in sync, else snapshots', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot: gen 0, seq 0
		assert.strictEqual(host.sent.length, 1);
		assert.strictEqual(publisher.generation, 0);
		assert.strictEqual(publisher.seq, 0);

		// In-sync request (matching gen+seq, no snapshot pending) → no emission.
		assert.strictEqual(publisher.onResyncRequest(0, 0), 'noop');
		await tick();
		assert.strictEqual(host.sent.length, 1, 'an in-sync resync request is a no-op');

		// A stale seq (webview behind) with a stale-generation report is still answered when the
		// reporting webview's baseline predates this generation's snapshot AND no this-connection
		// snapshot covers it (no onConnectionReady was recorded after the emission here — but the
		// snapshot at seq 0 was emitted with the default watermark (-1), so it DOES cover seq -1).
		assert.strictEqual(publisher.onResyncRequest(0, -1), 'noop');
		await tick();
		assert.strictEqual(host.sent.length, 1, 'a hello satisfied by a this-connection snapshot is a no-op');

		publisher.dispose();
	});

	test('a mark during an in-flight flush triggers a trailing flush', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // snapshot (gate off)
		assert.strictEqual(host.sent.length, 1);

		host.gate = true;
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		const inFlight = publisher.flush(); // builds + emits delta #1, notify held pending
		assert.strictEqual(host.sent.length, 2);

		// Land a new dirty mark while the flush is in flight.
		data.rowsStats.set('sha0', { additions: 1, deletions: 0, files: 1 });
		publisher.mark('rowsStats');

		host.release(true); // resolve delta #1 → finally schedules the trailing flush
		await inFlight;
		await tick();
		assert.strictEqual(host.sent.length, 3, 'the mid-flight mark produced a trailing delta');
		assert.ok(host.last.rowsStats?.sha0);

		host.release(true);
		publisher.dispose();
	});

	test('a snapshot required mid-flight recovers once from the finally, without timer polling', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		await publisher.flush(); // initial snapshot (gate off)
		assert.strictEqual(host.sent.length, 1);

		// Delta #1 in flight, notify held pending.
		host.gate = true;
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		const inFlight = publisher.flush();
		assert.strictEqual(host.sent.length, 2);

		// Mid-flight a snapshot becomes required, and a re-entrant flush lands while one is in flight. It must
		// LATCH a single follow-up (not re-arm the debounce, which would poll while notify is slow/hung), so
		// nothing emits until the in-flight run finishes.
		publisher.requireSnapshot();
		void publisher.flush(); // single-flight return → latches the follow-up
		assert.strictEqual(host.sent.length, 2, 'the latched follow-up does not emit while one is in flight');
		assert.strictEqual(publisher.snapshotRequired, true);

		host.gate = false; // let the follow-up's notify complete
		host.release(true); // delta #1 completes → the finally launches exactly one follow-up flush
		await inFlight;
		await tick();
		assert.strictEqual(host.sent.length, 3, 'the recovery snapshot shipped exactly once, from the finally');
		assert.strictEqual(host.last.sync?.snapshot, true);
		assert.strictEqual(publisher.snapshotRequired, false, 'the snapshot requirement cleared');

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
		assert.strictEqual(host.last.sync?.snapshot, true);
		assert.strictEqual(host.last.rows?.length, 5);

		publisher.dispose();
	});

	test('the boot-time sync-hello no-ops after a this-connection snapshot (no double initial page)', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		publisher.onConnectionReady();
		await publisher.flush(); // the onReady snapshot (seq 0)
		assert.strictEqual(host.sent.length, 1);

		// The webview's hello reports the bootstrap baseline (seq -1) — behind the snapshot, but the
		// snapshot was emitted during THIS connection, so FIFO delivery satisfies it.
		assert.strictEqual(publisher.onResyncRequest(publisher.generation, -1), 'noop');
		await tick();
		assert.strictEqual(host.sent.length, 1, 'no redundant second snapshot');

		publisher.dispose();
	});

	test('an IDENTICAL repeated resync defeats the supersedes-the-baseline no-op (lost-snapshot recovery)', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		publisher.onConnectionReady();
		await publisher.flush(); // the onReady snapshot (seq 0)
		assert.strictEqual(host.sent.length, 1);

		// First behind-baseline resync: the no-op trusts the seq-0 snapshot (FIFO says it arrives).
		assert.strictEqual(publisher.onResyncRequest(publisher.generation, -1), 'noop');
		await tick();
		assert.strictEqual(host.sent.length, 1, 'first request no-ops');

		// The receiver re-sends the SAME request after its retry threshold — the trusted snapshot
		// evidently never landed, so the repeat must be answered with a real snapshot.
		assert.strictEqual(publisher.onResyncRequest(publisher.generation, -1), 'diverged');
		await tick();
		assert.strictEqual(host.sent.length, 2, 'the repeat forces a fresh snapshot');
		assert.strictEqual(host.last.sync?.snapshot, true);

		publisher.dispose();
	});

	test('a prior-connection snapshot cannot satisfy a stale hello — resync snapshots and reports diverged', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		publisher.onConnectionReady();
		await publisher.flush(); // snapshot seq 0
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		await publisher.flush(); // delta seq 1
		assert.strictEqual(host.sent.length, 2);

		// Reconnect: the new connection's watermark is the current seq — the old snapshot (seq 0) predates
		// it and may have been pruned from replay, so a stale hello must force a fresh snapshot.
		publisher.onConnectionReady();
		assert.strictEqual(publisher.onResyncRequest(publisher.generation, -1), 'diverged');
		await tick();
		assert.strictEqual(host.sent.length, 3);
		assert.strictEqual(host.last.sync?.snapshot, true, 'the stale hello was answered with a snapshot');

		publisher.dispose();
	});

	test('a resync while a snapshot is already pending reports pending and coalesces', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(3);

		// Fresh publisher: snapshotRequired is true and nothing has been emitted.
		assert.strictEqual(publisher.onResyncRequest(publisher.generation, -1), 'pending');
		await tick();
		assert.strictEqual(host.sent.length, 1, 'one snapshot total — the resync coalesced into it');
		assert.strictEqual(host.last.sync?.snapshot, true);

		publisher.dispose();
	});

	test('a rider re-attached mid-flight survives the successful send and rides a trailing carrier', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		await publisher.flush(); // snapshot

		const search1: DidSearchParams = { search: { query: 'one' }, results: undefined, searchId: 1 };
		const search2: DidSearchParams = { search: { query: 'two' }, results: undefined, searchId: 2 };

		host.gate = true;
		data.avatars.set('a@example.com', 'url-a');
		publisher.attachRiders({ search: search1 });
		publisher.mark('avatars');
		const inFlight = publisher.flush(); // ships delta #1 carrying search1, notify held pending
		assert.deepStrictEqual(host.last.search, search1);

		// Re-attach a NEW search rider while the send is in flight.
		publisher.attachRiders({ search: search2 });

		host.release(true); // delta #1 succeeds
		await inFlight;
		await tick();

		// The successful send cleared the CAPTURED search1 but not the re-attached search2 — a riders-only
		// pending state, so the trailing re-run fires exactly one carrier for the survivor.
		assert.strictEqual(host.sent.length, 3, 'the surviving rider forced a trailing carrier emission');
		assert.deepStrictEqual(host.last.search, search2);

		publisher.dispose();
	});

	test('a successful send clears only the riders it actually carried', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		await publisher.flush();

		const search: DidSearchParams = { search: { query: 'foo' }, results: undefined, searchId: 1 };
		host.gate = true;
		data.avatars.set('a@example.com', 'url-a');
		publisher.attachRiders({ search: search, selectedRows: { sha0: true } });
		publisher.mark('avatars');
		const inFlight = publisher.flush(); // carries both riders, held
		assert.deepStrictEqual(host.last.search, search);
		assert.deepStrictEqual(host.last.selectedRows, { sha0: true });

		// Re-attach ONLY selectedRows mid-flight (a fresh selection landed); search is untouched.
		publisher.attachRiders({ selectedRows: { sha2: true } });

		host.release(true);
		await inFlight;
		await tick();

		assert.strictEqual(host.last.search, undefined, 'the sent-and-unchanged search rider was cleared');
		assert.deepStrictEqual(host.last.selectedRows, { sha2: true }, 'the re-attached selection survived');

		publisher.dispose();
	});

	test('a generation bump clears any pending riders (stale repo-A envelope never rides repo-B)', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		await publisher.flush();

		publisher.attachRiders({
			search: { search: { query: 'x' }, results: undefined, searchId: 1 },
			selectedRows: { sha0: true },
		});
		// A repo swap bumps the generation before the riders ever shipped.
		publisher.onGraphIdentityChanged();
		await publisher.flush(); // gen-1 snapshot

		assert.strictEqual(host.last.sync?.snapshot, true);
		assert.strictEqual(host.last.search, undefined, 'stale riders do not ride the new-repo snapshot');
		assert.strictEqual(host.last.selectedRows, undefined);

		publisher.dispose();
	});

	test('a post-generation-bump snapshot satisfies a stale hello from the live connection (watermark reset)', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);

		publisher.onConnectionReady();
		await publisher.flush(); // gen 0 snapshot seq 0
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		await publisher.flush(); // gen 0 delta seq 1
		publisher.onConnectionReady(); // watermark = 1

		// Repo swap bumps the generation. The watermark resets to -1 so the gen-1 snapshot (FIFO-delivered
		// to the live connection) can satisfy a stale hello instead of forcing a redundant second snapshot.
		publisher.onGraphIdentityChanged();
		await publisher.flush(); // gen 1 snapshot seq 0
		assert.strictEqual(host.sent.length, 3);

		assert.strictEqual(publisher.onResyncRequest(publisher.generation, -1), 'noop');
		await tick();
		assert.strictEqual(host.sent.length, 3, 'no redundant snapshot — the this-connection snapshot covers it');

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
		assert.strictEqual(host.last.sync?.snapshot, true);

		// Now a held multi-step delta: marks + riders coalesce into one release-driven emission.
		const search: DidSearchParams = { search: { query: 'q' }, results: undefined, searchId: 1 };
		publisher.hold();
		data.avatars.set('a@example.com', 'url-a');
		data.rowsStats.set('sha0', { additions: 1, deletions: 0, files: 1 });
		publisher.mark('avatars');
		publisher.mark('rowsStats');
		publisher.attachRiders({ search: search, selectedRows: { sha0: true } });
		await publisher.flush(); // no-op while held
		assert.strictEqual(host.sent.length, 1);

		publisher.release();
		await tick();
		assert.strictEqual(host.sent.length, 2, 'release flushes exactly once');
		assert.deepStrictEqual(host.last.avatars, { 'a@example.com': 'url-a' });
		assert.ok(host.last.rowsStats?.sha0, 'the coalesced delta carries every held mark');
		assert.deepStrictEqual(host.last.search, search, 'riders attached during the hold ride the release flush');
		assert.deepStrictEqual(host.last.selectedRows, { sha0: true });

		publisher.dispose();
	});

	test('hold is re-entrant: only the depth-zero release flushes', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		await publisher.flush(); // snapshot
		assert.strictEqual(host.sent.length, 1);

		publisher.hold();
		publisher.hold();
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');

		publisher.release(); // depth 1 — still held
		await tick();
		assert.strictEqual(host.sent.length, 1, 'a nested hold keeps deferring');

		publisher.release(); // depth 0 — flush
		await tick();
		assert.strictEqual(host.sent.length, 2, 'the outermost release flushes once');
		assert.deepStrictEqual(host.last.avatars, { 'a@example.com': 'url-a' });

		publisher.dispose();
	});

	test('markRefsMetadataReset ships the full map as an authoritative REPLACE; later deltas merge onto it', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		data.refsMetadataEnabled = true;
		data.refsMetadata = new Map<string, GraphRefMetadata>([['a', null]]);
		await publisher.flush(); // snapshot

		// A repo-level enable/disable: ship the FULL current map + `refsMetadataReset`, never a diff.
		data.refsMetadata = new Map<string, GraphRefMetadata>([['b', null]]);
		publisher.markRefsMetadataReset();
		await publisher.flush();
		assert.strictEqual(host.last.sync?.snapshot ?? false, false, 'the reset rides a delta, not a snapshot');
		assert.strictEqual(host.last.refsMetadataReset, true);
		assert.deepStrictEqual(host.last.refsMetadata, { b: null }, 'the full current map, not a reference-delta');

		// A subsequent refsMetadata change ships only the changed entry with NO reset flag (merge onto the map).
		data.refsMetadata = new Map<string, GraphRefMetadata>([
			['b', null],
			['c', null],
		]);
		publisher.mark('refsMetadata');
		await publisher.flush();
		assert.strictEqual(host.last.refsMetadataReset ?? false, false, 'a plain delta carries no reset flag');
		assert.deepStrictEqual(host.last.refsMetadata, { c: null }, 'only the newly-changed entry');

		publisher.dispose();
	});

	test('a strip REPLACE (integration flip) ships the upstream-preserving map, not an empty wipe', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		data.refsMetadataEnabled = true;

		const upstream = { name: 'main', owner: 'origin', ahead: 2, behind: 1 };
		// Pre-strip: the pill carries BOTH integration-derived PR data and local-git upstream stats.
		data.refsMetadata = new Map<string, GraphRefMetadata>([
			['a', { upstream: upstream, pullRequest: [{ hostingServiceType: 'github', id: 7, title: 'PR' }] }],
		]);
		await publisher.flush(); // snapshot

		// Integration disconnect strips PR (host-side) but PRESERVES upstream, then REPLACEs over the reset channel.
		data.refsMetadata = new Map<string, GraphRefMetadata>([['a', { upstream: upstream }]]);
		publisher.markRefsMetadataReset();
		await publisher.flush();

		assert.strictEqual(host.last.refsMetadataReset, true);
		assert.deepStrictEqual(
			host.last.refsMetadata,
			{ a: { upstream: upstream } },
			'ships the stripped map with upstream intact — never an empty wipe that would blank the counts',
		);

		publisher.dispose();
	});

	test('markRefsMetadataReset while off ships an authoritative null', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		data.refsMetadataEnabled = true;
		data.refsMetadata = new Map<string, GraphRefMetadata>([['a', null]]);
		await publisher.flush(); // snapshot

		// Feature turned off → the reset ships explicit null (webview resets, stops requesting).
		data.refsMetadataEnabled = false;
		data.refsMetadata = null;
		publisher.markRefsMetadataReset();
		await publisher.flush();
		assert.strictEqual(host.last.refsMetadata, null);
		assert.strictEqual(host.last.refsMetadataReset, true);

		publisher.dispose();
	});

	test('an avatars-only delta omits downstreams; rows-bearing ticks and snapshots ship it', async () => {
		const { publisher, host, data } = createPublisher();
		data.rows = rows(5);
		data.downstreams.set('origin/main', ['origin/feature']);
		await publisher.flush(); // snapshot always ships downstreams
		assert.deepStrictEqual(host.last.downstreams, { 'origin/main': ['origin/feature'] });

		// Enrichment-only tick (avatars marked) → downstreams omitted so the webview keeps its prior map.
		data.avatars.set('a@example.com', 'url-a');
		publisher.mark('avatars');
		await publisher.flush();
		assert.strictEqual(host.last.sync?.snapshot ?? false, false);
		assert.deepStrictEqual(host.last.avatars, { 'a@example.com': 'url-a' });
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
		assert.strictEqual(host.last.sync?.snapshot ?? false, false, 'a delta, not a snapshot');
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
			assert.strictEqual(host.last.sync?.snapshot ?? false, false, 'a delta, not a snapshot');
			assert.deepStrictEqual(host.last.rowsStats, { sha2: stat(3) }, 'exactly the swapped-in entry');

			publisher.dispose();
		});

		test('a rowsStats tick with nothing new since the snapshot ships nothing', async () => {
			const { publisher, host, data } = createPublisher();
			data.rows = rows(5);
			data.rowsStats = new Map<string, GraphRowStats>([['sha0', stat(1)]]);
			await publisher.flush(); // snapshot seeds {sha0}

			// Mark rowsStats (riding an avatars tick) but the map is unchanged → no rowsStats payload.
			data.avatars.set('a@example.com', 'url-a');
			publisher.mark('avatars');
			publisher.mark('rowsStats');
			await publisher.flush();
			assert.strictEqual(host.last.sync?.snapshot ?? false, false);
			assert.deepStrictEqual(host.last.avatars, { 'a@example.com': 'url-a' });
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
			assert.strictEqual(host.last.sync?.snapshot, true);
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
			assert.strictEqual(host.last.sync?.snapshot ?? false, false);
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
			assert.strictEqual(host.last.sync?.snapshot ?? false, false);
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
			assert.strictEqual(host.last.sync?.snapshot, true);
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
