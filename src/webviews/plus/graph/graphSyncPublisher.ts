/**
 * Rows-plane publisher — the single writer for the graph's rows-plane channels (rows, reachability,
 * rowsStats, downstreams).
 *
 * The recurring graph regression clusters (WIP staleness, enrichment clobber, fingerprint-advance-
 * before-delivery) all trace to the SAME structural flaw: every rows-plane field was written by BOTH
 * its delta channel AND the full-`State` push, so each needed a hand-written clobber guard and a
 * queued channel push could be wiped by a full-state reset. This module removes that dual-writer
 * hazard by construction: it owns the delivery cursors and collapses every divergence (reset,
 * reconnect, resync) to ONE recovery — a full snapshot that atomically reseeds all cursors.
 *
 * Ordering, gap detection, and generations belong to the transport: emissions go out over a
 * Supertalk `SequencedChannel` (`graph:rows`), which stamps `{generation, seq}` and tells the
 * receiver when it missed something. This module owns only the DOMAIN half — what a resync ships,
 * and bumping the generation when it does ({@link resync}, {@link onGraphIdentityChanged}).
 *
 * There is NO message queuing while hidden: {@link mark} only flips a per-channel dirty flag, and
 * {@link flush} computes fresh deltas at flush time from the injected data accessor + the internal
 * cursors. Nothing can be dropped because nothing is buffered — a channel that changed twice before a
 * flush still ships exactly one up-to-date delta.
 *
 * Cursors advance AT EMISSION. Delivery failure is no longer observable here ({@link GraphSyncHost.send}
 * is void), which is deliberate: the two recovery paths that remain — the receiver's gap event driving
 * {@link resync}, and a reconnect (the channel's `disconnect()` bumps the epoch) — both end in a
 * snapshot that reseeds every cursor from scratch, so no cursor skew can survive one.
 *
 * The row splice/ledger encoders are reused verbatim from {@link ./graphRowsSplice.js}; the
 * reachability append and rowsStats sent-set patterns are reproduced here so their cursors live in
 * one place.
 */

import type { GitGraphRow, GraphReachabilityTable } from '@gitlens/git/models/graph.js';
import {
	appendRowsLedger,
	buildRowsLedger,
	buildRowsLedgerFromSplice,
	diffRowsAgainstLedger,
} from './graphRowsSplice.js';
import type { SentRowsLedger } from './graphRowsSplice.js';
import type { GraphPaging, GraphRowsPayload, GraphRowStats, GraphSelectedRows } from './protocol.js';

/** The rows-plane channels the publisher owns a delivery cursor for. */
export type GraphSyncChannel = 'rows' | 'reachability' | 'rowsStats' | 'downstreams';

/** Minimal transport surface — injectable so the publisher is unit-testable without a webview host. */
export interface GraphSyncHost {
	isReady(): boolean;
	isVisible(): boolean;
	/** Post one emission on the `graph:rows` channel. Void by design — see the module header: delivery
	 *  failure is unobservable, and recovery is the receiver-driven {@link GraphSyncPublisher.resync}. */
	send(params: GraphRowsPayload): void;
	/** Bump the channel's epoch so the peer invalidates anything still in flight from the old one.
	 *  Always paired with a forced snapshot — the new generation's first emission must be seq 0. */
	newGeneration(): void;
}

/**
 * Read-only view of the host's current rows-plane data. Mirrors exactly what `notifyDidChangeRows`
 * reads off `_graph`, kept narrow so R1b can wire it trivially.
 */
export interface GraphSyncDataSource {
	getRows(): GitGraphRow[] | undefined;
	/** Accumulated rows for a snapshot: the FULL loaded window, not the page-scoped `_graph.rows` that
	 *  pagination leaves behind. Falls back to page rows when no mirror exists (pre-paging / initial). */
	getSnapshotRows(): GitGraphRow[] | undefined;
	getDownstreams(): ReadonlyMap<string, string[]> | undefined;
	getRowsStats(): ReadonlyMap<string, GraphRowStats> | undefined;
	isRowsStatsLoading(): boolean;
	isRowsStatsIncluded(): boolean;
	getReachability(): GraphReachabilityTable | undefined;
	getPaging(): GraphPaging | undefined;
}

