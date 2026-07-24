import { ContextProvider } from '@lit/context';
import type { GitGraphRow, GraphReachabilityTable } from '@gitlens/git/models/graph.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { appendRowsAtCursor } from '@gitlens/git/utils/graph.utils.js';
import { decodeReachabilitySet } from '@gitlens/git/utils/reachability.utils.js';
import { compareReachableRefs } from '@gitlens/git/utils/sorting.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { areEqual, hasKeys } from '@gitlens/utils/object.js';
import type { StoredGraphWipDraft } from '../../../../constants.storage.js';
import type { IpcMessage } from '../../../ipc/models/ipc.js';
import type {
	DidSearchParams,
	GraphRowsSplice,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphWorkingTreeStats,
	State,
	Wip,
	WorkDirStats,
} from '../../../plus/graph/protocol.js';
import {
	createSecondaryWipSha,
	DidChangeAgentSessionsNotification,
	DidChangeBranchStateNotification,
	DidChangeCanInstallClaudeHook,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeGraphWalkthroughBanner,
	DidChangeGraphWalkthroughComplete,
	DidChangeGraphWalkthroughStarted,
	DidChangeHooksBanner,
	DidChangeLayoutPromptNotification,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeOverviewNotification,
	DidChangePinnedRefNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWipDraftsNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidInvalidateScopeAnchorsNotification,
	DidRequestActiveSidebarPanelNotification,
	DidRequestGraphActionNotification,
	DidRequestOpenCompareModeNotification,
	DidRequestOpenTimelineScopeNotification,
	DidRequestSearchNotification,
	DidRequestWipRefetchNotification,
	DidSearchNotification,
	DidStartFeaturePreviewNotification,
	GetAgentSessionsRequest,
	GetOverviewEnrichmentRequest,
	GraphSyncResyncCommand,
	ResolveGraphScopeRequest,
} from '../../../plus/graph/protocol.js';
import type { WebviewState } from '../../../protocol.js';
import { DidChangeHostWindowFocusNotification } from '../../../protocol.js';
import type { OverviewBranchMergeTarget } from '../../../shared/overviewBranches.js';
import { sortAgentSessions } from '../../shared/agentUtils.js';
import type { ReactiveElementHost } from '../../shared/appHost.js';
import { signalObjectState, signalState } from '../../shared/components/signal-utils.js';
import type { LoggerContext } from '../../shared/contexts/logger.js';
import type { HostIpc } from '../../shared/ipc.js';
import { StateProviderBase } from '../../shared/stateProviderBase.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import type { AppState } from './context.js';
import { graphStateContext } from './context.js';
import { GraphRowsSyncReceiver } from './graphRowsSyncReceiver.js';

const BaseWebviewStateKeys = [
	'timestamp',
	'webviewId',
	'webviewInstanceId',
] as const satisfies readonly (keyof WebviewState<any>)[] as readonly string[];

export function isGraphSearchResultsError(
	results: GraphSearchResults | GraphSearchResultsError,
): results is GraphSearchResultsError {
	return 'error' in results;
}

/** The search CONTROL substate (everything a `DidSearchParams` decides EXCEPT the results object). */
export interface GraphSearchControlState {
	currentSearchId: number | undefined;
	searching: boolean;
	searchMode: 'filter' | 'normal';
	searchQuery: SearchQuery | undefined;
}

/**
 * Pure reduction of the search control substate for an incoming {@link DidSearchParams}. Kept separate
 * from (and unit-tested independently of) the results-accumulation in `handleSearchNotification` because
 * these are the decisions that were historically under-tested and repeatedly mis-set:
 * - the spinner gate: a rows-plane RIDER (a results/coverage refresh) must NEVER raise or lower
 *   `searching`; a real new search raises it; a final/error result lowers it; a partial keeps it on;
 * - query propagation: the query rides every non-cancel notification so a rebooted/reconnected app can
 *   restore its search box (results travel their own channel) — cleared on cancellation.
 * `ignore` marks a stale (superseded) notification the caller must drop entirely.
 */
export function reduceGraphSearchControlState(
	prev: GraphSearchControlState,
	params: Pick<DidSearchParams, 'searchId' | 'search' | 'results' | 'partial' | 'rider'>,
): { ignore: boolean; next: GraphSearchControlState } {
	const { searchId } = params;

	// Stale notification from a superseded search.
	if (prev.currentSearchId != null && searchId < prev.currentSearchId) {
		return { ignore: true, next: prev };
	}

	const cancelled = params.results == null && params.search == null;
	const isRider = params.rider === true;
	const isNewId = searchId !== prev.currentSearchId;

	let { currentSearchId, searching, searchMode, searchQuery } = prev;

	if (isNewId) {
		currentSearchId = searchId;
		// A rider re-delivers an already-complete search to a rebooted app (its `currentSearchId` is
		// unseeded, so this trips the new-id branch) — it must NOT raise the spinner; neither does cancel.
		if (!cancelled && !isRider) {
			searching = true;
		}
		if (params.search != null) {
			searchMode = params.search.filter ? 'filter' : 'normal';
		}
	}

	if (cancelled) {
		return {
			ignore: false,
			next: {
				currentSearchId: currentSearchId,
				searching: false,
				searchMode: searchMode,
				searchQuery: undefined,
			},
		};
	}

	// Query rides every non-cancel notification (start/progressive/final/rider) for box restoration.
	if (params.search != null) {
		searchQuery = params.search;
	}

	if (params.results != null) {
		if (isGraphSearchResultsError(params.results)) {
			searching = false;
		} else if (!isRider) {
			// Final (non-partial) result stops the spinner; a partial keeps it on. A rider never drives it.
			searching = params.partial === true;
		}
	}

	return {
		ignore: false,
		next: {
			currentSearchId: currentSearchId,
			searching: searching,
			searchMode: searchMode,
			searchQuery: searchQuery,
		},
	};
}

/**
 * Pure: whether a host-restored search query should hydrate the (empty) local search box. Fires after a
 * reboot/reconnect where an active search's query didn't reach the box; never clobbers an in-progress
 * user query (non-empty local). Gated on the search being live — results present OR still `searching` —
 * so it never revives a just-cancelled search (cancel clears both) yet still restores the box mid-
 * progressive-search before the first result lands (else a rebooted iframe shows a spinner + blank box).
 */
export function shouldRestoreSearchQuery(
	localQuery: string | undefined,
	restored: SearchQuery | undefined,
	hasResults: boolean,
	isSearching: boolean,
): boolean {
	return (localQuery ?? '') === '' && (restored?.query ?? '') !== '' && (hasResults || isSearching);
}

/** Lightweight scope anchor returned by `ResolveGraphScopeRequest` and cached webview-side. */
type ResolvedScopeAnchor = {
	mergeBase: { sha: string; date: number } | undefined;
	mergeTargetTipSha: string | undefined;
	focalBranchTipSha: string | undefined;
};

/**
 * Returns the scope without `mergeTargetTipSha` when `mergeBase` isn't set. Without the paired
 * `mergeBase`, the gitkraken-components scope walk falls into a "target tip without merge base"
 * path that only terminates when the target's ancestors are loaded — for a stale target tip
 * many years back in history, those aren't loaded and the walk exposes every first-parent
 * ancestor of the focal branch. Leaving the scope bare keeps the foreign-ref heuristic active,
 * which bounds visibility against currently-loaded refs.
 */
function stripUnpairedMergeTarget(scope: GraphScope): GraphScope {
	if (scope.mergeBase != null || scope.mergeTargetTipSha == null) return scope;

	const { mergeTargetTipSha: _, ...rest } = scope;
	return rest;
}

/**
 * Returns the scope with `mergeTargetTipSha` backfilled from the branch's enrichment, or the
 * original scope reference when nothing needs to change. Callers use reference-equality to know
 * whether they need to publish a new scope value.
 *
 * Skips the backfill when the scope has neither `mergeBase` nor a prior `mergeTargetTipSha` —
 * the bare scope state that `setScope` leaves behind when the anchor IPC bailed or its merge
 * base wasn't in the loaded rows. Promoting just a `mergeTargetTipSha` onto a bare scope pushes
 * the gitkraken-components scope walk into its "target tip without merge base" path, which can
 * only terminate when the target's ancestors are already loaded; for a stale target tip many
 * years back in history, those aren't loaded and the walk exposes every first-parent ancestor
 * of the focal branch. Leaving the scope bare keeps the foreign-ref heuristic active, which
 * bounds visibility against currently-loaded refs.
 */
export function reconcileScopeMergeTarget(
	scope: AppState['scope'],
	enrichment: AppState['overviewEnrichment'],
): AppState['scope'] {
	if (scope == null) return scope;
	if (scope.mergeBase == null && scope.mergeTargetTipSha == null) return scope;

	const sha = enrichment?.[scope.branchRef]?.mergeTarget?.sha;
	if (sha == null || sha === scope.mergeTargetTipSha) return scope;
	return { ...scope, mergeTargetTipSha: sha };
}

function getSearchResultModel(searchResults: State['searchResults']): {
	results: undefined | GraphSearchResults;
	resultsError: undefined | GraphSearchResultsError;
} {
	let results: undefined | GraphSearchResults;
	let resultsError: undefined | GraphSearchResultsError;
	if (searchResults != null) {
		if (isGraphSearchResultsError(searchResults)) {
			resultsError = searchResults;
		} else {
			results = searchResults;
		}
	}
	return { results: results, resultsError: resultsError };
}

// Sticky cache of the last-known `workDirStats` value seen for each secondary-WIP sha. Used to
// bridge the visual gap when an entry briefly disappears from `wipMetadataBySha` and re-enters
// via the `prevEntry == null` path — without this, the GK component renders no pill for the row
// across the 350ms settle + IPC round trip, producing a visible flash. One GraphStateProvider
// per webview, so module-level is effectively per-instance state.
export const lastKnownWorkDirStatsBySha = new Map<string, WorkDirStats>();

function captureLastKnownWorkDirStats(map: State['wipMetadataBySha']): void {
	if (map == null) return;

	for (const [sha, entry] of Object.entries(map)) {
		if (entry.workDirStats != null) {
			lastKnownWorkDirStatsBySha.set(sha, entry.workDirStats);
		}
	}
}

export class GraphStateProvider extends StateProviderBase<State['webviewId'], AppState, typeof graphStateContext> {
	// Track current search ID to ignore stale updates
	private _currentSearchId: number | undefined;

	get currentSearchId(): number | undefined {
		return this._currentSearchId;
	}

	// Rows-plane sync sequencer (R1c): holds the `{generation, seq}` baseline the webview mirrors from
	// the publisher's `DidChangeRows` channel plus the resync dedup flag. Seeded ONCE from the bootstrap
	// `State.sync` stamp in `initializeState`; thereafter advanced ONLY by contiguous deltas / rebased by
	// snapshots. A mid-session full-State push also carries `sync`, but MUST NOT move the baseline — the
	// rows channel is the single writer.
	private readonly _rowsSync = new GraphRowsSyncReceiver();

	// App state members moved from GraphAppState
	@signalState()
	accessor activeDay: AppState['activeDay'];

	@signalState()
	accessor activeRow: AppState['activeRow'];

	@signalState()
	accessor displayMode: AppState['displayMode'];

	@signalObjectState()
	accessor timeline: AppState['timeline'];

	@signalObjectState()
	accessor details: AppState['details'];

	@signalObjectState()
	accessor sidebar: AppState['sidebar'];

	@signalObjectState()
	accessor minimap: AppState['minimap'];

	@signalState()
	accessor pendingAction: AppState['pendingAction'];

	@signalState()
	accessor wipDrafts: State['wipDrafts'];

	@signalState()
	accessor visualizationMode: AppState['visualizationMode'];

	@signalState()
	accessor treemapMode: AppState['treemapMode'];

	get isBusy(): AppState['isBusy'] {
		return this.loading || this.searching || /*this.rowsStatsLoading ||*/ false;
	}

