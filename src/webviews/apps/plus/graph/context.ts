import { createContext } from '@lit/context';
import type { SearchQuery } from '@gitlens/git/models/search.js';
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
	State,
	Wip,
	WipStats,
} from '../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse, OverviewBranchMergeTarget } from '../../../shared/overviewBranches.js';

export interface AppState extends State {
	state: State;
	activeDay: number | undefined;
	activeRow: string | undefined;
	/**
	 * Columns whose search operator is currently present in the search query, derived from
	 * the parsed search query. Drives each column's header filter affordance.
	 */
	activeFilterColumns: ReadonlySet<GraphColumnName>;
	agentSessions: AgentSessionState[];
	isBusy: boolean;
	loading: boolean;
	/** True while one or more targeted row loads remain active past their soft display delay. */
	ensureLoading: boolean;
	/**
	 * Begin a targeted row-loading scope. Returns an idempotent disposer so overlapping consumers
	 * cannot clear each other's loading affordance.
	 */
	beginEnsureLoading(): () => void;
	/** Composed with `loading` at the `gl-graph` render boundary — true while a scope-anchor
	 *  IPC is in flight past `scopeLoadingDelayMs`. Owned by `GraphStateProvider.setScope`. */
	scopeLoading: boolean;
	agentsBannerCollapsed?: boolean | undefined;
	mcpCanAutoRegister?: boolean | undefined;
	canInstallHooks?: boolean | undefined;
	hooksAgents?: readonly { id: string; displayName: string; installed: boolean }[] | undefined;
	navigating: 'next' | 'previous' | false;
	overviewWip?: { branchIds: string[]; wip: GetOverviewWipResponse };
	overviewEnrichment?: GetOverviewEnrichmentResponse;
	scope: GraphScope | undefined;
	/** `scopeToBranch` parked until an attached branch arrives; any scope set or clear cancels it. */
	pendingScopeToBranch: boolean;
	searching: boolean;
	searchMode: 'filter' | 'normal';
	searchResultsResponse: GraphSearchResults | GraphSearchResultsError | undefined;
	searchResults: GraphSearchResults | undefined;
	searchResultsError: GraphSearchResultsError | undefined;
	/** The active search's query, carried from the host so a rebooted/reconnected app can restore its
	 *  search box (results ride their own channel; without this the box is blank after a reconnect). */
	searchQuery: SearchQuery | undefined;
	currentSearchId: number | undefined;
	/** Bumped locally each time the user submits a NEW search, so consumers can scope per-search UI
	 *  state to one search session. Unlike `currentSearchId` (assigned by the host, so it only lands a
	 *  round-trip later) this changes the instant the search is issued. Navigating/resuming an existing
	 *  search does not bump it. */
	searchSession: number;
	selectedRows: GraphSelectedRows | undefined;
	visibleDays: { top: number; bottom: number } | undefined;
	/**
	 * Webview-only monotonic counter bumped whenever the host ships an authoritative refsMetadata REPLACE
	 * (`refsMetadataReset`). An integration-flip STRIP preserves a non-empty upstream map, so the graph
	 * component can't detect the reset by emptiness — it watches this token instead to re-arm its per-id
	 * request dedup and re-request the dropped (PR/issue) types for visible rows. Not part of the host wire
	 * contract (`State`); lives purely in the reducer→component signal path.
	 */
	refsMetadataResetToken: number;

	/**
	 * Publish a lazily-fetched merge target into `overviewEnrichment` for the given branchId. The graph
	 * overview's enrichment IPC skips merge-target fetching; the click-to-scope path and the shared branch
	 * hover (`gl-branch-hover`, backing both the overview card and the graph WIP-bar pills) fetch it and
	 * call this so the scope-anchor's `reconcileScopeMergeTarget` hook backfills the tip SHA.
	 */
	mergeMergeTargetIntoEnrichment(branchId: string, mergeTarget: OverviewBranchMergeTarget | undefined): void;

	/**
	 * Fetch enrichment for the overview's active/recent branches. Called lazily by consumers such as
	 * the scope popover (on open) and the overview sidebar (on mount), rather than eagerly at bootstrap.
	 * Deduped via a fingerprint of the branch ids — repeat calls for the same overview are a no-op.
	 */
	ensureOverviewEnrichmentFetched(overview: State['overview']): void;

