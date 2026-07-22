/**
 * Sequenced rows-plane publisher — the single writer for the graph's rows-plane channels (rows,
 * reachability, rowsStats, avatars, downstreams, refsMetadata).
 *
 * The recurring graph regression clusters (WIP staleness, refsMetadata clobber, fingerprint-advance-
 * before-delivery) all trace to the SAME structural flaw: every rows-plane field was written by BOTH
 * its delta channel AND the full-`State` push, so each needed a hand-written clobber guard and a
 * queued channel push could be wiped by a full-state reset. This module removes that dual-writer
 * hazard by construction: it owns the delivery cursors, stamps every emission with `{generation,
 * seq}`, and collapses every divergence (delivery failure, reset, reconnect, resync) to ONE recovery
 * — a full snapshot on the same channel that atomically reseeds all cursors.
 *
 * There is NO message queuing while hidden: {@link mark} only flips a per-channel dirty flag, and
 * {@link flush} computes fresh deltas at flush time from the injected data accessor + the internal
 * cursors. Nothing can be dropped because nothing is buffered — a channel that changed twice before a
 * flush still ships exactly one up-to-date delta.
 *
 * Cursors advance AT EMISSION (optimistically), not on confirmed delivery: a failed `notify` forces
 * {@link markBroken}, so the next flush is a snapshot that reseeds everything from scratch — the one
 * recovery path. This is simpler than the confirmed-delivery model it replaces and is correct because
 * a snapshot rebases the webview's generation+seq regardless of any cursor skew a failure introduced.
 *
 * The row splice/ledger encoders are reused verbatim from {@link ./graphRowsSplice.js}; the
 * reachability append, rowsStats/avatars size-watermark, and refsMetadata reference-delta patterns
 * are reproduced here so their cursors live in one place.
 */

import type { GitGraphRow, GraphReachabilityTable } from '@gitlens/git/models/graph.js';
import {
	appendRowsLedger,
	buildRowsLedger,
	buildRowsLedgerFromSplice,
	diffRowsAgainstLedger,
} from './graphRowsSplice.js';
import type { SentRowsLedger } from './graphRowsSplice.js';
import type {
	DidChangeRowsParams,
	DidSearchParams,
	GraphPaging,
	GraphRefMetadata,
	GraphRefsMetadata,
	GraphRowStats,
	GraphSelectedRows,
} from './protocol.js';

/** The rows-plane channels the publisher owns a delivery cursor for. */
export type GraphSyncChannel = 'rows' | 'reachability' | 'rowsStats' | 'avatars' | 'downstreams' | 'refsMetadata';

/** Minimal transport surface — injectable so the publisher is unit-testable without a webview host. */
export interface GraphSyncHost {
	isReady(): boolean;
	isVisible(): boolean;
	notify(params: DidChangeRowsParams): Promise<boolean>;
}

/**
 * Read-only view of the host's current rows-plane data. Mirrors exactly what `notifyDidChangeRows`
 * and `getState` read off `_graph`/`_refsMetadata` today, kept narrow so R1b can wire it trivially.
 */
export interface GraphSyncDataSource {
	getRows(): GitGraphRow[] | undefined;
	/** Accumulated rows for a snapshot: the FULL loaded window, not the page-scoped `_graph.rows` that
	 *  pagination leaves behind. Falls back to page rows when no mirror exists (pre-paging / initial). */
	getSnapshotRows(): GitGraphRow[] | undefined;
	getAvatars(): ReadonlyMap<string, string> | undefined;
	getDownstreams(): ReadonlyMap<string, string[]> | undefined;
	getRowsStats(): ReadonlyMap<string, GraphRowStats> | undefined;
	isRowsStatsLoading(): boolean;
	isRowsStatsIncluded(): boolean;
	getReachability(): GraphReachabilityTable | undefined;
	getPaging(): GraphPaging | undefined;
	/** Live refsMetadata map: `null` = feature off, `undefined` = enabled-but-uninitialized, else the map. */
	getRefsMetadata(): ReadonlyMap<string, GraphRefMetadata> | null | undefined;
	/** Whether refsMetadata is populatable at all (drives snapshot `null` vs `{}`; see `isRefsMetadataEnabled`). */
	isRefsMetadataEnabled(): boolean;
}