	@signalState(false)
	accessor loading: AppState['loading'] = false;

	/**
	 * Signals that a scope-anchor IPC is in flight long enough to warrant a loading affordance.
	 * Composed with `loading` at the `gl-graph` render boundary (see `graph-wrapper.ts`) so
	 * scope-resolution and row-loading share the same visual indicator without sharing
	 * lifecycle — setScope owns this signal end-to-end (set on a delay timer, cleared in its
	 * finally), independent from the global `loading` flag managed by paging /
	 * `EnsureRowRequest` / `DidChangeRowsNotification`.
	 */
	@signalState(false)
	accessor scopeLoading: boolean = false;

	@signalState<AppState['navigating']>(false)
	accessor navigating: AppState['navigating'] = false;

	@signalState(false)
	accessor searching: AppState['searching'] = false;

	@signalState()
	accessor searchMode: AppState['searchMode'] = 'normal';

	@signalState<GraphSearchResults | GraphSearchResultsError | undefined>(undefined, {
		afterChange: (target, value) => {
			const { results, resultsError } = getSearchResultModel(value);
			target.searchResults = results;
			target.searchResultsError = resultsError;
		},
	})
	accessor searchResultsResponse: AppState['searchResultsResponse'];

	@signalState()
	accessor searchResults: AppState['searchResults'];

	@signalState<AppState['activeFilterColumns']>(new Set())
	accessor activeFilterColumns: AppState['activeFilterColumns'] = new Set();

	@signalState()
	accessor searchResultsError: AppState['searchResultsError'];

	@signalState()
	accessor searchQuery: AppState['searchQuery'];

	@signalState()
	accessor selectedRows: AppState['selectedRows'];

	@signalObjectState()
	accessor visibleDays: AppState['visibleDays'];

	// State accessors for all top-level State properties
	@signalState()
	accessor windowFocused: boolean | undefined;

	@signalState()
	accessor webroot: string | undefined;

	@signalState()
	accessor isWeb: State['isWeb'] = false;

	@signalState()
	accessor repositories: State['repositories'];

	@signalState()
	accessor worktreePaths: State['worktreePaths'];

	@signalState()
	accessor worktreeBranches: State['worktreeBranches'];

	@signalState()
	accessor selectedRepository: State['selectedRepository'];

	@signalState()
	accessor selectedRepositoryVisibility: State['selectedRepositoryVisibility'];

	@signalState()
	accessor branchesVisibility: State['branchesVisibility'];

	@signalState()
	accessor branch: State['branch'];

	@signalState()
	accessor branchState: State['branchState'];

	@signalState()
	accessor lastFetched: State['lastFetched'];

	@signalState()
	accessor subscription: State['subscription'];

	@signalState()
	accessor allowed: State['allowed'] = false;

	@signalState()
	accessor allowRepoSwitch: State['allowRepoSwitch'];

	@signalState()
	accessor avatars: State['avatars'];

	@signalState()
	accessor refsMetadata: State['refsMetadata'];

	// Bumped on every authoritative refsMetadata REPLACE (`refsMetadataReset`) so the graph component can
	// re-arm its per-id request dedup even when the strip preserves a non-empty (upstream) map.
	@signalState(0)
	accessor refsMetadataResetToken: AppState['refsMetadataResetToken'] = 0;

	@signalState()
	accessor rows: State['rows'];

	@signalState()
	accessor rowsStats: State['rowsStats'];

	@signalState()
	accessor rowsStatsLoading: State['rowsStatsLoading'] | undefined;

	@signalState()
	accessor rowsStatsIncluded: State['rowsStatsIncluded'];

	@signalState()
	accessor downstreams: State['downstreams'];

	@signalState()
	accessor paging: State['paging'];

	@signalState()
	accessor columns: State['columns'];

	@signalState()
	accessor config: State['config'];

	@signalState()
	accessor context: State['context'];

	@signalState()
	accessor nonce: State['nonce'];

	@signalState()
	accessor workingTreeStats: State['workingTreeStats'];

	@signalState<State['wipMetadataBySha']>(undefined, {
		// Maintain a sticky cache of last-known `workDirStats` keyed by secondary-WIP sha so that
		// `mergeWipMetadata` can recover stats for an entry that briefly disappears from
		// `wipMetadataBySha` (e.g. host worktree-list flap, transient `wt.sha == null`,
		// reduced-set full-state push) and re-enters via the `prevEntry == null` path. Without
		// this, the GK component sees `workDirStats: undefined` and renders nothing for the row
		// until the settle delay + IPC round trip resolves — that's the visible pill flash.
		afterChange: (_target: GraphStateProvider, value) => captureLastKnownWorkDirStats(value),
	})
	accessor wipMetadataBySha: State['wipMetadataBySha'];

	@signalState()
	accessor wip: State['wip'];

	@signalState()
	accessor scope: AppState['scope'];

	@signalState()
	accessor useNaturalLanguageSearch: State['useNaturalLanguageSearch'] | undefined;

	@signalState()
	accessor searchRequest: State['searchRequest'];

	@signalState()
	accessor excludeRefs: State['excludeRefs'];

	@signalState()
	accessor excludeTypes: State['excludeTypes'];

	@signalState()
	accessor includeOnlyRefs: State['includeOnlyRefs'];

	@signalState()
	accessor pinnedRef: State['pinnedRef'];

	@signalState()
	accessor featurePreview: State['featurePreview'];

	@signalState()
	accessor orgSettings: State['orgSettings'];

	@signalState()
	accessor overview: State['overview'];

	@signalState()
	accessor overviewRecentThreshold: State['overviewRecentThreshold'];

	@signalState<AppState['agentSessions']>([])
	accessor agentSessions: AppState['agentSessions'] = [];

	@signalState()
	accessor overviewWip: AppState['overviewWip'];

	@signalState<AppState['overviewEnrichment']>(undefined, {
		// When enrichment arrives (or refreshes) for the currently-scoped branch, backfill the
		// scope's `mergeTargetTipSha` so the graph's merge-target anchor appears without requiring
		// the user to re-scope.
		afterChange: (target: GraphStateProvider, value) => {
			const next = reconcileScopeMergeTarget(target.scope, value);
			if (next !== target.scope) {
				target.scope = next;
			}
		},
	})
	accessor overviewEnrichment: AppState['overviewEnrichment'];

	/** Fingerprint of the overview we last fetched enrichment for — avoids duplicate requests. */
	private _enrichmentFingerprint: string | undefined;

	/** Branch ids enriched on behalf of a non-overview consumer (a WIP-bar pill whose branch missed the
	 *  overview's active/recent cut). The overview's publishes are authoritative only for their OWN ids,
	 *  so these must be carried forward explicitly — otherwise an overview refetch evicts them, and a
	 *  pill's PR/issue rows vanish live, under an open hover. */
	private readonly _extraEnrichmentBranchIds = new Set<string>();
	/** In-flight additive fetches, so re-hovering a pill doesn't re-issue the request. */
	private readonly _extraEnrichmentInFlight = new Set<string>();

	mcpBannerCollapsed?: boolean | undefined;
	hooksBannerCollapsed?: boolean | undefined;
	canInstallClaudeHook?: boolean | undefined;
	graphWalkthroughBannerCollapsed?: boolean | undefined;
	graphWalkthroughComplete?: boolean | undefined;
	graphWalkthroughStarted?: boolean | undefined;
	layoutPromptNeeded?: boolean | undefined;

	constructor(
		host: ReactiveElementHost,
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
		private readonly options: { onStateUpdate?: (partial: Partial<State>) => void } = {},
	) {
		super(host, bootstrap, ipc, logger);
	}

	override dispose(): void {
		// Cancel any pending debounced provider update to prevent post-dispose updates
		this.fireProviderUpdate.cancel?.();
		if (this._resyncRetryTimer != null) {
			clearTimeout(this._resyncRetryTimer);
			this._resyncRetryTimer = undefined;
		}
		super.dispose();
	}

