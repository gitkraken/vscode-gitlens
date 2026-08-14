import type { CancellationToken } from 'vscode';
import { CancellationTokenSource } from 'vscode';
import { GitSearchError } from '@gitlens/git/errors.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSearch } from '@gitlens/git/models/graphSearch.js';
import type { GitGraphSession, GitGraphSessionChangedChannels } from '@gitlens/git/models/graphSession.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { CoalescedRun } from '@gitlens/utils/coalescedRun.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { count, find, last } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { Stopwatch } from '@gitlens/utils/stopwatch.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { toAbortSignal } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { IpcParams, IpcResponse } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { GraphSyncPublisher } from './graphSyncPublisher.js';
import { computeAdaptivePageLimit } from './graphWebview.utils.js';
import { DidChangeNotification, DidSearchNotification, isWipRowId, isWipSelectionSha } from './protocol.js';
import type {
	BranchState,
	CancelLoadRowCommand,
	DidSearchParams,
	GetMoreRowsCommand,
	GraphSelectedRows,
	GraphSyncResyncCommand,
	LoadRowRequest,
	SearchRequest,
	State,
} from './protocol.js';

/** Collaborator surface {@link GraphDataController} reaches for, assembled by
 *  `GraphWebviewProvider.createGraphDataContext()`. The controller now OWNS the data-plane state (graph
 *  session/window, loading promise, session store, in-flight page-in, rows-stats override, and the
 *  state-notify coalescer) as well as its logic; this surface only exposes the collaborators that stay on
 *  the provider — the rows-plane publisher, selection/search/etag reads, sidebar-seq bookkeeping, and the
 *  producer/overview/WIP methods the moved bodies invoke. */
export type GraphDataControllerContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSync: () => GraphSyncPublisher;

	// Selection / search / etag reads.
	getSelectedId: () => string | undefined;
	getSearch: () => GitGraphSearch | undefined;
	getSearchIdCounterCurrent: () => number;
	getEtagRepository: () => number | undefined;
	getConvertedSelectedRows: () => GraphSelectedRows | undefined;

	// Sidebar-seq + branchState (residue, committed by the state coalescer post-rebuild).
	getSidebarEventSeq: () => number;
	getFiredSidebarSeq: () => number;
	setFiredSidebarSeq: (seq: number) => void;
	isBranchStateRevisionCurrent: (revision: number) => boolean;
	commitSentBranchState: (branchState: BranchState, revision: number) => void;

	// Collaborators the moved bodies invoke (stay on the provider).
	buildSearchRider: () => DidSearchParams | undefined;
	buildState: () => Promise<State>;
	resetSearchState: () => void;
	resetRefsMetadata: () => void;
	resetHoverCache: () => void;
	clearAvatarProxyCaches: () => void;
	clearLastSentOverview: () => void;
	cancelComputeIncludedRefs: () => void;
	replayPendingRefMetadataForGraph: (graph: GitGraph) => void;
	searchGraphOrContinue: (
		e: IpcParams<typeof SearchRequest>,
		progressive: boolean,
	) => Promise<IpcResponse<typeof SearchRequest>>;
	notifyDidChangeOverview: () => void;
	notifySidebarInvalidated: () => void;
	notifyDidChangeCanInstallHooks: () => void;
	resetWipSendState: () => void;
	clearWipStatusCache: () => void;
	addPendingNotification: (notification: IpcNotification<any>) => void;
};

/** Shape of the in-flight page-in dedup entry (owned by the controller). */
export type GraphPendingRowsQuery = {
	promise: Promise<void>;
	cancellable: CancellationTokenSource;
	id?: string | undefined;
	search?: GitGraphSearch;
};

/** Host-side graph data plane, split out of `GraphWebviewProvider` (R3). Owns the session-lifecycle
 *  logic (setGraph / paging / rebuild anchor), the rows-plane publisher marks, the avatars channel, and
 *  the concurrency-sensitive state-notify coalescer (refresh×paging serialization, session-identity
 *  guards, pending-query cancellation). It also OWNS the data-plane state (session/window, loading, session
 *  store, page-in, rows-stats override, coalescer) and injects the remaining collaborators via
 *  {@link GraphDataControllerContext}; `getState` (the full-State bootstrap) stays on the provider and
 *  drives this controller for its session/refresh/anchor parts. */
export class GraphDataController {
	// Data-plane state (migrated from the provider in R3 follow-up A). The accumulated graph session/window,
	// the in-flight (re)walk, the page-in dedup entry, the eager rows-stats override, and the state-notify
	// coalescer bookkeeping + its debounced wrappers.
	private _graphSession: GitGraphSession | undefined;
	private _graphLoading: Promise<GitGraph> | undefined;
	private _rowsStatsLoadingOverride = false;
	private _pendingRowsQuery: GraphPendingRowsQuery | undefined;

