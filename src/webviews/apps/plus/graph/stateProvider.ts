import type { WorkDirStats } from '@gitkraken/gitkraken-components';
import { ContextProvider } from '@lit/context';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { areEqual, hasKeys } from '@gitlens/utils/object.js';
import type { StoredGraphWipDraft } from '../../../../constants.storage.js';
import type { IpcMessage } from '../../../ipc/models/ipc.js';
import type {
	DidSearchParams,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphWorkingTreeStats,
	State,
	Wip,
} from '../../../plus/graph/protocol.js';
import {
	createSecondaryWipSha,
	DidChangeAgentSessionsNotification,
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeCanInstallClaudeHook,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeGraphWalkthroughBanner,
	DidChangeGraphWalkthroughComplete,
	DidChangeGraphWalkthroughStarted,
	DidChangeHooksBanner,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeOverviewNotification,
	DidChangePinnedRefNotification,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeVisualizationsButtonCallout,
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
	accessor selectedRows: AppState['selectedRows'];

	@signalObjectState()
	accessor visibleDays: AppState['visibleDays'];

	// State accessors for all top-level State properties
	@signalState()
	accessor windowFocused: boolean | undefined;

	@signalState()
	accessor webroot: string | undefined;

	@signalState()
	accessor repositories: State['repositories'];

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
	accessor avatars: State['avatars'];

	@signalState()
	accessor refsMetadata: State['refsMetadata'];

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

	mcpBannerCollapsed?: boolean | undefined;
	hooksBannerCollapsed?: boolean | undefined;
	canInstallClaudeHook?: boolean | undefined;
	graphWalkthroughBannerCollapsed?: boolean | undefined;
	graphWalkthroughComplete?: boolean | undefined;
	graphWalkthroughStarted?: boolean | undefined;
	visualizationsButtonCalloutDismissed?: boolean | undefined;

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

		this.updateState(this._state, true);
		// Enrichment is fetched lazily when a consumer needs it (the overview sidebar mounting or
		// the scope popover opening) rather than eagerly at bootstrap, where it competes with the
		// graph render itself.

		void this.ipc.sendRequest(GetAgentSessionsRequest, undefined).then(sessions => {
			this.agentSessions = sortAgentSessions(sessions);
		});
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
			// in flight will trigger its own fetch whose result is authoritative. Build the next
			// state from `result` so stale entries (e.g. a closed/retargeted PR's enrichment) for
			// branchIds no longer in the active/recent set are dropped, but preserve any
			// locally-merged `mergeTarget` from `mergeMergeTargetIntoEnrichment` (overview cards /
			// click-to-scope) — the host opts out of merge-target resolution here via
			// `skipMergeTarget: true`, so it always returns `mergeTarget: undefined`.
			if (this._enrichmentFingerprint === fingerprint) {
				const previous = this.overviewEnrichment;
				if (previous == null) {
					this.overviewEnrichment = result;
				} else {
					const next: typeof result = {};
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
			}
		});
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

	/**
	 * Merge a lazily-fetched merge-target into `overviewEnrichment` for the given branchId. The graph
	 * overview's enrichment IPC opts out of eager merge-target fetching (`skipMergeTarget: true`); the
	 * card and click-to-scope paths fetch via `BranchesService.getMergeTargetStatus` and call this to
	 * publish the result so the existing `reconcileScopeMergeTarget` hook backfills the scope's tip SHA.
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
				this._enrichmentFingerprint = undefined;
				if (this.overviewEnrichment != null) {
					this.overviewEnrichment = undefined;
				}

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

			case DidChangeAvatarsNotification.is(msg):
				this.updateState({ avatars: msg.params.avatars });
				break;
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
					const wasScoped = this.scope != null;
					// Coalesce with the visibility update so the minimap and graph re-render once.
					this.scope = undefined;
					// Drop any in-flight `setScope` publish — otherwise a cache-miss resolve could
					// re-publish a scope the user just cleared by switching visibility modes.
					this._pendingScope = undefined;
					if (wasScoped) {
						emitTelemetrySentEvent<'graph/scope/cleared'>(this.host, {
							name: 'graph/scope/cleared',
							data: {},
						});
					}
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

			case DidChangeRefsMetadataNotification.is(msg):
				this.updateState({
					refsMetadata: msg.params.metadata,
				});
				break;

			case DidChangeRowsNotification.is(msg): {
				let rows;
				if (msg.params.rows.length && msg.params.paging?.startingCursor != null && this._state.rows != null) {
					const previousRows = this._state.rows;
					const lastId = previousRows.at(-1)?.sha;

					let previousRowsLength = previousRows.length;
					const newRowsLength = msg.params.rows.length;

					this.logger.debug(
						scope,
						`paging in ${newRowsLength} rows into existing ${previousRowsLength} rows at ${msg.params.paging.startingCursor} (last existing row: ${lastId})`,
					);

					// Preallocate the array to avoid reallocations
					rows = new Array(previousRowsLength + newRowsLength);

					if (msg.params.paging.startingCursor !== lastId) {
						this.logger.debug(scope, `searching for ${msg.params.paging.startingCursor} in existing rows`);

						let i = 0;
						let row;
						for (row of previousRows) {
							rows[i++] = row;
							if (row.sha === msg.params.paging.startingCursor) {
								this.logger.debug(scope, `found ${msg.params.paging.startingCursor} in existing rows`);

								previousRowsLength = i;

								if (previousRowsLength !== previousRows.length) {
									// If we stopped before the end of the array, we need to trim it
									rows.length = previousRowsLength + newRowsLength;
								}

								break;
							}
						}
					} else {
						for (let i = 0; i < previousRowsLength; i++) {
							rows[i] = previousRows[i];
						}
					}

					for (let i = 0; i < newRowsLength; i++) {
						rows[previousRowsLength + i] = msg.params.rows[i];
					}
				} else {
					this.logger.debug(scope, `setting to ${msg.params.rows.length} rows`);

					if (msg.params.rows.length === 0) {
						rows = this._state.rows;
					} else {
						rows = msg.params.rows;
					}
				}

				// `avatars` is sent as `undefined` when its backing Map size hasn't changed since
				// the last notification (host-side dedupe). Keep our existing state in that case
				// instead of replacing with undefined and losing it. `downstreams` is always
				// present — the provider mutates existing arrays in place, so size-based dedupe
				// is unsafe and the host always ships the full Record.
				if (msg.params.avatars != null) {
					updates.avatars = msg.params.avatars;
				}
				updates.downstreams = msg.params.downstreams;
				if (msg.params.refsMetadata !== undefined) {
					updates.refsMetadata = msg.params.refsMetadata;
				}
				updates.rows = rows;
				updates.paging = msg.params.paging;
				if (msg.params.rowsStats != null) {
					updates.rowsStats = { ...this._state.rowsStats, ...msg.params.rowsStats };
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
				scope?.addExitInfo(`rows=${this._state.rows?.length ?? 0}`);
				break;
			}
			case DidChangeRowsStatsNotification.is(msg):
				this.updateState({
					rowsStats: { ...this._state.rowsStats, ...msg.params.rowsStats },
					rowsStatsLoading: msg.params.rowsStatsLoading,
				});
				break;

			case DidChangeScrollMarkersNotification.is(msg):
				this.updateState({ context: { ...this._state.context, settings: msg.params.context } });
				break;

			case DidSearchNotification.is(msg):
				this.handleSearchNotification(msg.params, updates);
				this.updateState(updates);
				break;
			case DidChangeSelectionNotification.is(msg):
				this.updateState({ selectedRows: msg.params.selection });
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

			case DidChangeVisualizationsButtonCallout.is(msg):
				this.updateState({ visualizationsButtonCalloutDismissed: msg.params });
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
				// `workingTreeStats` is just the primary wip's embedded `stats` (git-authoritative,
				// same object as `msg.params.wip.stats`). Files and counts travel together, so they
				// can't drift — no generation guard needed.
				const updates: Partial<State> = { workingTreeStats: msg.params.stats };
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
				if (msg.params.wip != null) {
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
				this.mergeOverviewWipForRepo(msg.params.repoPath, msg.params.wip, msg.params.stats);
				break;
			}

			case DidRequestWipRefetchNotification.is(msg): {
				// Host pre-fetched the WIP for a non-active worktree (the active-repo watcher
				// wouldn't fire for it). Push it through the same channel as the regular
				// working-tree notification — the panel's `applyPushedWip` observer handles it.
				if (msg.params.wip != null) {
					const updates: Partial<State> = { wip: msg.params.wip };
					const { repoPath, stats } = msg.params;
					this.cacheWip(repoPath, msg.params.wip);

					// Host shipped its already-computed stats — use them directly rather than
					// deriving locally (would lose `pausedOpStatus` / `context` / `renamed`, and
					// the per-file classifier doesn't match `git diff --shortstat` semantics).
					if (stats != null && repoPath === this.selectedRepository) {
						updates.workingTreeStats = stats;
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
		const { searchId } = params;

		// Ignore stale notifications from old searches
		if (this._currentSearchId != null && searchId < this._currentSearchId) {
			return;
		}

		// Check if this is a cancellation/clear notification
		const cancelled = params.results == null && params.search == null;

		// Starting a new search - clear previous results
		if (searchId !== this._currentSearchId) {
			this._currentSearchId = searchId;
			// Only set searching=true if this is an actual new search (not a cancellation)
			if (!cancelled) {
				this.searching = true;
			}
			updates.searchResults = undefined;

			// Only update search mode when starting a NEW search
			// Don't update on progressive updates (user may have toggled mode during search)
			if (params.search != null) {
				this.searchMode = params.search.filter ? 'filter' : 'normal';
			}
		}

		// Early exit for cancellation - just clear state
		if (cancelled) {
			updates.searchResults = params.results;
			this.searching = false;
			return;
		}

		if (params.selectedRows != null) {
			updates.selectedRows = params.selectedRows;
		}

		// Process search results
		if (params.results != null) {
			if (isGraphSearchResultsError(params.results)) {
				updates.searchResults = params.results;
				this.searching = false;
			} else {
				// For progressive updates, accumulate the incremental batches
				// Backend sends only new results in each batch to save IPC bandwidth
				if (params.partial && this.searchResults != null && !isGraphSearchResultsError(this.searchResults)) {
					const { ids, count, hasMore, commitsLoaded } = params.results;
					// Merge new IDs with existing ones
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

				// Set searching state based on whether this is partial or final
				this.searching = params.partial === true;
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
	 * Seed the wip cache from a host push (working-tree notification / refetch notification).
	 * Clears the pending-local-edit marker because this write IS the host-side reconciliation.
	 */
	private cacheWip(repoPath: string, wip: Wip): void {
		this._wips.set(repoPath, { wip: wip, timestamp: Date.now() });
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
		this._pendingLocalEditPaths.add(repoPath);
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
			entry.label !== prevEntry?.label ||
			entry.branchRef !== prevEntry?.branchRef
		) {
			changed = true;
		}
	}

	// Preserve reference when nothing changed so downstream reactive consumers don't churn.
	return changed ? result : prev;
}