	protected override createContextProvider(
		_state: State,
	): ContextProvider<typeof graphStateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: graphStateContext, initialValue: this });
	}

	protected override async initializeState(): Promise<void> {
		await super.initializeState();

		if (this._state.searchMode != null) {
			this.searchMode = this._state.searchMode;
		}

		// Bootstrap rows arrive lean: the host ships only `contexts.flags`, not the serialized commit
		// `contexts.row`/`contexts.avatar` blobs. Those are now reconstructed on demand at right-click /
		// selection time (see `graph-wrapper`), so nothing to rebuild here. Reachability is likewise
		// decoded on demand from `_state.reachabilityTable` via `getRowReachability`.
		this.updateState(this._state, true);

		// Seed the rows-plane sync baseline from the bootstrap stamp — ONLY here (single-writer:
		// mid-session full-State pushes also carry `sync` but must not move the baseline).
		this._rowsSync.initFromBootstrap(this._state.sync);
		// Sync-hello: announce the held baseline so the host catches us up when we're behind (its
		// `onResyncRequest` no-ops when in sync, snapshots when not). This closes the silent-staleness
		// reconnect window where a mid-session State reset pruned rows-plane messages out of the
		// replay buffer. `initializeState` runs once per fresh iframe — initial boot, soft-reconnect
		// replay, and hard-refresh all re-run it — so this fires exactly once per (re)connect.
		this.sendSyncHello();

		// Enrichment is fetched lazily when a consumer needs it (the overview sidebar mounting or
		// the scope popover opening) rather than eagerly at bootstrap, where it competes with the
		// graph render itself.

		void this.ipc.sendRequest(GetAgentSessionsRequest, undefined).then(sessions => {
			this.agentSessions = sortAgentSessions(sessions);
		});
	}

	/** Announce the held rows-plane baseline to the host on (re)connect. Best-effort — deliberately
	 *  NOT gated by the resync dedup: the host may legitimately no-op it (in sync), which would never
	 *  clear an outstanding flag and would then wedge genuine mid-session gap recovery. */
	private sendSyncHello(): void {
		this.ipc.sendCommand(GraphSyncResyncCommand, {
			generation: this._rowsSync.generation,
			seq: this._rowsSync.lastApplied,
		});
	}

	private _resyncRetryTimer: ReturnType<typeof setTimeout> | undefined;

	/** Request a rows-plane snapshot after a detected gap / splice-guard mismatch. Deduped by the
	 *  receiver (a second gap while one request is in flight is dropped; the flag clears when a
	 *  snapshot lands), with a LIVENESS timer for the loss cases: if the request itself — or the
	 *  snapshot the host trusted in place of answering it — went missing, no further rows message may
	 *  ever arrive on an idle repo to re-trigger this, so the timer re-sends past the receiver's retry
	 *  threshold (where the host treats the identical repeat as proof of non-delivery and snapshots). */
	private requestResync(): void {
		if (!this._rowsSync.beginResync()) return;

		this.ipc.sendCommand(GraphSyncResyncCommand, {
			generation: this._rowsSync.generation,
			seq: this._rowsSync.lastApplied,
		});

		// Slightly past the receiver's 10s re-arm threshold so the retry's beginResync() passes. Each
		// retry arms the next check; the chain ends when a snapshot commit clears the outstanding flag
		// (or on dispose). One live timer at most — a gap-storm re-entering here just re-schedules it.
		if (this._resyncRetryTimer != null) {
			clearTimeout(this._resyncRetryTimer);
		}
		this._resyncRetryTimer = setTimeout(() => {
			this._resyncRetryTimer = undefined;
			if (this._rowsSync.resyncOutstanding) {
				this.requestResync();
			}
		}, 11_000);
	}

	ensureOverviewEnrichmentFetched(overview: State['overview']): void {
		if (overview == null) return;

		const branchIds = [...overview.active.map(b => b.id), ...overview.recent.map(b => b.id)];
		if (branchIds.length === 0) return;

		const fingerprint = branchIds.toSorted().join(',');
		if (fingerprint === this._enrichmentFingerprint) return;

		// Skip the IPC entirely when overviewEnrichment (possibly populated by the sidebar's
		// parallel fetch path) already covers every id in this composition.
		const enrichment = this.overviewEnrichment;
		if (enrichment != null && branchIds.every(id => id in enrichment)) {
			this._enrichmentFingerprint = fingerprint;
			return;
		}

		this._enrichmentFingerprint = fingerprint;

		void this.ipc.sendRequest(GetOverviewEnrichmentRequest, { branchIds: branchIds }).then(result => {
			// Only publish when the overview fingerprint hasn't moved on — a newer overview
			// in flight will trigger its own fetch whose result is authoritative.
			if (this._enrichmentFingerprint === fingerprint) {
				this.publishOverviewEnrichment(result);
			}
		});
	}

	/**
	 * Publish an authoritative overview enrichment result. Builds the next state from `result` so stale
	 * entries (e.g. a closed/retargeted PR's enrichment) for branchIds no longer in the active/recent set
	 * are dropped — but drop-stale applies only WITHIN the overview's own id set:
	 *
	 * - entries fetched additively for non-overview branches (`ensureEnrichmentFetchedForBranches`) are
	 *   carried forward, since this result was never asked about them;
	 * - locally-merged `mergeTarget`s from `mergeMergeTargetIntoEnrichment` are preserved — the host opts
	 *   out of merge-target resolution here via `skipMergeTarget: true` and always returns `undefined`.
	 */
	publishOverviewEnrichment(result: NonNullable<AppState['overviewEnrichment']>): void {
		const previous = this.overviewEnrichment;
		if (previous == null) {
			this.overviewEnrichment = result;
			return;
		}

		const next: typeof result = {};
		for (const branchId of this._extraEnrichmentBranchIds) {
			if (branchId in result) continue;

			const entry = previous[branchId];
			if (entry != null) {
				next[branchId] = entry;
			}
		}
		for (const branchId in result) {
			const incoming = result[branchId];
			const localMergeTarget = previous[branchId]?.mergeTarget;
			next[branchId] =
				localMergeTarget != null && incoming?.mergeTarget == null
					? { ...incoming, mergeTarget: localMergeTarget }
					: incoming;
		}
		this.overviewEnrichment = next;
	}

	/** Clear all enrichment state — the shared record, the overview fingerprint, and the additive
	 *  WIP-bar tracking Sets — as one unit. Both reset paths (scope-anchor invalidation and the overview
	 *  panel's `refresh`) must go through here so the add-only `_extraEnrichmentBranchIds` can't outlive
	 *  the data it tracks (unbounded growth) or carry a prior repo's ids into the next fetch. */
	resetOverviewEnrichment(): void {
		this._enrichmentFingerprint = undefined;
		this._extraEnrichmentBranchIds.clear();
		this._extraEnrichmentInFlight.clear();
		if (this.overviewEnrichment != null) {
			this.overviewEnrichment = undefined;
		}
	}

	/**
	 * Additively fetch enrichment for branch ids that may sit OUTSIDE the overview's active/recent set —
	 * a WIP-bar pill on a worktree whose branch missed the recency cut still wants its PR/issues.
	 *
	 * Deliberately not routed through `ensureOverviewEnrichmentFetched`: that guards on a fingerprint of
	 * the exact overview id set, so feeding it a different list would flip the fingerprint back and forth
	 * and refetch forever. This path fetches only the ids it doesn't already have and merges — never drops.
	 */
	ensureEnrichmentFetchedForBranches(branchIds: string[]): void {
		const enrichment = this.overviewEnrichment;
		const missing = branchIds.filter(
			id => !this._extraEnrichmentInFlight.has(id) && !(enrichment != null && id in enrichment),
		);
		if (missing.length === 0) return;

		for (const id of missing) {
			this._extraEnrichmentInFlight.add(id);
		}

		void this.ipc.sendRequest(GetOverviewEnrichmentRequest, { branchIds: missing }).then(
			result => {
				for (const id of missing) {
					this._extraEnrichmentInFlight.delete(id);
					this._extraEnrichmentBranchIds.add(id);
				}
				if (result == null) return;

				// Preserve any locally-merged `mergeTarget` per id: this fetch opts out of merge-target
				// resolution (`skipMergeTarget`), so a raw spread would erase a target that
				// `ensureMergeTargetFetched` may have published for the same branch moments earlier (both
				// fire from one hover's settle timer). Same preservation as `publishOverviewEnrichment`.
				const previous = this.overviewEnrichment;
				const next: NonNullable<typeof previous> = { ...previous };
				for (const branchId in result) {
					const incoming = result[branchId];
					const localMergeTarget = previous?.[branchId]?.mergeTarget;
					next[branchId] =
						localMergeTarget != null && incoming?.mergeTarget == null
							? { ...incoming, mergeTarget: localMergeTarget }
							: incoming;
				}
				this.overviewEnrichment = next;
			},
			() => {
				for (const id of missing) {
					this._extraEnrichmentInFlight.delete(id);
				}
			},
		);
	}

	/** Session cache of resolved scope anchors (mergeBase + mergeTargetTipSha), keyed by `repoPath|branchRef`. */
	private _mergeBaseCache = new Map<string, ResolvedScopeAnchor | undefined>();
	/** In-flight scope-anchor resolves, deduped per cache key. */
	private _mergeBasePromises = new Map<string, Promise<ResolvedScopeAnchor | undefined>>();
	/**
	 * Per-repo generation, bumped on `DidInvalidateScopeAnchorsNotification`. In-flight resolves
	 * capture this before awaiting and skip writing back if it has advanced — otherwise the
	 * post-await cache write would repopulate `_mergeBaseCache` with the pre-invalidation anchor.
	 */
	private _anchorGenerations = new Map<string, number>();

	/**
	 * Latest scope the user has asked to navigate to. Tracked separately from the published
	 * `scope` signal so a cache-miss anchor resolve only publishes when the user is still
	 * waiting for that branch — re-scoping or clearing while the IPC is in flight cancels the
	 * pending publish. Compared by `branchRef` (not reference) so a second `setScope` to the
	 * same branch with a fresher upstream/target still allows the in-flight resolve to publish.
	 */
	private _pendingScope: GraphScope | undefined;

	/**
	 * Set by callers (e.g. the scope popover) right before sending a filter-changing IPC, so the
	 * scope clear coalesces with the resulting `DidChangeRefsVisibilityNotification` rather than
	 * causing an immediate minimap reset followed by a separate filter-update repaint.
	 */
	private _scopeClearDeferred = false;

	deferScopeClear(): void {
		// Cancel any in-flight `setScope` publish so a cache-miss resolve can't sneak a new
		// scope in after the imminent visibility change clears `this.scope`.
		this._pendingScope = undefined;
		if (this.scope == null) return;

		this._scopeClearDeferred = true;
	}

	cancelPendingScope(): void {
		this._pendingScope = undefined;
		this._scopeClearDeferred = false;
		this.scopeLoading = false;
	}

	clearScope(): void {
		if (this.scope == null) return;

		this.cancelPendingScope();
		this.scope = undefined;

		emitTelemetrySentEvent<'graph/scope/cleared'>(this.host, {
			name: 'graph/scope/cleared',
			data: {},
		});
	}

	/**
	 * Merge a lazily-fetched merge-target into `overviewEnrichment` for the given branchId. The graph
	 * overview's enrichment IPC opts out of eager merge-target fetching (`skipMergeTarget: true`); the
	 * click-to-scope path and the shared branch hover (`gl-branch-hover`, backing both the overview card
	 * and the graph WIP-bar pills) fetch it via `getBranchEnrichment(...).mergeTargetStatus` and call this
	 * to publish the result so the existing `reconcileScopeMergeTarget` hook backfills the scope's tip SHA.
	 */
	mergeMergeTargetIntoEnrichment(branchId: string, mergeTarget: OverviewBranchMergeTarget | undefined): void {
		const current = this.overviewEnrichment;
		const existing = current?.[branchId];
		this.overviewEnrichment = {
			...current,
			[branchId]: { ...existing, mergeTarget: mergeTarget },
		};
	}

	/**
	 * Publishes a freshly-picked scope. Resolves to `void` only after the scope value visible to
	 * the graph (`this.scope`) has reached its final settled form for this call — anchored if the
	 * anchor IPC resolves with a usable merge base, bare otherwise. Callers that need to fire a
	 * row selection against the scoped view (`ensureAndSelectCommit`) should `await` this so the
	 * GK row index has the post-scope set ready by the time selection runs.
	 *
	 * Publish strategy: ALWAYS publish exactly one `this.scope` write per `setScope` call. We
	 * wait for the anchor IPC to resolve before publishing — bare-then-anchored two-step writes
	 * are perceptible as commits jumping (the GK bundle's bare-scope walk uses a foreign-ref
	 * heuristic; the anchored walk uses a real merge base, producing a different visible set).
	 * The IPC is local-disk on desktop and well under 100ms in the common case; the chip + graph
	 * stay on their pre-scope state until the publish lands, which is more readable than a flash.
	 *
	 * `mergeTargetTipSha` is stripped from the bare publish (when the anchor IPC bails) even
	 * when the caller supplied one (e.g. `scopeToBranchById` pre-fills it from overview
	 * enrichment): without a paired `mergeBase`, the bundle scope walk falls into a "target tip
	 * without merge base" path that only terminates when the target's ancestors are loaded —
	 * for a stale or deep target that's unsafe.
	 */
	async setScope(scope: GraphScope): Promise<void> {
		this._pendingScope = scope;

		const repoPath = scope.branchRef.split('|', 2)[0];
		if (!repoPath) {
			this._pendingScope = undefined;
			return;
		}

		// `branchRef` is the cache key directly — `getBranchId` already encodes the repoPath
		// (`${repoPath}|heads/${name}`), so it's unique across repos without re-prefixing.
		const cacheKey = scope.branchRef;

		// Cache hit — publish synchronously, single write.
		if (this._mergeBaseCache.has(cacheKey)) {
			this.publishResolvedScope(scope, this._mergeBaseCache.get(cacheKey));
			return;
		}

		// Cache miss — wait for the anchor IPC, then publish once (anchored if usable, bare if
		// the host bailed). Never write `this.scope` mid-IPC, so the user never sees the bare
		// foreign-ref heuristic flash through.
		//
		// Show a loading affordance ONLY if the IPC takes long enough to be perceptible. Fast
		// (sub-`scopeLoadingDelayMs`) paths skip the flag entirely. The flag has its own
		// lifecycle (own signal `scopeLoading`, set here and cleared in `finally`) and doesn't
		// share state with the global `loading` flag managed by paging / EnsureRow — so a
		// concurrent paging IPC's loader can't be clobbered by our finally, and vice versa.
		const loadingTimer = setTimeout(() => {
			// Only show if this scope is still the pending one — a superseding `setScope` would
			// own its own loader timer.
			if (this._pendingScope !== scope) return;

			this.scopeLoading = true;
		}, GraphStateProvider.scopeLoadingDelayMs);

		try {
			const anchor = await this.fetchScopeAnchor(repoPath, scope, cacheKey);
			this.publishResolvedScope(scope, anchor);
		} finally {
			clearTimeout(loadingTimer);
			// Only clear when this call still owns the pending scope. A superseding `setScope`
			// has already taken over (and started its own loader timer); leave `scopeLoading`
			// alone so the newer call manages it.
			if (this._pendingScope == null || this._pendingScope === scope) {
				this.scopeLoading = false;
			}
		}
	}

	/** Soft delay before showing the scope-loading affordance — sub-threshold IPCs (the common
	 *  case) never trigger the affordance, avoiding a visual blip on fast paths. */
	private static readonly scopeLoadingDelayMs = 120;

	/**
	 * Publishes a scope ONCE — anchored if the resolved anchor is usable, bare otherwise. Used by
	 * the no-bare-flash path (cache hit / fast IPC) AND the cache-miss path.
	 *
	 * Why an unloaded `mergeBase` falls through to bare: the gitkraken-components scope walk
	 * requires the boundary to be loaded in order to terminate, and a "not loaded" merge base
	 * means the walk would expose every first-parent ancestor of the focal branch. The bare
	 * scope keeps the foreign-ref heuristic active, which bounds visibility against currently-
	 * loaded refs.
	 *
	 * Preserve-anchored guard: if `this.scope` is already anchored for the same `branchRef` and
	 * the new anchor would be a bare downgrade (host bailed OR merge base no longer loaded
	 * because rows re-paged), we KEEP the existing anchored scope rather than wipe it. The
	 * previous flow's `applyAnchorToPendingScope` early-returned in this case; preserve that
	 * behavior so a stale-re-resolve never erases a working anchored state.
	 */
	private publishResolvedScope(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): void {
		const pending = this._pendingScope;
		if (pending?.branchRef !== scope.branchRef) return;

		this._pendingScope = undefined;

		const anchorUsable =
			anchor != null &&
			(anchor.mergeBase != null || anchor.mergeTargetTipSha != null) &&
			(anchor.mergeBase == null || this.isShaLoaded(anchor.mergeBase.sha));

		if (!anchorUsable) {
			// Preserve an already-anchored scope for the same branch — don't downgrade to bare —
			// BUT ONLY if the existing scope's mergeBase is also still loaded. If the existing
			// anchor's boundary is itself stale (e.g., rows re-paged past it), the GK scope walk
			// on an unloaded boundary would expose every first-parent ancestor of the focal
			// branch (see `isShaLoaded` docs). In that case bare is the safer state.
			const current = this.scope;
			if (
				current?.branchRef === pending.branchRef &&
				current.mergeBase != null &&
				this.isShaLoaded(current.mergeBase.sha)
			) {
				return;
			}

			this.scope = stripUnpairedMergeTarget(pending);
			return;
		}

		// `anchorUsable` is true → `anchor` is non-null here. TS narrowing through the local
		// boolean isn't smart enough; the field-level checks below restore the narrow.
		const next: GraphScope = { ...pending };
		if (anchor?.mergeBase != null) {
			next.mergeBase = anchor.mergeBase;
		}
		if (anchor?.mergeTargetTipSha != null) {
			next.mergeTargetTipSha = anchor.mergeTargetTipSha;
		}
		this.scope = next;
	}

	async resolveScopeMergeBase(scope: GraphScope): Promise<void> {
		const repoPath = scope.branchRef.split('|', 2)[0];
		if (!repoPath) return;

		const cacheKey = scope.branchRef;

		// Cache hit — patch and return without IPC.
		if (this._mergeBaseCache.has(cacheKey)) {
			this.patchScopeAnchor(scope, this._mergeBaseCache.get(cacheKey));
			return;
		}

		const anchor = await this.fetchScopeAnchor(repoPath, scope, cacheKey);
		this.patchScopeAnchor(scope, anchor);
	}

	/**
	 * Shared anchor IPC + cache write used by both the initial `setScope` flow and the re-resolve
	 * flow (`resolveScopeMergeBase`, invoked from `DidInvalidateScopeAnchorsNotification`). Dedupes
	 * concurrent requests for the same `(repoPath, branchRef)` and skips the cache write when a
	 * mid-flight invalidation has bumped the per-repo generation.
	 */
	private async fetchScopeAnchor(
		repoPath: string,
		scope: GraphScope,
		cacheKey: string,
	): Promise<ResolvedScopeAnchor | undefined> {
		// Capture before await — if invalidation arrives mid-flight (refs/config moved), skip the
		// writeback so we don't repopulate `_mergeBaseCache` with the pre-invalidation anchor.
		const generation = this._anchorGenerations.get(repoPath) ?? 0;

		let promise = this._mergeBasePromises.get(cacheKey);
		if (promise == null) {
			promise = this.ipc
				.sendRequest(ResolveGraphScopeRequest, {
					repoPath: repoPath,
					scope: scope,
				})
				.then((r): ResolvedScopeAnchor | undefined =>
					r == null
						? undefined
						: {
								mergeBase: r.scope.mergeBase,
								mergeTargetTipSha: r.scope.resolvedMergeTargetTipSha,
								focalBranchTipSha: r.scope.resolvedFocalBranchTipSha,
							},
				)
				.catch((): ResolvedScopeAnchor | undefined => undefined)
				.finally(() => {
					// Only clear when the stored entry still points at *this* promise — otherwise
					// invalidation already cleared it and a newer resolve may have taken its slot.
					if (this._mergeBasePromises.get(cacheKey) === promise) {
						this._mergeBasePromises.delete(cacheKey);
					}
				});
			this._mergeBasePromises.set(cacheKey, promise);
		}

		const anchor = await promise;
		if ((this._anchorGenerations.get(repoPath) ?? 0) !== generation) return undefined;

		this._mergeBaseCache.set(cacheKey, anchor);
		return anchor;
	}

	/** On-demand decode cache for `getRowReachability`, keyed by the host table's stable set index.
	 *  Shared across pages and consumers; reset by `resetReachabilityCache` on a new table generation. */
	private readonly _reachabilityCache = new Map<number, GitCommitReachability>();

	/**
	 * Decodes a single row's `reachability` on demand from the host-owned, accumulated
	 * `reachabilityTable` (rows carry only a `contexts.reachabilityIndex`, never per-row ref arrays).
	 * The table is append-only across pagination within a graph session — an index, once assigned,
	 * always means the same set — so decoded sets are cached by index and shared across every page and
	 * consumer (selection details, timeline branch attribution). Decoding only happens for rows a
	 * consumer actually inspects. Returns undefined when the row has no reachability.
	 *
	 * The returned object is shared (one per distinct set, cached) — consumers MUST treat `refs` as
	 * read-only (filter/map, never sort/splice in place), or they corrupt the set for every other row
	 * and consumer that shares it.
	 */
	getRowReachability(row: NonNullable<State['rows']>[number]): GitCommitReachability | undefined {
		const table = this._state.reachabilityTable;
		if (table == null) return undefined;

		const index = row.contexts?.reachabilityIndex;
		if (index == null) return undefined;

		let reachability = this._reachabilityCache.get(index);
		if (reachability == null) {
			const refs = decodeReachabilitySet(table, index);
			// The dictionary is interned in first-seen order (to dedup bitmaps), so restore the host's
			// canonical order — current-first / local-before-remote / tags newest-first — that the lazy
			// `getCommitReachability` "load all" path uses and the details panel's `branches[0]`
			// branch-name fallback depends on.
			refs.sort(compareReachableRefs);
			reachability = { partial: true, refs: refs };
			this._reachabilityCache.set(index, reachability);
		}
		return reachability;
	}

	/** Clears the on-demand decode cache. Called when a new table generation arrives (different `id`);
	 *  same-generation pagination extends the SAME table, so it must NOT clear there. */
	private resetReachabilityCache(): void {
		this._reachabilityCache.clear();
	}

	/**
	 * Adopts a reachability-table push from the host. The host ships the FULL table on a new generation
	 * (a fresh graph walk → new `id`) and only the appended dictionary/sets tail (a delta) on
	 * same-generation pagination. So a different `id` (or no table yet) → replace + reset the decode
	 * cache (set indices restart for a new generation); the same `id` → concatenate the delta and KEEP
	 * the cache (existing indices stay valid — new entries only append). `undefined` means nothing was
	 * shipped (deduped/no reachability) → keep what we have. Owns `_state.reachabilityTable` directly,
	 * so callers must NOT also route the table through `updateState`.
	 */
	private applyReachabilityTable(incoming: GraphReachabilityTable | undefined, snapshot?: boolean): void {
		if (incoming == null) {
			// A SNAPSHOT is an authoritative replace even with no table (the new graph has no reachability):
			// reclaim the stale table + decode cache — the snapshot's rows carry no indices, so the old table
			// would never be read again, just retained.
			if (snapshot && this._state.reachabilityTable != null) {
				this._state.reachabilityTable = undefined;
				this.resetReachabilityCache();
			}
			return;
		}

		const current = this._state.reachabilityTable;
		// A publisher snapshot ships the FULL table (reset-anchor) — replace even on a same-`id` push,
		// or a same-generation recovery snapshot would double the table via the append branch below.
		if (snapshot || current?.id !== incoming.id) {
			this._state.reachabilityTable = incoming;
			this.resetReachabilityCache();
			return;
		}

		this._state.reachabilityTable = {
			id: current.id,
			dictionary: [...current.dictionary, ...incoming.dictionary],
			sets: [...current.sets, ...incoming.sets],
		};
	}

	/**
	 * Reconstructs the full row set from a splice-delta (changed head + a reused span of the rows we
	 * already hold + optional grown tail), applying the flags/reachabilityIndex patch in place —
	 * reused rows keep their identity (consumers read both lazily), only the two patchable ints move
	 * (`null` = unchanged, `-1` = now absent). The host only sends a splice against a
	 * delivery-confirmed base, so a guard failure means the mirror diverged — returns undefined
	 * (caller keeps its rows) after requesting a full resend.
	 */
	private applyRowsSplice(splice: GraphRowsSplice, scope: ScopedLogger | undefined): GitGraphRow[] | undefined {
		const current = this._state.rows;
		const spanEnd = splice.reusedStart + splice.reusedCount;
		if (
			current == null ||
			current.length !== splice.expectedPriorRows ||
			current[splice.reusedStart]?.sha !== splice.firstReusedSha ||
			current[spanEnd - 1]?.sha !== splice.lastReusedSha
		) {
			this.logger.info(
				scope,
				`rows splice guards FAILED (have ${current?.length ?? 0} rows, expected ${splice.expectedPriorRows}); requesting a resync snapshot`,
			);
			this.requestResync();
			return undefined;
		}

		const span = current.slice(splice.reusedStart, spanEnd);
		if (splice.patch != null) {
			const { flags, reachability } = splice.patch;
			for (let i = 0; i < span.length; i++) {
				const f = flags[i];
				const r = reachability[i];
				if (f == null && r == null) continue;

				const contexts = (span[i].contexts ??= {});
				if (f != null) {
					contexts.flags = f === -1 ? undefined : f;
				}
				if (r != null) {
					contexts.reachabilityIndex = r === -1 ? undefined : r;
				}
			}
		}
		this.logger.debug(
			scope,
			`spliced rows: head=${splice.head.length} reused=${splice.reusedCount} tail=${splice.tail?.length ?? 0} patched=${splice.patch != null}`,
		);
		return [...splice.head, ...span, ...(splice.tail ?? [])];
	}

	/** True when `sha` is present in the graph's loaded rows. Used to decide whether a resolved
	 *  scope anchor is usable — see `publishResolvedScope`. */
	private isShaLoaded(sha: string): boolean {
		const rows = this._state.rows;
		return rows?.some(r => r.sha === sha) ?? false;
	}

	private patchScopeAnchor(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): void {
		if (anchor == null) return;
		// Host couldn't resolve any field — leave the live scope alone rather than assigning a
		// no-op spread that would re-zoom the minimap for nothing.
		if (anchor.mergeBase == null && anchor.mergeTargetTipSha == null && anchor.focalBranchTipSha == null) {
			return;
		}

		// Merge base resolved but not loaded — applying it would put the bundle scope walk on
		// an unloaded boundary; see `publishResolvedScope`.
		if (anchor.mergeBase != null && !this.isShaLoaded(anchor.mergeBase.sha)) return;

		// Only patch if the live scope still points at the same branch (user may have re-scoped
		// or cleared while the resolve was in flight).
		const current = this.scope;
		if (current?.branchRef !== scope.branchRef) return;

		// Skip if every patchable field already matches — prevents a redundant signal update that
		// would re-zoom the minimap needlessly.
		const mergeBaseSame =
			current.mergeBase?.sha === anchor.mergeBase?.sha && current.mergeBase?.date === anchor.mergeBase?.date;
		// `mergeTargetTipSha` may also be supplied by enrichment via `reconcileScopeMergeTarget`.
		// Only overwrite when the resolver returned a value AND it differs — `undefined` from the
		// resolver shouldn't clobber an enrichment-supplied SHA.
		const targetTipSame =
			anchor.mergeTargetTipSha == null || anchor.mergeTargetTipSha === current.mergeTargetTipSha;
		const focalTipSame = anchor.focalBranchTipSha == null || anchor.focalBranchTipSha === current.focalBranchTipSha;
		if (mergeBaseSame && targetTipSame && focalTipSame) return;

		const next: GraphScope = { ...current };
		if (anchor.mergeBase != null && !mergeBaseSame) {
			next.mergeBase = anchor.mergeBase;
		}
		if (anchor.mergeTargetTipSha != null && !targetTipSame) {
			next.mergeTargetTipSha = anchor.mergeTargetTipSha;
		}
		if (anchor.focalBranchTipSha != null && !focalTipSame) {
			next.focalBranchTipSha = anchor.focalBranchTipSha;
		}
		this.scope = next;
	}

	protected onMessageReceived(msg: IpcMessage): void {
		const scope = getScopedLogger();

		const updates: Partial<State> = {};
		switch (true) {
			case DidChangeNotification.is(msg): {
				// Preserve client-side wipMetadataBySha.workDirStats (populated via GetWipStatsRequest)
				// across full-state pushes — the server only sends anchor info. Read from the
				// accessor (signal) rather than `_state`: writebacks from `graph-wrapper.ts` and
				// `graph-app.ts` assign through the accessor and don't update `_state`, so reading
				// `_state` here would see a stale anchor-only map and the merge would drop the
				// freshly-fetched `workDirStats` from every secondary row (visible pill flash).
				const incoming = msg.params.state;
				const next: Partial<State> =
					incoming.wipMetadataBySha != null
						? {
								...incoming,
								wipMetadataBySha: mergeWipMetadata(
									this.wipMetadataBySha,
									incoming.wipMetadataBySha,
									lastKnownWorkDirStatsBySha,
								),
							}
						: { ...incoming };
				// Rows-plane fields (rows/avatars/downstreams/paging/reachabilityTable/rowsStats*) travel on
				// the publisher's `DidChangeRows` channel and arrive ABSENT here. Two exceptions ride this
				// push: `refsMetadata` (a full-map/`null` reset-anchor REPLACE, applied via `updateState`) and
				// `sync` (bootstrap-only baseline stamp — consumed by `initializeState`, must not move the live baseline).
				// Drop `branchState` and `lastFetched` when the full-state push carries values
				// structurally equal to what's already applied. The fast paths (`DidChangeBranchState`,
				// `DidFetch`) land these ~20-30ms before the heavier full-state rebuild; without this
				// guard the bulk push re-assigns the same values and Lit's identity-based reactivity
				// forces a redundant header re-render for every pull/push/fetch.
				if (areEqual(next.branchState, this._state.branchState)) {
					delete next.branchState;
				}
				if (next.lastFetched?.getTime() === this._state.lastFetched?.getTime()) {
					delete next.lastFetched;
				}
				// `workingTreeStats` has a second, revision-ordered writer — the wip channel
				// (`DidChangeWorkingTree`/refetch, guarded by `isStaleWip`). This full-state copy is unstamped and
				// snapshotted early in the host rebuild, so drop it whenever the wip channel has already written
				// stats for the repo THIS push is for (`_wipStatsRepo === incoming.selectedRepository`): the live
				// value wins, including one a B working-tree tick delivered early during an A→B swap (which is why
				// the compare is against the incoming repo, not the client's lagging current selection). Otherwise
				// seed (first delivery). Plus an equal-value delete to spare a redundant header re-render.
				if ('workingTreeStats' in next) {
					const { seed, wipStatsRepo } = resolveFullStateWorkingTreeStats(
						incoming.selectedRepository,
						this._wipStatsRepo,
					);
					// Seeding hands ownership back to the full-state (clears the marker) so a stale marker from a
					// prior visit can't drop a later seed after a B→A→B swap-back; a drop keeps the wip owner.
					this._wipStatsRepo = wipStatsRepo;
					if (!seed || areEqual(next.workingTreeStats, this._state.workingTreeStats)) {
						delete next.workingTreeStats;
					}
				}
				this.updateState(next);
				break;
			}

			case DidFetchNotification.is(msg):
				this._state.lastFetched = msg.params.lastFetched;
				this.updateState({ lastFetched: msg.params.lastFetched });
				break;

			case DidInvalidateScopeAnchorsNotification.is(msg): {
				// Drop the mirrored merge-base cache when the host signals that refs/config moved —
				// otherwise the next scope-resolve would hand back the cached pre-rebase anchor.
				const { repoPath, branchRefs } = msg.params;
				// Bump generation so any in-flight resolve for this repo skips its post-await
				// writeback (per-repo is sufficient; in-flight resolves whose `branchRefs` weren't
				// targeted simply re-issue on the next consumer call).
				this._anchorGenerations.set(repoPath, (this._anchorGenerations.get(repoPath) ?? 0) + 1);
				// Cache keys are `branchRef`s (which already include `${repoPath}|` via `getBranchId`),
				// so targeted invalidation uses the ref directly; the bulk path matches by prefix.
				const prefix = `${repoPath}|`;
				if (branchRefs?.length) {
					for (const ref of branchRefs) {
						this._mergeBaseCache.delete(ref);
						this._mergeBasePromises.delete(ref);
					}
				} else {
					for (const key of [...this._mergeBaseCache.keys()]) {
						if (key.startsWith(prefix)) {
							this._mergeBaseCache.delete(key);
						}
					}
					for (const key of [...this._mergeBasePromises.keys()]) {
						if (key.startsWith(prefix)) {
							this._mergeBasePromises.delete(key);
						}
					}
				}

				// Also reset enrichment so a stale `mergeTargetTipSha` doesn't survive — the next
				// popover open or sidebar render will re-fetch and `reconcileScopeMergeTarget` will
				// re-anchor the live scope when it lands.
				this.resetOverviewEnrichment();

				// Proactively re-resolve the live scope. The cache clear above only ensures the
				// *next* `resolveScopeMergeBase` call won't hand back the stale anchor — it doesn't
				// touch the live `scope.mergeBase`/`scope.mergeTargetTipSha` themselves, which were
				// set on the prior resolve and would otherwise keep anchoring the minimap to the
				// pre-rebase SHA until the user re-scopes. The bumped generation just above ensures
				// any concurrently-running stale resolve can't beat this fresh one to the writeback.
				const liveScope = this.scope;
				if (liveScope?.branchRef.startsWith(prefix)) {
					void this.resolveScopeMergeBase(liveScope);
				}
				break;
			}

			case DidStartFeaturePreviewNotification.is(msg):
				this._state.featurePreview = msg.params.featurePreview;
				this._state.allowed = msg.params.allowed;
				this.updateState({
					featurePreview: msg.params.featurePreview,
					allowed: msg.params.allowed,
				});
				break;
			case DidChangeBranchStateNotification.is(msg):
				this.updateState({
					branchState: msg.params.branchState,
				});
				break;

			case DidChangeHostWindowFocusNotification.is(msg):
				this.updateState({
					windowFocused: msg.params.focused,
				});
				break;

			case DidChangeColumnsNotification.is(msg):
				this.updateState({
					columns: msg.params.columns,
					columnsRevision: msg.params.columnsRevision,
					context: {
						...this._state.context,
						header: msg.params.context,
						settings: msg.params.settingsContext,
					},
				});
				break;

			case DidChangeRefsVisibilityNotification.is(msg):
				if (this._scopeClearDeferred) {
					this._scopeClearDeferred = false;
					this.clearScope();
				}
				this.updateState({
					branchesVisibility: msg.params.branchesVisibility,
					excludeRefs: msg.params.excludeRefs,
					excludeTypes: msg.params.excludeTypes,
					includeOnlyRefs: msg.params.includeOnlyRefs,
				});
				break;

			case DidChangePinnedRefNotification.is(msg):
				this.updateState({ pinnedRef: msg.params.pinnedRef });
				break;

			case DidChangeRowsNotification.is(msg): {
				// Rows-plane sequencing (R1c). The publisher stamps every emission `{generation, seq, snapshot?}`.
				// Snapshots are authoritative resets that rebase the baseline; deltas apply iff strictly
				// contiguous within the current generation. Anything else drops (stale replay) or triggers one
				// deduped resync (gap / future generation). The baseline advances only AFTER a successful apply
				// (`_rowsSync.commit` below), so a splice-guard failure leaves it behind and the resync snapshots.
				const sync = msg.params.sync;
				const outcome = this._rowsSync.classify(sync);
				if (outcome.action === 'drop') break;

				if (outcome.action === 'resync') {
					this.requestResync();
					break;
				}

				const snapshot = outcome.snapshot;

				// Lean commit contexts are reconstructed on demand at right-click / selection time (see
				// `graph-wrapper`); reachability is decoded on demand from the accumulated
				// `reachabilityTable` (adopted into `updates` below). Nothing to rebuild per-row here.
				let rows;
				if (snapshot) {
					// Authoritative full REPLACE — always adopt the snapshot's rows (even an empty set, which
					// clears a stale prior graph on repo swap / recovery). Snapshots never ship a splice.
					rows = msg.params.rows;
				} else if (msg.params.rowsSplice != null) {
					// Cursor-less replace shipped as a splice-delta — reconstruct from the rows we hold. A guard
					// mismatch (`applyRowsSplice` returns undefined + requests a resync) means the mirror diverged:
					// drop the whole message (rows AND enrichment) WITHOUT advancing the baseline — the resync
					// snapshot re-seeds everything.
					const spliced = this.applyRowsSplice(msg.params.rowsSplice, scope);
					if (spliced == null) break;

					rows = spliced;
				} else if (
					msg.params.rows.length &&
					msg.params.paging?.startingCursor != null &&
					this._state.rows != null
				) {
					const previousRows = this._state.rows;
					const startingCursor = msg.params.paging.startingCursor;

					this.logger.debug(
						scope,
						`paging in ${msg.params.rows.length} rows into existing ${previousRows.length} rows at ${startingCursor}`,
					);

					rows = appendRowsAtCursor(previousRows, startingCursor, msg.params.rows);
				} else if (msg.params.rows.length === 0) {
					// A carrier delta (avatars/riders/etc. with no rows change) — retain what we hold.
					this.logger.debug(scope, 'rows unchanged (carrier delta)');
					rows = this._state.rows;
				} else {
					this.logger.debug(scope, `setting to ${msg.params.rows.length} rows`);
					rows = msg.params.rows;
				}

				// `avatars`/`downstreams` are sent ABSENT (undefined) when unchanged — the host dedupes avatars
				// by Map size and ships `downstreams` only when its channel is marked (a refresh that changed the
				// upstream→branches map, a page/initial walk, or a snapshot). Keep our existing state when absent
				// instead of replacing with undefined and losing it.
				if (msg.params.avatars != null) {
					updates.avatars = msg.params.avatars;
				}
				if (msg.params.downstreams != null) {
					updates.downstreams = msg.params.downstreams;
				}
				// `refsMetadata`: a snapshot OR an explicit `refsMetadataReset` carries the authoritative full
				// map / `null` (reset-anchor REPLACE); a plain delta carries a value-reference delta (spread-merge
				// an object, replace on an explicit `null` reset, keep our state on `undefined` = no change).
				if (msg.params.refsMetadata === null) {
					updates.refsMetadata = null;
				} else if (msg.params.refsMetadata !== undefined) {
					updates.refsMetadata =
						snapshot || msg.params.refsMetadataReset
							? { ...msg.params.refsMetadata }
							: { ...this._state.refsMetadata, ...msg.params.refsMetadata };
				}
				// An explicit `refsMetadataReset` REPLACE (integration flip / feature toggle) may preserve a
				// non-empty upstream map, so the component can't detect it by emptiness — bump a token it
				// watches to re-arm its per-id request dedup (a snapshot re-seeds the component wholesale, so
				// it needs no token). Assigned directly (webview-only signal, not routed through `updateState`).
				if (msg.params.refsMetadataReset) {
					this.refsMetadataResetToken = (this.refsMetadataResetToken ?? 0) + 1;
				}
				updates.rows = rows;
				// Adopt the reachability table by generation id: a snapshot REPLACEs (reset-anchor), else append
				// the delta on same-generation pagination (cache preserved) / replace + reset on a new generation.
				this.applyReachabilityTable(msg.params.reachabilityTable, snapshot);
				updates.paging = msg.params.paging;
				// `rowsStats`: a snapshot REPLACEs wholesale (authoritative), a delta spread-merges the new keys.
				if (msg.params.rowsStats != null) {
					updates.rowsStats = snapshot
						? { ...msg.params.rowsStats }
						: { ...this._state.rowsStats, ...msg.params.rowsStats };
				}
				updates.rowsStatsLoading = msg.params.rowsStatsLoading;
				if (msg.params.rowsStatsIncluded !== undefined) {
					updates.rowsStatsIncluded = msg.params.rowsStatsIncluded;
				}
				if (msg.params.selectedRows != null) {
					updates.selectedRows = msg.params.selectedRows;
				}
				updates.loading = false;

				if (msg.params.search != null) {
					this.handleSearchNotification(msg.params.search, updates);
				}

				this.updateState(updates);

				// Advance the baseline now that application succeeded. A snapshot rebases BOTH values (its
				// generation may be new) and clears any outstanding resync; a contiguous delta advances the seq;
				// a legacy (no-sync) push is a no-op (no baseline movement).
				this._rowsSync.commit(sync);
				scope?.addExitInfo(`rows=${this._state.rows?.length ?? 0}`);
				break;
			}
			case DidChangeScrollMarkersNotification.is(msg):
				this.updateState({ context: { ...this._state.context, settings: msg.params.context } });
				break;

			case DidSearchNotification.is(msg):
				this.handleSearchNotification(msg.params, updates);
				this.updateState(updates);
				break;
			case DidChangeSelectionNotification.is(msg):
				this.updateState({ selectedRows: msg.params.selection });
				// Host-initiated reveals (Show in Commit Graph, terminal links, deep links) push the
				// selection here; user clicks aren't echoed back this way. Ask the app to scroll the
				// revealed row into view — the new engine doesn't auto-scroll on a plain selection the
				// way the legacy engine did.
				{
					const revealed = Object.keys(msg.params.selection ?? {})[0];
					if (revealed != null) {
						this.host.dispatchEvent(
							new CustomEvent('gl-graph-request-ensure-row-visible', {
								detail: revealed,
								bubbles: true,
							}),
						);
					}
				}
				break;

			case DidRequestOpenCompareModeNotification.is(msg):
				this.host.dispatchEvent(
					new CustomEvent('gl-graph-request-open-compare-mode', {
						detail: msg.params,
						bubbles: true,
					}),
				);
				break;

			case DidRequestOpenTimelineScopeNotification.is(msg):
				this.host.dispatchEvent(
					new CustomEvent('gl-graph-request-open-timeline-scope', {
						detail: msg.params,
						bubbles: true,
					}),
				);
				break;

			case DidRequestSearchNotification.is(msg):
				this.host.dispatchEvent(
					new CustomEvent('gl-graph-request-search', {
						detail: msg.params,
						bubbles: true,
					}),
				);
				break;

			case DidRequestActiveSidebarPanelNotification.is(msg):
				this.updateState({
					sidebar: { ...this.sidebar, visible: true, activePanel: msg.params.panel },
				});
				break;

			case DidRequestGraphActionNotification.is(msg):
				// Pre-populate the WIP draft for the target worktree FIRST so `loadWipDraft` (which
				// fires when the panel anchors on the new WIP row in this same render cycle) finds
				// the seeded message on its first pass — avoids a one-frame empty box before the
				// post-`updateComplete` `setCommitMessage` would override it.
				if (msg.params.action === 'show-wip' && msg.params.commitMessage != null && msg.params.target != null) {
					this.setWipDraft(msg.params.target.worktreePath, {
						message: msg.params.commitMessage,
						messageDirty: true,
					});
				}
				this.updateState({
					pendingAction: {
						action: msg.params.action,
						target: msg.params.target,
						commitMessage: msg.params.commitMessage,
						scopeBranch: msg.params.scopeBranch,
						composeInstructions: msg.params.composeInstructions,
						composeScope: msg.params.composeScope,
					},
					...(msg.params.action !== 'scope-to-branch' ? { details: { ...this.details, visible: true } } : {}),
				});
				break;

			case DidChangeGraphConfigurationNotification.is(msg):
				this.updateState({ config: msg.params.config });
				break;

			case DidChangeSubscriptionNotification.is(msg):
				this.updateState({
					subscription: msg.params.subscription,
					allowed: msg.params.allowed,
				});
				break;

			case DidChangeOrgSettings.is(msg):
				this.updateState({ orgSettings: msg.params.orgSettings });
				break;

			case DidChangeOverviewNotification.is(msg):
				this.updateState({ overview: msg.params.overview });
				break;

			case DidChangeAgentSessionsNotification.is(msg):
				this.agentSessions = sortAgentSessions(msg.params.sessions);
				break;

			case DidChangeMcpBanner.is(msg):
				this.updateState({ mcpBannerCollapsed: msg.params });
				break;

			case DidChangeHooksBanner.is(msg):
				this.updateState({ hooksBannerCollapsed: msg.params });
				break;

			case DidChangeCanInstallClaudeHook.is(msg):
				this.updateState({ canInstallClaudeHook: msg.params });
				break;

			case DidChangeGraphWalkthroughBanner.is(msg):
				this.updateState({
					graphWalkthroughBannerCollapsed: msg.params.dismissed,
				});
				break;

			case DidChangeGraphWalkthroughComplete.is(msg):
				this.updateState({ graphWalkthroughComplete: msg.params });
				break;

			case DidChangeGraphWalkthroughStarted.is(msg):
				this.updateState({ graphWalkthroughStarted: msg.params });
				break;

			case DidChangeLayoutPromptNotification.is(msg):
				this.updateState({ layoutPromptNeeded: msg.params });
				break;

			case DidChangeWorkingTreeNotification.is(msg): {
				// Host always sends `wipMetadataBySha` as an object (possibly `{}`) so the merge
				// can correctly clear stale anchors. If a future host change ever omits the field
				// (or it's undefined for "unchanged"), don't destructively clear — leave existing
				// webview anchors in place. Read from the accessor (`this.wipMetadataBySha`) rather
				// than `this._state`: writebacks from `graph-wrapper.ts` and `graph-app.ts` assign
				// through the accessor and don't update `_state`, so reading `_state` here sees a
				// stale anchor-only map and the merge drops freshly-fetched `workDirStats` from
				// every secondary row (the visible pill flash).
				// `workingTreeStats` is just the primary wip's embedded `stats` (git-authoritative).
				// Files and counts travel together on the same `wip` object, so they can't drift —
				// no generation guard needed. Assign only when stats are present: `updateState`
				// enumerates keys, so `workingTreeStats: undefined` would actively CLEAR the badge.
				// The producer always populates `wip.stats` and skips this notification when the status
				// fetch fails, but guarding here keeps a stats-less push from blanking the badge and
				// matches the `DidRequestWipRefetchNotification` handler's discipline below.
				// Drop a push reflecting an older working tree than what's already applied (see `isStaleWip`) —
				// otherwise a delayed push regresses the cache/badge/overview. `wipMetadataBySha` is an independent
				// per-sha merge, so it still applies.
				const staleWip = this.isStaleWip(msg.params.repoPath, msg.params.wip);

				const updates: Partial<State> = {};
				if (!staleWip && msg.params.wip?.stats != null) {
					updates.workingTreeStats = msg.params.wip.stats;
					// Stamp ownership by the PUSH's repo, not the client's current `selectedRepository` (which lags
					// the host during a swap). This channel is primary-only host-side, so an early B tick during an
					// A→B switch is genuinely B's — attributing it to B lets its fresh stats supersede B's full-state
					// seed once the switch lands. (`repoPath === id` for file repos, the only producers of stats.)
					this._wipStatsRepo = msg.params.repoPath;
				}
				if (msg.params.wipMetadataBySha != null) {
					updates.wipMetadataBySha = mergeWipMetadata(
						this.wipMetadataBySha,
						msg.params.wipMetadataBySha,
						lastKnownWorkDirStatsBySha,
					);
				}
				// The host packs the full WIP into every working-tree notification (same
				// `git status` it already ran for the stats). The panel observes this and
				// applies it directly — no `getWip` round-trip needed.
				if (!staleWip && msg.params.wip != null) {
					updates.wip = msg.params.wip;
					// Seed the cache so re-opening the WIP panel paints from memory while a fresh
					// host push lands. The active-watcher set covers `isLive` derivation at read
					// time — we don't stamp it on the entry.
					this.cacheWip(msg.params.repoPath, msg.params.wip);
				}
				this.updateState(updates);
				// Merge the overview entry for the primary's current branch from the same fetch,
				// so the overview card's dirty/clean indicator AND inline breakdown counts stay
				// live without the bulk probe. Skip on detached HEAD (no branch to key by).
				if (!staleWip) {
					this.mergeOverviewWipForRepo(msg.params.repoPath, msg.params.wip, msg.params.wip?.stats);
				}
				break;
			}

			case DidRequestWipRefetchNotification.is(msg): {
				// Host pre-fetched the WIP for a non-active worktree (the active-repo watcher
				// wouldn't fire for it). Push it through the same channel as the regular
				// working-tree notification — the panel's `applyPushedWip` observer handles it.
				// Same ordering rule as the working-tree notification above — a refetch reflecting an older working
				// tree than what's applied must not regress the cache/badge/row metadata (see `isStaleWip`).
				if (msg.params.wip != null && !this.isStaleWip(msg.params.repoPath, msg.params.wip)) {
					const updates: Partial<State> = { wip: msg.params.wip };
					const { repoPath } = msg.params;
					// Stats travel embedded as `wip.stats` (host-computed from the same `git status`).
					const stats = msg.params.wip.stats;
					this.cacheWip(repoPath, msg.params.wip);

					// Host shipped its already-computed stats — use them directly rather than
					// deriving locally (would lose `pausedOpStatus` / `context` / `renamed`, and
					// the per-file classifier doesn't match `git diff --shortstat` semantics).
					if (stats != null && repoPath === this.selectedRepository) {
						updates.workingTreeStats = stats;
						this._wipStatsRepo = repoPath;
					}

					// Refresh the secondary row's metadata (workDirStats + pausedOpStatus) when
					// this push is for a secondary worktree. Same accessor-read rationale as the
					// `DidChangeWorkingTreeNotification` branch above.
					const wipMetadataBySha = this.wipMetadataBySha;
					if (stats != null && wipMetadataBySha != null) {
						const secondarySha = createSecondaryWipSha(repoPath);
						const prevSecondary = wipMetadataBySha[secondarySha];
						if (prevSecondary != null) {
							updates.wipMetadataBySha = {
								...wipMetadataBySha,
								[secondarySha]: {
									...prevSecondary,
									workDirStats: {
										added: stats.added,
										deleted: stats.deleted,
										modified: stats.modified,
									},
									workDirStatsStale: false,
									pausedOpStatus: stats.pausedOpStatus,
								},
							};
						}
					}
					this.updateState(updates);
					// Merge the overview entry from the same fetch. For secondaries the branchId
					// lives on `wipMetadataBySha[secondarySha].branchRef` (pre-computed host-side
					// with the MAIN repo path); fall back to deriving from the wip payload's
					// branch name if absent. `stats` carries the breakdown for the inline counts.
					this.mergeOverviewWipForRepo(repoPath, msg.params.wip, stats);
				}
				break;
			}

			case DidChangeRepoConnectionNotification.is(msg):
				this.updateState({ repositories: msg.params.repositories });
				break;

			case DidChangeWipDraftsNotification.is(msg):
				// Skip when the incoming map is structurally identical to ours — most commonly the
				// self-fire after our own flush (our own write triggers the storage onDidChange,
				// which fans the notification back to us). Avoids a redundant render cycle on
				// every flush.
				if (!areEqual(this.wipDrafts, msg.params.wipDrafts)) {
					this.updateState({ wipDrafts: msg.params.wipDrafts });
				}
				break;
		}
	}

	private handleSearchNotification(params: DidSearchParams, updates: Partial<State>): void {
		const prevSearchId = this._currentSearchId;

		// Control substate (id / spinner / mode / query-for-restore) is decided by the pure, unit-tested
		// `reduceGraphSearchControlState`; the results object is accumulated inline below (it needs the
		// prior results and isn't part of that decision). Apply the control substate immediately, exactly
		// as before (these were direct `this.x =` assignments), plus the new `searchQuery` propagation.
		const { ignore, next } = reduceGraphSearchControlState(
			{
				currentSearchId: prevSearchId,
				searching: this.searching,
				searchMode: this.searchMode,
				searchQuery: this.searchQuery,
			},
			params,
		);
		if (ignore) return;

		this._currentSearchId = next.currentSearchId;
		this.searching = next.searching;
		this.searchMode = next.searchMode;
		this.searchQuery = next.searchQuery;

		const cancelled = params.results == null && params.search == null;

		// Starting a new search clears the prior results (the merge below reads the pre-update accessor,
		// so this reset only affects the shipped `updates`, matching the original ordering).
		if (params.searchId !== prevSearchId) {
			updates.searchResults = undefined;
		}

		// Early exit for cancellation - just clear state
		if (cancelled) {
			updates.searchResults = params.results;
			return;
		}

		if (params.selectedRows != null) {
			updates.selectedRows = params.selectedRows;
			// No auto-reveal here: this notification also fires for progressive (partial) result batches,
			// and revealing on every tick would fight the user's scrolling. graph-header's request-response
			// paths (startSearch/onSearchPromise) own the new-search reveal.
		}

		// Process search results (control substate — incl. `searching` — was already applied above).
		if (params.results != null) {
			if (isGraphSearchResultsError(params.results)) {
				updates.searchResults = params.results;
			} else if (params.partial && this.searchResults != null && !isGraphSearchResultsError(this.searchResults)) {
				// For progressive updates, accumulate the incremental batches (backend sends only new
				// results in each batch to save IPC bandwidth) — merge new IDs with existing ones.
				const { ids, count, hasMore, commitsLoaded } = params.results;
				updates.searchResults = {
					ids: { ...this.searchResults.ids, ...ids },
					count: this.searchResults.count + count,
					hasMore: hasMore,
					commitsLoaded: {
						count: this.searchResults.commitsLoaded.count + commitsLoaded.count,
					},
				};
			} else {
				// For final results or first partial update, replace
				updates.searchResults = params.results;
			}
		}
	}

	/**
	 * LRU cache of the freshest `Wip` payload keyed by repo path. Lets `fetchDetails` paint the
	 * panel synchronously from memory while a host push lands. Private — consumers go through
	 * `setWip` / `getWipState`, not raw access.
	 *
	 * Bounded at 16 entries — comfortably covers one repo's worktrees plus a few neighbors;
	 * older entries naturally drop instead of growing without bound.
	 */
	private readonly _wips = new LruMap<string, { wip: Wip; timestamp: number }>(16);

	/**
	 * Highest {@link Wip.revision} accepted per repo path — the ordering high-water for `isStaleWip`.
	 *
	 * Deliberately NOT read off `_wips`: that cache is evictable, and evicting a repo's payload would forget its
	 * revision, so a delayed older push for it would then be accepted and regress the cache. Ordering state has to
	 * outlive the payload it ordered, and only ever increase. One number per repo path seen this session.
	 */
	private readonly _wipRevisions = new Map<string, number>();

	/**
	 * Which repo currently owns the primary `workingTreeStats` badge on the wip channel's behalf: its `repoPath`
	 * (stamped on each wip stats write; `repository.id` for file repos, the only producers), CLEARED when a
	 * full-state seed takes over. The full-state gate drops its (unstamped, early-snapshotted) stats when this
	 * matches the pushed `selectedRepository`, so the live channel's value wins — including one a working-tree
	 * tick delivered early during a repo swap, since ownership is stamped by the PUSH's repo (not the client's
	 * lagging current selection). Distinct from `_wipRevisions` (revision high-water, also advanced for probed
	 * secondaries); this marks only who owns the primary badge value.
	 */
	private _wipStatsRepo: string | undefined;

	/**
	 * The set of repo paths the host currently has an active working-tree watcher for. Drives
	 * `getWipState().isLive` so consumers know whether a cache hit will be refreshed by a
	 * push soon (true) or needs explicit revalidation (false).
	 *
	 * Membership = the primary `selectedRepository` plus any secondary worktrees in the latest
	 * `SyncWipWatchesCommand` set (computed from visible-secondary-WIP-shas).
	 */
	private _activeWipWatchers = new Set<string>();

	/**
	 * Optimistic-edit marker: when a local mutation (stage/unstage) writes the cache before the
	 * host's watcher tick lands, the entry is "ours" — `isLive` is suppressed until the next
	 * host push reconfirms.
	 */
	private _pendingLocalEditPaths = new Set<string>();

	/**
	 * Whether `wip` reflects an OLDER working tree than the one already cached for `repoPath`, per the host's
	 * monotonic {@link Wip.revision}. Payloads race — a debounced push can land after a newer push or after a forced
	 * refresh — so the graph-level mirrors (cache, badge, overview) must order by that marker rather than by arrival,
	 * or a delayed push regresses them. Unstamped payloads have no ordering to enforce and are never stale.
	 */
	private isStaleWip(repoPath: string, wip: Wip | undefined): boolean {
		if (wip?.revision == null) return false;

		const applied = this._wipRevisions.get(repoPath);
		return applied != null && wip.revision < applied;
	}

	/** Advance the ordering high-water for `repoPath`. Monotonic — a payload accepted for its content (an unstamped
	 *  wip, an optimistic local edit) must never lower the bar for the pushes that follow it. */
	private recordWipRevision(repoPath: string, wip: Wip): void {
		if (wip.revision == null) return;

		const applied = this._wipRevisions.get(repoPath);
		if (applied == null || wip.revision > applied) {
			this._wipRevisions.set(repoPath, wip.revision);
		}
	}

	/**
	 * Seed the wip cache from a host push (working-tree notification / refetch notification).
	 * Clears the pending-local-edit marker because this write IS the host-side reconciliation.
	 */
	private cacheWip(repoPath: string, wip: Wip): void {
		this._wips.set(repoPath, { wip: wip, timestamp: Date.now() });
		this.recordWipRevision(repoPath, wip);
		this._pendingLocalEditPaths.delete(repoPath);
	}

	/**
	 * Merge a single overview entry from a host wip push. Pushes a partial `overviewWip` with just
	 * the one branchId — the consumer at `graph-overview.ts` iterates `pushedWip.branchIds` and
	 * preserves untouched entries via the spread in `nextWipData`. New object reference forces the
	 * consumer's `_lastPushedWip !==` check to re-process.
	 *
	 * Discriminates by `repoPath === selectedRepository` rather than "try secondary lookup, fall
	 * back to deriving": a secondary push that lands before its `wipMetadataBySha` entry exists
	 * (early-mount race) must NOT fall back to deriving `getBranchId(secondaryPath, ...)` — that
	 * produces a phantom branchId no card renders, silently losing the update.
	 */
	private mergeOverviewWipForRepo(
		repoPath: string | undefined,
		wip: Wip | undefined,
		stats: WorkDirStats | undefined,
	): void {
		if (repoPath == null || wip == null) return;

		let branchId: string | undefined;
		if (repoPath === this.selectedRepository) {
			// Primary repo: derive directly from the wip payload's branch name + primary path.
			const branchName = wip.changes?.branchName;
			if (!branchName) return; // detached HEAD or empty

			branchId = getBranchId(repoPath, false, branchName);
		} else {
			// Secondary worktree: branchRef is pre-computed host-side with the MAIN repo path,
			// which is the format overview entries are keyed by. If metadata hasn't loaded yet,
			// skip — the next event for this worktree will recover once metadata lands.
			const secondarySha = createSecondaryWipSha(repoPath);
			branchId = this.wipMetadataBySha?.[secondarySha]?.branchRef;
			if (branchId == null) return;
		}

		const hasChanges = (wip.changes?.files?.length ?? 0) > 0;
		const pausedOpStatus = wip.changes?.pausedOpStatus;
		// Carry the breakdown when the push provides it — the active overview card renders inline
		// `commit-stats` from `workingTreeState` and would otherwise lag behind real-time edits
		// (only `hasChanges` would flip, leaving the counts frozen at the initial fetch values).
		// Mapped: `WorkDirStats.modified` → `GitDiffFileStats.changed`.
		// When stats is absent, intentionally omit the key from the merged entry so the consumer's
		// spread (`{ ...prev, ...wip }` in graph-overview.ts) preserves any cached breakdown.
		const prev = this.overviewWip;
		const prevEntry = prev?.wip?.[branchId];
		this.overviewWip = {
			branchIds: [branchId],
			wip: {
				...(prev?.wip ?? {}),
				[branchId]: {
					...prevEntry,
					hasChanges: hasChanges,
					pausedOpStatus: pausedOpStatus,
					...(stats != null
						? {
								workingTreeState: {
									added: stats.added,
									changed: stats.modified,
									deleted: stats.deleted,
								},
							}
						: {}),
				},
			},
		};
	}

	/**
	 * Optimistic write — flag the entry so subsequent `getWipState` calls report `isLive: false`
	 * until the host's watcher reconciles. Used by `DetailsActions.optimisticallyUpdate*` so the
	 * details panel can paint the staged-state flip without waiting for a `git status` round-trip.
	 */
	setWip(repoPath: string, wip: Wip): void {
		this._wips.set(repoPath, { wip: wip, timestamp: Date.now() });
		this.recordWipRevision(repoPath, wip);
		this._pendingLocalEditPaths.add(repoPath);
	}

	/**
	 * Ingest an AUTHORITATIVE wip for `repoPath` — a `getWip` RPC response, which the host produces from the same
	 * single `git status` as a push. Reconciles every mirror a push reconciles: the payload cache and its ordering
	 * high-water, the header/row badge stats, and the overview entry (otherwise the overview card's dirty indicator
	 * silently keeps pre-refresh state — only the notification handlers merged it).
	 *
	 * Distinct from {@link setWip}, which exists for OPTIMISTIC local guesses and so marks the entry non-live until
	 * the host reconciles. Marking host truth non-live makes every revisit buy another `git status` to re-confirm
	 * what the host just said — and on an idle repo, with no watcher ticks to reconcile it, that repeats forever.
	 *
	 * Ordering is the caller's to enforce (same contract as `setWip`) — the panel gates on its own applied revision
	 * before it paints, and ingesting a payload it didn't paint would strand the cache ahead of it.
	 */
	ingestWip(repoPath: string, wip: Wip): void {
		this.cacheWip(repoPath, wip);
		if (wip.stats != null) {
			this.setWorkingTreeStats(repoPath, wip.stats);
		}
		this.mergeOverviewWipForRepo(repoPath, wip, wip.stats);
	}

	/**
	 * Reseed `workingTreeStats` (the header / primary-row badge source) from a panel-driven
	 * `getWip` response. `stats` is the primary wip's embedded {@link WipStats} — git-authoritative
	 * and the SAME object as `wip.stats`, so the file list and counts can never disagree. No
	 * generation guard: with stats embedded in the wip there's no separate value to race, and a
	 * stale-but-consistent write self-corrects on the next host push.
	 *
	 * Repo-path guard mirrors `DidRequestWipRefetchNotification`'s primary-only update: the badges
	 * always reflect the active/selected repo, so a secondary worktree's `getWip` must NOT
	 * overwrite the primary's stats.
	 */
	setWorkingTreeStats(repoPath: string, stats: GraphWorkingTreeStats): void {
		if (repoPath !== this.selectedRepository) return;

		this._wipStatsRepo = repoPath;
		this.updateState({ workingTreeStats: stats });
	}

	/**
	 * Return the cached wip for `repoPath` along with metadata the caller needs to decide
	 * whether to revalidate. `isLive` is computed at read time from the host's active-watcher
	 * set — never stored on the entry — so a worktree that scrolls out of the viewport (no
	 * longer in `SyncWipWatchesCommand`) flips to non-live without anyone having to mutate state.
	 * Local optimistic edits also suppress `isLive` until the host reconciles.
	 */
	getWipState(repoPath: string): { wip: Wip; isLive: boolean; ageMs: number } | undefined {
		const entry = this._wips.get(repoPath);
		if (entry == null) return undefined;

		// Primary repo is always watched while selected; secondaries come from the latest
		// `updateActiveWipWatchers` call. Pending optimistic edits suppress `isLive` until the
		// host's push reconciles.
		const watched = repoPath === this.selectedRepository || this._activeWipWatchers.has(repoPath);
		const isLive = watched && !this._pendingLocalEditPaths.has(repoPath);
		return { wip: entry.wip, isLive: isLive, ageMs: Date.now() - entry.timestamp };
	}

	/**
	 * Update the set of repos with active host-side watchers. Called by `graph-wrapper.ts` when
	 * the SyncWipWatchesCommand visibility set changes, plus when `selectedRepository` changes —
	 * the primary repo is always considered watched as long as it's selected (the active-repo
	 * working-tree watcher is unconditionally on for it).
	 *
	 * Pure state — does not fire signals; reads happen on demand via `getWipState`.
	 */
	updateActiveWipWatchers(repoPaths: Iterable<string>): void {
		// Primary repo is unioned in dynamically at read time (see `getWipState`) so this method
		// only tracks the secondary set — no need to re-fire when `selectedRepository` changes.
		this._activeWipWatchers = new Set(repoPaths);
	}

	/** Patch one `(worktreePath, draft)` slot in the wipDrafts map. Routes through
	 *  {@link updateState} so `_state.wipDrafts` stays in sync with the signal accessor. Pass
	 *  `draft: null` to delete; the parent map collapses to `undefined` when empty.
	 *  Short-circuits when the slot's content is unchanged so per-keystroke flushes don't
	 *  trigger redundant panel re-renders.
	 *  Builds a fresh outer map rather than mutating — the signal accessor uses `Object.is`
	 *  comparison, so passing the same outer reference back through `updateState` would
	 *  silently skip the change notification and downstream subscribers wouldn't re-render. */
	setWipDraft(worktreePath: string, draft: StoredGraphWipDraft | null): void {
		const current = this.wipDrafts;
		const existing = current?.[worktreePath];
		if (
			draft != null &&
			existing?.message === draft.message &&
			existing?.messageDirty === draft.messageDirty &&
			existing?.amend?.baseSha === draft.amend?.baseSha
		) {
			return;
		}
		if (draft == null && existing == null) return;

		let merged: Record<string, StoredGraphWipDraft> | undefined;
		if (draft != null) {
			merged = { ...current, [worktreePath]: { ...draft } };
		} else {
			const { [worktreePath]: _, ...rest } = current ?? {};
			merged = hasKeys(rest) ? rest : undefined;
		}
		this.updateState({ wipDrafts: merged });
	}

	private fireProviderUpdate = debounce(() => this.provider.setValue(this, true), 100);

	protected updateState(partial: Partial<State>, silent?: boolean) {
		// Capture the selected repo so we can re-pin its WIP cache entry below if it changes.
		const prevSelectedRepo = this.selectedRepository;
		let hasChanges = false;
		for (const key in partial) {
			hasChanges = true;

			const value = partial[key as keyof State];
			// @ts-expect-error key is a key of State
			this._state[key] = value;

			if (BaseWebviewStateKeys.includes(key)) continue;

			// Update corresponding accessors
			switch (key) {
				case 'allowed':
					this.allowed = partial.allowed ?? false;
					break;
				case 'loading':
					this.loading = partial.loading ?? false;
					break;
				case 'searchResults':
					// searchResults is managed via searchResultsResponse, so update it specially
					this.searchResultsResponse = value as GraphSearchResults | GraphSearchResultsError | undefined;
					break;
				default:
					// @ts-expect-error key is a key of State
					this[key as keyof Omit<State, 'timestamp' | 'webviewId' | 'webviewInstanceId'>] = value;
					break;
			}
		}

		// Pin the active repo's WIP cache entry so it survives eviction pressure from browsing
		// many secondary worktrees — re-opening the primary WIP panel then paints from cache
		// instead of cold-loading a fresh `git status`. Unpin the previous primary on switch so
		// the `_pinned` set stays bounded (size 1) and stale primaries can eventually evict.
		if (this.selectedRepository !== prevSelectedRepo) {
			if (prevSelectedRepo != null) {
				this._wips.unpin(prevSelectedRepo);
			}
			if (this.selectedRepository != null) {
				this._wips.pin(this.selectedRepository);
			}
		}

		if (silent || !hasChanges) return;

		this.options.onStateUpdate?.(partial);
		this.fireProviderUpdate();
	}
}