	private _pendingStateOp: Promise<unknown> | undefined;
	private _lastStateSentAt: number | undefined;
	private _stateFreshnessRetryTimer: ReturnType<typeof setTimeout> | undefined;
	// Trailing run re-enters `notifyDidChangeState`, so rapid-fire dirty marks still coalesce against
	// the freshness gate there.
	private readonly _stateNotify = new CoalescedRun<boolean>(
		() => this.runStateNotify(),
		() => void this.notifyDidChangeState(),
	);
	private _notifyDidChangeStateDebounced: Deferrable<GraphDataController['notifyDidChangeState']> | undefined;
	private _notifyDidChangeAvatarsDebounced: Deferrable<GraphDataController['notifyDidChangeAvatars']> | undefined;

	constructor(private readonly context: GraphDataControllerContext) {}

	private get container(): Container {
		return this.context.container;
	}
	private get host(): WebviewHost<'gitlens.views.graph' | 'gitlens.graph'> {
		return this.context.host;
	}
	private get repository(): GlRepository | undefined {
		return this.context.getRepository();
	}

	// Still provider-owned; reached through the context.
	private get _graphSync(): GraphSyncPublisher {
		return this.context.getSync();
	}
	private get _selectedId(): string | undefined {
		return this.context.getSelectedId();
	}
	private get _search(): GitGraphSearch | undefined {
		return this.context.getSearch();
	}
	private get _etagRepository(): number | undefined {
		return this.context.getEtagRepository();
	}

	/** The active graph session (accumulated window). Provider-facing accessor; internal code uses the field. */
	get session(): GitGraphSession | undefined {
		return this._graphSession;
	}
	set session(value: GitGraphSession | undefined) {
		this._graphSession = value;
	}
	/** The in-flight (re)walk promise. `getGraph` compares its own boxed promise against this for liveness. */
	get loading(): Promise<GitGraph> | undefined {
		return this._graphLoading;
	}
	set loading(value: Promise<GitGraph> | undefined) {
		this._graphLoading = value;
	}
	/** In-flight page-in dedup entry; `getGraph` reads its promise to serialize a refresh against it. */
	get pendingRowsQuery(): GraphPendingRowsQuery | undefined {
		return this._pendingRowsQuery;
	}
	/** Eager Visualizations "stats loading" override; the provider flips it on display-mode change and the
	 *  publisher reads it. */
	get rowsStatsLoadingOverride(): boolean {
		return this._rowsStatsLoadingOverride;
	}
	set rowsStatsLoadingOverride(value: boolean) {
		this._rowsStatsLoadingOverride = value;
	}

	private static readonly stateFreshnessMs = 500;

	/** Mark the rows-plane channels dirty so the next publisher flush re-derives each delta from the current
	 *  graph session. Called wherever new rows land (rebuild via `setGraph(data)`, page-append). The publisher
	 *  decides REPLACE-vs-append per its `getPaging()` at flush time.
	 *
	 *  With `changed` (a refresh reporting exactly which channels it touched) only those channels are marked —
	 *  `refsMetadata` is intentionally NOT among them: the session doesn't produce it, and its real changes are
	 *  marked by the host's own enrichment path (`invalidateUpstreamRefsMetadata`/`onGetMissingRefMetadata` →
	 *  `updateRefsMetadata`), so marking it here would only trigger a redundant reference-scan of the map.
	 *  Without `changed` (page-append / initial walk / reuse) every channel is marked — the page/initial cases
	 *  genuinely touch most channels, and reuse is a harmless over-approximation (unchanged channels ship
	 *  nothing). */
	private markGraphRowsPlaneDirty(changed?: GitGraphSessionChangedChannels): void {
		if (changed == null) {
			this._graphSync.mark('rows');
			this._graphSync.mark('reachability');
			this._graphSync.mark('rowsStats');
			this._graphSync.mark('avatars');
			this._graphSync.mark('downstreams');
			this._graphSync.mark('refsMetadata');
			return;
		}

		if (changed.rows) {
			this._graphSync.mark('rows');
		}
		if (changed.reachability) {
			this._graphSync.mark('reachability');
		}
		if (changed.rowsStats) {
			if (changed.rowsStatsRecomputed) {
				this._graphSync.invalidateRowsStats();
			}
			this._graphSync.mark('rowsStats');
		}
		if (changed.avatars) {
			this._graphSync.mark('avatars');
		}
		if (changed.downstreams) {
			this._graphSync.mark('downstreams');
		}
	}

	@trace()
	updateState(immediate: boolean = false): void {
		// The full-state push no longer carries rows-plane data (the publisher owns it), so there is
		// nothing here to re-seed — and clearing the controller's pending queue would wipe the queued
		// working-tree push (the recurring #5322 staleness). Left intentionally as a plain dispatcher.
		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		this._notifyDidChangeStateDebounced ??= debounce(this.notifyDidChangeState.bind(this), 250);
		void this._notifyDidChangeStateDebounced();
	}

	@trace()
	updateAvatars(immediate: boolean = false): void {
		if (immediate) {
			this.notifyDidChangeAvatars();
			return;
		}

		this._notifyDidChangeAvatarsDebounced ??= debounce(this.notifyDidChangeAvatars.bind(this), 100);
		this._notifyDidChangeAvatarsDebounced();
	}

	@trace()
	private notifyDidChangeAvatars(): void {
		if (this._graphSession == null) return;

		// The publisher owns the avatars channel (size-watermark delta). New avatars grow the Map, so a
		// mark ships them; the proxy replaces values without changing size, which `onProxyAvatars` handles
		// via `invalidateAvatars()`.
		this._graphSync.mark('avatars');
		void this._graphSync.flush();
	}

