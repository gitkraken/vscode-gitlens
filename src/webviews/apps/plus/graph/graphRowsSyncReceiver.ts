/**
 * Webview-side sequencer for the rows-plane publisher's `{generation, seq}` channel (R1c) — the mirror
 * of {@link ../../../plus/graph/graphSyncPublisher.GraphSyncPublisher} on the receiving end.
 *
 * It holds the baseline the webview currently mirrors (the generation + last-applied seq) plus the
 * outstanding-resync dedup flag, and turns each incoming `DidChangeRows` stamp into one of three
 * actions: apply (delta or snapshot), drop (stale replay / duplicate), or resync (a gap or a
 * generation we haven't snapshotted yet). This localizes the per-field clobber guards the old reducer
 * needed into one cursor so the sequencing rules are testable without a DOM/host.
 *
 * The baseline is seeded ONCE from the bootstrap `State.sync` stamp ({@link initFromBootstrap}) and
 * thereafter advanced ONLY by {@link commit} on a successfully-applied message — mid-session full-State
 * pushes also carry `sync`, but the rows channel is the single writer, so their stamp must never move
 * the baseline. Advancing is a separate step from {@link classify} because a splice can still fail its
 * guards after being classified `apply`: the caller applies first, then commits only on success (a
 * failed splice leaves the baseline behind so the follow-up resync is guaranteed to snapshot).
 */
import type { GraphRowsSyncStamp } from '../../../plus/graph/protocol.js';

/** Outcome of classifying an incoming rows-plane message against the held baseline. */
export type RowsSyncOutcome =
	/** Apply the message. `snapshot` = authoritative REPLACE (rebases the generation); else a contiguous
	 *  delta. After a successful apply the caller must call {@link GraphRowsSyncReceiver.commit}. */
	| { action: 'apply'; snapshot: boolean }
	/** Ignore — a stale-generation straggler or an already-applied (duplicate/replayed) seq. */
	| { action: 'drop' }
	/** Ignore — a within-generation gap or a generation ahead of ours; the caller should request one
	 *  (deduped) resync via {@link GraphRowsSyncReceiver.beginResync}. */
	| { action: 'resync' };

export class GraphRowsSyncReceiver {
	/** How long an outstanding resync dedups before {@link beginResync} re-arms and allows a re-send. */
	private static readonly resyncRetryThresholdMs = 10_000;

	private _generation = 0;
	/** Last-applied seq within the current generation; `-1` before the generation's first apply. */
	private _lastApplied = -1;
	private _resyncOutstanding = false;
	private _resyncRequestedAt = 0;

	/** Current generation the webview mirrors. */
	get generation(): number {
		return this._generation;
	}

	/** Last seq applied within the current generation. */
	get lastApplied(): number {
		return this._lastApplied;
	}

	/** Whether a resync request is in flight (dedup). */
	get resyncOutstanding(): boolean {
		return this._resyncOutstanding;
	}

	/**
	 * Seed the baseline from a bootstrap `State.sync` stamp. Call exactly once at init; a mid-session
	 * full-State push also carries `sync`, but MUST NOT call this — the rows channel is the single writer
	 * and re-seeding from a State push would desync the delta sequence.
	 */
	initFromBootstrap(sync: GraphRowsSyncStamp | undefined): void {
		if (sync == null) return;

		this._generation = sync.generation;
		this._lastApplied = sync.seq;
	}

	/**
	 * Classify an incoming rows-plane message. Does NOT advance the baseline — the caller applies the
	 * message first (a splice may still fail its guards) and then calls {@link commit} on success.
	 * `sync` absent (pre-R1b hosts) → `apply` with legacy semantics and no baseline movement.
	 */
	classify(sync: GraphRowsSyncStamp | undefined): RowsSyncOutcome {
		if (sync == null) return { action: 'apply', snapshot: false };
		// Stale generation (post-repo-swap straggler) — drop FIRST, even a snapshot: a repo-A snapshot must
		// never rebase repo-B's baseline. A same-or-newer-generation snapshot still applies unconditionally.
		if (sync.generation < this._generation) return { action: 'drop' };
		if (sync.snapshot) return { action: 'apply', snapshot: true };
		// A generation we haven't snapshotted yet — recover with one resync.
		if (sync.generation > this._generation) return { action: 'resync' };
		// Already applied (transport/replay duplicate) — idempotent drop.
		if (sync.seq <= this._lastApplied) return { action: 'drop' };
		// Within-generation gap — recover with one resync.
		if (sync.seq !== this._lastApplied + 1) return { action: 'resync' };
		return { action: 'apply', snapshot: false };
	}

	/**
	 * Advance the baseline after a message applied successfully. A snapshot rebases BOTH values (its
	 * generation may be new) and clears the outstanding-resync flag; a contiguous delta advances the seq;
	 * a legacy (no-sync) push is a no-op (defensive tolerance).
	 */
	commit(sync: GraphRowsSyncStamp | undefined): void {
		if (sync == null) return;

		this._generation = sync.generation;
		this._lastApplied = sync.seq;
		if (sync.snapshot) {
			this._resyncOutstanding = false;
		}
	}

	/**
	 * Reserve the single outstanding-resync slot for a gap / splice-guard mismatch. Returns true when the
	 * caller should actually send the command, false when one is already in flight (dedup). The flag
	 * clears when a snapshot {@link commit}s.
	 *
	 * Durability: the dedup RE-ARMS once a request has been outstanding past a threshold — a lost resync
	 * command (or a host no-op that trusted a snapshot which was itself the lost message) would otherwise
	 * wedge the channel forever: every later delta gap-drops here and nothing ever clears the flag. Retry
	 * is event-driven (no timer): the next gap-classified message re-triggers the send.
	 */
	beginResync(now: number = Date.now()): boolean {
		if (this._resyncOutstanding && now - this._resyncRequestedAt < GraphRowsSyncReceiver.resyncRetryThresholdMs) {
			return false;
		}

		this._resyncOutstanding = true;
		this._resyncRequestedAt = now;
		return true;
	}
}