/**
 * Resolve a full-state `workingTreeStats` push against the wip channel's ownership marker (`_wipStatsRepo`, the
 * repo the revision-ordered wip channel last wrote stats for). The full-state copy is UNSTAMPED and snapshotted
 * early in the host rebuild, so drop it while the wip channel still owns the repo this push is FOR
 * (`wipStatsRepo === incomingRepo`) — the live value wins, INCLUDING one delivered early during a repo swap
 * (hence comparing against the incoming repo, not the client's lagging current selection). Otherwise seed AND
 * hand ownership back (clear the marker), so a STALE marker from a prior visit can't wrongly drop a later seed
 * after a B→A→B swap-back. Returns the seed decision and the next ownership marker atomically.
 */
export function resolveFullStateWorkingTreeStats(
	incomingRepo: string | undefined,
	wipStatsRepo: string | undefined,
): { seed: boolean; wipStatsRepo: string | undefined } {
	if (wipStatsRepo === incomingRepo) return { seed: false, wipStatsRepo: wipStatsRepo };
	return { seed: true, wipStatsRepo: undefined };
}

/**
 * Sticky-restore is the only producer of `workDirStatsStale: true`. Live working-tree updates
 * push fresh stats directly via `DidRequestWipRefetchNotification` — they don't toggle this
 * flag. The flag exists so re-selection on a session-restored row (graph-app's
 * `fetchSelectedWorktreeWipStats`) refetches authoritative stats instead of trusting cached
 * guesses, and so the GK component's missing-stats request loop terminates cleanly.
 */