	/**
	 * Ships the current rows-plane state (rows splice/append + enrichment deltas) through the publisher,
	 * with the search-results/selection envelope riding atomically. `setGraph(data)` already marked the
	 * channels dirty (rebuild) or the page-append landing did; this only attaches the riders and flushes.
	 * The publisher decides REPLACE (splice) vs page-append from `getPaging()` at flush time.
	 */
	@trace()
	notifyDidChangeRows(sendSelectedRows: boolean = false): void {
		if (this._graphSession == null) return;

		// `search` always rides (fresh truth, including undefined-to-clear). The `selectedRows` KEY is
		// included ONLY when sending selection — `attachRiders` keys off `'selectedRows' in riders`, so
		// omitting it can't stomp a selection rider a concurrent call left pending.
		this._graphSync.attachRiders({
			search: this.context.buildSearchRider(),
			...(sendSelectedRows ? { selectedRows: this.context.getConvertedSelectedRows() } : {}),
		});
		void this._graphSync.flush();
	}

	notifyDidChangeRowsStats(graph: GitGraph): void {
		if (graph.rowsStats == null || this._graphSession?.current !== graph) return;

		// Deferred-stats completion — the publisher ships the delta of stats keys added since its cursor.
		this._graphSync.mark('rowsStats');
		void this._graphSync.flush();
	}

	@trace()
	async notifyDidChangeState(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.context.addPendingNotification(DidChangeNotification);
			return false;
		}

		// Coalesce: if a notify is already in flight, join it (marks it dirty for one trailing refire) —
		// this check MUST stay ahead of the freshness gate below so a concurrent caller never bypasses it.
		if (this._stateNotify.running) return this._stateNotify.run();

		// If bootstrap (or another op) is building state right now, wait for it — afterwards the freshness
		// check below will skip the redundant work. Handles repo-change events firing during bootstrap.
		if (this._pendingStateOp != null) {
			await this._pendingStateOp.catch(() => undefined);
		}

		// Within the freshness window: defer rather than drop. A trailing flush at the window boundary
		// coalesces the rapid-fire notifies that follow bootstrap or repo subscription wiring, so legitimate
		// changes that land during the window aren't silently lost.
		if (this._lastStateSentAt != null) {
			const elapsed = performance.now() - this._lastStateSentAt;
			if (elapsed < GraphDataController.stateFreshnessMs) {
				this._stateFreshnessRetryTimer ??= setTimeout(() => {
					this._stateFreshnessRetryTimer = undefined;
					void this.notifyDidChangeState();
				}, GraphDataController.stateFreshnessMs - elapsed);
				return false;
			}
		}

		if (this._stateFreshnessRetryTimer != null) {
			clearTimeout(this._stateFreshnessRetryTimer);
			this._stateFreshnessRetryTimer = undefined;
		}
		this._notifyDidChangeStateDebounced?.cancel();

