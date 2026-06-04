import { createContext } from '@lit/context';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { AgentSessionState } from '../../../../agents/models/agentSessionState.js';
import type { StoredGraphWipDraft } from '../../../../constants.storage.js';
import type {
	GetOverviewWipResponse,
	GraphColumnName,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelectedRows,
	GraphWorkingTreeStats,
	State,
	Wip,
} from '../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse, OverviewBranchMergeTarget } from '../../../shared/overviewBranches.js';

export interface AppState extends State {
	state: State;
	activeDay: number | undefined;
	activeRow: string | undefined;
	/**
	 * Columns whose search operator is currently present in the search query, derived from
	 * the parsed search query. Used by gl-graph.react.tsx to set `isFilterActive` on each
	 * column before passing settings to GraphContainer.
	 */
	activeFilterColumns: ReadonlySet<GraphColumnName>;
	agentSessions: AgentSessionState[];
	isBusy: boolean;
	loading: boolean;
	/** Composed with `loading` at the `gl-graph` render boundary — true while a scope-anchor
	 *  IPC is in flight past `scopeLoadingDelayMs`. Owned by `GraphStateProvider.setScope`. */
	scopeLoading: boolean;
	mcpBannerCollapsed?: boolean | undefined;
	hooksBannerCollapsed?: boolean | undefined;
	canInstallClaudeHook?: boolean | undefined;
	navigating: 'next' | 'previous' | false;
	overviewWip?: { branchIds: string[]; wip: GetOverviewWipResponse };
	overviewEnrichment?: GetOverviewEnrichmentResponse;
	scope: GraphScope | undefined;
	searching: boolean;
	searchMode: 'filter' | 'normal';
	searchResultsResponse: GraphSearchResults | GraphSearchResultsError | undefined;
	searchResults: GraphSearchResults | undefined;
	searchResultsError: GraphSearchResultsError | undefined;
	currentSearchId: number | undefined;
	selectedRows: GraphSelectedRows | undefined;
	visibleDays: { top: number; bottom: number } | undefined;

	/**
	 * Publish a lazily-fetched merge target into `overviewEnrichment` for the given branchId. The graph
	 * overview's enrichment IPC skips merge-target fetching; the overview card and click-to-scope path
	 * fetch via `BranchesService.getMergeTargetStatus` and call this so the scope-anchor's
	 * `reconcileScopeMergeTarget` hook backfills the tip SHA.
	 */
	mergeMergeTargetIntoEnrichment(branchId: string, mergeTarget: OverviewBranchMergeTarget | undefined): void;

	/**
	 * Fetch enrichment for the overview's active/recent branches. Called lazily by consumers such as
	 * the scope popover (on open) and the overview sidebar (on mount), rather than eagerly at bootstrap.
	 * Deduped via a fingerprint of the branch ids — repeat calls for the same overview are a no-op.
	 */
	ensureOverviewEnrichmentFetched(overview: State['overview']): void;

	/**
	 * Publish a freshly-picked scope to the `scope` signal — synchronously in its bare form
	 * (without `mergeBase` / `mergeTargetTipSha`) so the graph component's scope filter activates
	 * before any concurrent scroll-to-commit / select-row work. The anchor is resolved
	 * asynchronously via IPC and applied afterward; if the resolved merge base isn't in the
	 * loaded rows (stale or deep target), the bare scope stays and the foreign-ref heuristic
	 * bounds visibility.
	 */
	setScope(scope: GraphScope): Promise<void>;

	/**
	 * Re-resolve the authoritative `mergeBase` for an already-published scope. Called from the
	 * `DidInvalidateScopeAnchorsNotification` handler after refs/config move so the live scope
	 * picks up the fresh anchor without the user re-picking. Initial picks go through `setScope`.
	 */
	resolveScopeMergeBase(scope: GraphScope): Promise<void>;