type ReachabilityCursor = { id: number; dictLen: number; setsLen: number };

export interface GraphSyncPublisherOptions {
	/** Debounce window (ms) between {@link mark} and the auto-scheduled flush. */
	debounceMs?: number;
}

export class GraphSyncPublisher {
	private readonly debounceMs: number;

	/** Forces the next emission to be a full snapshot (initial sync, reset/reconnect, resync). */
	private _snapshotRequired = true;
	private readonly _dirty = new Set<GraphSyncChannel>();

	// Delivery cursors — the authoritative record of what the webview currently holds.
	private _ledger: SentRowsLedger | undefined;
	private _reachabilityCursor: ReachabilityCursor | undefined;
	/** Shas whose stats the webview already holds. Stats are immutable per sha, so the delta ships only entries
	 *  NOT in this set — a same-size head refresh (map rebuilt to the trimmed window, membership swapped) still
	 *  ships the new shas a size watermark would miss. Reseeded to the map's keys on a snapshot; cleared on a
	 *  generation bump. */
	private readonly _rowsStatsSent = new Set<string>();

	// The selection rider that must travel atomically WITH the next rows-plane emission. Attached until an
	// emission carries it, then cleared.
	private _riderSelectedRows: GraphSelectedRows | undefined;
	private _ridersPending = false;

	/** Re-entrant flush suspension depth (see {@link hold}). While > 0 nothing is built/sent. */
	private _holdCount = 0;
	private _disposed = false;

