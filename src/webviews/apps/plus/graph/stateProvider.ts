import { ContextProvider } from '@lit/context';
import { debounce } from '@gitlens/utils/debounce.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { IpcMessage } from '../../../ipc/models/ipc.js';
import type {
	DidSearchParams,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	State,
} from '../../../plus/graph/protocol.js';
import {
	DidChangeAgentSessionsNotification,
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeCanInstallClaudeHook,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeHooksBanner,
	DidChangeMcpBanner,
	DidChangeNotification,
	DidChangeOrgSettings,
	DidChangeOverviewNotification,
	DidChangeOverviewWipNotification,
	DidChangePinnedRefNotification,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeScrollMarkersNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWipStaleNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidInvalidateScopeAnchorsNotification,
	DidRequestOpenCompareModeNotification,
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
};

/**
 * Returns the scope with `mergeTargetTipSha` backfilled from the branch's enrichment, or the
 * original scope reference when nothing needs to change. Callers use reference-equality to know
 * whether they need to publish a new scope value.
 */
export function reconcileScopeMergeTarget(
	scope: AppState['scope'],
	enrichment: AppState['overviewEnrichment'],
): AppState['scope'] {
	if (scope == null) return scope;
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
	accessor activeSidebarPanel: AppState['activeSidebarPanel'];

	@signalState()
	accessor displayMode: AppState['displayMode'];

	@signalState()
	accessor timelinePeriod: AppState['timelinePeriod'];

	@signalState()
	accessor timelineSliceBy: AppState['timelineSliceBy'];

	@signalState()
	accessor timelineShowAllBranches: AppState['timelineShowAllBranches'];

	@signalState()
	accessor detailsVisible: AppState['detailsVisible'];

	@signalState()
	accessor detailsPosition: AppState['detailsPosition'];

	@signalState()
	accessor detailsBottomPosition: AppState['detailsBottomPosition'];

	@signalState()
	accessor sidebarVisible: AppState['sidebarVisible'];

	@signalState()
	accessor sidebarPosition: AppState['sidebarPosition'];

	@signalState()
	accessor minimapVisible: AppState['minimapVisible'];

	@signalState()
	accessor minimapPosition: AppState['minimapPosition'];

	get isBusy(): AppState['isBusy'] {
		return this.loading || this.searching || /*this.rowsStatsLoading ||*/ false;
	}

	@signalState(false)
	accessor loading: AppState['loading'] = false;

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

	@signalState()
	accessor wipMetadataBySha: State['wipMetadataBySha'];

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
	 * Set by callers (e.g. the scope popover) right before sending a filter-changing IPC, so the
	 * scope clear coalesces with the resulting `DidChangeRefsVisibilityNotification` rather than
	 * causing an immediate minimap reset followed by a separate filter-update repaint.
	 */
	private _scopeClearDeferred = false;

	deferScopeClear(): void {
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

	async resolveScopeMergeBase(scope: GraphScope): Promise<void> {
		const repoPath = scope.branchRef.split('|', 2)[0];
		if (!repoPath) return;

		const cacheKey = `${repoPath}|${scope.branchRef}`;

		// Cache hit — patch and return without IPC.
		if (this._mergeBaseCache.has(cacheKey)) {
			this.patchScopeAnchor(scope, this._mergeBaseCache.get(cacheKey));
			return;
		}

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
		if ((this._anchorGenerations.get(repoPath) ?? 0) !== generation) return;
		this._mergeBaseCache.set(cacheKey, anchor);
		this.patchScopeAnchor(scope, anchor);
	}

	private patchScopeAnchor(scope: GraphScope, anchor: ResolvedScopeAnchor | undefined): void {
		if (anchor == null) return;
		// Host couldn't resolve either field — leave the live scope alone rather than assigning
		// a no-op spread that would re-zoom the minimap for nothing.
		if (anchor.mergeBase == null && anchor.mergeTargetTipSha == null) return;
		// Only patch if the live scope still points at the same branch (user may have re-scoped
		// or cleared while the resolve was in flight).
		const current = this.scope;
		if (current?.branchRef !== scope.branchRef) return;
		// Skip if both the mergeBase and target tip already match — prevents a redundant signal
		// update that would re-zoom the minimap needlessly.
		const mergeBaseSame =
			current.mergeBase?.sha === anchor.mergeBase?.sha && current.mergeBase?.date === anchor.mergeBase?.date;
		// `mergeTargetTipSha` may also be supplied by enrichment via `reconcileScopeMergeTarget`.
		// Only overwrite when the resolver returned a value AND it differs — `undefined` from the
		// resolver shouldn't clobber an enrichment-supplied SHA.
		const targetTipSame =
			anchor.mergeTargetTipSha == null || anchor.mergeTargetTipSha === current.mergeTargetTipSha;
		if (mergeBaseSame && targetTipSame) return;

		const next: GraphScope = { ...current };
		if (anchor.mergeBase != null && !mergeBaseSame) {
			next.mergeBase = anchor.mergeBase;
		}
		if (anchor.mergeTargetTipSha != null && !targetTipSame) {
			next.mergeTargetTipSha = anchor.mergeTargetTipSha;
		}
		this.scope = next;
	}

	protected onMessageReceived(msg: IpcMessage): void {
		const scope = getScopedLogger();

		const updates: Partial<State> = {};
		switch (true) {
			case DidChangeNotification.is(msg): {
				// Preserve client-side wipMetadataBySha.workDirStats (populated via GetWipStatsRequest)
				// across full-state pushes — the server only sends anchor info.
				const incoming = msg.params.state;
				const next =
					incoming.wipMetadataBySha != null
						? {
								...incoming,
								wipMetadataBySha: mergeWipMetadata(
									this._state.wipMetadataBySha,
									incoming.wipMetadataBySha,
								),
							}
						: incoming;
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
				const prefix = `${repoPath}|`;
				if (branchRefs?.length) {
					for (const ref of branchRefs) {
						const key = `${repoPath}|${ref}`;
						this._mergeBaseCache.delete(key);
						this._mergeBasePromises.delete(key);
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

				updates.avatars = msg.params.avatars;
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

			case DidChangeOverviewWipNotification.is(msg):
				this.overviewWip = msg.params.wip;
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

			case DidChangeWorkingTreeNotification.is(msg):
				this.updateState({
					workingTreeStats: msg.params.stats,
					wipMetadataBySha: mergeWipMetadata(this._state.wipMetadataBySha, msg.params.wipMetadataBySha),
				});
				break;

			case DidRequestWipRefetchNotification.is(msg): {
				// Bump the working-tree-stats reference so the panel's willUpdate observer
				// treats it as changed and force-runs `refetchWipQuiet(effectiveRepoPath)`.
				// We don't have a direct path from stateProvider to actions, so we ride the
				// existing wts-driven refresh hook. Stats values are unchanged — only the
				// reference identity matters for the dedup at the panel side.
				const stats = this._state.workingTreeStats;
				if (stats != null) {
					this.updateState({ workingTreeStats: { ...stats } });
				}
				break;
			}

			case DidChangeWipStaleNotification.is(msg): {
				const current = this._state.wipMetadataBySha;
				if (current == null) break;
				// Produce a new reference so the GK component's dedup resets and re-requests stats
				// for any currently-visible entries marked stale.
				const next = { ...current };
				for (const sha of msg.params.shas) {
					const prev = next[sha];
					if (prev == null) continue;
					next[sha] = { ...prev, workDirStatsStale: true };
				}
				this.updateState({ wipMetadataBySha: next });
				break;
			}

			case DidChangeRepoConnectionNotification.is(msg):
				this.updateState({ repositories: msg.params.repositories });
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

	private fireProviderUpdate = debounce(() => this.provider.setValue(this, true), 100);

	protected updateState(partial: Partial<State>, silent?: boolean) {
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

		if (silent || !hasChanges) return;

		this.options.onStateUpdate?.(partial);
		this.fireProviderUpdate();
	}
}

export function mergeWipMetadata(
	prev: State['wipMetadataBySha'],
	incoming: State['wipMetadataBySha'],
): State['wipMetadataBySha'] {
	if (incoming == null) return undefined;
	if (prev == null) return incoming;

	const incomingKeys = Object.keys(incoming);
	const prevKeys = Object.keys(prev);
	let changed = incomingKeys.length !== prevKeys.length;

	const result: NonNullable<State['wipMetadataBySha']> = {};
	for (const [sha, entry] of Object.entries(incoming)) {
		const prevEntry = prev[sha];
		// Preserve per-row derived fields fetched client-side via GetWipStatsRequest; anchor fields come from `entry`.
		// Without this, the library's resolveWipState falls back to the primary's workDirStats for secondary rows
		// between when the server rebuilds anchors and when fresh stats arrive, causing a visible flash.
		result[sha] =
			prevEntry != null
				? { ...entry, workDirStats: prevEntry.workDirStats, workDirStatsStale: prevEntry.workDirStatsStale }
				: entry;

		if (changed) continue;
		if (
			entry.repoPath !== prevEntry?.repoPath ||
			entry.parentSha !== prevEntry?.parentSha ||
			entry.label !== prevEntry?.label
		) {
			changed = true;
		}
	}

	// Preserve reference when nothing changed so downstream reactive consumers don't churn.
	return changed ? result : prev;
}