type ReachabilityCursor = { id: number; dictLen: number; setsLen: number };

export interface GraphSyncPublisherOptions {
	/** Debounce window (ms) between {@link mark} and the auto-scheduled flush. */
	debounceMs?: number;
}

export class GraphSyncPublisher {
	private readonly debounceMs: number;

	private _generation = 0;
	/** Last emitted seq within the current generation; `-1` before the generation's first emission. */
	private _seq = -1;
	/** Forces the next emission to be a full snapshot (initial sync, reset/reconnect, resync, broken delivery). */
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
	private _avatarsSizeCursor = 0;
	private _refsMetadataCursor: Map<string, GraphRefMetadata> | undefined;

	// Riders that must travel atomically WITH the next rows-plane emission (the search-results/selection
	// envelope the old `notifyDidChangeRows` carried). Attached until an emission SUCCEEDS, then cleared;
	// a failed emission keeps them so the recovery snapshot re-carries them.
	private _riderSearch: DidSearchParams | undefined;
	private _riderSelectedRows: GraphSelectedRows | undefined;
	private _ridersPending = false;

	/** A refsMetadata reset REPLACE is queued (see {@link markRefsMetadataReset}): the next refsMetadata
	 *  emission ships the FULL map + `refsMetadataReset`, not a spread-merge delta. Cleared on a successful
	 *  reset/snapshot send. */
	private _refsMetadataResetPending = false;

	/** Re-entrant flush suspension depth (see {@link hold}). While > 0 nothing is built/sent. */
	private _holdCount = 0;
	private _disposed = false;

	/** Seq of the last snapshot emitted in the current generation; `-1` when none has been. */
	private _lastSnapshotSeq = -1;
	/** The seq at the moment the current webview connection became ready — emissions after this point are
	 *  FIFO-guaranteed to reach the live webview, so they can satisfy a stale-baseline hello. */
	private _seqAtConnectionReady = -1;

	private _flushing: Promise<void> | undefined;
	private _flushTimer: ReturnType<typeof setTimeout> | undefined;
	/** A snapshot became required while a flush was in flight — launch exactly one follow-up from the flush's
	 *  `finally` (never re-arm the timer, which would poll every debounce interval while `notify` is slow). */
	private _reflushAfterInflight = false;

	constructor(
		private readonly host: GraphSyncHost,
		private readonly data: GraphSyncDataSource,
		options?: GraphSyncPublisherOptions,
	) {
		this.debounceMs = options?.debounceMs ?? 16;
	}

	/** Current graph-identity generation stamped on emissions. */
	get generation(): number {
		return this._generation;
	}

	/** Last emitted seq within the current generation. */
	get seq(): number {
		return this._seq;
	}

	/** Whether the next flush will emit a full snapshot. */
	get snapshotRequired(): boolean {
		return this._snapshotRequired;
	}

	dispose(): void {
		this._disposed = true;
		this.cancelScheduledFlush();
	}

