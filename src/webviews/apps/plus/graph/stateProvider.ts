import type { Connection, Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import type { ChannelGap, ChannelMeta, SequencedChannel } from '@eamodio/supertalk-core/handlers/channel.js';
import { Signal } from '@lit-labs/signals';
import { ContextProvider } from '@lit/context';
import type { GitGraphRow, GraphReachabilityTable } from '@gitlens/git/models/graph.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { appendRowsAtCursor } from '@gitlens/git/utils/graph.utils.js';
import { decodeReachabilitySet } from '@gitlens/git/utils/reachability.utils.js';
import { compareReachableRefs } from '@gitlens/git/utils/sorting.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { areEqual, hasKeys } from '@gitlens/utils/object.js';
import { defer } from '@gitlens/utils/promise.js';
import type { StoredGraphWipDraft } from '../../../../constants.storage.js';
import type { IpcMessage } from '../../../ipc/models/ipc.js';
import type {
	GraphAccessState,
	GraphColumnsService,
	GraphConfigurationService,
	GraphFiltersService,
	GraphNavigationService,
	GraphOverviewService,
	GraphRefsMetadataService,
	GraphRepoStatusService,
	GraphRowsService,
	GraphScopeService,
	GraphSearchState,
	GraphSelectionService,
	GraphServices,
	GraphStateService,
	GraphWipService,
	GraphWorktreeEnrichment,
} from '../../../plus/graph/graphService.js';
import type {
	GraphRefsMetadata,
	GraphRowsPayload,
	GraphRowsSplice,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphWipState,
	GraphWipStateById,
	State,
	Wip,
	WipStats,
	WorkDirStats,
} from '../../../plus/graph/protocol.js';
import { createWipRowId, isWipRowId } from '../../../plus/graph/protocol.js';
import type { WebviewState } from '../../../protocol.js';
import { DidChangeHostWindowFocusNotification } from '../../../protocol.js';
import type { Unsubscribe } from '../../../rpc/services/types.js';
import type { OverviewBranchMergeTarget } from '../../../shared/overviewBranches.js';
import type { ReactiveElementHost } from '../../shared/appHost.js';
import { signalObjectState, signalState } from '../../shared/components/signal-utils.js';
import type { LoggerContext } from '../../shared/contexts/logger.js';
import { subscribeAll } from '../../shared/events/subscriptions.js';
import type { HostIpc } from '../../shared/ipc.js';
import { StateProviderBase } from '../../shared/stateProviderBase.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import type { AppState } from './context.js';
import { graphStateContext } from './context.js';
import { getGraphDebugDiagnostics } from './graphDebugDiagnostics.js';
import { getSelectedRepoPath } from './utils/repository.utils.js';
import { hasDirtyCounts } from './utils/wip.utils.js';

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

/** Lightweight scope anchor returned by `GraphScopeService.resolveScope` and cached webview-side. */
export type ResolvedScopeAnchor = {
	mergeBase: { sha: string; date: number } | undefined;
	mergeTargetTipSha: string | undefined;
	/** Merge-target branch name paired with `mergeTargetTipSha` — row-marker labels the target tip from it.
	 *  OPTIONAL (`?:`), unlike its siblings' `| undefined`: those predate this field and every existing
	 *  constructor omits it entirely, so requiring the key would break callers that legitimately have no
	 *  target to name — a name only exists when `mergeTargetTipSha` does. */
	mergeTargetName?: string;
	focalBranchTipSha: string | undefined;
};

/**
 * Returns the scope without `mergeTargetTipSha` when `mergeBase` isn't set. An unpaired target tip
 * can't re-root anything (`computeScopeProjection` needs a fork point), so all it does is land in the
 * scope walk's `unreachable` set — which `onScopeAnchorsUnreachable` answers by paging toward it. For a
 * stale target tip many years back in history that means paging deep into unrelated history for an anchor
 * that will never be used, so the scope stays bare instead.
 *
 * Note this fires only when the host resolved NO base at all (no merge target, failed
 * resolve). A resolved-but-not-yet-loaded base is published as-is — see `publishResolvedScope`.
 */
function stripUnpairedMergeTarget(scope: GraphScope): GraphScope {
	if (scope.mergeBase != null || scope.mergeTargetTipSha == null) return scope;

	const { mergeTargetTipSha: _, ...rest } = scope;
	return rest;
}

/**
 * True when a freshly-resolved anchor shows the live scope's anchors may describe pre-rewrite history:
 * the resolver placed the merge base elsewhere, or the focal branch tip moved since they were resolved
 * (rebase / amend / reset). Deliberately CONSERVATIVE on the tip — an amend rewrites history while
 * leaving the merge base where it was, so tip movement has to count, which means an ordinary commit
 * trips this too. Callers must therefore treat it as "re-examine these anchors", not "discard them":
 * acting on it without a replacement in hand would bare a perfectly good scope. Anchors are SHAs, so a
 * rewrite leaves them behind as ordinary commits —
 * still present in the loaded rows, still anchoring the fork-point / merge-target markers and bounding
 * the scope walk at the wrong commit. The guards that otherwise protect a working anchor from a
 * transient re-resolve key off this to know when letting go is the correct move.
 */
export function isScopeAnchorStale(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): boolean {
	if (anchor == null || (scope.mergeBase == null && scope.mergeTargetTipSha == null)) return false;
	if (anchor.mergeBase != null && scope.mergeBase != null && anchor.mergeBase.sha !== scope.mergeBase.sha) {
		return true;
	}

	return (
		anchor.focalBranchTipSha != null &&
		scope.focalBranchTipSha != null &&
		anchor.focalBranchTipSha !== scope.focalBranchTipSha
	);
}

/**
 * Folds a freshly-resolved anchor into the live scope, or returns `undefined` when nothing should
 * change (the caller then leaves `this.scope` untouched rather than assigning a no-op spread that
 * would re-zoom the minimap for nothing). Split out of `patchScopeAnchor` so the replacement rules —
 * which decide whether a rebase's stale anchors are dropped and whether an ordinary commit keeps a
 * working one — are directly testable.
 *
 * Whether an anchor's commits are currently LOADED is deliberately not a factor: anchor reachability is
 * row membership, which every rows push re-derives, so an anchor that resolves ahead of its rows is
 * correct-but-early rather than unusable.
 */
export function applyScopeAnchorPatch(scope: GraphScope, anchor: ResolvedScopeAnchor): GraphScope | undefined {
	// Host couldn't resolve any field — nothing to fold in.
	if (anchor.mergeBase == null && anchor.mergeTargetTipSha == null && anchor.focalBranchTipSha == null) {
		return undefined;
	}

	// History may have moved under the live anchors — see `isScopeAnchorStale`. Only actionable
	// alongside a replacement, hence `replacesAnchors` below.
	const stale = isScopeAnchorStale(scope, anchor);

	// Skip if every patchable field already matches — prevents a redundant signal update that
	// would re-zoom the minimap needlessly.
	const mergeBaseSame =
		scope.mergeBase?.sha === anchor.mergeBase?.sha && scope.mergeBase?.date === anchor.mergeBase?.date;
	// `mergeTargetTipSha` may also be supplied by enrichment via `reconcileScopeMergeTarget`.
	// Only overwrite when the resolver returned a value AND it differs — `undefined` from the
	// resolver shouldn't clobber an enrichment-supplied SHA.
	const targetTipSame = anchor.mergeTargetTipSha == null || anchor.mergeTargetTipSha === scope.mergeTargetTipSha;
	const focalTipSame = anchor.focalBranchTipSha == null || anchor.focalBranchTipSha === scope.focalBranchTipSha;
	if (mergeBaseSame && targetTipSame && focalTipSame) return undefined;

	const next: GraphScope = { ...scope };
	// Drop anchors the fresh resolve replaces — the resolver answers with both or neither, so a leftover
	// would otherwise ride along under the new tip (and enrichment can re-supply a target tip once
	// refetched). Gated on the resolve actually CARRYING anchor data: staleness also fires when the focal
	// tip merely advanced — an ordinary commit does that — and a focal-tip-only answer (no merge target,
	// or a partial resolve) offers no replacement, so dropping there would silently bare a working scope
	// with no rewrite involved.
	const replacesAnchors = anchor.mergeBase != null || anchor.mergeTargetTipSha != null;
	if (stale && replacesAnchors) {
		delete next.mergeBase;
		delete next.mergeTargetTipSha;
	}
	if (anchor.mergeBase != null && (stale || !mergeBaseSame)) {
		next.mergeBase = anchor.mergeBase;
	}
	if (anchor.mergeTargetTipSha != null && (stale || !targetTipSame)) {
		next.mergeTargetTipSha = anchor.mergeTargetTipSha;
	}
	if (anchor.focalBranchTipSha != null && !focalTipSame) {
		next.focalBranchTipSha = anchor.focalBranchTipSha;
	}
	return next;
}

/**
 * Returns the scope with `mergeTargetTipSha` backfilled from the branch's enrichment, or the
 * original scope reference when nothing needs to change. Callers use reference-equality to know
 * whether they need to publish a new scope value.
 *
 * Skips the backfill when the scope has neither `mergeBase` nor a prior `mergeTargetTipSha` — the bare
 * scope state `setScope` leaves behind when the anchor IPC bailed. Promoting just a `mergeTargetTipSha`
 * onto a bare scope gives the scope walk an anchor it can't re-root on (no merge base) but will report
 * unreachable, which the unreachable-anchor handler answers by paging toward it — deep into unrelated
 * history for a stale target tip. The bare scope keeps the dim-in-place treatment instead.
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

/** The row marker's merge target as carried by a resolved anchor — undefined when the anchor named no
 *  target tip (detached, or a resolve that bailed). */
function rowMarkerTargetFromAnchor(anchor: ResolvedScopeAnchor | undefined): AppState['rowMarkerMergeTarget'] {
	return anchor?.mergeTargetTipSha != null
		? { sha: anchor.mergeTargetTipSha, name: anchor.mergeTargetName }
		: undefined;
}

/** How many of a search's results are loaded as rows. WIP results are synthetic rows standing in for a
 *  worktree's working changes — they have no commit to page in, so they always count as loaded.
 *  Takes the loaded shas as a set rather than the rows, so the set survives result-only changes (a
 *  progressive search re-counts against an unchanged graph many times over). */
export function countLoadedSearchResults(
	results: GraphSearchResults | GraphSearchResultsError | undefined,
	loadedShas: ReadonlySet<string>,
): number {
	if (results == null || isGraphSearchResultsError(results) || results.ids == null) return 0;

	let count = 0;
	for (const id of Object.keys(results.ids)) {
		if (isWipRowId(id) || loadedShas.has(id)) {
			count++;
		}
	}

	return count;
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

// Sticky cache of the last-known `workDirStats` value seen for each WIP row id. Used to bridge the
// visual gap when an entry briefly disappears from `wipStateById` and re-enters via the
// `prevEntry == null` path — without this, the GK component renders no pill for the row across the
// 350ms settle + IPC round trip, producing a visible flash. One GraphStateProvider per webview, so
// module-level is effectively per-instance state.
export const lastKnownWorkDirStatsBySha = new Map<string, WorkDirStats>();

/** Ceiling on {@link lastKnownWorkDirStatsBySha}, evicting oldest-first (`Map` iterates in insertion
 *  order). A cap rather than pruning against `wipRowsById`: a row vanishing from the topology is exactly
 *  the flap this cache exists to survive — the host pushes an empty rows object when a worktree
 *  enumeration comes back short (`graphWipService.getWipRows`) — so topology-keyed pruning would delete
 *  each entry at the moment it's needed. Entries are three integers; 128 outlasts any real flap. */
const lastKnownWorkDirStatsLimit = 128;

function captureLastKnownWorkDirStats(map: State['wipStateById']): void {
	if (map == null) return;

	for (const [sha, entry] of Object.entries(map)) {
		if (entry.workDirStats != null) {
			// Re-insert so the entry counts as recently seen against the eviction order.
			lastKnownWorkDirStatsBySha.delete(sha);
			lastKnownWorkDirStatsBySha.set(sha, entry.workDirStats);
		}
	}

	while (lastKnownWorkDirStatsBySha.size > lastKnownWorkDirStatsLimit) {
		const oldest = lastKnownWorkDirStatsBySha.keys().next();
		if (oldest.done) break;

		lastKnownWorkDirStatsBySha.delete(oldest.value);
	}
}

export class GraphStateProvider extends StateProviderBase<State['webviewId'], AppState, typeof graphStateContext> {
	// App state members moved from GraphAppState
	@signalState()
	accessor activeDay: AppState['activeDay'];

	@signalState()
	accessor activeRow: AppState['activeRow'];

	@signalState()
	accessor displayMode: AppState['displayMode'];

	@signalState()
	accessor gitHealthBanner: AppState['gitHealthBanner'];

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
	accessor pendingCompare: AppState['pendingCompare'];

	@signalState()
	accessor wipDrafts: State['wipDrafts'];

	@signalState()
	accessor visualizationMode: AppState['visualizationMode'];

	@signalState()
	accessor treemapMode: AppState['treemapMode'];

	get isBusy(): AppState['isBusy'] {
		return this.loading || this.ensureLoading || this.searching || /*this.rowsStatsLoading ||*/ false;
	}

	@signalState(false)
	accessor loading: AppState['loading'] = false;

	/**
	 * Delayed loading state for targeted row loads. It is independent from paging's `loading` flag,
	 * and reference-counted because search navigation and an external reveal can overlap.
	 */
	@signalState(false)
	accessor ensureLoading: boolean = false;
	private _ensureLoadingCount = 0;
	private _ensureLoadingTimer?: ReturnType<typeof setTimeout>;

	beginEnsureLoading(): () => void {
		this._ensureLoadingCount++;
		this._ensureLoadingTimer ??= setTimeout(() => {
			this._ensureLoadingTimer = undefined;
			if (this._ensureLoadingCount > 0) {
				this.ensureLoading = true;
			}
		}, GraphStateProvider.ensureLoadingDelayMs);

		let ended = false;
		return () => {
			if (ended) return;

			ended = true;
			this._ensureLoadingCount = Math.max(0, this._ensureLoadingCount - 1);
			if (this._ensureLoadingCount !== 0) return;

			if (this._ensureLoadingTimer != null) {
				clearTimeout(this._ensureLoadingTimer);
				this._ensureLoadingTimer = undefined;
			}
			this.ensureLoading = false;
		};
	}

	/**
	 * Signals that a scope-anchor IPC is in flight long enough to warrant a loading affordance.
	 * Composed with `loading` at the `gl-graph` render boundary (see `graph-wrapper.ts`) so
	 * scope-resolution and row-loading share the same visual indicator without sharing
	 * lifecycle — setScope owns this signal end-to-end (set on a delay timer, cleared in its
	 * finally), independent from the paging and targeted-row loading signals.
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

	/** The loaded rows' shas, held apart from the count below so paging pays for the set once and a
	 *  progressive search's result batches re-count against it without rebuilding it. */
	private readonly _loadedRowShas = new Signal.Computed<ReadonlySet<string>>(
		() => new Set(this.rows?.map(r => r.sha)),
	);

	/** {@link countLoadedSearchResults} over the active search and the loaded rows, recomputed only when
	 *  one of them changes. Both consumers read it at render time. Reads `searchResults` before touching
	 *  `_loadedRowShas` so an idle (no active search) run never depends on — and never rebuilds — the
	 *  rows Set on every rows tick. */
	private readonly _searchResultsLoadedCount = new Signal.Computed<number>(() => {
		const results = this.searchResults;
		if (results == null) return 0;

		return countLoadedSearchResults(results, this._loadedRowShas.get());
	});
	get searchResultsLoadedCount(): number {
		return this._searchResultsLoadedCount.get();
	}

	@signalState<AppState['activeFilterColumns']>(new Set())
	accessor activeFilterColumns: AppState['activeFilterColumns'] = new Set();

	@signalState()
	accessor searchResultsError: AppState['searchResultsError'];

	@signalState()
	accessor searchQuery: AppState['searchQuery'];

	@signalState()
	accessor searchFallback: AppState['searchFallback'];

	@signalState()
	accessor searchRelaxations: AppState['searchRelaxations'];

	@signalState<AppState['searchSession']>(0)
	accessor searchSession: AppState['searchSession'] = 0;

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
	accessor trusted: State['trusted'] = true;

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

	// Bumped on every authoritative refsMetadata REPLACE (`onRefsMetadataChanged`) so the graph component
	// can re-arm its per-id request dedup even when the strip preserves a non-empty (upstream) map.
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

	/** Stable per-worktree WIP row topology, EVERY worktree including the graph's own. */
	@signalState()
	accessor wipRowsById: State['wipRowsById'];

	/** Hot per-worktree WIP state, keyed by the same row ids as {@link wipRowsById}. */
	@signalState<State['wipStateById']>(undefined, {
		// Maintain a sticky cache of last-known `workDirStats` keyed by WIP row id so that
		// `mergeWipState` can recover stats for an entry that briefly disappears from
		// `wipStateById` (e.g. host worktree-list flap, transient `wt.sha == null`,
		// reduced-set full-state push) and re-enters via the `prevEntry == null` path. Without
		// this, the GK component sees `workDirStats: undefined` and renders nothing for the row
		// until the settle delay + IPC round trip resolves — that's the visible pill flash.
		afterChange: (_target: GraphStateProvider, value) => captureLastKnownWorkDirStats(value),
	})
	accessor wipStateById: State['wipStateById'];

	@signalState()
	accessor wip: State['wip'];

	@signalState()
	accessor scope: AppState['scope'];

	@signalState()
	accessor rowMarkerMergeTarget: AppState['rowMarkerMergeTarget'];

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
		// the user to re-scope. The row-marker target rides the same correction — it resolves through a
		// PR-timeout fallback that enrichment's settled answer supersedes.
		afterChange: (target: GraphStateProvider, value) => {
			const next = reconcileScopeMergeTarget(target.scope, value);
			if (next !== target.scope) {
				target.scope = next;
			}
			target.reconcileRowMarkerMergeTarget(value);
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

	agentsBannerCollapsed?: boolean | undefined;
	mcpCanAutoRegister?: boolean | undefined;
	canInstallHooks?: boolean | undefined;
	hooksAgents?: readonly { id: string; displayName: string; installed: boolean }[] | undefined;
	graphWalkthroughStarted?: boolean | undefined;
	layoutPromptNeeded?: boolean | undefined;

	/** The overview RPC sub-service, held for {@link ensureOverviewEnrichmentFetched} and
	 *  {@link ensureEnrichmentFetchedForBranches} — set by {@link initializeServices}. */
	private _overviewService: GraphOverviewService | undefined;
	/** The scope-anchor RPC sub-service, held for {@link fetchScopeAnchor} — set by
	 *  {@link initializeServices}. */
	private _scopeService: GraphScopeService | undefined;
	/** The config RPC sub-service — held only for its {@link GraphConfigurationService.onDidChange}
	 *  subscription; reads/writes go through `graphServicesContext` at the call site instead. Set by
	 *  {@link initializeServices}. */
	private _configService: GraphConfigurationService | undefined;
	/** The columns RPC sub-service — held only for its {@link GraphColumnsService.onDidChange}
	 *  subscription; writes go through `graphServicesContext` at the call site instead. Set by
	 *  {@link initializeServices}. */
	private _columnsService: GraphColumnsService | undefined;
	/** The filters RPC sub-service — held only for its {@link GraphFiltersService.onDidChange}
	 *  subscription; writes go through `graphServicesContext` at the call site instead. Set by
	 *  {@link initializeServices}. */
	private _filtersService: GraphFiltersService | undefined;
	/** The WIP RPC sub-service — held only for its {@link GraphWipService.onDraftsChanged}
	 *  subscription; the details panel's draft writes go through its own remote instead. Set by
	 *  {@link initializeServices}. */
	private _wipService: GraphWipService | undefined;
	/** The navigation RPC sub-service — held only for its five `onRequest…` subscriptions (the warm
	 *  host→app navigation pushes; see `GraphNavigationService`). Set by {@link initializeServices}. */
	private _navigationService: GraphNavigationService | undefined;
	/** The selection RPC sub-service — held only for its two host→app pushes (host-initiated reveals and
	 *  the reveals that failed; see `GraphSelectionService`). Set by {@link initializeServices}. */
	private _selectionService: GraphSelectionService | undefined;
	/** The refs-metadata RPC sub-service — held only for its reset-class push (see
	 *  `GraphRefsMetadataService`). Set by {@link initializeServices}. */
	private _refsMetadataService: GraphRefsMetadataService | undefined;
	/** The full-state-push RPC sub-service — held only for its {@link GraphStateService.onStateChanged}
	 *  subscription. Set by {@link initializeServices}. */
	private _stateService: GraphStateService | undefined;
	/** The repo/branch-status RPC sub-service — held only for its `onBranchStateChanged` /
	 *  `onRepoConnectionChanged` subscriptions (see `GraphRepoStatusService`). Set by
	 *  {@link initializeServices}. */
	private _repoStatusService: GraphRepoStatusService | undefined;
	/** Resolved once {@link initializeServices} has assigned {@link _overviewService} and
	 *  {@link _scopeService} — callers that need either before the RPC handshake completes await this
	 *  instead of racing it. Same resolve-once-per-lifetime semantics as `SearchActions`' `serviceReady`:
	 *  re-initializing on reconnect reassigns both services but never re-settles this promise. */
	private readonly _servicesReady = defer<void>();
	/** The rows RPC sub-service — held for {@link resyncRows}, the rows plane's only recovery call. Set by
	 *  {@link initializeServices}. */
	private _rowsService: GraphRowsService | undefined;
	/** Unsubscribes this provider's `graph:rows` channel listeners. */
	private readonly _unsubscribeRowsChannel: (() => void)[] = [];
	/** The RPC event subscription, armed once (per provider lifetime) by {@link initializeServices}. The
	 *  library re-runs {@link connectServices} on every successful handshake (reconnects included) and
	 *  re-issues every event subscription against the fresh remote, so there's no per-mount re-wiring,
	 *  teardown preamble, or staleness guard to maintain here — {@link dispose} unsubscribes it once. */
	private _servicesSubscription: Subscription | undefined;

	constructor(
		host: ReactiveElementHost,
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
		private readonly options: {
			onStateUpdate?: (partial: Partial<State>) => void;
			/** The app host's `graph:rows` channel — the rows plane's sole inbound path. */
			rowsChannel: SequencedChannel<GraphRowsPayload>;
		},
	) {
		super(host, bootstrap, ipc, logger);

		// Subscribed in the constructor, not in `initializeState`: the base constructor already fired
		// `WebviewReadyRequest` (which is what unblocks the host's first emission), and `initializeState`
		// only resolves a turn later. Both happen in THIS synchronous task, so no emission can interleave
		// ahead of these listeners — but a subscribe deferred to an await would race the first snapshot,
		// and a missed delivery still advances the channel's expected seq (silently, no gap event).
		this._unsubscribeRowsChannel.push(
			options.rowsChannel.subscribe((params, meta) => this.applyRowsPayload(params, meta)),
			options.rowsChannel.onGap(gap => this.onRowsGap(gap)),
		);
	}

	/**
	 * Wires this provider against the connected RPC services — called from `graph.ts`'s
	 * `_onRpcReady` on every ready, but only arms {@link _servicesSubscription} the first time. The
	 * library re-runs {@link connectServices} on every successful handshake (reconnects included),
	 * so there's no per-mount re-wiring here.
	 */
	initializeServices(connection: Connection): void {
		this._servicesSubscription ??= subscribe<GraphServices>(connection, async services =>
			this.connectServices(services),
		);
	}

	private async connectServices(services: Remote<GraphServices>): Promise<Unsubscribe> {
		// One round-trip for the whole set. A rejection here (a torn-down connection is the only
		// realistic cause) propagates to the library, which logs it and re-issues this subscriber on
		// the next successful handshake — `_servicesReady` deliberately stays pending until a
		// handshake actually delivers the services, so its awaiters resolve against a live set
		// rather than a dead one.
		const [
			overview,
			scope,
			configuration,
			columns,
			filters,
			wip,
			navigation,
			selection,
			refsMetadata,
			state,
			repoStatus,
			rows,
		] = await Promise.all([
			services.overview,
			services.scope,
			services.configuration,
			services.columns,
			services.filters,
			services.wip,
			services.navigation,
			services.selection,
			services.refsMetadata,
			services.state,
			services.repoStatus,
			services.rows,
		]);
		this._overviewService = overview;
		this._scopeService = scope;
		this._configService = configuration;
		this._columnsService = columns;
		this._filtersService = filters;
		this._wipService = wip;
		this._navigationService = navigation;
		this._selectionService = selection;
		this._refsMetadataService = refsMetadata;
		this._stateService = state;
		this._repoStatusService = repoStatus;
		this._rowsService = rows;
		this._servicesReady.fulfill();

		return subscribeAll([
			() =>
				overview.onOverviewChanged(data => {
					this.updateState({ overview: data });
				}),
			() =>
				scope.onScopeAnchorsInvalidated(data => {
					this.handleScopeAnchorsInvalidated(data.repoPath);
				}),
			() =>
				configuration.onDidChange(data => {
					this.updateState({ config: data });
				}),
			// One writer for all three context slots: `settings` is derived from BOTH the column settings and
			// the scroll-marker settings, so the snapshot carries every one and this write replaces all three.
			() =>
				columns.onDidChange(data => {
					this.updateState({
						columns: data.columns,
						context: {
							...this._state.context,
							header: data.headerContext,
							settings: data.settingsContext,
							scrollMarkers: data.scrollMarkersContext,
						},
					});
				}),
			// One writer for all five filter slots — branch visibility, the hidden ref/type sets, the included
			// refs, and the pinned ref all come from the same storage record, so the snapshot replaces them
			// together and two paints can never disagree.
			() =>
				filters.onDidChange(data => {
					// The deferred scope clear is consumed HERE, on the push — never on a write's resolution. A
					// `setScope` landing between the write and this push must not be clobbered (see `setScope`).
					if (this._scopeClearDeferred) {
						this._scopeClearDeferred = false;
						this.clearScope();
					}
					this.updateState({
						branchesVisibility: data.branchesVisibility,
						excludeRefs: data.excludeRefs,
						excludeTypes: data.excludeTypes,
						includeOnlyRefs: data.includeOnlyRefs,
						pinnedRef: data.pinnedRef,
					});
				}),
			() =>
				wip.onDraftsChanged(data => {
					// Skip when the incoming map is structurally identical to ours — most commonly the
					// self-fire after our own flush (our own write triggers the storage watcher, which
					// fans the event back to us). Avoids a redundant render cycle on every flush.
					if (!areEqual(this.wipDrafts, data)) {
						this.updateState({ wipDrafts: data });
					}
				}),
			// Payload is CUMULATIVE (every sha closed since our last `syncWatches` call), not a full-state
			// snapshot — see `GraphWipService.onWatchesClosed`. `markWipWatchesClosed` is idempotent for
			// shas it's already marked closed, so replaying old ones alongside new ones is harmless.
			() =>
				wip.onWatchesClosed(data => {
					// Coverage for these worktrees just ended (or ended earlier and is being replayed). Flag
					// what we hold for them as unverified so the visible-range scan re-reads their counts and
					// the details panel stops treating its cached payload as live — anything that happens to
					// them from now until they're watched again reaches nobody.
					this.markWipWatchesClosed(data.shas);
				}),
			// TWO subscriptions, one handler: the tick and the background peer probe produce disjoint slices
			// of the same planes and ride separate `save-last` events so neither can swallow the other (see
			// `GraphWipService.onWorkingTreeChanged`). Routing both through `applyWorkingTreeChange` keeps
			// their merge semantics byte-identical.
			() =>
				wip.onWorkingTreeChanged(data => {
					this.applyWorkingTreeChange(data);
				}),
			() =>
				wip.onWorktreeEnrichment(data => {
					this.applyWorkingTreeChange(data);
				}),
			() =>
				wip.onWipRefetched(data => {
					this.applyWipRefetch(data);
				}),
			() =>
				navigation.onRequestAction(data => {
					// Pre-populate the WIP draft for the target worktree FIRST so `loadWipDraft` (which
					// fires when the panel anchors on the new WIP row in this same render cycle) finds
					// the seeded message on its first pass — avoids a one-frame empty box before the
					// post-`updateComplete` `setCommitMessage` would override it.
					if (data.action === 'show-wip' && data.commitMessage != null && data.target != null) {
						this.setWipDraft(data.target.worktreePath, {
							message: data.commitMessage,
							messageDirty: true,
						});
					}
					this.updateState({
						pendingAction: {
							action: data.action,
							target: data.target,
							commitMessage: data.commitMessage,
							scopeBranch: data.scopeBranch,
							scopeOrigin: data.scopeOrigin,
							composeInstructions: data.composeInstructions,
							composeScope: data.composeScope,
							agentSessionId: data.agentSessionId,
							revealOnly: data.revealOnly,
							followed: data.followed,
							onlyIfWipSelected: data.onlyIfWipSelected,
						},
						...(data.action !== 'scope-to-branch' && !data.revealOnly
							? { details: { ...this.details, visible: true } }
							: {}),
					});
				}),
			() =>
				navigation.onRequestOpenCompareMode(data => {
					this.host.dispatchEvent(
						new CustomEvent('gl-graph-request-open-compare-mode', {
							detail: data,
							bubbles: true,
						}),
					);
				}),
			() =>
				navigation.onRequestOpenTimelineScope(data => {
					this.host.dispatchEvent(
						new CustomEvent('gl-graph-request-open-timeline-scope', {
							detail: data,
							bubbles: true,
						}),
					);
				}),
			() =>
				navigation.onRequestVisualization(data => {
					// Both axes are needed: `visualizationMode` picks WHICH visualization, while `displayMode`
					// is what makes the visualizations pane render at all — setting only the former leaves the
					// graph on screen. (`openTimelineScope` sets the pair for the same reason.)
					this.displayMode = 'visualizations';
					this.visualizationMode = data.visualization;
				}),
			() =>
				navigation.onRequestActiveSidebarPanel(data => {
					this.updateState({
						sidebar: { ...this.sidebar, visible: true, activePanel: data.panel },
					});
				}),
			() =>
				selection.onSelectionChanged(data => {
					this.updateState({ selectedRows: data });
					// Host-initiated reveals (Show in Commit Graph, terminal links, deep links) push the
					// selection here; user clicks aren't echoed back this way. Ask the app to scroll the
					// revealed row into view — the graph doesn't auto-scroll on a plain selection.
					const revealed = Object.keys(data ?? {})[0];
					if (revealed != null) {
						this.host.dispatchEvent(
							new CustomEvent('gl-graph-request-ensure-row-visible', {
								detail: revealed,
								bubbles: true,
							}),
						);
					}
				}),
			// RESET-CLASS ONLY — the payload is always a COMPLETE snapshot (`null` = feature off), so this
			// REPLACES rather than merges and bumps the component's request-dedup token. Incremental enrichment
			// never arrives here; it returns from `getMissingRefsMetadata` (see `graph-wrapper`).
			() =>
				refsMetadata.onRefsMetadataChanged(data => {
					this.applyRefsMetadataReset(data.metadata);
				}),
			() =>
				selection.onRevealFailed(data => {
					// A host-initiated reveal that gave up before ever pushing a selection (an unresolved ref) —
					// nothing else tells the webview the jump was a no-op, so surface it explicitly the same way
					// `gl-graph-request-ensure-row-visible` surfaces a successful one, above.
					this.host.dispatchEvent(
						new CustomEvent('gl-graph-request-reveal-failed', {
							detail: data,
							bubbles: true,
						}),
					);
				}),
			() =>
				state.onStateChanged(data => {
					const incoming = data.state;
					const next: Partial<State> = { ...incoming };
					// Both WIP planes merge rather than replace — the host only sends topology plus whatever
					// status it produced, so client-fetched peer stats (via `wip.getStats`) have to
					// survive a full-state push. Read from the accessors (`this.wipRowsById` /
					// `this.wipStateById`) rather than `_state`: writebacks from `graph-wrapper.ts` and
					// `graph-app.ts` assign through the accessor and don't update `_state`, so reading `_state`
					// would see a stale map and drop those stats (the visible pill flash).
					if (incoming.wipRowsById != null) {
						next.wipRowsById = mergeWipRows(this.wipRowsById, incoming.wipRowsById);
					}
					// Rows-plane fields (rows/downstreams/paging/reachabilityTable/rowsStats*) travel on the
					// publisher's `DidChangeRows` channel and arrive ABSENT here; `avatars`/`refsMetadata` are
					// owned by their request/response services and are bootstrap-only on this push. The one
					// exception that rides it live: `sync` (bootstrap-only baseline stamp — consumed by
					// `initializeState`, must not move the live baseline).
					// Drop `branchState` and `lastFetched` when the full-state push carries values
					// structurally equal to what's already applied. The fast paths (`DidChangeBranchState`,
					// `GraphRepoStatusService.onDidFetch`) land these ~20-30ms before the heavier full-state
					// rebuild; without this guard the bulk push re-assigns the same values and Lit's
					// identity-based reactivity forces a redundant header re-render for every pull/push/fetch.
					if (areEqual(next.branchState, this._state.branchState)) {
						delete next.branchState;
					}
					// `lastFetched` has the same build-start-read / late-ship race as `branchState`, but needs no
					// stamp: it's a timestamp that only moves FORWARD within a repo, so the value carries its own
					// ordering. `getState` reads it in the build-start `allSettled` and ships it after the rows
					// walk, so a fetch completing mid-walk lands via `onDidFetch` first and this older snapshot
					// would otherwise rewind the header's "Last fetched" until the next fetch. Rejecting `<=` also
					// subsumes the equality case this replaces (same timestamp = a pointless header re-render).
					// Scoped to the SAME repo: a swap legitimately carries an earlier timestamp, and nothing clears
					// `lastFetched` on selection change, so a repo-blind guard would pin the previous repo's value.
					// Compared against the INCOMING push's repo (as the wip guard below does), not the client's
					// possibly-lagging selection.
					// The repo-id gap this used to leave open — a fetch for repo B landing before B's full push
					// writes B's timestamp while `selectedRepository` still reads A — is now closed upstream:
					// `onDidFetch` carries `repoPath`, and `applyLastFetched` (below) ignores an event whose
					// repo isn't the one currently selected, so `this._state.lastFetched` can no longer be
					// wrongly stamped with another repo's time in the first place.
					if (next.lastFetched != null && this._state.lastFetched != null) {
						const sameRepo =
							(incoming.selectedRepository ?? this._state.selectedRepository) ===
							this._state.selectedRepository;
						if (sameRepo && next.lastFetched <= this._state.lastFetched) {
							delete next.lastFetched;
						}
					}
					// The graph's own worktree's status group has a second, revision-ordered writer — the wip channel
					// (`workingTreeChanged`/`wipRefetched`, guarded by `isStaleWip`). This full-state copy is unstamped and
					// snapshotted early in the host rebuild, so drop it whenever the wip channel has already written
					// status for the row THIS push is for (`_wipStatsRowId === <incoming primary row id>`): the live
					// value wins, including one a B working-tree tick delivered early during an A→B swap (which is why
					// the compare is against the incoming repo, not the client's lagging current selection). Otherwise
					// seed (first delivery). Peer rows are unaffected — the client owns their status group.
					if (incoming.wipStateById != null) {
						// The incoming push's own primary, resolved from the repositories/selection it carries (both
						// travel on a full state) with a fallback to what's already applied.
						const incomingPrimaryRowId = getPrimaryWipRowId({
							repositories: next.repositories ?? this._state.repositories,
							selectedRepository: incoming.selectedRepository ?? this._state.selectedRepository,
						});
						const { seed, wipStatsRowId } = resolveFullStateWorkingTreeStats(
							incomingPrimaryRowId,
							this._wipStatsRowId,
						);
						// Seeding hands ownership back to the full-state (clears the marker) so a stale marker from a
						// prior visit can't drop a later seed after a B→A→B swap-back; a drop keeps the wip owner.
						this._wipStatsRowId = wipStatsRowId;
						next.wipStateById = mergeWipState(
							this.wipStateById,
							seed ? incoming.wipStateById : stripWipStatus(incoming.wipStateById, incomingPrimaryRowId),
							next.wipRowsById ?? this.wipRowsById,
							incomingPrimaryRowId,
							lastKnownWorkDirStatsBySha,
						);
					}
					this.updateState(next);
				}),
			() =>
				repoStatus.onBranchStateChanged(data => {
					this.updateState({ branchState: data.branchState });
				}),
			() =>
				repoStatus.onRepoConnectionChanged(data => {
					this.updateState({ repositories: data.repositories });
				}),
		]);
	}

	/** Set by {@link dispose} — fences async continuations (a rejected resync's retry arm) that can
	 *  land after teardown and would otherwise re-arm timers against a disposed provider. */
	private _providerDisposed = false;

	override dispose(): void {
		this._providerDisposed = true;
		// Cancel any pending debounced provider update to prevent post-dispose updates
		this.fireProviderUpdate.cancel?.();
		if (this._resyncRetryTimer != null) {
			clearTimeout(this._resyncRetryTimer);
			this._resyncRetryTimer = undefined;
		}
		for (const unsubscribe of this._unsubscribeRowsChannel) {
			unsubscribe();
		}
		this._unsubscribeRowsChannel.length = 0;
		if (this._ensureLoadingTimer != null) {
			clearTimeout(this._ensureLoadingTimer);
			this._ensureLoadingTimer = undefined;
		}
		this._ensureLoadingCount = 0;
		this.ensureLoading = false;
		this._servicesSubscription?.unsubscribe();
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

		// No rows-plane baseline to seed: the bootstrap `State` carries no rows plane at all, and the
		// `graph:rows` channel starts with no inbound generation — it adopts whatever the host's first
		// emission carries. The host forces that first emission to a snapshot (seq 0) on every
		// (re)connect, so a fresh iframe adopts cleanly with no gap and no hello round-trip.

		// Enrichment is fetched lazily when a consumer needs it (the overview sidebar mounting or
		// the scope popover opening) rather than eagerly at bootstrap, where it competes with the
		// graph render itself.

		// Agent sessions come from the `agents` RPC service, wired in `GraphAppHost._onRpcReady`
		// (subscribe-before-fetch, so no bootstrap seed race here).
	}

	private _resyncRetryTimer: ReturnType<typeof setTimeout> | undefined;
	/** Guards against overlapping `resyncRows` RPC calls — a channel gap and a splice-guard failure can
	 *  both fire in the same tick, and a retry can still be in flight when a fresh gap arrives. Every
	 *  resync re-snapshots the full row set from the host, so dropping a duplicate request loses nothing. */
	private _resyncInFlight = false;
	/** Count of unhealable rows-channel gaps this session. MUST stay 0 in steady state — a non-zero value
	 *  means messages are being lost between the host and this webview, which storms/soaks assert on. */
	private _rowsGapCount = 0;

	/** The channel reported a gap it could not heal. `replay: 0` means every gap lands here, and the
	 *  channel fires exactly once per gap, so this is the one place recovery starts. */
	private onRowsGap(gap: ChannelGap): void {
		this._rowsGapCount++;
		this.logger.info(
			undefined,
			`rows channel GAP #${this._rowsGapCount} (generation=${gap.generation} expected=${gap.expected} received=${gap.received}); resyncing`,
		);
		this.resyncRows();
	}

	/**
	 * Ask the host for a fresh rows snapshot — the plane's only recovery, driven by a channel gap or a
	 * failed splice guard. The host's `resyncRows` bumps the channel's generation, which is what re-arms
	 * gap detection: until it lands the channel stays gapped and drops same-generation deltas. A failed
	 * call would therefore wedge the plane, so retry ONCE after 2s and then give up loudly rather than
	 * looping against a connection that is gone (a reconnect re-snapshots anyway).
	 */
	private resyncRows(retry: boolean = true): void {
		if (this._resyncInFlight || this._providerDisposed) return;

		const service = this._rowsService;
		if (service == null) {
			this.logger.info(undefined, 'rows resync requested before the rows service connected');
			return;
		}

		this._resyncInFlight = true;

		void service.resyncRows().then(
			() => {
				this._resyncInFlight = false;
				if (this._resyncRetryTimer != null) {
					clearTimeout(this._resyncRetryTimer);
					this._resyncRetryTimer = undefined;
				}
			},
			(ex: unknown) => {
				this._resyncInFlight = false;
				// Teardown rejects the in-flight RPC — don't arm a retry against a disposed provider.
				if (this._providerDisposed) return;

				this.logger.info(undefined, `rows resync failed: ${String(ex)}`);
				if (!retry) return;

				if (this._resyncRetryTimer != null) {
					clearTimeout(this._resyncRetryTimer);
				}
				this._resyncRetryTimer = setTimeout(() => {
					this._resyncRetryTimer = undefined;
					this.resyncRows(false);
				}, 2000);
			},
		);
	}

	ensureOverviewEnrichmentFetched(overview: State['overview']): void {
		if (overview == null) return;

		const branchIds = [...overview.active.map(b => b.id), ...overview.recent.map(b => b.id)];
		if (branchIds.length === 0) return;

		const fingerprint = branchIds.toSorted().join(',');
		if (fingerprint === this._enrichmentFingerprint) return;

		// Skip the RPC call entirely when overviewEnrichment (possibly populated by the sidebar's
		// parallel fetch path) already covers every id in this composition.
		const enrichment = this.overviewEnrichment;
		if (enrichment != null && branchIds.every(id => id in enrichment)) {
			this._enrichmentFingerprint = fingerprint;
			return;
		}

		this._enrichmentFingerprint = fingerprint;

		void this._servicesReady.promise
			.then(() => this._overviewService!.getEnrichment(branchIds))
			.then(
				result => {
					// Only publish when the overview fingerprint hasn't moved on — a newer overview
					// in flight will trigger its own fetch whose result is authoritative.
					if (this._enrichmentFingerprint === fingerprint) {
						this.publishOverviewEnrichment(result);
					}
				},
				() => {
					// Let a future call with this same composition retry — otherwise a rejected fetch
					// (e.g. a connection reset while the panel was hidden) would permanently look "fetched".
					if (this._enrichmentFingerprint === fingerprint) {
						this._enrichmentFingerprint = undefined;
					}
				},
			);
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

		void this._servicesReady.promise
			.then(() => this._overviewService!.getEnrichment(missing))
			.then(
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
	 * Per-repo generation, bumped by {@link handleScopeAnchorsInvalidated} (the
	 * `GraphScopeService.onScopeAnchorsInvalidated` RPC event). In-flight resolves capture this before
	 * awaiting and skip writing back if it has advanced — otherwise the post-await cache write would
	 * repopulate `_mergeBaseCache` with the pre-invalidation anchor.
	 */
	private _anchorGenerations = new Map<string, number>();

	/**
	 * Latest scope the user has asked to navigate to. Tracked separately from the published
	 * `scope` signal so a cache-miss anchor resolve only publishes when the user is still
	 * waiting for that branch — re-scoping or clearing while the RPC call is in flight cancels the
	 * pending publish. Compared by `branchRef` (not reference) so a second `setScope` to the
	 * same branch with a fresher upstream/target still allows the in-flight resolve to publish.
	 */
	private _pendingScope: GraphScope | undefined;

	/**
	 * `scopeToBranch` parked until a state push carries an attached branch. Any scope set or
	 * clear — even automatic — cancels it, so it can't override a scope change made in the meantime.
	 */
	@signalState(false)
	accessor pendingScopeToBranch: AppState['pendingScopeToBranch'] = false;

	/**
	 * Set by callers (e.g. the scope popover) right before a filter write, so the scope clear coalesces
	 * with the resulting `GraphFiltersService.onDidChange` push rather than causing an immediate minimap
	 * reset followed by a separate filter-update repaint.
	 */
	private _scopeClearDeferred = false;

	deferScopeClear(): void {
		// Also retire a parked walkthrough focus — with no scope published, `clearScope` below never fires
		this.pendingScopeToBranch = false;
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
		this.pendingScopeToBranch = false;
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
	 * anchor IPC resolved a merge base or target tip, bare otherwise. Callers that need to fire a
	 * row navigation against the scoped view (`navigateToCommit`) should `await` this so the graph
	 * row index has the post-scope set ready by the time selection runs.
	 *
	 * Publish strategy: ALWAYS publish exactly one `this.scope` write per `setScope` call. We wait for the
	 * anchor IPC to resolve before publishing — bare-then-anchored two-step writes are perceptible as
	 * commits jumping, since a bare scope only dims while an anchored one re-roots, producing a different
	 * visible set. The IPC is local-disk on desktop and well under 100ms in the common case; the chip +
	 * graph stay on their pre-scope state until the publish lands, which is more readable than a flash.
	 *
	 * `mergeTargetTipSha` is stripped from the bare publish (when the anchor IPC bails) even
	 * when the caller supplied one (e.g. `scopeToBranchById` pre-fills it from overview
	 * enrichment) — see `stripUnpairedMergeTarget`.
	 */
	async setScope(scope: GraphScope): Promise<void> {
		this.pendingScopeToBranch = false;
		this._pendingScope = scope;
		// A pending `deferScopeClear` was armed to retire the scope this call REPLACES; leaving it set
		// means the next filters push clears the scope we're installing right now instead — the user picks
		// a branch and the focus silently evaporates a moment later.
		this._scopeClearDeferred = false;

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
		// the host bailed). Never write `this.scope` mid-IPC, so the user never sees a bare
		// dim-only scope flash through on the way to the re-rooted one.
		//
		// Show a loading affordance ONLY if the IPC takes long enough to be perceptible. Fast
		// (sub-`scopeLoadingDelayMs`) paths skip the flag entirely. The flag has its own
		// lifecycle (own signal `scopeLoading`, set here and cleared in `finally`) and doesn't
		// share state with paging or targeted-row loading, so concurrent operations can't
		// clobber one another's affordance.
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
	private static readonly ensureLoadingDelayMs = 250;

	/**
	 * Publishes a scope ONCE — anchored if the resolved anchor is usable, bare otherwise. Used by
	 * the no-bare-flash path (cache hit / fast IPC) AND the cache-miss path.
	 *
	 * An anchor whose `mergeBase` isn't in the loaded rows yet is still USABLE, and publishing it is what
	 * makes the boundary arrive at all: anchor reachability is row membership, re-derived on every rows push
	 * (`gl-lit-graph`'s `recomputeScope`), so `computeScopeAnchors` reports the base unreachable, that drives
	 * a targeted page, and the re-root adopts it once it lands. Until then the projection re-roots against an
	 * open terminus. Loaded-ness therefore has no say here — withholding the anchor for it would also
	 * withhold the paging that loads it.
	 *
	 * Preserve-anchored guard: if `this.scope` is already anchored for the same `branchRef` and the new
	 * anchor would be a bare downgrade (the host bailed), we KEEP the existing anchored scope rather than
	 * wipe it, so a transient failed re-resolve never erases a working anchored state.
	 */
	private publishResolvedScope(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): void {
		const pending = this._pendingScope;
		if (pending?.branchRef !== scope.branchRef) return;

		this._pendingScope = undefined;

		const anchorUsable = anchor != null && (anchor.mergeBase != null || anchor.mergeTargetTipSha != null);

		if (!anchorUsable) {
			// Preserve an already-anchored scope for the same branch — don't downgrade to bare. Reaching
			// here means the resolver offered NO anchors at all (it bailed, or the branch has no merge
			// target), so there's no replacement to prefer over the working one; a stale-anchor swap is
			// `applyScopeAnchorPatch`'s job, on the re-resolve path.
			const current = this.scope;
			if (current?.branchRef === pending.branchRef && current.mergeBase != null) return;

			const bare = stripUnpairedMergeTarget(pending);
			this.scope =
				anchor?.focalBranchTipSha != null ? { ...bare, focalBranchTipSha: anchor.focalBranchTipSha } : bare;
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
		// Carry the tip the anchors were resolved against: it stamps them for `isScopeAnchorStale`, and
		// the popover's "branch tip isn't in the loaded rows" fallback drains on it (see `graph-app.ts`).
		if (anchor?.focalBranchTipSha != null) {
			next.focalBranchTipSha = anchor.focalBranchTipSha;
		}
		this.scope = next;
	}

	async resolveScopeMergeBase(scope: GraphScope): Promise<void> {
		const repoPath = scope.branchRef.split('|', 2)[0];
		if (!repoPath) return;

		const cacheKey = scope.branchRef;

		// Cache hit — patch and return without IPC.
		if (this._mergeBaseCache.has(cacheKey)) {
			this.applyResolvedAnchor(scope, this._mergeBaseCache.get(cacheKey));
			return;
		}

		const anchor = await this.fetchScopeAnchor(repoPath, scope, cacheKey);
		this.applyResolvedAnchor(scope, anchor);
	}

	/** Route a resolved anchor to whichever writeback owns this scope right now. A scope still awaiting its
	 *  first publication is NOT `this.scope`, so `patchScopeAnchor` would drop the result on the floor and
	 *  the bare publish would stand — which made the invalidation retry a race on who finished first. Either
	 *  order is now safe: resolving first publishes the anchored scope (and the superseded original bails on
	 *  the cleared pending), publishing first leaves the retry to patch the now-live scope. */
	private applyResolvedAnchor(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): void {
		if (this._pendingScope?.branchRef === scope.branchRef) {
			this.publishResolvedScope(scope, anchor);
			return;
		}

		this.patchScopeAnchor(scope, anchor);
	}

	/** Branch id whose row-marker merge-target we last kicked off — the per-branch dedup so repeated
	 *  `ensureRowMarkerMergeTarget` calls (one per render) don't re-issue the IPC. Cleared on ref-move
	 *  invalidation so the next call re-resolves. */
	private _rowMarkerBranchId: string | undefined;
	/** Monotonic token discriminating the LATEST row-marker resolve. The branch id alone can't tell a
	 *  superseded resolve apart after an invalidation re-arm for the SAME branch: the stale in-flight
	 *  resolve (blanked to undefined by the anchor generation guard) could land after the fresh one and
	 *  clobber the signal until the next invalidation. */
	private _rowMarkerRequestId = 0;
	/** Branch id the PUBLISHED `rowMarkerMergeTarget` describes — distinct from `_rowMarkerBranchId`, which
	 *  invalidation blanks to re-arm. Lets a branch change tell "this value is about another branch" (blank
	 *  it) apart from a re-arm on the same branch (keep it, so the ref-pill adornments don't churn). */
	private _rowMarkerTargetBranchId: string | undefined;

	ensureRowMarkerMergeTarget(): void {
		const branch = this._state.branch;
		// Detached / no branch — no branch to resolve a merge target for.
		if (branch?.id == null || branch.name == null) {
			this._rowMarkerBranchId = undefined;
			this._rowMarkerRequestId++;
			this.publishRowMarkerMergeTarget(undefined, undefined);
			return;
		}

		// Already resolving/resolved for this branch — cache + `_mergeBasePromises` dedupe the IPC, but this
		// guard also avoids re-touching the signal every render.
		if (branch.id === this._rowMarkerBranchId) return;

		// Resolved BEFORE latching the dedup, so an unusable branch id doesn't wedge it permanently. Blank
		// as we go: a branch that can't name its repo can never resolve, so leaving a previous branch's
		// target published would strand a wrong (and jumpable) tip on the rail.
		const repoPath = branch.repoPath;
		if (!repoPath) {
			this._rowMarkerRequestId++;
			this.publishRowMarkerMergeTarget(undefined, undefined);
			return;
		}

		this._rowMarkerBranchId = branch.id;
		const requestId = ++this._rowMarkerRequestId;

		// Cache hit (e.g. scoping already resolved this branch's anchor) — publish synchronously, no IPC;
		// the same cache-first idiom as `setScope`/`resolveScopeMergeBase`. Invalidation deletes the entry,
		// so a re-arm after a ref move still refetches.
		if (this._mergeBaseCache.has(branch.id)) {
			this.publishRowMarkerMergeTarget(rowMarkerTargetFromAnchor(this._mergeBaseCache.get(branch.id)), branch.id);
			return;
		}

		// Blank another branch's target before the async resolve — until it lands, the overview bar's jump
		// leg and the row adornments would otherwise still point at the PREVIOUS branch's target. Skipped on
		// an invalidation re-arm for the same branch: that value still describes this branch, so blanking it
		// would churn the ref-pill adornments (and blink the leg) for nothing.
		if (this._rowMarkerTargetBranchId !== branch.id) {
			this.publishRowMarkerMergeTarget(undefined, undefined);
		}

		// Route through the SAME scope-anchor pipeline scoping uses (shared cache, dedup, generation guard)
		// — keyed on the branch id so a later scope-to-current reuses this resolve. The minimal scope carries
		// only what the host resolver reads (`branchName`).
		const scope: GraphScope = { branchName: branch.name, branchRef: branch.id };
		void this.fetchScopeAnchor(repoPath, scope, branch.id).then(anchor => {
			// A newer resolve superseded this one while it was in flight (branch switch, detach, or an
			// invalidation re-arm for the SAME branch) — drop the stale answer.
			if (requestId !== this._rowMarkerRequestId) return;

			this.publishRowMarkerMergeTarget(rowMarkerTargetFromAnchor(anchor), branch.id);
		});
	}

	/**
	 * Re-anchor the row-marker merge target from overview enrichment, the same correction
	 * `reconcileScopeMergeTarget` applies to the scope. The host's anchor resolve caps PR lookup at 100ms
	 * and falls back to the base/default branch, so a slow PR API leaves the row-marker on a target that
	 * isn't the PR's base — and the two rails would then mark two different rows, since the graph unions
	 * the row-marker target with the scope's. Enrichment carries the settled answer, so it wins: latch the
	 * dedup and bump the request id so an in-flight fallback resolve can't land on top of it.
	 */
	private reconcileRowMarkerMergeTarget(enrichment: AppState['overviewEnrichment']): void {
		const branch = this._state.branch;
		if (branch?.id == null) return;

		const mergeTarget = enrichment?.[branch.id]?.mergeTarget;
		if (mergeTarget == null) return;
		// Same rule the host's resolver applies: a target tip that IS the branch tip means there's no real
		// merge to mark. Blank rather than leave the fallback's target standing — enrichment has just said
		// there's nothing to point at.
		if (mergeTarget.sha === branch.sha) {
			this._rowMarkerRequestId++;
			this.publishRowMarkerMergeTarget(undefined, branch.id);
			return;
		}

		this._rowMarkerBranchId = branch.id;
		this._rowMarkerRequestId++;
		this.publishRowMarkerMergeTarget({ sha: mergeTarget.sha, name: mergeTarget.name }, branch.id);
	}

	/** Writes the `rowMarkerMergeTarget` signal only when the tip actually changed — a re-resolve that
	 *  lands on the same target must not churn identity (every write invalidates the graph's ref-pill
	 *  adornments downstream). `branchId` records which branch the published value describes; pass
	 *  `undefined` when blanking. */
	private publishRowMarkerMergeTarget(target: AppState['rowMarkerMergeTarget'], branchId: string | undefined): void {
		this._rowMarkerTargetBranchId = branchId;

		const current = this.rowMarkerMergeTarget;
		if (current?.sha === target?.sha && current?.name === target?.name) return;

		this.rowMarkerMergeTarget = target;
	}

	/**
	 * Shared anchor RPC + cache write used by both the initial `setScope` flow and the re-resolve
	 * flow (`resolveScopeMergeBase`, invoked from {@link handleScopeAnchorsInvalidated}). Dedupes
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
			promise = this._servicesReady.promise
				.then(() => this._scopeService!.resolveScope(repoPath, scope))
				.then((r): ResolvedScopeAnchor | undefined =>
					r == null
						? undefined
						: {
								mergeBase: r.scope.mergeBase,
								mergeTargetTipSha: r.scope.resolvedMergeTargetTipSha,
								mergeTargetName: r.scope.resolvedMergeTargetName,
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

	/**
	 * `GraphScopeService.onScopeAnchorsInvalidated` handler — the host fired because refs/config moved
	 * somewhere. `repoPath` names the repo the host detected the change in, but the event is buffered as
	 * a coalescing `signal` (see the service doc): a hidden webview only ever replays the LAST
	 * invalidation, so a burst touching two different repos while hidden can lose one's `repoPath`
	 * entirely. Sweep every repo's cache unconditionally rather than scoping to `repoPath` — an
	 * over-invalidated repo just re-resolves once for nothing; an under-invalidated one rides a stale
	 * anchor indefinitely.
	 */
	private handleScopeAnchorsInvalidated(repoPath: string): void {
		// Bump every repo we've ever tracked a generation for, plus the repo this event named (which may
		// be its first-ever invalidation and so absent from the map) — so any resolve in flight for any
		// of them loses the post-await generation check below and skips its stale writeback.
		const repoPaths = new Set(this._anchorGenerations.keys());
		if (repoPath) {
			repoPaths.add(repoPath);
		}
		for (const path of repoPaths) {
			this._anchorGenerations.set(path, (this._anchorGenerations.get(path) ?? 0) + 1);
		}
		this._mergeBaseCache.clear();
		this._mergeBasePromises.clear();

		// Also reset enrichment so a stale `mergeTargetTipSha` doesn't survive — the next popover open
		// or sidebar render will re-fetch and `reconcileScopeMergeTarget` will re-anchor the live scope
		// when it lands.
		this.resetOverviewEnrichment();

		// Proactively re-resolve the live scope. The cache clear above only ensures the *next*
		// `resolveScopeMergeBase` call won't hand back a stale anchor — it doesn't touch the live
		// `scope.mergeBase`/`scope.mergeTargetTipSha` themselves, which were set on the prior resolve and
		// would otherwise keep anchoring the minimap to a pre-rebase SHA until the user re-scopes. The
		// bumped generations above ensure any concurrently-running stale resolve can't beat this fresh
		// one to the writeback.
		const liveScope = this.scope;
		if (liveScope != null) {
			void this.resolveScopeMergeBase(liveScope);
		}
		// The scope still awaiting its FIRST resolution needs the same treatment. Its in-flight resolve
		// is about to lose the generation check bumped above and return no anchors, and it is not yet
		// `this.scope`, so the retry above can't reach it — without this it publishes bare and nothing
		// ever re-drives it, leaving the minimap unanchored until the user re-scopes.
		const pendingScope = this._pendingScope;
		if (pendingScope != null && pendingScope !== liveScope) {
			void this.resolveScopeMergeBase(pendingScope);
		}

		// Re-arm row marker's merge-target resolve for the current branch — the tip may have moved.
		this._rowMarkerBranchId = undefined;
		this.ensureRowMarkerMergeTarget();
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
	 * (`null` = unchanged, `-1` = now absent). The host only sends a splice against the base its ledger
	 * says we hold, so a guard failure means the mirror diverged — returns undefined (caller keeps its
	 * rows) after driving the same {@link resyncRows} recovery a channel gap would.
	 */
	private applyRowsSplice(splice: GraphRowsSplice): GitGraphRow[] | undefined {
		const current = this._state.rows;
		const spanEnd = splice.reusedStart + splice.reusedCount;
		if (
			current == null ||
			current.length !== splice.expectedPriorRows ||
			current[splice.reusedStart]?.sha !== splice.firstReusedSha ||
			current[spanEnd - 1]?.sha !== splice.lastReusedSha
		) {
			this.logger.info(
				undefined,
				`rows splice guards FAILED (have ${current?.length ?? 0} rows, expected ${splice.expectedPriorRows}); requesting a resync snapshot`,
			);
			this.resyncRows();
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
			undefined,
			`spliced rows: head=${splice.head.length} reused=${splice.reusedCount} tail=${splice.tail?.length ?? 0} patched=${splice.patch != null}`,
		);
		return [...splice.head, ...span, ...(splice.tail ?? [])];
	}

	private patchScopeAnchor(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): void {
		if (anchor == null) return;

		// Only patch if the live scope still points at the same branch (user may have re-scoped
		// or cleared while the resolve was in flight).
		const current = this.scope;
		if (current?.branchRef !== scope.branchRef) return;

		const next = applyScopeAnchorPatch(current, anchor);
		if (next == null) return;

		this.scope = next;
	}

	protected onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeHostWindowFocusNotification.is(msg):
				this.updateState({
					windowFocused: msg.params.focused,
				});
				break;
		}
	}

	/**
	 * Applies one `graph:rows` emission — the rows plane's ONLY writer. The channel already guarantees
	 * this runs in order within a generation and never for a message that skipped one (a gap goes to
	 * {@link onRowsGap} instead), so there is no sequencing to redo here: `params.snapshot` is the only
	 * discriminator, distinguishing an authoritative REPLACE from a delta.
	 *
	 * Application ORDER is load-bearing and must stay as written: downstreams → rows/splice →
	 * reachability → paging → rowsStats → loading flags → selectedRows, then one `updateState`.
	 */
	private applyRowsPayload(params: GraphRowsPayload, meta: ChannelMeta): void {
		const updates: Partial<State> = {};
		const snapshot = params.snapshot === true;

		// Lean commit contexts are reconstructed on demand at right-click / selection time (see
		// `graph-wrapper`); reachability is decoded on demand from the accumulated
		// `reachabilityTable` (adopted into `updates` below). Nothing to rebuild per-row here.
		let rows;
		if (snapshot) {
			// Authoritative full REPLACE — always adopt the snapshot's rows (even an empty set, which
			// clears a stale prior graph on repo swap / recovery). Snapshots never ship a splice.
			rows = params.rows;
		} else if (params.rowsSplice != null) {
			// Cursor-less replace shipped as a splice-delta — reconstruct from the rows we hold. A guard
			// mismatch (`applyRowsSplice` returns undefined + requests a resync) means the mirror diverged:
			// drop the whole message (rows AND enrichment) — the resync snapshot re-seeds everything.
			const spliced = this.applyRowsSplice(params.rowsSplice);
			if (spliced == null) return;

			rows = spliced;
		} else if (params.rows.length && params.paging?.startingCursor != null && this._state.rows != null) {
			const previousRows = this._state.rows;
			const startingCursor = params.paging.startingCursor;

			this.logger.debug(
				undefined,
				`paging in ${params.rows.length} rows into existing ${previousRows.length} rows at ${startingCursor}`,
			);

			rows = appendRowsAtCursor(previousRows, startingCursor, params.rows);
		} else if (params.rows.length === 0) {
			// A carrier delta (riders/enrichment with no rows change) — retain what we hold.
			this.logger.debug(undefined, 'rows unchanged (carrier delta)');
			rows = this._state.rows;
		} else {
			this.logger.debug(undefined, `setting to ${params.rows.length} rows`);
			rows = params.rows;
		}

		// `downstreams` is sent ABSENT (undefined) when unchanged — the host ships it only when its
		// channel is marked (a refresh that changed the upstream→branches map, a page/initial walk, or a
		// snapshot). Keep our existing state when absent instead of replacing with undefined and losing it.
		if (params.downstreams != null) {
			updates.downstreams = params.downstreams;
		}
		updates.rows = rows;
		// Adopt the reachability table by generation id: a snapshot REPLACEs (reset-anchor), else append
		// the delta on same-generation pagination (cache preserved) / replace + reset on a new generation.
		this.applyReachabilityTable(params.reachabilityTable, snapshot);
		updates.paging = params.paging;
		// `rowsStats`: a snapshot REPLACEs wholesale (authoritative), a delta spread-merges the new keys.
		if (params.rowsStats != null) {
			updates.rowsStats = snapshot ? { ...params.rowsStats } : { ...this._state.rowsStats, ...params.rowsStats };
		}
		updates.rowsStatsLoading = params.rowsStatsLoading;
		if (params.rowsStatsIncluded !== undefined) {
			updates.rowsStatsIncluded = params.rowsStatsIncluded;
		}
		if (params.selectedRows != null) {
			updates.selectedRows = params.selectedRows;
		}
		updates.loading = false;

		this.updateState(updates);
		if (DEBUG) {
			getGraphDebugDiagnostics().markRowsApplied(this._state.rows, {
				generation: meta.generation,
				seq: meta.seq,
				snapshot: snapshot,
				rows: this._state.rows?.length ?? 0,
				receivedRows: params.rows.length,
				splice: params.rowsSplice != null,
				cursor: params.paging?.startingCursor,
			});
		}
	}

	/**
	 * Applies a search snapshot from the host, replacing every search field wholesale. A snapshot is
	 * always CUMULATIVE — `state.results` already reflects everything the search has accumulated so far
	 * — so merging any field here (instead of replacing it) would double-count a progressive batch or
	 * resurrect a stale one. `undefined` means no active search.
	 */
	applySearchState(state: GraphSearchState | undefined): void {
		this.searching = state?.searching ?? false;
		this.searchQuery = state?.query;
		this.searchResultsResponse = state?.results;
		this.searchFallback = state?.fallback;
		this.searchRelaxations = state?.relaxations;

		if (state?.query != null) {
			this.searchMode = state.query.filter ? 'filter' : 'normal';
		}
	}

	/** Applies the agents-banner dismissal state fed by the onboarding RPC service. */
	applyAgentsBannerCollapsed(collapsed: boolean): void {
		this.agentsBannerCollapsed = collapsed;
		this.fireProviderUpdate();
	}

	/** Applies the walkthrough-started usage flag fed by the telemetry RPC service's `onUsageChanged`. */
	applyGraphWalkthroughStarted(started: boolean): void {
		this.graphWalkthroughStarted = started;
		this.fireProviderUpdate();
	}

	/** Applies the gating snapshot from `GraphAccessService` — `subscription`, `allowed`, and
	 *  `featurePreview` land in ONE `updateState` so the account wall and the plan gate can never
	 *  disagree between paints. */
	applyAccess(access: GraphAccessState): void {
		this.updateState({
			subscription: access.subscription,
			allowed: access.allowed,
			featurePreview: access.featurePreview,
		});
	}

	/**
	 * Applies the active repo's last-fetched time from `GraphRepoStatusService.onDidFetch` (also used to
	 * apply the result of its pull-based `getLastFetched()`). Ignores an event for a repo other than the
	 * one currently selected — this is what closes the repo-id gap the full-state-push guard above used
	 * to leave open. Also enforces the same forward-only ordering as that guard, since a fast-path fetch
	 * and a slower full-state push both write `lastFetched` and can arrive out of order.
	 */
	applyLastFetched(repoPath: string, lastFetched: number): void {
		if (repoPath !== getSelectedRepoPath(this._state)) return;
		if (this._state.lastFetched != null && lastFetched <= this._state.lastFetched) return;

		this.updateState({ lastFetched: lastFetched });
	}

	/** Merges a `GraphAvatarsService` response into the avatars map. Additive: the response carries only
	 *  the emails that call asked for, and a proxied entry legitimately overwrites its own key. */
	applyAvatars(avatars: Record<string, string>): void {
		if (Object.keys(avatars).length === 0) return;

		this.updateState({ avatars: { ...this._state.avatars, ...avatars } });
	}

	/** Merges a `getMissingRefsMetadata` response into the map. Additive (spread-merge): the response
	 *  carries only the refs that call asked for, and only the ones the host actually resolved. */
	applyRefsMetadata(metadata: GraphRefsMetadata): void {
		if (Object.keys(metadata).length === 0) return;

		// A `null` map means the feature is off — enrichment can't be arriving, and merging onto it would
		// silently turn the feature back on for the component.
		if (this._state.refsMetadata === null) return;

		this.updateState({ refsMetadata: { ...this._state.refsMetadata, ...metadata } });
	}

	/** Applies an `onRefsMetadataChanged` reset: an authoritative REPLACE with a COMPLETE snapshot (`null`
	 *  = feature off). Bumps the dedup token because a reset may preserve a non-empty (upstream) map, so
	 *  the component can't detect it by emptiness — it watches the token to re-arm its per-id requests. */
	private applyRefsMetadataReset(metadata: GraphRefsMetadata | null): void {
		this.updateState({ refsMetadata: metadata == null ? null : { ...metadata } });
		// Assigned directly (webview-only signal, not part of the host wire contract).
		this.refsMetadataResetToken = (this.refsMetadataResetToken ?? 0) + 1;
	}

	/** Applies the hooks-install capability derived from `AgentsService.getAgents()`/`onAgentsChanged`. */
	applyHooksCapability(
		canInstallHooks: boolean,
		hooksAgents: readonly { id: string; displayName: string; installed: boolean }[],
	): void {
		this.canInstallHooks = canInstallHooks;
		this.hooksAgents = hooksAgents;
		this.fireProviderUpdate();
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
	 * Which WIP row currently owns the graph's own worktree's status group on the wip channel's behalf: its
	 * `wip::<path>` row id (stamped on each wip status write), CLEARED when a full-state seed takes over. The
	 * full-state gate drops its (unstamped, early-snapshotted) status for that row when this matches the pushed
	 * state's own primary row id, so the live channel's value wins — including one a working-tree tick delivered
	 * early during a repo swap, since ownership is stamped by the PUSH's repo (not the client's lagging current
	 * selection). Distinct from `_wipRevisions` (revision high-water, also advanced for probed peers); this marks
	 * only who owns the badge value.
	 *
	 * Kept in ROW-ID space rather than raw paths: `createWipRowId` normalizes, so this compares equal across the
	 * separator differences between `repository.path` (push side) and `repository.id` (full-state side).
	 */
	private _wipStatsRowId: string | undefined;

	/** The graph's own worktree's WIP row id, from the selected repository. Undefined before the repo
	 *  list lands. Cheap (a small `find`) and read only on WIP writes, so it isn't memoized. */
	get primaryWipRowId(): string | undefined {
		return getPrimaryWipRowId(this._state);
	}

	/**
	 * The set of repo paths the host currently has an active working-tree watcher for. Drives
	 * `getWipState().isLive` so consumers know whether a cache hit will be refreshed by a
	 * push soon (true) or needs explicit revalidation (false).
	 *
	 * Membership = the primary `selectedRepository` plus any secondary worktrees in the latest
	 * `wip.syncWatches` set (computed from visible-secondary-WIP-shas).
	 */
	private _activeWipWatchers = new Set<string>();

	/**
	 * Optimistic-edit marker: when a local mutation (stage/unstage) writes the cache before the
	 * host's watcher tick lands, the entry is "ours" — `isLive` is suppressed until the next
	 * host push reconfirms.
	 */
	private _pendingLocalEditPaths = new Set<string>();

	/**
	 * Repo paths whose cached wip predates a gap in their watcher coverage — the row scrolled out, the
	 * host closed the watcher, and anything that changed meanwhile arrived nowhere. Re-watching restores
	 * `_activeWipWatchers` membership but not the missed changes, so `isLive` has to stay false until an
	 * authoritative payload lands (see `cacheWip`); otherwise the panel keeps painting the pre-gap file
	 * list and never revalidates.
	 */
	private _gappedWipPaths = new Set<string>();

	/**
	 * Applies one working-tree payload from the host. Shared VERBATIM by both producers — the tick
	 * (`onWorkingTreeChanged`, which carries `wip`) and the background peer probe
	 * (`onWorktreeEnrichment`, which doesn't) — so the two can never diverge in merge semantics. They
	 * ride separate RPC events precisely because their payloads are disjoint: one `save-last` slot
	 * between them would let a probe overwrite an undelivered tick and lose its `wip` for good.
	 *
	 * Read from the accessors (`this.wipRowsById` / `this.wipStateById`) rather than `this._state`:
	 * writebacks from `graph-wrapper.ts` and `graph-app.ts` assign through the accessor and don't
	 * update `_state`, so reading `_state` here sees a stale anchor-only map and the merge drops
	 * freshly-fetched `workDirStats` from every peer row (the visible pill flash).
	 *
	 * Drop a payload reflecting an older working tree than what's already applied (see `isStaleWip`) —
	 * otherwise a delayed one regresses the cache/badge/overview. The topology plane carries no
	 * working-tree content, so it applies regardless; only the pushed row's STATUS is ordered.
	 */
	private applyWorkingTreeChange(data: GraphWorktreeEnrichment & { wip?: Wip }): void {
		const staleWip = this.isStaleWip(data.repoPath, data.wip);
		const pushedRowId = createWipRowId(data.repoPath);

		// Both producers always send the full topology (possibly `{}`) so the merge can clear stale
		// anchors; `mergeWipRows` returns the SAME object when nothing changed, which is what keeps the
		// decorated-rows memo from re-running.
		const nextRows = mergeWipRows(this.wipRowsById, data.wipRowsById);
		const updates: Partial<State> = { wipRowsById: nextRows };

		// This channel is host-authoritative for the PUSHED repo's status group, so stamp ownership by
		// the PUSH's repo rather than the client's current `selectedRepository` (which lags the host
		// during a swap): an early B tick during an A→B switch is genuinely B's, and attributing it to B
		// lets its fresh status supersede B's full-state seed once the switch lands.
		// A stale push still carries the free enumeration fields for every worktree; only its
		// snapshotted STATUS for the pushed row must not regress what's applied.
		if (!staleWip && data.wipStateById[pushedRowId]?.workDirStats != null) {
			this._wipStatsRowId = pushedRowId;
		}
		updates.wipStateById = mergeWipState(
			this.wipStateById,
			staleWip ? stripWipStatus(data.wipStateById, pushedRowId) : data.wipStateById,
			nextRows,
			this.primaryWipRowId,
			lastKnownWorkDirStatsBySha,
		);

		// The tick packs the full WIP into every fire (same `git status` it already ran for the stats).
		// The panel observes this and applies it directly — no `getWip` round-trip needed. The probe has
		// no `git status` to pack, so this is where the two producers part.
		if (!staleWip && data.wip != null) {
			updates.wip = data.wip;
			// Seed the cache so re-opening the WIP panel paints from memory while a fresh
			// host push lands. The active-watcher set covers `isLive` derivation at read
			// time — we don't stamp it on the entry.
			this.cacheWip(data.repoPath, data.wip);
		}
		this.updateState(updates);
		// Merge the overview entry for the primary's current branch from the same fetch,
		// so the overview card's dirty/clean indicator AND inline breakdown counts stay
		// live without the bulk probe. Skip on detached HEAD (no branch to key by).
		if (!staleWip) {
			this.mergeOverviewWipForRepo(data.repoPath, data.wip, data.wip?.stats);
		}
	}

	/**
	 * Applies a `wipRefetched` payload: WIP the host pre-fetched for a worktree the graph's own
	 * working-tree watcher can't see (a peer's watcher tick, or a conflict-resolution run against a
	 * peer's WIP row). Same ordering rule as {@link applyWorkingTreeChange} — a refetch reflecting an
	 * older working tree than what's applied must not regress the cache/badge/row metadata.
	 */
	private applyWipRefetch(data: { repoPath: string; wip?: Wip }): void {
		if (data.wip == null || this.isStaleWip(data.repoPath, data.wip)) return;

		const updates: Partial<State> = { wip: data.wip };
		const { repoPath } = data;
		// Stats travel embedded as `wip.stats` (host-computed from the same `git status`).
		const stats = data.wip.stats;
		this.cacheWip(repoPath, data.wip);

		// Host shipped its already-computed stats — use them directly rather than
		// deriving locally (would lose `pausedOpStatus` / `renamed`, and the per-file
		// classifier doesn't match `git diff --shortstat` semantics). One write for ANY
		// worktree: the graph's own and its peers share one row-keyed plane, so there is no
		// fork on which repo the refetch is for. Same accessor-read rationale as
		// {@link applyWorkingTreeChange}.
		// Tracked-row gate: a refetch for a worktree the client does not render is dropped.
		// The graph's own row is exempt — its badges are shown
		// whether or not the worktree enumeration has landed.
		const rowId = createWipRowId(repoPath);
		const tracked = rowId === this.primaryWipRowId || this.wipRowsById?.[rowId] != null;
		if (stats != null && tracked) {
			updates.wipStateById = mergeWipState(
				this.wipStateById,
				{ [rowId]: toWipStatePatch(stats) },
				this.wipRowsById,
				this.primaryWipRowId,
			);
			if (rowId === this.primaryWipRowId) {
				this._wipStatsRowId = rowId;
			}
		}
		this.updateState(updates);
		// Merge the overview entry from the same fetch. For peers the branchId
		// lives on `wipRowsById[rowId].branchRef` (pre-computed host-side
		// with the MAIN repo path); fall back to deriving from the wip payload's
		// branch name if absent. `stats` carries the breakdown for the inline counts.
		this.mergeOverviewWipForRepo(repoPath, data.wip, stats);
	}

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
		this._gappedWipPaths.delete(repoPath);
	}

	/**
	 * Merge a single overview entry from a host wip push. Pushes a partial `overviewWip` with just
	 * the one branchId — the consumer at `graph-overview.ts` iterates `pushedWip.branchIds` and
	 * preserves untouched entries via the spread in `nextWipData`. New object reference forces the
	 * consumer's `_lastPushedWip !==` check to re-process.
	 *
	 * Discriminates by `repoPath === selectedRepository` rather than "try secondary lookup, fall
	 * back to deriving": a peer push that lands before its `wipRowsById` entry exists
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
			// Peer worktree: branchRef is pre-computed host-side with the MAIN repo path,
			// which is the format overview entries are keyed by. If topology hasn't loaded yet,
			// skip — the next event for this worktree will recover once it lands.
			branchId = this.wipRowsById?.[createWipRowId(repoPath)]?.branchRef;
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
			this.setWipStatus(repoPath, wip.stats);
		}
		this.mergeOverviewWipForRepo(repoPath, wip, wip.stats);
	}

	/**
	 * Reseed one worktree's WIP status group (the header / row badge source) from a panel-driven
	 * `getWip` response. `stats` is that wip's embedded {@link WipStats} — git-authoritative and the
	 * SAME object as `wip.stats`, so the file list and counts can never disagree. No generation
	 * guard: with stats embedded in the wip there's no separate value to race, and a
	 * stale-but-consistent write self-corrects on the next host push.
	 *
	 * No repo-path guard any more: status is written into the row-keyed hot plane, so a peer
	 * worktree's `getWip` lands on that peer's row instead of overwriting the graph's own. Peers must
	 * still be tracked rows — an untracked one has no row to render what we'd write.
	 */
	setWipStatus(repoPath: string, stats: WipStats): void {
		const rowId = createWipRowId(repoPath);
		if (rowId === this.primaryWipRowId) {
			this._wipStatsRowId = rowId;
		} else if (this.wipRowsById?.[rowId] == null) {
			return;
		}

		this.updateState({
			wipStateById: mergeWipState(
				this.wipStateById,
				{ [rowId]: toWipStatePatch(stats) },
				this.wipRowsById,
				this.primaryWipRowId,
			),
		});
	}

	/**
	 * Return the cached wip for `repoPath` along with metadata the caller needs to decide
	 * whether to revalidate. `isLive` is computed at read time from the host's active-watcher
	 * set — never stored on the entry — so a worktree that scrolls out of the viewport (no
	 * longer in the `wip.syncWatches` set) flips to non-live without anyone having to mutate state.
	 * Local optimistic edits also suppress `isLive` until the host reconciles.
	 */
	getWipState(repoPath: string): { wip: Wip; isLive: boolean; ageMs: number } | undefined {
		const entry = this._wips.get(repoPath);
		if (entry == null) return undefined;

		// Primary repo is always watched while selected; secondaries come from the latest
		// `updateActiveWipWatchers` call. Pending optimistic edits suppress `isLive` until the
		// host's push reconciles.
		const watched = repoPath === this.selectedRepository || this._activeWipWatchers.has(repoPath);
		const isLive = watched && !this._pendingLocalEditPaths.has(repoPath) && !this._gappedWipPaths.has(repoPath);
		return { wip: entry.wip, isLive: isLive, ageMs: Date.now() - entry.timestamp };
	}

	private _wipStatsRequestSeq = 0;
	/** Row id → ticket of the most recent `wip.getStats` call that asked about it. */
	private readonly _wipStatsRequestBySha = new Map<string, number>();

	/**
	 * Stake a claim on `shas` for an outgoing stats request and return its ticket. Concurrent batches no
	 * longer cancel each other (cancelling a sibling is what stranded rows with unverifiable stats), so
	 * supersession moves here — per SHA, which is the only place it's meaningful once batches are allowed to
	 * overlap on the same row rather than being assumed disjoint. A response is
	 * applied for a row only while it still holds the claim, so an older read that lands after a newer one
	 * can't roll the row back: the responses carry no revision of their own to order by.
	 */
	claimWipStatsRequest(shas: Iterable<string>): number {
		const ticket = ++this._wipStatsRequestSeq;
		for (const sha of shas) {
			this._wipStatsRequestBySha.set(sha, ticket);
		}
		return ticket;
	}

	/**
	 * Record that the host tore down the watchers for `shas`: mark each row's stats stale so the visible
	 * scan re-reads them, and mark the worktree gapped so `getWipState().isLive` stops vouching for a
	 * payload nothing is keeping current. Driven by the host's own disposal rather than by a row leaving
	 * the viewport, which the host deliberately outlives by a grace period.
	 */
	markWipWatchesClosed(shas: readonly string[]): void {
		const existing = this.wipStateById;
		let next: State['wipStateById'] | undefined;
		for (const sha of shas) {
			const repoPath = this.wipRowsById?.[sha]?.repoPath;
			if (repoPath != null && repoPath !== this.selectedRepository) {
				this._gappedWipPaths.add(repoPath);
			}

			const prev = existing?.[sha];
			if (prev?.workDirStats == null || prev.workDirStatsStale) continue;

			next ??= { ...existing };
			next[sha] = { ...prev, workDirStatsStale: true };
		}
		if (next != null) {
			this.updateState({ wipStateById: next });
		}
	}

	/** Whether `ticket` is still the latest request for `sha` — i.e. whether its response may be applied. */
	isCurrentWipStatsRequest(sha: string, ticket: number): boolean {
		return this._wipStatsRequestBySha.get(sha) === ticket;
	}

	/**
	 * Update the set of repos with active host-side watchers. Called by `graph-wrapper.ts` when
	 * the `wip.syncWatches` visibility set changes, plus when `selectedRepository` changes —
	 * the primary repo is always considered watched as long as it's selected (the active-repo
	 * working-tree watcher is unconditionally on for it).
	 *
	 * Pure state — does not fire signals; reads happen on demand via `getWipState`.
	 */
	updateActiveWipWatchers(repoPaths: Iterable<string>): void {
		// Primary repo is unioned in dynamically at read time (see `getWipState`) so this method
		// only tracks the secondary set — no need to re-fire when `selectedRepository` changes.
		const next = new Set(repoPaths);
		// A secondary ENTERING the set is uncovered until its watcher exists: anything cached for it — a
		// details selection of an off-screen worktree, say — was produced with no watcher behind it and
		// nothing has vouched for it since. The flag clears on the first authoritative payload, so this
		// costs one revalidate for a repo the panel is actually showing, not a read per row entering view.
		// Departures are NOT handled here: the host keeps the watcher for a grace period, so a row leaving
		// the viewport doesn't mean coverage ended. The host says when it does (`markWipWatchesClosed`).
		for (const repoPath of next) {
			if (!this._activeWipWatchers.has(repoPath) && repoPath !== this.selectedRepository) {
				this._gappedWipPaths.add(repoPath);
			}
		}
		this._activeWipWatchers = next;
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
				// Scope is webview-local, so a repo switch would otherwise carry it over — and none of it
				// resolves here: `branchRef` embeds the old repo path (`getBranchId`) and the anchors are
				// SHAs from the old history. Left alone it silently hides the primary WIP row (the
				// `branchRef` can't match the new repo's branch id) while the view still LOOKS scoped
				// whenever the new repo shares the branch name.
				//
				// Both calls are needed. `clearScope` bails early when nothing is published yet, which is
				// exactly the state a first `setScope` is in while its anchor IPC is still in flight —
				// leaving `_pendingScope` set, so the resolve lands after the switch and
				// `publishResolvedScope` installs the OLD repo's scope here. Each no-ops on its own.
				this.cancelPendingScope();
				this.clearScope();
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

/** The graph's own worktree's WIP row id for a given (possibly partial) state — `undefined` until
 *  the repo list lands. Every id goes through `createWipRowId` so path separators normalize. */
function getPrimaryWipRowId(state: {
	repositories?: State['repositories'];
	selectedRepository?: State['selectedRepository'];
}): string | undefined {
	const path = getSelectedRepoPath(state);
	return path != null ? createWipRowId(path) : undefined;
}

/**
 * Resolve a full-state WIP-status push against the wip channel's ownership marker (`_wipStatsRowId`, the WIP row
 * the revision-ordered wip channel last wrote a status group for). The full-state copy is UNSTAMPED and
 * snapshotted early in the host rebuild, so drop it while the wip channel still owns the row this push is FOR
 * (`wipStatsRowId === incomingRowId`) — the live value wins, INCLUDING one delivered early during a repo swap
 * (hence comparing against the incoming state's own primary row, not the client's lagging current selection).
 * Otherwise seed AND hand ownership back (clear the marker), so a STALE marker from a prior visit can't wrongly
 * drop a later seed after a B→A→B swap-back. Returns the seed decision and the next ownership marker atomically.
 */
export function resolveFullStateWorkingTreeStats(
	incomingRowId: string | undefined,
	wipStatsRowId: string | undefined,
): { seed: boolean; wipStatsRowId: string | undefined } {
	if (wipStatsRowId === incomingRowId) return { seed: false, wipStatsRowId: wipStatsRowId };
	return { seed: true, wipStatsRowId: undefined };
}

/** Strips undefined-valued keys so merged entries compare (and store) like the host's own
 *  conditional-spread payloads — see the call site in {@link mergeWipState}. */
function compactWipState(state: GraphWipState): GraphWipState {
	const result: GraphWipState = {};
	for (const [key, value] of Object.entries(state)) {
		if (value === undefined) continue;

		(result as Record<string, unknown>)[key] = value;
	}
	return result;
}

/** Projects a `Wip`'s embedded git-authoritative counts onto a hot-plane status group. Mirrors the
 *  host's `toWipState` so a client-side write and a host push produce the same shape. */
function toWipStatePatch(stats: WipStats): GraphWipState {
	return {
		workDirStats: {
			added: stats.added,
			deleted: stats.deleted,
			modified: stats.modified,
			renamed: stats.renamed,
		},
		workDirStatsStale: false,
		hasConflicts: stats.hasConflicts,
		conflictsCount: stats.conflictsCount,
		pausedOpStatus: stats.pausedOpStatus,
	};
}

/** Drops `rowId`'s status group from a hot-plane patch, leaving its enumeration fields — so a merge
 *  applies the free `ahead`/`hasUnpushed` a stale (or out-of-band-superseded) push still carries
 *  without letting its snapshotted counts overwrite the live ones. */
function stripWipStatus(state: GraphWipStateById, rowId: string | undefined): GraphWipStateById {
	if (rowId == null) return state;

	const entry = state[rowId];
	if (entry?.workDirStats == null) return state;

	const {
		workDirStats: _s,
		workDirStatsStale: _ss,
		hasConflicts: _c,
		conflictsCount: _cc,
		pausedOpStatus: _p,
		...rest
	} = entry;
	return { ...state, [rowId]: rest };
}

/**
 * Merge the stable WIP topology plane. `incoming` is the host's full worktree enumeration, so it is
 * authoritative for which rows exist — a worktree it omits is gone. Preserves the previous reference
 * when nothing changed so every cache keyed on this map (and there are several: the decorated-rows
 * memo, the agent-status map, the minimap markers) survives a working-tree tick untouched. That
 * stability is the entire point of splitting topology from {@link mergeWipState}'s hot fields.
 */
export function mergeWipRows(prev: State['wipRowsById'], incoming: State['wipRowsById']): State['wipRowsById'] {
	if (incoming == null) return undefined;
	if (prev == null) return incoming;

	const incomingKeys = Object.keys(incoming);
	if (incomingKeys.length !== Object.keys(prev).length) return incoming;

	for (const [id, row] of Object.entries(incoming)) {
		const prevRow = prev[id];
		if (
			prevRow == null ||
			row.repoPath !== prevRow.repoPath ||
			row.parentSha !== prevRow.parentSha ||
			row.parentDate !== prevRow.parentDate ||
			row.label !== prevRow.label ||
			row.branchRef !== prevRow.branchRef ||
			// Sent every build (a sync projection of the already-loaded `wt.branch`), so a plain content
			// diff is right. Must be compared: without it, a change confined to the branch (e.g. `behind`
			// moving after a fetch) leaves the map unchanged, `prev` is returned, and the fresh branch is
			// silently discarded — freezing the WIP bar's hover on stale tracking data. `areEqual` (deep)
			// so a field the hover starts rendering later can't silently fall out of the comparison.
			!areEqual(row.branch, prevRow.branch)
		) {
			return incoming;
		}
	}

	return prev;
}

/**
 * Merge the hot WIP state plane. `incoming` is a SPARSE patch: each producer only fills the fields it
 * owns (see {@link GraphWipState}), so the merge is field-aware rather than a replace.
 *
 * - The STATUS group (`workDirStats` + `workDirStatsStale` + `hasConflicts` + `conflictsCount` +
 *   `pausedOpStatus`) all derives from ONE `git status` and therefore replaces as a unit, keyed off
 *   `workDirStats` being present. Group-wise replacement (not per-field `??`) is what lets a
 *   completed rebase clear `pausedOpStatus`, while a topology-only push leaves a peer row's
 *   client-fetched stats alone instead of flashing an empty pill.
 * - `hasChanges` / `hasUnpushed` are only sent on the graph-load probe build, so a per-tick push that
 *   omits them must preserve the last-known value or the WIP bar drops that worktree between loads.
 *   (`ahead` is free every build, so it rides the spread and needs no preservation.)
 *
 * Pruned to `rows` (∪ the primary), which is authoritative for existence — a removed worktree must
 * not leave a phantom entry. The primary is exempt because its status has an independent producer and
 * lifetime: a worktree enumeration that fails, or a repo whose HEAD has no commits yet, must not blank
 * the header badges.
 *
 * `workDirStatsStale: true` marks counts nothing has verified: sticky-restore sets it, so does a clean
 * probe bit that contradicts them here, and so does a row leaving the viewport (`graph-wrapper`'s
 * `markDepartedWipStatsStale`) — its watcher lapses and the changes it misses reach nobody. Live
 * working-tree updates push fresh stats directly and clear it. The flag is what makes the row keep
 * asking: the visible-range scan, the selection refetch, and the pill hover all gate on it, and the
 * glyph dims while it's set.
 */
export function mergeWipState(
	prev: State['wipStateById'],
	incoming: State['wipStateById'],
	rows: State['wipRowsById'],
	primaryWipRowId: string | undefined,
	lastKnownStats?: ReadonlyMap<string, WorkDirStats>,
): State['wipStateById'] {
	if (incoming == null) return prev;

	const keep = (id: string) => rows == null || rows[id] != null || id === primaryWipRowId;

	const result: NonNullable<State['wipStateById']> = {};
	let changed = false;
	for (const [id, prevEntry] of Object.entries(prev ?? {})) {
		if (!keep(id)) {
			changed = true;
			continue;
		}

		result[id] = prevEntry;
	}

	for (const [id, entry] of Object.entries(incoming)) {
		if (!keep(id)) continue;

		const prevEntry = result[id];
		let next: GraphWipState;
		if (entry.workDirStats != null) {
			// Authoritative status group — replace it wholesale, keeping the ENUMERATION fields, which come
			// from a different producer. `ahead` rides every worktree-enumeration build, but a stats-only
			// patch (`toWipStatePatch`, from a refetch or a status push) carries no enumeration fields at
			// all: spreading one on its own drops the count, degrading a peer pill's hover to the bare
			// unpushed bit until the next enumeration happens to arrive. The sibling merge in
			// `graph-wrapper.onWipShasMissingStats` preserves it by spreading prev — these two must agree.
			next = {
				...entry,
				// The probe's cheap bit answers the same question these counts do, and worse — so a real
				// `git status` RETIRES it rather than preserving it. Carrying it forward let a worktree that
				// was dirty at graph load stay `hasChanges: true` for the whole session, and any consumer
				// that falls back to the bit when the counts look unverified (the WIP bar's pill rule) then
				// reports a long-since-cleaned worktree as dirty.
				// Unconditional, not `entry.hasChanges ?? …`: these counts came from a real `git status`, so
				// they outrank the probe's bit even when a producer sends both in one patch.
				hasChanges: hasDirtyCounts(entry.workDirStats),
				hasUnpushed: entry.hasUnpushed ?? prevEntry?.hasUnpushed,
				ahead: entry.ahead ?? prevEntry?.ahead,
			};
		} else {
			// No status in this patch. Carry the existing group forward, or — for a row seen earlier this
			// session and re-introduced (worktree-list flap, reduced-set full-state push) — restore the
			// sticky stats and flag them stale so the row keeps showing values across the refetch instead
			// of briefly rendering an empty pill.
			const sticky = prevEntry?.workDirStats == null ? lastKnownStats?.get(id) : undefined;
			next = {
				...entry,
				workDirStats: prevEntry?.workDirStats ?? sticky,
				workDirStatsStale: sticky != null ? true : prevEntry?.workDirStatsStale,
				hasConflicts: prevEntry?.hasConflicts,
				conflictsCount: prevEntry?.conflictsCount,
				pausedOpStatus: prevEntry?.pausedOpStatus,
				hasChanges: entry.hasChanges ?? prevEntry?.hasChanges,
				hasUnpushed: entry.hasUnpushed ?? prevEntry?.hasUnpushed,
			};

			// The probe's cheap dirty bit says clean while the carried counts say dirty — one of them is
			// out of date and this patch can't say which. Flag the counts stale so the visible-range scan
			// buys an authoritative `git status`, rather than letting the unstamped bit overwrite them
			// (`hasChanges` has no revision fence, so a probe issued before an edit can land after it).
			if (entry.hasChanges === false && hasDirtyCounts(next.workDirStats)) {
				next.workDirStatsStale = true;
			}
		}

		// Drop undefined-valued keys before storing/comparing: `areEqual` is key-count based, so an
		// explicit `pausedOpStatus: undefined` from a status-group replace would read as a change against
		// an entry that simply omits it — and reference-preservation is the whole point of this merge.
		const compacted = compactWipState(next);
		if (!changed && !areEqual(compacted, prevEntry)) {
			changed = true;
		}
		result[id] = compacted;
	}

	// Preserve reference when nothing changed so downstream reactive consumers don't churn.
	return changed ? result : prev;
}