		return this._stateNotify.run();
	}

	/** The build-and-push body; `CoalescedRun` owns the in-flight/dirty bookkeeping around it, so this
	 *  only carries its own `_pendingStateOp` responsibility. */
	private async runStateNotify(): Promise<boolean> {
		try {
			// Snapshot before `getState()` so a mid-rebuild event leaves a delta for the trailing run.
			const seqAtRebuildStart = this.context.getSidebarEventSeq();

			const op = this.context.buildState();
			this._pendingStateOp = op;
			const state = await op;

			// `setGraph(data)` has run inside `getState()`, marking the publisher's rows-plane channels
			// dirty, so the fresh rows travel via the publisher (not this push). Commit the *captured*
			// sidebar seq (not current) so a mid-rebuild event remains unfired for the trailing run.
			if (seqAtRebuildStart !== this.context.getFiredSidebarSeq()) {
				this.context.setFiredSidebarSeq(seqAtRebuildStart);
				this.context.notifySidebarInvalidated();
			}

			// A build can still go stale between its post-walk branch re-read and this send, because the
			// notify coalescer and the freshness gate can hold it. Strip rather than ship: the fast path
			// has already delivered the newer counts, and re-applying these would restore the old ones.
			const branchStateRevision = state.branchStateRevision;
			if (branchStateRevision != null && !this.context.isBranchStateRevisionCurrent(branchStateRevision)) {
				state.branchState = undefined;
			}
			// Host-internal — never goes over the wire (see `State.branchStateRevision`).
			state.branchStateRevision = undefined;

			// `getState` already produced the rows-plane fields in the "skipRows" shape (rows/
			// reachability/avatars/downstreams/rowsStats/paging = undefined; refsMetadata = the
			// authoritative full map). Rows always ship via the publisher's channel now, so this is a
			// plain full-state push — no per-field fingerprint, splice, or reachability delta here.
			const result = await this.host.notify(DidChangeNotification, { state: state });

			this._lastStateSentAt = performance.now();
			// Commit only on confirmed delivery, and only value+ordering together: committing a value the
			// webview never received lets the fast path's dedup suppress every resend of it, leaving the
			// header blank until the counts change.
			if (result && state.branchState != null && branchStateRevision != null) {
				this.context.commitSentBranchState(state.branchState, branchStateRevision);
			}

			// Refresh canInstallHooks asynchronously so the bulk push doesn't block on `gk`.
			// Dedups internally — only fires `DidChangeCanInstallHooks` when the value diverges.
			this.context.notifyDidChangeCanInstallHooks();
			return result;
		} finally {
			this._pendingStateOp = undefined;
		}
	}

	computeRebuildAnchor(): { rev: string | undefined; limit: number } {
		const { defaultItemLimit } = configuration.get('graph');
		// If we have a set of data refresh to the same set
		const limit = Math.max(defaultItemLimit, this._graphSession?.current.ids.size ?? defaultItemLimit);

		// Preserve the loaded window's BOTTOM boundary across rebuilds: target the oldest loaded COMMIT row so
		// the re-walk ends exactly where the prior window did, however many new commits landed at the top. A
		// fixed count alone shifts the boundary by the new-commit count — cutting/growing the bottom, turning
		// resolved merge parents into unloaded reservations, and renumbering free-lane columns below, defeating
		// the webview's suffix reuse. Stash rows are skipped (their shas aren't in `git log --all`, so targeting
		// one triggers the defensive 10× over-walk). Page-scoped rows (the last `more()` page) preserve the prior
		// `_graph.rows` semantics: the page's bottom IS the window's bottom.
		let rebuildAnchorSha: string | undefined;
		const priorRows = this._graphSession?.current.rows;
		if (priorRows != null && priorRows.length > 0) {
			for (let i = priorRows.length - 1; i >= 0 && i >= priorRows.length - 10; i--) {
				const type = priorRows[i].kind;
				if (type === 'commit' || type === 'merge') {
					rebuildAnchorSha = priorRows[i].sha;
					break;
				}
			}
		}

		// `rev` is a git REVISION, so a synthetic WIP row id has to be translated back to the working tree's
		// revision here — passing the row id itself makes the provider run a `git log -n1 'wip::…'` that
		// always fails + a defensive 10× over-walk. The provider short-circuits `uncommitted` (no resolve,
		// untargeted walk), which is what a WIP anchor wants: there is no commit to page to. Real shas pass
		// through so off-screen anchors still page in.
		const rev = rebuildAnchorSha ?? (isWipRowId(this._selectedId) ? uncommitted : this._selectedId);
		return { rev: rev, limit: limit };
	}

	/**
	 * Post-change sync for the graph session. Called with `session.current` after a refresh/page-append
	 * (marks the rows-plane channels + fires the stats-deferred/overview/metadata-replay hooks), and with
	 * `undefined` on repo swap/clear (disposes the session and bumps the publisher's generation). The
	 * session owns the accumulated window and the write-once cross-generation avatar merge now — this
	 * method no longer maintains either.
	 *
	 * `changed` is the refresh's per-channel change report — when present, only the channels it actually
	 * touched are marked dirty (precise marking); a page-append / initial walk / reuse omits it and marks
	 * every channel (see {@link markGraphRowsPlaneDirty}).
	 */
	setGraph(graph: GitGraph | undefined, changed?: GitGraphSessionChangedChannels): void {
		if (graph == null) {
			// Repo swap / clear — the session's window is gone; dispose it.
			this._graphSession?.dispose();
			this._graphSession = undefined;
			// Graph identity changed (repo swap / clear): the publisher bumps its generation, rebases seq,
			// and forces its next emission to a snapshot (which reseeds all its delivery cursors from the
			// fresh graph). Repo swaps route through `resetRepositoryState` → `setGraph(undefined)` first,
			// so this covers them; pagination calls `setGraph(session.current)` directly and never hits here.
			this._graphSync.onGraphIdentityChanged();
			// Repo swap / clear invalidates any pending Visualizations stats-load — drop the override so
			// the new repo's loading state derives purely from its own graph.
			this._rowsStatsLoadingOverride = false;
			this.context.clearLastSentOverview();
			this.context.resetWipSendState();
			this._graphLoading = undefined;
			// Cancel + clear any in-flight page-in (mirrors dispose) so a stale repo-A query can't dedupe-swallow
			// repo-B's first page-in.
			if (this._pendingRowsQuery != null) {
				this._pendingRowsQuery.cancellable.cancel();
				this._pendingRowsQuery.cancellable.dispose();
				this._pendingRowsQuery = undefined;
			}
			this.context.clearAvatarProxyCaches();
			this.context.resetHoverCache();
			this.context.resetRefsMetadata();
			this.context.resetSearchState();
			this.context.cancelComputeIncludedRefs();
			this.context.clearWipStatusCache();
		} else {
			// New rows (rebuild or page-append) landed — mark the rows-plane channels so the publisher
			// re-derives each delta from this graph at flush time. It decides REPLACE-vs-append from
			// `getPaging()`, so the mark set is correct for both a full rebuild and a page. A refresh passes
			// its precise `changed` report (mark only what it touched); a page/initial/reuse marks all.
			this.markGraphRowsPlaneDirty(changed);

			// A stats-including graph landed — hand the "stats loading" signal back to the deferred
			// mechanism (`rowsStatsDeferred.isLoaded()`), which now reports loading until the stats query
			// resolves. Clears the eager Visualizations override set in `onDisplayModeChanged`.
			if (graph.includes?.stats === true) {
				this._rowsStatsLoadingOverride = false;
			}

			void graph.rowsStatsDeferred?.promise.then(() => {
				if (this._graphSession?.current !== graph) return;

				this.notifyDidChangeRowsStats(graph);
			});
			this.context.notifyDidChangeOverview();

			// Replay metadata requests buffered during the rebuild window — the graph exists now, so
			// onGetMissingRefMetadata can fetch. RepoPath-gated so a buffer captured for the prior repo can't
			// satisfy against this graph.
			this.context.replayPendingRefMetadataForGraph(graph);
		}
	}

	async updateGraphWithMoreRows(
		id: string | undefined,
		search?: GitGraphSearch,
		limitOverride?: number,
	): Promise<void> {
		let superseded;
		if (this._pendingRowsQuery != null) {
			const { id: pendingId, search: pendingSearch, cancellable: pendingCancellable } = this._pendingRowsQuery;
			// A CANCELLED entry is never a valid dedup target. It stays parked here by design (the finally
			// below skips clearing so the next caller can await its wind-down), but its promise is already
			// settled — handing it out answers this caller with a walk that produced nothing, and for
			// `id == null` scroll paging it would wedge paging permanently. Fall through to supersede it
			// instead: cancel (no-op), dispose, then await the wind-down.
			if (
				!pendingCancellable.token.isCancellationRequested &&
				pendingSearch === search &&
				(pendingId === id || (pendingId != null && id == null))
			) {
				return this._pendingRowsQuery.promise;
			}

			superseded = this._pendingRowsQuery;
			superseded.cancellable.cancel();
			superseded.cancellable.dispose();
		}

		const sw = new Stopwatch(undefined);
		// The window we're paging from — captured for the telemetry count before `more()` advances it.
		const priorRowCount = this._graphSession?.current.rows.length ?? 0;

		const cancellable = new CancellationTokenSource();
		const cancellation = cancellable.token;

		// The DAG discipline (see Core's serialization comment) requires this method's ENTIRE synchronous
		// prefix to hold: the new entry is registered and the loading promise captured in the SAME turn the
		// call arrives, so every later caller/getState sees (and awaits) this entry, and this entry awaits
		// only promises created before it. An `await` before registration would open a window where a third
		// `more()` bypasses the dedup entirely and races this one over the shared paging closure.
		const loading = this._graphLoading;
		const supersededPromise = superseded?.promise;
		this._pendingRowsQuery = {
			promise: (async () => {
				// AWAIT the superseded query's wind-down before starting ours: two `more()` walks share ONE
				// paging closure (`ids`/`total`/`iterations`/cursor in `getCommitsForGraphCore`), and a
				// cancelled-but-still-running walk interleaving with ours partitions the page between them —
				// gaps in the applied window and a poisoned `--skip` cursor. Cancellation makes it resolve
				// promptly (the walk aborts; Core's guards bail); its catch already swallows cancellation.
				if (supersededPromise != null) {
					await supersededPromise.catch(() => {});
				}
				return this.updateGraphWithMoreRowsCore(id, search, cancellation, loading, limitOverride);
			})().catch((ex: unknown) => {
				if (cancellation.isCancellationRequested) return;

				throw ex;
			}),
			cancellable: cancellable,
			id: id,
			search: search,
		};

		const entry = this._pendingRowsQuery;
		void entry.promise.finally(() => {
			// Cleanup runs even when cancelled — by now the walk HAS wound down, so releasing the entry
			// can't strand a later caller (clearing at cancel time would). Only telemetry is gated.
			if (this._pendingRowsQuery === entry) {
				this._pendingRowsQuery = undefined;
				entry.cancellable.dispose();
			}
			if (cancellation.isCancellationRequested) return;

			this.host.sendTelemetryEvent('graph/rows/loaded', {
				duration: sw.elapsed(),
				rows: priorRowCount,
			});
			sw.stop();
		});

		return this._pendingRowsQuery.promise;
	}

	private async updateGraphWithMoreRowsCore(
		id: string | undefined,
		search: GitGraphSearch | undefined,
		cancellation: CancellationToken,
		loading: Promise<unknown> | undefined,
		limitOverride?: number,
	) {
		// A superseded query can be cancelled BEFORE its walk starts (parked below, or before this frame
		// runs) — `toAbortSignal` of an already-cancelled token yields an already-aborted signal whose
		// 'abort' listeners never fire, so without this bail the walk would run to completion unabortably.
		if (cancellation.isCancellationRequested) return;

		const session = this._graphSession;
		if (session == null) return;

		// Serialize against an in-flight (re)walk: a concurrent getState refresh rebuilds the window this page
		// would splice onto, so wait it out first (cancellation resolves, never rejects), then re-validate the
		// captured session identity (a repo swap disposes+replaces it). `loading` was captured SYNCHRONOUSLY
		// at the caller's entry — awaiting the LIVE field here could await a getState created after this
		// entry, and since that getState symmetrically awaits `_pendingRowsQuery` (this entry), the two would
		// deadlock. Captured-at-creation keeps the await graph a creation-ordered DAG: nothing ever awaits a
		// promise made after itself. (A refresh created later instead awaits THIS entry and re-walks after.)
		if (loading != null) {
			await loading.catch(() => {});
			if (cancellation.isCancellationRequested) return;
			if (this._graphSession !== session) return;
		}

		const { defaultItemLimit, pageItemLimit } = configuration.get('graph');

		// Adaptive page size: scale the base `pageItemLimit` with how deep we're already loaded so the
		// growing `git log --skip=N` re-walk cost amortizes over fewer, larger pages. Depth = the
		// ACCUMULATED loaded count (`ids.size`) — `current.rows` is page-scoped after pagination and would
		// pin the multiplier at one page. Targeted row-load walks pass an explicit `limitOverride`
		// (0 = uncapped) and keep their exact semantics untouched.
		let limit =
			limitOverride ?? computeAdaptivePageLimit(session.current.ids.size, pageItemLimit ?? defaultItemLimit);
		let targetId = id;

		// Determine the last search result (for auto-loading more search results)
		const lastSearchResultId = search?.results.size ? last(search.results.keys()) : undefined;

		if (!id && search?.results.size) {
			// If there are a small number of results and we're filtering, load them all at once
			if (search.results.size < 50 && search.query.filter) {
				targetId = lastSearchResultId;
				limit = 0;
			} else {
				// Determine the next unloaded search result (if any)
				const nextUnloadedResultId = search?.results.size
					? find(search.results.keys(), sha => !session.current.ids.has(sha))
					: undefined;
				targetId = nextUnloadedResultId;
			}
		}

		// The session pages into its window and swaps `current` to the page view; it returns `false` when a
		// concurrent refresh superseded the page (stale generation — its internal `current !== prior` guard)
		// or there was nothing to add. A repo swap disposes+replaces the session, caught by the `!==` guard
		// below. Both cases drop the page: the rebuild re-anchored on the same bottom, `hasMore` still
		// stands, and the webview re-requests on the next scroll.
		const gotMore = await session.more(limit, targetId, toAbortSignal(cancellation));
		if (this._graphSession !== session) return;

		if (gotMore) {
			this.setGraph(session.current);

			if (!search?.hasMore || lastSearchResultId == null) return;

			if (session.current.ids.has(lastSearchResultId)) {
				// Auto-load more search results in the background
				// Suppress notifications - notifyDidChangeRows will send both
				// the search results AND the rows together to avoid race conditions
				try {
					await this.context.searchGraphOrContinue({ search: search.query, more: true }, false);
					// Search results are now updated in this._search
					// notifyDidChangeRows() will send them along with the rows
				} catch (ex) {
					if (isCancellationError(ex)) return;

					// Only send error notifications immediately
					void this.host.notify(DidSearchNotification, {
						search: search.query,
						results: {
							error: ex instanceof GitSearchError ? 'Invalid search pattern' : 'Unexpected error',
						},
						partial: false,
						searchId: this.context.getSearchIdCounterCurrent(),
					});
				}
			}
		}
	}

	/** Pages an explicit real-commit selection target in if a (capped) cold-start `getGraph` walk didn't
	 *  reach it. `getGraph` caps the targeted walk at `defaultItemLimit*10`, so a deeper "Open in Commit
	 *  Graph" target opened against a CLOSED graph would never load. Keeps the normal cold-start view
	 *  (we don't shrink `getGraph`'s limit) and only resumes — uncapped (`limit: 0`) — from the frontier
	 *  to the target when needed. WIP/already-loaded targets and a fully-paged graph no-op. */
	async ensureSelectedTargetLoaded(): Promise<boolean> {
		const id = this._selectedId;
		// Rejects BOTH working-changes namespaces — a `wip::<path>` row id and the bare `uncommitted`
		// revision, which other GitLens surfaces can still hand us (a working-changes file node routed
		// through "Open File History in Graph"). Neither is a commit, so the walk below could never find
		// one: it runs `limit: 0` with a sha that never matches, and the defensive `limit * 10` cap only
		// applies when `limit` is non-zero — so it would enumerate the entire repository, on every
		// `getState`, forever.
		if (id == null || isWipSelectionSha(id)) return false;
		if (
			this._graphSession == null ||
			this._graphSession.current.ids.has(id) ||
			this._graphSession.current.paging?.hasMore !== true
		) {
			return false;
		}

		await this.updateGraphWithMoreRows(id, this._search, 0);
		return this._graphSession?.current.ids.has(id) ?? false;
	}

	async onGetMoreRows(
		params: IpcParams<typeof GetMoreRowsCommand>,
		sendSelectedRows: boolean = false,
	): Promise<void> {
		// Nothing to page from — including no session at all, which a repo swap mid-flight leaves behind. The
		// client sets its `loading` lock before sending and clears it only on a rows push, so returning
		// silently here wedges the lock and with it EVERY later page request; refresh instead, whose
		// full-state push carries `loading: false`. (A carrier can't serve this: the publisher builds one from
		// the session, and there isn't one.)
		if (
			this._graphSession?.current.paging == null ||
			this._graphSession.current.more == null ||
			this.repository?.etag !== this._etagRepository
		) {
			this.updateState(true);

			return;
		}

		// Hold the publisher across the whole page-in so the page rows AND the search/selection riders ship
		// as ONE atomic emission — `updateGraphWithMoreRows` → setGraph marks the channels and its internal
		// search-continue await would otherwise let a premature flush ship rows without the search envelope.
		this._graphSync.hold();
		try {
			await this.updateGraphWithMoreRows(params.id, this._search, params.limit);
		} catch (ex) {
			// A genuine page-in failure (e.g. a corrupt object) must still ship a rows notification below so
			// the webview's `loading` flag (reset only by a rows push) doesn't wedge forever. Cancellation
			// already resolves (the query's inner catch swallows it), so it never lands here.
			Logger.error(ex, 'GraphDataController', 'onGetMoreRows');
		} finally {
			// Guarantee the push below actually ships: a page that adds nothing (superseded walk, or a failure
			// above) marks no channel, and with no search rider `attachRiders` leaves nothing pending either, so
			// `flush` early-returns on an empty dirty set — wedging the client's `loading` lock, which only a
			// rows push clears, forever. A CARRIER, not `mark('rows')` — see `markCarrier` for why re-shipping
			// rows here would restart the very prefetch this response is answering.
			this._graphSync.markCarrier();
			// Notify BEFORE release so a failed page still ships an (empty-delta) rows push that resets client loading.
			this.notifyDidChangeRows(sendSelectedRows);
			this._graphSync.release();
		}
	}

	onSyncResync(params: IpcParams<typeof GraphSyncResyncCommand>): void {
		// The publisher's single recovery request: a seq gap, splice-guard mismatch, or the post-bootstrap
		// sync-hello. No-ops when the reported baseline is already reconciled; else re-ships a snapshot.
		// A genuine divergence (a previously-in-sync webview lost a message) is warn-worthy — storms/soaks
		// assert zero of these in steady state.
		const outcome = this._graphSync.onResyncRequest(params.generation, params.seq);
		if (outcome === 'diverged') {
			Logger.warn(
				`GraphSyncPublisher: webview diverged (reported gen=${params.generation}, seq=${params.seq}; publisher gen=${this._graphSync.generation}, seq=${this._graphSync.seq}); re-shipping snapshot`,
			);
		}
	}

	/** Cancels the walk started by {@link onLoadRowRequest} for `id`, if it is still the pending query.
	 *  Deliberately does NOT clear `_pendingRowsQuery`: two walks share one paging closure, so the next
	 *  caller still has to await this one's wind-down (see `updateGraphWithMoreRows`). */
	onCancelLoadRow(params: IpcParams<typeof CancelLoadRowCommand>): void {
		const pending = this._pendingRowsQuery;
		if (pending == null || pending.id !== params.id) return;

		pending.cancellable.cancel();
	}

	async onLoadRowRequest(params: IpcParams<typeof LoadRowRequest>): Promise<IpcResponse<typeof LoadRowRequest>> {
		if (this._graphSession == null) return { id: undefined, reason: 'notFound' };
		// WIP rows are synthesized client-side and have no commit behind them, so there is nothing to
		// load and `updateGraphWithMoreRows` below runs UNCAPPED for the id. The webview guards its own
		// callers, but this is the boundary that has to hold — search seeds WIP row ids into its results
		// (`graphSearchService`), and the header's ensure-a-search-result path forwards any id it gets.
		if (isWipRowId(params.id)) return { id: undefined, reason: 'notFound' };

		const repoPath = this._graphSession.repoPath;

		try {
			if (this._graphSession.current.ids.has(params.id)) {
				// The webview only asks for a row it cannot resolve locally. If the host already has it,
				// the planes have diverged (for example after a lost rows notification); re-ship the
				// authoritative snapshot so navigation can recover instead of waiting for a row that the
				// host would otherwise consider already delivered.
				this._graphSync.requireSnapshot();
				await this._graphSync.flush();
				return { id: params.id };
			}

			// Not present — page it in. Hold the publisher across the page-in AND its notify (mirrors
			// onGetMoreRows) so a reveal's flush can't silently no-op against a concurrent hold; a rows push
			// always ships (finally) so a failed page still resets the client loading flag.
			let id: string | undefined;
			this._graphSync.hold();
			try {
				// Targeted, UNCAPPED load: `more(0, id)` walks until the SHA is found with no
				// unreachable-SHA cap. The default-limit path caps each walk at `pageItemLimit*10`
				// (~2000) and re-walks from the frontier without advancing across retries, so it can
				// never reach a deeper-but-reachable selection target (nav/search/deep-link/overview).
				// A real selection target IS reachable; an unreachable one bounds at history end
				// (`hasMore` goes false). That cap (added in 0ffbf5d for the scope-anchor pagination
				// path) caught this select-a-row path collaterally — `limit=0` restores the pre-cap
				// "find the SHA then select it" behavior for the explicit-target case.
				await this.updateGraphWithMoreRows(params.id, this._search, 0);
				if (this._graphSession?.current.ids.has(params.id)) {
					id = params.id;
				}
			} catch (ex) {
				// A genuine page-in failure must still ship the rows push below (finally) so client loading
				// resets. Cancellation already resolves (the query's inner catch swallows it).
				Logger.error(ex, 'GraphDataController', 'onLoadRowRequest');
			} finally {
				// New rows were loaded (heavy: rows + avatars + downstreams + rowsStats + refsMetadata).
				// Selection is deliberately client-owned and latest-wins; this request only makes the row
				// available. Notify before release so an empty delta still settles client paging state.
				this.notifyDidChangeRows();
				this._graphSync.release();
			}

			if (id != null) return { id: id };

			return { id: undefined, reason: await this.classifyLoadRowFailure(repoPath, params.id) };
		} catch (ex) {
			Logger.error(ex, 'GraphDataController', 'onLoadRowRequest');
			return { id: undefined, error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	/** Classifies why a targeted {@link onLoadRowRequest} walk failed to find `id`, so the webview can
	 *  tell the user why the jump didn't land instead of failing silently. Distinguishes a commit that
	 *  genuinely doesn't exist from one that exists but is unreachable because the graph only walks
	 *  first-parent history (`gitlens.graph.onlyFollowFirstParent`) — an unreachable-but-existing commit
	 *  with first-parent OFF is bucketed as `notFound` too; an `--all` walk can't otherwise tell "exists
	 *  but unreachable" apart from "doesn't exist". */
	private async classifyLoadRowFailure(repoPath: string, id: string): Promise<'notFound' | 'firstParent'> {
		let exists = false;
		try {
			exists = (await this.container.git.getRepositoryService(repoPath).refs.validateReference(id)) != null;
		} catch (ex) {
			if (!isCancellationError(ex)) {
				Logger.error(ex, 'GraphDataController', 'classifyLoadRowFailure');
			}

			return 'notFound';
		}

		if (!exists) return 'notFound';

		const { onlyFollowFirstParent } = configuration.get('graph');

		return onlyFollowFirstParent ? 'firstParent' : 'notFound';
	}

	async onGetCounts(): Promise<
		| {
				branches: number;
				remotes: number;
				stashes: number | undefined;
				worktrees: number | undefined;
				tags: number;
		  }
		| undefined
	> {
		const graph = this._graphSession?.current ?? (await this._graphLoading?.catch(() => undefined));
		if (graph == null) return undefined;

		const tags = await this.container.git.getRepositoryService(graph.repoPath).tags.getTags();
		return {
			// Intentionally local-only, even when `views.branches.showRemoteBranches` adds remote branches to
			// the panel — the badge answers "how many branches do I have here" and shouldn't swing on a filter
			branches: count(graph.branches?.values(), b => !b.remote),
			remotes: graph.remotes.size,
			stashes: graph.stashes?.size,
			// Subtract the default worktree; an empty array means the fetch failed/unsupported, not "no worktrees"
			worktrees: graph.worktrees != null && graph.worktrees.length > 0 ? graph.worktrees.length - 1 : undefined,
			tags: tags.values.length,
		};
	}

	/** Cancel + drop any in-flight page-in (dispose / repo swap). */
	cancelPendingRowsQuery(): void {
		if (this._pendingRowsQuery != null) {
			this._pendingRowsQuery.cancellable.cancel();
			this._pendingRowsQuery.cancellable.dispose();
			this._pendingRowsQuery = undefined;
		}
	}

	/** Clear the freshness-window retry timer (dispose / repo reset). */
	clearStateFreshnessRetryTimer(): void {
		if (this._stateFreshnessRetryTimer != null) {
			clearTimeout(this._stateFreshnessRetryTimer);
			this._stateFreshnessRetryTimer = undefined;
		}
	}

	/** Cancel the state/avatars debounced notifiers (dispose) so a trailing fire can't hit a torn-down host. */
	cancelDebouncedNotifiers(): void {
		this._notifyDidChangeAvatarsDebounced?.cancel();
		this._notifyDidChangeStateDebounced?.cancel();
	}

	/** Clear the state-notify freshness/op bookkeeping (repo reset). The `CoalescedRun` coalescer is
	 *  instance-owned and isn't force-cleared here — a stale in-flight run still settles on its own, and
	 *  `markDirty()` guarantees its trailing refire fires (even if the in-flight run was otherwise clean)
	 *  so the new repo gets re-processed. Leaves the freshness retry timer to the caller's own
	 *  {@link clearStateFreshnessRetryTimer} so its original ordering is preserved. */
	resetStateNotify(): void {
		this._lastStateSentAt = undefined;
		this._pendingStateOp = undefined;
		this._stateNotify.markDirty();
	}

	/** Register the bootstrap's `getState` as the in-flight state op so repo-change notifies during the
	 *  bootstrap window wait on it, then find the state already fresh. Mirrors the coalescer's own finally. */
	trackBootstrapStateOp(statePromise: Promise<State>): Promise<State> {
		const op = statePromise.finally(() => {
			this._lastStateSentAt = performance.now();
			this._pendingStateOp = undefined;
		});
		this._pendingStateOp = op;
		return op;
	}

	/** Dispose the accumulated graph session and drop it (provider dispose). */
	disposeSession(): void {
		this._graphSession?.dispose();
		this._graphSession = undefined;
	}
}