	/**
	 * Defer clearing the current scope until the next `DidChangeRefsVisibilityNotification` lands —
	 * coalesces the scope clear with the filter visibility update so a mode/filter change produces
	 * a single coordinated re-render instead of a minimap reset followed by a separate filter update.
	 */
	deferScopeClear(): void;

	/**
	 * Cancel any in-flight `setScope` publish and clean up all associated transient state
	 * (`_pendingScope`, `_scopeClearDeferred`, `scopeLoading`). Lower-level primitive used by
	 * {@link clearScope} — prefer `clearScope()` unless you need to separate the cancel from
	 * the scope assignment (e.g. the deferred-clear path).
	 */
	cancelPendingScope(): void;

	/**
	 * Immediately clear the active scope, cancel any in-flight resolve, clean up transient
	 * state, and emit `graph/scope/cleared` telemetry. No-op when no scope is active.
	 */
	clearScope(): void;

	/**
	 * Seed the per-repo WIP cache with an optimistically-edited `Wip` (e.g. after a local stage/
	 * unstage). The entry is flagged so subsequent `getWipState` calls report `isLive: false`
	 * until the host's watcher reconciles. The host-driven push paths (`DidChangeWorkingTree` /
	 * `DidRequestWipRefetch`) seed the cache through an internal path that clears that flag.
	 */
	setWip(repoPath: string, wip: Wip): void;

	/**
	 * Reseed `workingTreeStats` (header / primary-row badge source) from a panel-driven `getWip`
	 * response. No-op unless `repoPath` matches the selected repository. `stats` is the primary
	 * wip's embedded counts (git-authoritative, same object as `wip.stats`) so the file list and
	 * counts can't drift — no generation guard needed.
	 */
	setWorkingTreeStats(repoPath: string, stats: GraphWorkingTreeStats): void;

	/**
	 * Return the cached WIP for `repoPath` plus liveness metadata. `isLive` reflects whether the
	 * host currently has an active working-tree watcher for that repo — `true` for the primary
	 * repo while it's selected, `true` for any secondary whose row is in the latest
	 * `SyncWipWatchesCommand` set, `false` otherwise (and after a local optimistic edit until
	 * the host reconciles). `ageMs` is the time since the entry was last written. Consumers use
	 * `isLive` to decide whether to background-revalidate on cache hit.
	 */
	getWipState(repoPath: string): { wip: Wip; isLive: boolean; ageMs: number } | undefined;

	/**
	 * Update the set of repos the host currently has working-tree watchers for. Called by
	 * `graph-wrapper.ts` whenever it sends `SyncWipWatchesCommand` (visible secondaries) and on
	 * `selectedRepository` change. The primary `selectedRepository` is always included by the
	 * implementation — callers only need to pass the secondary set.
	 */
	updateActiveWipWatchers(repoPaths: Iterable<string>): void;

	/**
	 * Patch one `(worktreePath, draft)` slot in the per-repo wipDrafts map (routed through
	 * `updateState` so `_state.wipDrafts` stays in sync with the signal accessor). Pass
	 * `draft: null` to delete; prunes the parent map to `undefined` when empty. Used by the
	 * details panel to optimistically mirror a flushed draft so the next `loadWipDraft` (e.g.,
	 * swap-away-and-back within the same session) sees it without waiting for a host state push.
	 */
	setWipDraft(worktreePath: string, draft: StoredGraphWipDraft | null): void;

	/**
	 * Decode a single loaded row's reachability (the branches/tags it's reachable from) on demand from
	 * the accumulated, host-owned reachability table. Rows carry only a compact `reachabilityIndex`;
	 * decoded sets are cached by index and shared across pages and consumers. Returns undefined for
	 * rows with no reachability. Used by the selection→details flow and the timeline's branch
	 * attribution.
	 */
	getRowReachability(row: NonNullable<State['rows']>[number]): GitCommitReachability | undefined;
}

export const graphStateContext = createContext<AppState>('graph-state-context');

export const graphServicesContext = createContext<
	import('@eamodio/supertalk').Remote<import('../../../plus/graph/graphService.js').GraphServices> | undefined
>('graph-services-context');