	private _flushTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly host: GraphSyncHost,
		private readonly data: GraphSyncDataSource,
		options?: GraphSyncPublisherOptions,
	) {
		this.debounceMs = options?.debounceMs ?? 16;
	}

	/** Whether the next flush will emit a full snapshot. */
	get snapshotRequired(): boolean {
		return this._snapshotRequired;
	}

	dispose(): void {
		this._disposed = true;
		this.cancelScheduledFlush();
	}

	/** Flag a channel dirty; schedules a debounced flush unless held. */
	mark(channel: GraphSyncChannel): void {
		this._dirty.add(channel);
		if (this._holdCount > 0) return;

		this.scheduleFlush();
	}

	/**
	 * Suspend flushing so a multi-step host update (setGraph → await → attach riders) ships as ONE atomic
	 * emission. Re-entrant: nest freely. While held, {@link mark} won't schedule and {@link flush} cancels
	 * any timer and no-ops (all pending flags — dirty, riders, snapshot — persist). {@link release} at depth
	 * zero flushes once if anything is pending.
	 */
	hold(): void {
		this._holdCount++;
	}

	release(): void {
		if (this._holdCount === 0) return;

		this._holdCount--;
		if (this._holdCount > 0) return;

		if (this._dirty.size > 0 || this._ridersPending || this._snapshotRequired) {
			void this.flush();
		}
	}

	/**
	 * Attach a selection rider to the NEXT emission (delta or snapshot), preserving the atomicity envelope
	 * the old rows push had. Provided keys overwrite; omitted keys keep any pending rider. Riders clear once
	 * an emission carries them. Does NOT schedule a flush on its own; the accompanying {@link mark}/
	 * {@link flush} drives it.
	 */
	attachRiders(riders: { selectedRows?: GraphSelectedRows }): void {
		if ('selectedRows' in riders) {
			this._riderSelectedRows = riders.selectedRows;
		}
		// Pending only when a rider is actually present (mirrors the post-send re-derivation in `doFlush`) — an
		// all-undefined attach must not force an otherwise-empty emission.
		this._ridersPending = this._riderSelectedRows !== undefined;
	}

	/** Force the next rowsStats emission to resend every entry — a parent-rewriting refresh
	 *  (unshallow / replace-ref change) recomputes stats for shas the webview already holds. */
	invalidateRowsStats(): void {
		this._rowsStatsSent.clear();
	}

	/** Graph identity changed (repo swap / graph clear): bump the channel's epoch, force a snapshot. The
	 *  epoch announcement and the snapshot that follows it ride the same wire in that order, so the
	 *  receiver invalidates the old repo's in-flight deltas before the new repo's seq 0 lands. */
	onGraphIdentityChanged(): void {
		this.host.newGeneration();
		// New graph identity — the webview holds no stats for it yet; the forced snapshot below reseeds the set.
		this._rowsStatsSent.clear();
		// A stale repo-A rider envelope must not ride repo-B's snapshot.
		this._riderSelectedRows = undefined;
		this._ridersPending = false;
		this.requireSnapshot();
	}

	/** Force the next emission to a snapshot and schedule a flush (reset / reconnect / resync). */
	requireSnapshot(): void {
		this._snapshotRequired = true;
		this.scheduleFlush();
	}

	/**
	 * The rows plane's ONE domain recovery: the webview's mirror diverged (a channel gap, or a splice
	 * guard that failed), so bump the epoch — invalidating anything still in flight — and re-ship a full
	 * snapshot at seq 0. Resolves once that snapshot has been posted; when the webview is hidden or not
	 * ready the requirement is simply latched for the next flush.
	 */
	resync(): Promise<void> {
		this.host.newGeneration();
		this.requireSnapshot();
		return this.flush();
	}

	/**
	 * Visibility/ready-gated flush. Builds one {@link GraphRowsPayload} (snapshot when required, else the
	 * dirty-channel deltas) and posts it, advancing cursors as it builds. Synchronous end to end — the
	 * channel's `send` is void — so there is no in-flight window for a mark or a rider to land in; the
	 * returned promise exists only so callers can `await` "the emission has been posted".
	 */
	flush(): Promise<void> {
		if (this._disposed) return Promise.resolve();

		this.cancelScheduledFlush();

		// Held for an atomic multi-step update: keep every pending flag; `release` re-drives the flush.
		if (this._holdCount > 0) return Promise.resolve();

		// Not ready/visible: leave the dirty flags (and any snapshot requirement) intact — a later flush
		// picks them up. Nothing is buffered, so nothing is lost.
		if (!this.host.isReady() || !this.host.isVisible()) return Promise.resolve();

		this.doFlush();
		return Promise.resolve();
	}

	private doFlush(): void {
		let params: GraphRowsPayload;
		if (this._snapshotRequired) {
			// No graph yet (a deferred bootstrap still building): an "empty" snapshot here would clear the
			// webview's loading state and flash "No commits" before the real rows land. Keep the snapshot
			// requirement; the `setGraph` marks re-trigger the flush once rows exist. (A genuinely empty
			// repo has a graph with zero rows — `getRows()` returns `[]`, not undefined — and snapshots.)
			if (this.data.getRows() == null) return;

			params = this.buildSnapshot();
		} else {
			// Nothing dirty and no rider waiting for an envelope → nothing to ship.
			if (this._dirty.size === 0 && !this._ridersPending) return;

			params = this.buildDelta(this._dirty);
			this._dirty.clear();
		}

		if (this._ridersPending) {
			params.selectedRows = this._riderSelectedRows;
			this._riderSelectedRows = undefined;
			this._ridersPending = false;
		}

		this.host.send(params);
	}

	/**
	 * Assemble the authoritative rows-plane snapshot: full rows, reachability, rowsStats (+loading/
	 * included), and downstreams. Flags itself `snapshot: true` and atomically reseeds ALL cursors so the
	 * ledger exactly mirrors what the webview will hold.
	 */
	buildSnapshot(): GraphRowsPayload {
		// The accumulated window the webview holds — NOT `getRows()`, which is page-scoped after paging.
		// A snapshot is an authoritative REPLACE, so shipping only the last page would truncate the webview.
		const rows = this.data.getSnapshotRows() ?? [];
		const table = this.data.getReachability();
		const rowsStats = this.data.getRowsStats();
		const downstreams = this.data.getDownstreams();

		// Reseed cursors to the full snapshot — the ledger mirrors the webview's held rows exactly.
		this._ledger = buildRowsLedger(rows);
		this._reachabilityCursor =
			table != null ? { id: table.id, dictLen: table.dictionary.length, setsLen: table.sets.length } : undefined;
		// Reseed the sent-shas set to the full snapshot's keys — the webview holds exactly these after a REPLACE.
		this._rowsStatsSent.clear();
		if (rowsStats != null) {
			for (const sha of rowsStats.keys()) {
				this._rowsStatsSent.add(sha);
			}
		}
		this._dirty.clear();
		this._snapshotRequired = false;

		return {
			rows: rows,
			rowsSplice: undefined,
			reachabilityTable:
				table != null ? { id: table.id, dictionary: table.dictionary, sets: table.sets } : undefined,
			// A snapshot always ships the full downstreams (reset-anchor); deltas ship it only on rows-bearing ticks.
			downstreams: downstreams != null ? Object.fromEntries(downstreams) : {},
			rowsStats: rowsStats != null ? Object.fromEntries(rowsStats) : undefined,
			// The always-fields carry a cursor-less `paging` — a snapshot wholesale-REPLACES rows regardless
			// of the current page state.
			...this.buildAlwaysFields(),
			snapshot: true,
		};
	}

	/** Fields every rows-plane emission carries: the stats loading/included flags plus a cursor-less
	 *  `paging` default (the page-append branch in {@link fillRowsDelta} overwrites `paging`). Shared by
	 *  {@link buildSnapshot} and {@link buildDelta} so the two can't drift. */
	private buildAlwaysFields(): { rowsStatsLoading: boolean; rowsStatsIncluded: boolean; paging: GraphPaging } {
		return {
			rowsStatsLoading: this.data.isRowsStatsLoading(),
			rowsStatsIncluded: this.data.isRowsStatsIncluded(),
			paging: { startingCursor: undefined, hasMore: this.data.getPaging()?.hasMore ?? false },
		};
	}

	/** Build a delta carrying only the dirty channels; unmarked channels ship their "keep" sentinel. */
	private buildDelta(dirty: ReadonlySet<GraphSyncChannel>): GraphRowsPayload {
		// `paging` (always shipped) rides via `buildAlwaysFields`: the reducer unconditionally adopts
		// `params.paging`, so omitting it would blank the webview's `hasMore`. Cursor-less by default; the
		// page-append branch in `fillRowsDelta` overwrites it with the page's starting cursor.
		const params: GraphRowsPayload = {
			rows: [],
			...this.buildAlwaysFields(),
		};

		// `downstreams` rides ONLY when its own channel is marked — the host now marks it precisely (a refresh
		// marks it only when the upstream→branches map actually changed; a page/initial/reuse marks it along
		// with everything else). It has no size-watermark (the provider rebuilds the map each walk), so it
		// ships the full map when marked; absent = the webview keeps its prior map. Decoupled from `rows` so a rows-only refresh no longer re-ships an unchanged map.
		if (dirty.has('downstreams')) {
			const downstreams = this.data.getDownstreams();
			params.downstreams = downstreams != null ? Object.fromEntries(downstreams) : {};
		}

		if (dirty.has('rows')) {
			this.fillRowsDelta(params);
		}
		if (dirty.has('reachability')) {
			const { payload, cursor } = this.buildReachabilityDelta(this.data.getReachability());
			params.reachabilityTable = payload;
			this._reachabilityCursor = cursor;
		}
		if (dirty.has('rowsStats')) {
			const rowsStats = this.data.getRowsStats();
			if (rowsStats != null) {
				// Stats are immutable per sha — ship exactly the entries the webview doesn't hold yet (tracked by
				// sha, so an at-limit head refresh that swaps membership without growing still ships the new shas).
				// The reducer spread-merges, so a partial map is additive. Cursor advances optimistically at build.
				// A parent-rewriting refresh (unshallow / replace-ref change) recomputes stats for already-shipped
				// shas — the host clears the sent-set via `invalidateRowsStats()` first so those still ship.
				let delta: Record<string, GraphRowStats> | undefined;
				for (const [sha, stats] of rowsStats) {
					if (this._rowsStatsSent.has(sha)) continue;

					(delta ??= {})[sha] = stats;
					this._rowsStatsSent.add(sha);
				}
				if (delta != null) {
					params.rowsStats = delta;
				}
			}
		}

		return params;
	}

	/** Rows channel: cursor-less pushes splice against the ledger; a page append ships the page rows. */
	private fillRowsDelta(params: GraphRowsPayload): void {
		const rows = this.data.getRows() ?? [];
		const paging = this.data.getPaging();
		const cursor = paging?.startingCursor;

		if (cursor == null) {
			// Wholesale REPLACE — ship a splice when a worthwhile suffix is reusable, else the full rows.
			const priorLedger = this._ledger;
			const splice = priorLedger != null ? diffRowsAgainstLedger(rows, priorLedger) : undefined;
			if (splice != null && priorLedger != null) {
				params.rows = [];
				params.rowsSplice = splice;
				// Reuse the diff's own fingerprints for the (usually large) reused span instead of
				// re-stringifying every row via `buildRowsLedger` — only the changed head/tail need it.
				this._ledger = buildRowsLedgerFromSplice(priorLedger, splice);
			} else {
				params.rows = rows;
				// The webview now holds the full fresh rows — no reusable splice to build the ledger from.
				this._ledger = buildRowsLedger(rows);
			}
		} else {
			// Page append — ship the page and mirror the reducer's cursor-anchored concatenation.
			params.rows = rows;
			params.paging = { startingCursor: cursor, hasMore: paging?.hasMore ?? false };
			if (this._ledger != null) {
				this._ledger = appendRowsLedger(this._ledger, cursor, rows);
			}
			// No ledger to append onto (a page with no recorded base): leave it unset; the next
			// cursor-less send reseeds it. A page-built ledger would silently miss the window above it.
		}
	}

	/**
	 * Reachability append-delta: the table is append-only within a generation (`id`), so a same-`id`
	 * push ships only the entries appended since the cursor; a new `id` ships the full table.
	 */
	private buildReachabilityDelta(table: GraphReachabilityTable | undefined): {
		payload: GraphReachabilityTable | undefined;
		cursor: ReachabilityCursor | undefined;
	} {
		if (table == null) return { payload: undefined, cursor: this._reachabilityCursor };

		const cursor: ReachabilityCursor = {
			id: table.id,
			dictLen: table.dictionary.length,
			setsLen: table.sets.length,
		};
		const last = this._reachabilityCursor;
		if (last?.id === table.id) {
			const dictionary = table.dictionary.slice(last.dictLen);
			const sets = table.sets.slice(last.setsLen);
			// Nothing appended since the cursor → ship nothing, keep the cursor.
			if (!dictionary.length && !sets.length) return { payload: undefined, cursor: last };

			return { payload: { id: table.id, dictionary: dictionary, sets: sets }, cursor: cursor };
		}

		// New generation (or first send) → full table.
		return { payload: { id: table.id, dictionary: table.dictionary, sets: table.sets }, cursor: cursor };
	}

	private scheduleFlush(): void {
		if (this._flushTimer != null) return;

		this._flushTimer = setTimeout(() => {
			this._flushTimer = undefined;
			void this.flush();
		}, this.debounceMs);
	}

	private cancelScheduledFlush(): void {
		if (this._flushTimer != null) {
			clearTimeout(this._flushTimer);
			this._flushTimer = undefined;
		}
	}
}