export function mergeWipMetadata(
	prev: State['wipMetadataBySha'],
	incoming: State['wipMetadataBySha'],
	lastKnownStats?: ReadonlyMap<string, WorkDirStats>,
): State['wipMetadataBySha'] {
	if (incoming == null) return undefined;
	if (prev == null) {
		// No prior state to merge from. If we have remembered stats from earlier in the session
		// for any incoming sha, seed them here so a re-introduced worktree row doesn't blink to
		// empty while the GK component requests fresh stats.
		if (lastKnownStats == null || lastKnownStats.size === 0) return incoming;

		let seeded: NonNullable<State['wipMetadataBySha']> | undefined;
		for (const [sha, entry] of Object.entries(incoming)) {
			if (entry.workDirStats != null) continue;

			const sticky = lastKnownStats.get(sha);
			if (sticky == null) continue;

			seeded ??= { ...incoming };
			seeded[sha] = { ...entry, workDirStats: sticky, workDirStatsStale: true };
		}
		return seeded ?? incoming;
	}

	const incomingKeys = Object.keys(incoming);
	const prevKeys = Object.keys(prev);
	let changed = incomingKeys.length !== prevKeys.length;

	const result: NonNullable<State['wipMetadataBySha']> = {};
	for (const [sha, entry] of Object.entries(incoming)) {
		const prevEntry = prev[sha];
		if (prevEntry != null) {
			// Preserve per-row derived fields fetched client-side via GetWipStatsRequest; anchor fields come from `entry`.
			// Without this, the library's resolveWipState falls back to the primary's workDirStats for secondary rows
			// between when the server rebuilds anchors and when fresh stats arrive, causing a visible flash.
			result[sha] = {
				...entry,
				workDirStats: prevEntry.workDirStats,
				workDirStatsStale: prevEntry.workDirStatsStale,
				pausedOpStatus: prevEntry.pausedOpStatus,
				// Client-side fetched (GetWipStatsRequest), like `pausedOpStatus`; preserve so the WIP
				// row's Resolve Conflicts menu doesn't flicker off when the host rebuilds anchors.
				hasConflicts: prevEntry.hasConflicts,
				// `hasChanges` is only sent on the graph-load probe build; per-tick pushes omit it.
				// Preserve the last-known dirty bit so the WIP bar doesn't drop a worktree between loads.
				hasChanges: entry.hasChanges ?? prevEntry.hasChanges,
				// Tracked branches send `hasUnpushed` every build; local-only branches only on the probe
				// build (`undefined` otherwise) — preserve it so their `↑` survives per-tick pushes. (`ahead`
				// is free every build, so it rides `...entry` above and needs no preservation.)
				hasUnpushed: entry.hasUnpushed ?? prevEntry.hasUnpushed,
			};
		} else {
			// Newly-seen sha for this push. If we've previously seen stats for this sha during
			// the session, restore them with `workDirStatsStale: true` so the row keeps showing
			// values across the upcoming refetch rather than briefly rendering an empty pill.
			const sticky = lastKnownStats?.get(sha);
			result[sha] =
				sticky != null && entry.workDirStats == null
					? { ...entry, workDirStats: sticky, workDirStatsStale: true }
					: entry;
		}

		if (changed) continue;

		if (
			entry.repoPath !== prevEntry?.repoPath ||
			entry.parentSha !== prevEntry?.parentSha ||
			entry.parentDate !== prevEntry?.parentDate ||
			entry.label !== prevEntry?.label ||
			entry.branchRef !== prevEntry?.branchRef ||
			// `ahead` is sent every build (incl 0), so a plain diff catches pushes that clear it.
			entry.ahead !== prevEntry?.ahead ||
			// Only the probe build carries `hasChanges`/local-only `hasUnpushed`; a per-tick push leaves
			// them undefined and must not register as a change (the merge above preserves the prior value).
			(entry.hasChanges != null && entry.hasChanges !== prevEntry?.hasChanges) ||
			(entry.hasUnpushed != null && entry.hasUnpushed !== prevEntry?.hasUnpushed) ||
			// Sent every build (a sync projection of the already-loaded `wt.branch`), so a plain content
			// diff is right. Must be compared: without it, a change confined to the branch (e.g. `behind`
			// moving after a fetch) leaves `changed` false, `prev` is returned, and the fresh branch is
			// silently discarded — freezing the WIP bar's hover on stale tracking data. `areEqual` (deep)
			// so a field the hover starts rendering later can't silently fall out of the comparison.
			!areEqual(entry.branch, prevEntry?.branch)
		) {
			changed = true;
		}
	}

	// Preserve reference when nothing changed so downstream reactive consumers don't churn.
	return changed ? result : prev;
}