	/**
	 * Additively fetch enrichment for branch ids that may sit outside the overview's active/recent set —
	 * a WIP-bar pill on a worktree whose branch missed the recency cut. Merges; never drops. Deduped
	 * against what's already resolved or in flight, so re-hovering a pill is a no-op.
	 */
	ensureEnrichmentFetchedForBranches(branchIds: string[]): void;

	/**
	 * Publish an authoritative overview enrichment result. Drop-stale applies only within the overview's
	 * own id set: entries fetched via `ensureEnrichmentFetchedForBranches` and locally-merged merge-targets
	 * are carried forward.
	 */
	publishOverviewEnrichment(enrichment: NonNullable<AppState['overviewEnrichment']>): void;

	/** Clear all enrichment state (shared record + overview fingerprint + additive WIP-bar tracking) as
	 *  one unit. Both reset paths (scope-anchor invalidation, overview `refresh`) route through here. */
	resetOverviewEnrichment(): void;

	/**
	 * Publish a freshly-picked scope to the `scope` signal — at most ONE write per call (never a
	 * bare-then-anchored two-step; the two produce different visible sets, which reads as commits
	 * jumping), after the anchor IPC settles: anchored when it yields a merge base that's in the
	 * loaded rows, bare otherwise. A superseded or invalid call writes nothing. Resolves once the
	 * publish attempt settles, so callers can sequence a scroll-to-commit / select-row against the
	 * settled scope — re-checking `scope` after the await, since a superseding call owns the final
	 * value.
	 */
	setScope(scope: GraphScope): Promise<void>;

	/**
	 * Re-resolve the authoritative `mergeBase` for an already-published scope. Called from the
	 * `DidInvalidateScopeAnchorsNotification` handler after refs/config move so the live scope
	 * picks up the fresh anchor without the user re-picking. Initial picks go through `setScope`.
	 */
	resolveScopeMergeBase(scope: GraphScope): Promise<void>;

	/** The current branch's merge-target tip + name — row marker's merge-target role/segment. Resolved
	 *  async on load (and re-resolved on ref move) via the shared scope-anchor pipeline, so it lands after
	 *  the initial paint and is absent when there's no real target (default branch / detached). */
	rowMarkerMergeTarget: { sha: string; name?: string } | undefined;

	/**
	 * Resolve (or refresh) `rowMarkerMergeTarget` for the current branch through the shared
	 * scope-anchor cache. Idempotent + self-deduping per branch id, so callers can invoke it freely
	 * (e.g. every render); a ref-move invalidation re-arms it. Non-blocking — the tip lands later.
	 */
	ensureRowMarkerMergeTarget(): void;

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
	 * Ingest an AUTHORITATIVE `Wip` for `repoPath` — a `getWip` RPC response, produced by the host
	 * from the same single `git status` as a push. Reconciles the same mirrors a push does (cache +
	 * ordering high-water, badge stats, overview entry) and leaves the entry live: it is host truth,
	 * not a local guess, so a revisit must not have to buy another `git status` to re-confirm it.
	 * Use this for anything the host produced; {@link setWip} is only for optimistic local edits.
	 * Ordering is the caller's to enforce.
	 */
	ingestWip(repoPath: string, wip: Wip): void;

	/**
	 * Reseed one worktree's WIP status group (header / row badge source) from a panel-driven `getWip`
	 * response. Writes into the row-keyed hot plane, so a peer worktree's response lands on that
	 * peer's row rather than the graph's own. `stats` is that wip's embedded counts
	 * (git-authoritative, same object as `wip.stats`) so the file list and counts can't drift — no
	 * generation guard needed.
	 */
	setWipStatus(repoPath: string, stats: WipStats): void;

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
	 * Stake a claim on `shas` for an outgoing `GetWipStatsRequest` and return its ticket; pair with
	 * {@link isCurrentWipStatsRequest} before applying the response. Concurrent batches don't cancel each
	 * other, and the responses carry no revision, so this is what keeps an older read that lands late from
	 * rolling a row back over a newer one.
	 */
	claimWipStatsRequest(shas: Iterable<string>): number;

	/** Whether `ticket` is still the latest {@link claimWipStatsRequest} for `sha`. */
	isCurrentWipStatsRequest(sha: string, ticket: number): boolean;

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