	/** Flag a channel dirty; schedules a debounced flush unless one is already in flight or held. */
	mark(channel: GraphSyncChannel): void {
		this._dirty.add(channel);
		if (this._holdCount > 0) return;

		if (this._flushing == null) {
			this.scheduleFlush();
		}
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
	 * Attach search-results/selection riders to the NEXT emission (delta or snapshot), preserving the
	 * atomicity envelope the old rows push had. Provided keys overwrite; omitted keys keep any pending
	 * rider. Riders persist until an emission succeeds ({@link GraphSyncHost.notify} returns true), then
	 * clear — so a failed send's recovery snapshot re-carries them. Does NOT schedule a flush on its own;
	 * the accompanying {@link mark}/{@link flush} drives it.
	 */
	attachRiders(riders: { search?: DidSearchParams; selectedRows?: GraphSelectedRows }): void {
		if ('search' in riders) {
			this._riderSearch = riders.search;
		}
		if ('selectedRows' in riders) {
			this._riderSelectedRows = riders.selectedRows;
		}
		// Pending only when a rider is actually present (mirrors the post-send re-derivation in `doFlush`) — an
		// all-undefined attach (e.g. a no-search reconnect) must not force an otherwise-empty emission.
		this._ridersPending = this._riderSearch !== undefined || this._riderSelectedRows !== undefined;
	}

	/** Force the next avatars emission to ship the full map even if the Map size is unchanged (the avatar
	 *  proxy replaces values for existing keys — same size, new data URIs). */
	invalidateAvatars(): void {
		this._avatarsSizeCursor = -1;
	}

	/** Force the next rowsStats emission to resend every entry — a parent-rewriting refresh
	 *  (unshallow / replace-ref change) recomputes stats for shas the webview already holds. */
	invalidateRowsStats(): void {
		this._rowsStatsSent.clear();
	}

	/** Graph identity changed (repo swap / graph clear): bump generation, rebase seq, force a snapshot. */
	onGraphIdentityChanged(): void {
		this._generation++;
		this._seq = -1;
		this._lastSnapshotSeq = -1;
		// New graph identity — the webview holds no stats for it yet; the forced snapshot below reseeds the set.
		this._rowsStatsSent.clear();
		// The live connection predates this bump — every new-generation emission is FIFO-delivered to it, so
		// no watermark can vouch for a pre-bump baseline; reset it fail-safe.
		this._seqAtConnectionReady = -1;
		// A stale repo-A rider envelope must not ride repo-B's snapshot.
		this._riderSearch = undefined;
		this._riderSelectedRows = undefined;
		this._ridersPending = false;
		this.requireSnapshot();
	}

	/**
	 * Queue an authoritative refsMetadata REPLACE over the sequenced channel (repo-level enable/disable
	 * that the spread-merge delta can't express). The next flush ships the FULL current map (or explicit
	 * `null` when off) with `refsMetadataReset: true` and reseeds the cursor to match; cleared on a
	 * successful send. A failed send is covered by the snapshot recovery path (snapshots are already
	 * authoritative REPLACEs).
	 */
	markRefsMetadataReset(): void {
		this._refsMetadataResetPending = true;
		this.mark('refsMetadata');
	}

	/** A webview connection became ready (boot / reconnect). Records the seq watermark separating "may
	 *  have been lost with a previous connection" from "FIFO-guaranteed to reach this webview". */
	onConnectionReady(): void {
		this._seqAtConnectionReady = this._seq;
	}

	/** Force the next emission to a snapshot and schedule a flush (reset / reconnect / resync). */
	requireSnapshot(): void {
		this._snapshotRequired = true;
		this.scheduleFlush();
	}

	/** Delivery failed: force the next flush to a snapshot. Does NOT auto-reflush (avoids a hot loop on
	 *  a persistently failing transport); the next external trigger recovers. */
	markBroken(): void {
		this._snapshotRequired = true;
	}

	/** The last resync request answered `'noop'` on the supersedes-the-baseline branch — a REPEAT of the
	 *  same request means the snapshot that branch trusted never arrived (see onResyncRequest). */
	private _lastSupersededResync: { generation: number; seq: number } | undefined;

	/**
	 * The webview asked to resync (a seq gap, a guard mismatch, or the post-bootstrap sync-hello). Returns
	 * what happened so the caller can log genuine divergences:
	 * - `'noop'` — already reconciled: exact baseline match, OR a snapshot emitted DURING this connection
	 *   already supersedes the reported baseline (FIFO delivery guarantees it arrives — this is what makes
	 *   the boot-time hello free instead of double-shipping the initial page).
	 * - `'pending'` — a snapshot was already required (initial sync / broken delivery); the request
	 *   coalesces into it.
	 * - `'diverged'` — a previously-in-sync webview genuinely diverged; a fresh snapshot was forced.
	 *
	 * Durability: the supersedes-the-baseline no-op trusts a snapshot ALREADY SENT on this connection. If
	 * that very snapshot is what went missing, the receiver re-sends the SAME request after its retry
	 * threshold — so an identical repeat is treated as proof of non-delivery and answered with a real
	 * snapshot instead of no-op'ing forever.
	 */
	onResyncRequest(generation: number, seq: number): 'noop' | 'pending' | 'diverged' {
		if (generation === this._generation && !this._snapshotRequired) {
			if (seq === this._seq) return 'noop';
			if (this._lastSnapshotSeq > seq && this._lastSnapshotSeq > this._seqAtConnectionReady) {
				const last = this._lastSupersededResync;
				if (last == null || last.generation !== generation || last.seq !== seq) {
					this._lastSupersededResync = { generation: generation, seq: seq };
					return 'noop';
				}
				// Identical repeat — the trusted snapshot evidently never landed; fall through to snapshot.
			}
		}

		this._lastSupersededResync = undefined;
		const pending = this._snapshotRequired;
		this.requireSnapshot();
		void this.flush();
		return pending ? 'pending' : 'diverged';
	}

	/**
	 * Visibility/ready-gated, single-flight flush with a trailing re-run for marks that land mid-flight.
	 * Builds one {@link DidChangeRowsParams} (snapshot when required, else the dirty-channel deltas) and
	 * ships it. Advances cursors as it builds; a failed `notify` forces the next flush to a snapshot.
	 */
	flush(): Promise<void> {
		if (this._disposed) return Promise.resolve();

		this.cancelScheduledFlush();

		// Held for an atomic multi-step update: keep every pending flag; `release` re-drives the flush.
		if (this._holdCount > 0) return Promise.resolve();

		// Not ready/visible: leave the dirty flags (and any snapshot requirement) intact — a later flush
		// picks them up. Nothing is buffered, so nothing is lost.
		if (!this.host.isReady() || !this.host.isVisible()) return Promise.resolve();

		// Single-flight: coalesce concurrent callers onto the in-flight run. If a snapshot became required
		// mid-flight (e.g. `requireSnapshot` from a resync/identity change), its `scheduleFlush` timer was just
		// cancelled at the top of this call — latch a single follow-up for the in-flight run's `finally` rather
		// than re-arming the timer (which would poll every debounce interval while `notify` is slow/hung). The
		// trailing run below skips this under its `!_snapshotRequired` gate.
		if (this._flushing != null) {
			if (this._snapshotRequired) {
				this._reflushAfterInflight = true;
			}
			return this._flushing;
		}

		const promise = this.doFlush().finally(() => {
			this._flushing = undefined;
			// A snapshot latched mid-flight (see the single-flight branch) launches exactly once here.
			// `markBroken` sets the requirement from INSIDE doFlush — never via a re-entrant flush — so it
			// never latches, preserving the no-hot-loop guarantee on a persistently failing transport.
			const reflushForSnapshot = this._reflushAfterInflight && this._snapshotRequired;
			this._reflushAfterInflight = false;
			// Trailing run for marks/riders that arrived while the flush was in flight, gated on
			// `!_snapshotRequired` for the same no-hot-loop reason.
			if (
				!this._disposed &&
				(reflushForSnapshot || (!this._snapshotRequired && (this._dirty.size > 0 || this._ridersPending)))
			) {
				void this.flush();
			}
		});
		this._flushing = promise;
		return promise;
	}

	private async doFlush(): Promise<void> {
		let params: DidChangeRowsParams | undefined;
		if (this._snapshotRequired) {
			// No graph yet (a deferred bootstrap still building): an "empty" snapshot here would clear the
			// webview's loading state and flash "No commits" before the real rows land. Keep the snapshot
			// requirement; the `setGraph` marks re-trigger the flush once rows exist. (A genuinely empty
			// repo has a graph with zero rows — `getRows()` returns `[]`, not undefined — and snapshots.)
			if (this.data.getRows() == null) return;

			params = this.buildSnapshot();
		} else {
			// Nothing dirty AND no rider waiting for a carrier → nothing to ship.
			if (this._dirty.size === 0 && !this._ridersPending) return;

			params = this.buildDelta(this._dirty);
			this._dirty.clear();
		}

		// Capture the rider values attached to THIS emission so a rider re-attached mid-flight (during the
		// await) survives: on success we clear a field ONLY if it still holds the captured value.
		const ridersSent = this._ridersPending;
		const sentSearch = this._riderSearch;
		const sentSelectedRows = this._riderSelectedRows;
		if (ridersSent) {
			params.search = sentSearch;
			params.selectedRows = sentSelectedRows;
		}

		const ok = await this.host.notify(params);
		if (ok) {
			if (ridersSent) {
				// A failed send keeps the riders so the next (snapshot) emission re-carries the envelope; a
				// rider re-attached mid-flight (new captured value) survives here and rides the next emission.
				if (this._riderSearch === sentSearch) {
					this._riderSearch = undefined;
				}
				if (this._riderSelectedRows === sentSelectedRows) {
					this._riderSelectedRows = undefined;
				}
				this._ridersPending = this._riderSearch !== undefined || this._riderSelectedRows !== undefined;
			}
			// A refsMetadata reset REPLACE landed — delta-flagged, or a snapshot's authoritative full map —
			// so stop re-shipping it.
			if (params.refsMetadataReset || params.sync?.snapshot) {
				this._refsMetadataResetPending = false;
			}
		} else {
			this.markBroken();
		}
	}

	/**
	 * Assemble the authoritative rows-plane snapshot: full rows, reachability, rowsStats (+loading/
	 * included), avatars, downstreams, and refsMetadata (full map / explicit `null` when off / `{}` when
	 * empty — never a delta). Stamps `{generation, seq, snapshot: true}` and atomically reseeds ALL
	 * cursors so the ledger and watermarks exactly mirror what the webview will hold. Also used by
	 * bootstrap (R1b) to seed the webview through the same path.
	 */
	buildSnapshot(): DidChangeRowsParams {
		// The accumulated window the webview holds — NOT `getRows()`, which is page-scoped after paging.
		// A snapshot is an authoritative REPLACE, so shipping only the last page would truncate the webview.
		const rows = this.data.getSnapshotRows() ?? [];
		const table = this.data.getReachability();
		const avatars = this.data.getAvatars();
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
		this._avatarsSizeCursor = avatars?.size ?? 0;

		const refsMetadata = this.serializeRefsMetadata();
		this._refsMetadataCursor = refsMetadata.cursor;

		this._dirty.clear();
		this._snapshotRequired = false;
		const seq = ++this._seq;
		this._lastSnapshotSeq = seq;

		return {
			rows: rows,
			rowsSplice: undefined,
			reachabilityTable:
				table != null ? { id: table.id, dictionary: table.dictionary, sets: table.sets } : undefined,
			avatars: avatars != null ? Object.fromEntries(avatars) : {},
			// A snapshot always ships the full downstreams (reset-anchor); deltas ship it only on rows-bearing ticks.
			downstreams: downstreams != null ? Object.fromEntries(downstreams) : {},
			rowsStats: rowsStats != null ? Object.fromEntries(rowsStats) : undefined,
			refsMetadata: refsMetadata.payload,
			// The always-fields carry a cursor-less `paging` — a snapshot wholesale-REPLACES rows regardless
			// of the current page state.
			...this.buildAlwaysFields(),
			sync: { generation: this._generation, seq: seq, snapshot: true },
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
	private buildDelta(dirty: ReadonlySet<GraphSyncChannel>): DidChangeRowsParams {
		// `paging` (always shipped) rides via `buildAlwaysFields`: the reducer unconditionally adopts
		// `params.paging`, so omitting it would blank the webview's `hasMore`. Cursor-less by default; the
		// page-append branch in `fillRowsDelta` overwrites it with the page's starting cursor.
		const params: DidChangeRowsParams = {
			rows: [],
			avatars: undefined,
			...this.buildAlwaysFields(),
			sync: { generation: this._generation, seq: ++this._seq },
		};

		// `downstreams` rides ONLY when its own channel is marked — the host now marks it precisely (a refresh
		// marks it only when the upstream→branches map actually changed; a page/initial/reuse marks it along
		// with everything else). It has no size-watermark (the provider rebuilds the map each walk), so it
		// ships the full map when marked; absent = the webview keeps its prior map (mirrors avatars
		// keep-if-absent). Decoupled from `rows` so a rows-only refresh no longer re-ships an unchanged map.
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
		if (dirty.has('avatars')) {
			const avatars = this.data.getAvatars();
			const size = avatars?.size ?? 0;
			if (size !== this._avatarsSizeCursor) {
				params.avatars = avatars != null ? Object.fromEntries(avatars) : {};
				this._avatarsSizeCursor = size;
			}
		}
		if (dirty.has('refsMetadata')) {
			if (this._refsMetadataResetPending) {
				// Authoritative REPLACE over the sequenced channel — the FULL current map (or explicit `null`
				// when off), flagged so the reducer REPLACEs instead of spread-merging. Reseed the cursor to match.
				const { payload, cursor } = this.serializeRefsMetadata();
				params.refsMetadata = payload;
				params.refsMetadataReset = true;
				this._refsMetadataCursor = cursor;
			} else {
				const { payload, cursor } = this.buildRefsMetadataDelta(this.data.getRefsMetadata());
				params.refsMetadata = payload;
				this._refsMetadataCursor = cursor;
			}
		}

		return params;
	}

	/** Rows channel: cursor-less pushes splice against the ledger; a page append ships the page rows. */
	private fillRowsDelta(params: DidChangeRowsParams): void {
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

	/**
	 * refsMetadata reference-delta: every update replaces the value with a fresh object (copy-on-write),
	 * so a reference compare against the cursor is an exact delta the webview spread-merges. `null` =
	 * feature off (webview resets); `undefined` = nothing changed (webview keeps).
	 */
	private buildRefsMetadataDelta(metadata: ReadonlyMap<string, GraphRefMetadata> | null | undefined): {
		payload: GraphRefsMetadata | null | undefined;
		cursor: Map<string, GraphRefMetadata> | undefined;
	} {
		if (metadata == null) return { payload: metadata, cursor: undefined };

		const last = this._refsMetadataCursor;
		let delta: GraphRefsMetadata | undefined;
		for (const [id, value] of metadata) {
			if (last?.get(id) !== value) {
				(delta ??= {})[id] = value;
			}
		}
		// Nothing changed since the cursor → ship nothing, keep the cursor.
		if (delta == null) return { payload: undefined, cursor: last };

		return { payload: delta, cursor: new Map(metadata) };
	}

	/**
	 * Authoritative refsMetadata for a snapshot: full map, explicit `null` when the feature is off, or
	 * `{}` when enabled-but-empty — never a delta (a snapshot is a reset-anchor). Also yields the cursor
	 * to reseed alongside it.
	 */
	private serializeRefsMetadata(): {
		payload: GraphRefsMetadata | null;
		cursor: Map<string, GraphRefMetadata> | undefined;
	} {
		if (!this.data.isRefsMetadataEnabled()) return { payload: null, cursor: undefined };

		const metadata = this.data.getRefsMetadata();
		return {
			payload: metadata == null ? {} : Object.fromEntries(metadata),
			cursor: new Map(metadata ?? []),
		};
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
