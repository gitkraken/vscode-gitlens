import * as assert from 'assert';
import type { GraphRowsSyncStamp } from '../../../../plus/graph/protocol.js';
import { GraphRowsSyncReceiver } from '../graphRowsSyncReceiver.js';

function stamp(generation: number, seq: number, snapshot?: boolean): GraphRowsSyncStamp {
	return snapshot ? { generation: generation, seq: seq, snapshot: true } : { generation: generation, seq: seq };
}

suite('GraphRowsSyncReceiver', () => {
	test('starts at the empty baseline (gen 0, seq -1)', () => {
		const r = new GraphRowsSyncReceiver();
		assert.strictEqual(r.generation, 0);
		assert.strictEqual(r.lastApplied, -1);
		assert.strictEqual(r.resyncOutstanding, false);
	});

	test('initFromBootstrap seeds the baseline from the bootstrap State.sync stamp', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(3, 7));
		assert.strictEqual(r.generation, 3);
		assert.strictEqual(r.lastApplied, 7);
	});

	test('initFromBootstrap with an absent stamp keeps the empty baseline', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(undefined);
		assert.strictEqual(r.generation, 0);
		assert.strictEqual(r.lastApplied, -1);
	});

	test('a seq-contiguous delta applies and advances the baseline', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 0));

		const s = stamp(0, 1);
		assert.deepStrictEqual(r.classify(s), { action: 'apply', snapshot: false });
		r.commit(s);
		assert.strictEqual(r.lastApplied, 1);
		assert.strictEqual(r.generation, 0);
	});

	test('a stale-seq delta (already applied) drops — no baseline movement, no resync', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 5));

		assert.deepStrictEqual(r.classify(stamp(0, 5)), { action: 'drop' }, 'seq == lastApplied');
		assert.deepStrictEqual(r.classify(stamp(0, 3)), { action: 'drop' }, 'seq < lastApplied');
		assert.strictEqual(r.lastApplied, 5, 'baseline unchanged');
		assert.strictEqual(r.resyncOutstanding, false, 'a stale replay must not trigger a resync');
	});

	test('a stale-generation delta drops (post-repo-swap straggler)', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(2, 0));

		assert.deepStrictEqual(r.classify(stamp(1, 99)), { action: 'drop' });
		assert.strictEqual(r.generation, 2, 'baseline generation unchanged');
		assert.strictEqual(r.resyncOutstanding, false);
	});

	test('an outstanding resync re-arms past the retry threshold (lost command / host no-op recovery)', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(1, 3));
		assert.deepStrictEqual(r.classify(stamp(1, 9)), { action: 'resync' });

		const t0 = 1_000_000;
		assert.strictEqual(r.beginResync(t0), true, 'the first gap sends a resync');
		assert.strictEqual(r.beginResync(t0 + 5_000), false, 'deduped within the retry threshold');
		assert.strictEqual(r.beginResync(t0 + 15_000), true, 're-arms past the threshold — the request re-sends');
		assert.strictEqual(r.beginResync(t0 + 16_000), false, 'the re-sent request dedups again');

		// A snapshot still clears the flag as before.
		r.commit(stamp(1, 12, true));
		assert.strictEqual(r.resyncOutstanding, false);
	});

	test('a within-generation gap resyncs, and the dedup emits exactly one request', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 0));

		// seq jumps 0 -> 2: a gap.
		assert.deepStrictEqual(r.classify(stamp(0, 2)), { action: 'resync' });
		assert.strictEqual(r.beginResync(), true, 'the first gap sends a resync');

		// A second gap while the first resync is still outstanding must NOT send again.
		assert.deepStrictEqual(r.classify(stamp(0, 3)), { action: 'resync' });
		assert.strictEqual(r.beginResync(), false, 'deduped — no second send while one is outstanding');

		assert.strictEqual(r.lastApplied, 0, 'a gap never advances the baseline (message dropped)');
	});

	test('a delta from a generation ahead of ours resyncs (missing that generation snapshot)', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 3));

		assert.deepStrictEqual(r.classify(stamp(1, 0)), { action: 'resync' });
		assert.strictEqual(r.lastApplied, 3);
	});

	test('a splice-guard mismatch on a contiguous delta resyncs and leaves the baseline behind', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 3));

		// The delta classifies as a contiguous apply...
		const s = stamp(0, 4);
		assert.deepStrictEqual(r.classify(s), { action: 'apply', snapshot: false });
		// ...but the splice guards fail, so the caller requests a resync and does NOT commit.
		assert.strictEqual(r.beginResync(), true, 'a splice mismatch requests a resync');
		assert.strictEqual(
			r.lastApplied,
			3,
			'no commit on a failed splice — the reported seq stays behind the host so the resync snapshots',
		);
	});

	test('a stale-generation SNAPSHOT drops (a repo-A snapshot must never rebase repo-B)', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(2, 3));

		// The stale-generation drop is classified BEFORE the snapshot branch, so even a snapshot stamped for
		// an older generation (a post-repo-swap straggler) drops instead of rebasing the live baseline.
		assert.deepStrictEqual(r.classify(stamp(1, 0, true)), { action: 'drop' });
		assert.strictEqual(r.generation, 2, 'baseline generation unchanged by a stale snapshot');
		assert.strictEqual(r.lastApplied, 3, 'baseline seq unchanged');
	});

	test('a newer-generation snapshot still applies and rebases unconditionally', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(2, 3));

		const snap = stamp(5, 0, true);
		assert.deepStrictEqual(r.classify(snap), { action: 'apply', snapshot: true });
		r.commit(snap);
		assert.strictEqual(r.generation, 5, 'the newer-generation snapshot rebased the generation');
		assert.strictEqual(r.lastApplied, 0);
	});

	test('a snapshot applies authoritatively, rebases BOTH baseline values, and clears the outstanding resync', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 0));

		// Open an outstanding resync (a gap happened).
		r.beginResync();
		assert.strictEqual(r.resyncOutstanding, true);

		// A snapshot on a NEW generation with an arbitrary (non-contiguous) seq.
		const snap = stamp(1, 4, true);
		assert.deepStrictEqual(r.classify(snap), { action: 'apply', snapshot: true });
		r.commit(snap);

		assert.strictEqual(r.generation, 1, 'generation rebased to the snapshot');
		assert.strictEqual(r.lastApplied, 4, 'seq rebased to the snapshot');
		assert.strictEqual(r.resyncOutstanding, false, 'a snapshot clears the outstanding-resync flag');
	});

	test('a snapshot applies even when its seq is not contiguous with the baseline', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 2));

		const snap = stamp(0, 9, true);
		assert.deepStrictEqual(r.classify(snap), { action: 'apply', snapshot: true });
		r.commit(snap);
		assert.strictEqual(r.lastApplied, 9);
	});

	test('after a snapshot clears the flag, a later gap can resync again', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 0));

		r.beginResync();
		assert.strictEqual(r.beginResync(), false, 'deduped while a resync is outstanding');

		r.commit(stamp(0, 5, true)); // snapshot recovery clears the flag
		assert.strictEqual(r.resyncOutstanding, false);
		assert.strictEqual(r.beginResync(), true, 'a fresh gap after recovery can resync again');
	});

	test('an absent sync stamp applies with legacy semantics and never moves the baseline', () => {
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 4));

		assert.deepStrictEqual(r.classify(undefined), { action: 'apply', snapshot: false });
		r.commit(undefined);
		assert.strictEqual(r.generation, 0);
		assert.strictEqual(r.lastApplied, 4, 'a legacy (no-sync) push does not advance the baseline');
	});

	test('only the rows channel (commit) advances the baseline — a re-delivered bootstrap-seq push drops', () => {
		// Single-writer discipline: a mid-session full-State push also carries `sync` (bootstrap-frozen),
		// but the reducer never routes it through the receiver — only `DidChangeRows` calls `commit`. If
		// such a stamp WERE (wrongly) classified as a delta, it would be a stale replay and drop, never
		// re-seed. This pins that a State-shaped stamp can't rewind/advance the live baseline.
		const r = new GraphRowsSyncReceiver();
		r.initFromBootstrap(stamp(0, 6));
		r.commit(stamp(0, 7)); // one real delta advanced us past bootstrap
		assert.strictEqual(r.lastApplied, 7);

		assert.deepStrictEqual(r.classify(stamp(0, 6)), { action: 'drop' }, 'the bootstrap-frozen seq is stale now');
		assert.strictEqual(r.lastApplied, 7, 'baseline unmoved by a State-shaped stamp');
	});
});
