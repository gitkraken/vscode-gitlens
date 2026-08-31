import { hasDirtyCounts } from '@gitkraken/commit-graph-ui/worktree.js';
import { isPrimaryWipRowId } from '@gitkraken/commit-graph/identity.js';
import { computed, signal } from '@lit-labs/signals';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { areEqual } from '@gitlens/utils/object.js';
import { basename } from '@gitlens/utils/path.js';
import type { GraphFiltersService } from '../../../plus/graph/graphService.js';
import type { GraphScopeSource, State } from '../../../plus/graph/protocol.js';
import { noop } from '../../shared/actions/rpc.js';
import { matchAgentSessionsForWorktree } from '../../shared/agentUtils.js';
import { HeldActionController } from '../../shared/controllers/held-action.js';
import type {
	OverviewBarFocusDetail,
	OverviewBarItem,
	OverviewBarJumpDetail,
	OverviewBarSelectDetail,
	OverviewBarStatsNeededDetail,
} from './components/gl-graph-overview-bar.js';
import { pickWipRowAgentStatus } from './components/wipRowAgentStatus.js';
import type { AppState } from './context.js';
import type { GlGraphWrapper } from './graph-wrapper/graph-wrapper.js';
import { serializeWipContext } from './utils/rowContext.utils.js';
import {
	filterSecondariesForScopeAndVisibility,
	isScopeFocalHead,
	shouldIncludeOverviewBarSecondary,
	shouldShowPrimaryWipRow,
} from './utils/wip.utils.js';

/** How often the overview bar's coarse wall-clock tick fires — see `_overviewBarItemsSignal`. Matches
 *  the 60s relative-time refresh `gl-lit-graph` already uses. */
const overviewBarClockTickMs = 60_000;

/** A typical OS double-click interval — how long pill interactions wait to see whether a second
 *  click lands. */
const overviewBarDblClickGraceMs = 300;

/** Extract the user-visible branch name from a ref id of the form `{repoPath}|heads/{name}`. */
function branchNameFromRef(branchRef: string | undefined): string | undefined {
	if (branchRef == null) return undefined;

	const idx = branchRef.indexOf('|heads/');
	return idx >= 0 ? branchRef.slice(idx + '|heads/'.length) : undefined;
}

/** Derives a user-friendly label for the primary worktree when no branch is checked out
 *  (detached HEAD). Uses the worktree directory basename — matches how worktrees typically
 *  appear in VS Code's worktree list and tooling. Falls back to `(detached)` for safety. */
function primaryFallbackLabel(repoPath: string): string {
	return basename(repoPath) || '(detached)';
}

/** One-time-bound view of the host state the overview/WIP bar reads and drives. Built ONCE by
 *  `<gl-graph-app>` as closures over itself; none of these run on a hot path. */
export type OverviewBarHostDeps = {
	graph(): GlGraphWrapper | undefined;
	graphState(): AppState;
	updateComplete(): Promise<boolean>;
	fallbackRepoPath(): string | undefined;
	primaryWipRowId(): string | undefined;
	ensureGraphDisplayMode(): boolean;
	getFiltersService(): Promise<GraphFiltersService | undefined>;
	waitForState(predicate: () => boolean, timeoutMs?: number): Promise<void>;
	/** The repo path of the host's current selection, or `undefined` when nothing is selected. */
	selectedCommitRepoPath(): string | undefined;
	/** Anchors the host selection on `uncommitted` for `repoPath` (the WIP-selection shape). */
	selectWip(repoPath: string): void;
	openWipDetails(
		repoPath: string,
		sha: string,
		target: 'compose' | 'review' | 'resolve' | 'agents' | undefined,
		trigger: 'request-mode' | 'request-agents' | 'request-graph-wip-bar',
	): Promise<void>;
	emitDetailsVisibilityTelemetry(visible: boolean, trigger: 'request-graph-wip-bar'): void;
	scopeToBranchByName(
		branchName: string,
		upstreamName?: string,
		options?: { remote?: boolean; source?: GraphScopeSource; additionalBranchRefs?: string[] },
	): Promise<void>;
	fetchSelectedWorktreeWipStats(sha: string): Promise<void>;
};

/**
 * The overview/WIP bar: item building (a signal-backed computed with per-item identity preservation),
 * its coarse wall-clock tick for agent-staleness buckets, the pill select/focus/jump handlers,
 * scope-aware reveal helpers shared with the sidebar paths, and lazy stats fetching on hover.
 */
export class OverviewBarController implements ReactiveController {
	private readonly _host: ReactiveControllerHost;
	private readonly deps: OverviewBarHostDeps;

	/** A pill click's select, held for the double-click grace window — see {@link onSelect}. */
	private readonly _select: HeldActionController;

	constructor(controllerHost: ReactiveControllerHost, deps: OverviewBarHostDeps) {
		this._host = controllerHost;
		this.deps = deps;
		this._select = new HeldActionController(controllerHost, overviewBarDblClickGraceMs);
		controllerHost.addController(this);
	}

	hostConnected(): void {
		// Coarse wall-clock tick for the overview bar's agent-staleness buckets — see
		// `_overviewBarItemsSignal` for why it exists.
		this._clockTimer ??= setInterval(() => this._overviewBarClock.set(Date.now()), overviewBarClockTickMs);
	}

	hostDisconnected(): void {
		if (this._clockTimer != null) {
			clearInterval(this._clockTimer);
			this._clockTimer = undefined;
		}
		this._select.cancel();
	}

	/** A row-marker-leg jump: reveal + select a HEAD / upstream / merge-target tip. Deliberately just
	 *  the reveal — unlike a pill select it never opens the WIP details panel, since the user asked to
	 *  look somewhere, not to work on that worktree's changes. */
	onJump = async (e: CustomEvent<OverviewBarJumpDetail>): Promise<void> => {
		if (this.deps.ensureGraphDisplayMode()) {
			// Wait for the graph to mount after the mode switch before asking it to reveal a row.
			await this.deps.updateComplete();
		}
		void this.deps.graph()?.navigateToCommit(e.detail.sha, { source: 'overview', flash: true });
	};

	onSelect = (e: CustomEvent<OverviewBarSelectDetail>): void => {
		const detail = e.detail;
		this._select.hold(() => void this.selectItem(detail));
	};

	/** Double-click on an overview-bar pill — focus (scope) the graph on its worktree's branch, or
	 *  unfocus when that branch is already the live scope. Mirrors the sidebar rows' toggle. Bound
	 *  arrow: wired directly as a Lit listener, so it must keep the controller as its receiver. */
	onFocus = (e: CustomEvent<OverviewBarFocusDetail>): void => {
		// The double-click supersedes its own clicks' held select — the scope owns positioning now.
		this._select.cancel();
		const gs = this.deps.graphState();
		if (gs.scope?.branchRef === e.detail.branchId) {
			gs.clearScope();

			return;
		}

		void this.deps.scopeToBranchByName(e.detail.branch, undefined, { source: 'wip-row' });
	};

	/** Selects a WIP overview-bar item (click or digit shortcut) — puts the graph in graph mode, drops
	 *  a scope that would hide the target worktree, opens the WIP details panel, and reveals the row.
	 *  `returnFocusToGraph` re-focuses the graph once everything above has settled — used by the digit
	 *  shortcut, whose keystroke originates in the graph and shouldn't leave it; the click path (no
	 *  option) leaves focus on the pill, matching today's behavior. */
	async selectItem(detail: OverviewBarSelectDetail, options?: { returnFocusToGraph?: boolean }): Promise<void> {
		const { id, repoPath } = detail;
		// Bar is a global WIP affordance; clicking it always lands the user in graph mode
		// so the corresponding WIP row is visible (matches the stated user intent: "select that
		// WIP row in the graph and reveal the WIP details panel").
		const gs = this.deps.graphState();
		// Snapshot pre-state — `persistState()` can flow back through host and flip visibility
		// between the mode switch and the visibility check, so capture both up front.
		const wasVisible = gs.details?.visible === true;
		this.deps.ensureGraphDisplayMode();
		// Drop the active scope when the clicked WIP isn't part of it, so the worktree's row
		// materializes in the now-unscoped graph and `navigateToCommit` below can reveal it.
		// Leave the scope untouched when the pill already matches it. Uses the canonical clear
		// (`deferScopeClear` + the filters reset): the host's filter-reset reloads unscoped rows and pushes
		// the snapshot that fires the deferred clear. (Pills hidden purely by `branchesVisibility` are out
		// of this rule's scope — the product decision is scope-only.)
		const scopeCleared = gs.scope != null && !this.isWipPillInScope(id, gs.scope);
		let resetFilters: Promise<void> | undefined;
		if (scopeCleared) {
			gs.deferScopeClear();
			// Attach a rejection sink at creation — a failed reset already leaves the deferred scope
			// clear untouched (it's consumed on the host's push; no push means the `waitForState`
			// timeout below covers it), so there's nothing more to do here than keep it from surfacing
			// as an unhandled rejection.
			resetFilters = (async () => (await this.deps.getFiltersService())?.reset())().catch(noop);
		}
		// Anchor the selection synchronously, normalized to `uncommitted` — every WIP row (primary
		// and secondary alike) collapses to that sha and is distinguished by `repoPath`, matching
		// what `handleWipRowOpen` and the graph's own selection path produce. Setting it here, before
		// the telemetry emit below, ensures the already-visible `graphDetails/shown` event reflects
		// the newly-selected WIP rather than the prior selection. `openWipDetails` re-applies the
		// same values.
		this.deps.selectWip(repoPath);
		// Pre-await telemetry — covers the setDetailsVisible-short-circuit case inside openWipDetails:
		// if the details panel is already visible, downstream telemetry would lose this bar-click
		// intent. Emitting pre-await also avoids a race where visibility flips off/on during the await.
		if (wasVisible) {
			this.deps.emitDetailsVisibilityTelemetry(true, 'request-graph-wip-bar');
		}
		// Graph may be freshly mounted by the display-mode switch above — wait one update cycle so
		// `this.graph` exists before navigating (what the `openWipDetails` await used to cover).
		await this.deps.updateComplete();
		// When we cleared the scope above, the unscoped rows arrive via a host round-trip. The reset
		// resolves once the host wrote and fired; the cleared scope itself lands one hop later, on the
		// filters push that consumes the deferred clear — so wait for the settled state too, or the
		// retry window starts before the worktree's row can materialize. Both halves of the predicate
		// matter: the state clears synchronously, but the graph's projection lifts on its next update —
		// a jump re-run in between classifies its target against the STALE projection.
		if (resetFilters != null) {
			await resetFilters;
			await this.deps.waitForState(
				() => this.deps.graphState().scope == null && this.deps.graph()?.isScopeProjectionActive() !== true,
			);
		}
		// Select + reveal the WIP row in the graph itself — the bar's stated intent, and the user's
		// immediate feedback — BEFORE opening the details panel. The `id` is `uncommitted` for the
		// graph's own worktree and the peer's WIP row id otherwise; `navigateToCommit` handles both
		// and waits through the render + scope catch-up.
		void this.deps.graph()?.navigateToCommit(id, { source: 'overview', flash: true });

		// Open the details panel on the NEXT frame, after the row highlight commits — the panel
		// render is heavy for a worktree with many agent sessions, and sequencing it in front of the
		// selection made the click read sluggish (a half-second highlight lag on such worktrees).
		await this.deps.updateComplete();
		requestAnimationFrame(() => {
			// A later pill click supersedes this deferred open — its own flow owns the panel now.
			if (this.deps.selectedCommitRepoPath() !== repoPath) return;

			void this.deps.openWipDetails(repoPath, uncommitted, undefined, 'request-graph-wip-bar');
		});

		if (options?.returnFocusToGraph) {
			void this.deps.updateComplete().then(() => this.deps.graph()?.focus());
		}
	}

	/** Navigates to a just-applied scope's selection, then re-asserts the reveal once after the
	 *  restructure's geometry settles. The projection flag flips before the virtualizer re-measures
	 *  the restructured rows, so the first reveal can scroll stale geometry and get clamped when the
	 *  re-measure lands — selection right, viewport wrong. The re-assert is a visual no-op when the
	 *  first reveal landed (same target, no flash), and is dropped when a newer scope owns the view
	 *  by then. */
	revealForScope(sha: string, ref: string, branchRef: string, source: 'sidebar' | 'overview'): void {
		void this.deps.graph()?.navigateToCommit(sha, { source: source, flash: true, ref: ref });
		setTimeout(() => {
			if (this.deps.graphState().scope?.branchRef !== branchRef) return;

			void this.deps.graph()?.navigateToCommit(sha, { source: source, reveal: 'always', feedback: false });
		}, overviewBarDblClickGraceMs);
	}

	/** Whether a clicked WIP pill's worktree is part of the active graph scope. The primary WIP
	 *  (`uncommitted`) matches when its row renders under the scope; a secondary matches when its
	 *  worktree branch is the scope's focal or one of its additional refs. Detached secondaries (no
	 *  `branchRef`) never match a branch scope. */
	private isWipPillInScope(id: string, scope: NonNullable<AppState['scope']>): boolean {
		if (id === uncommitted) {
			// Ask the predicate the wrapper renders by, with the same rows-derived fallback — the old
			// `scope.branchRef === branch?.id` re-derivation treated a transiently-unknown branch as a
			// mismatch and cleared the scope (plus reset filters) for a row already on screen. Same
			// drift `handleJumpToWip` had.
			const gs = this.deps.graphState();
			const { branchesVisibility, includeOnlyRefs, branch } = gs;
			const scopeFocalIsHead = branch == null ? isScopeFocalHead(gs.rows, scope) : undefined;
			return shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, branch, scope, scopeFocalIsHead);
		}

		const branchRef = this.deps.graphState().wipRowsById?.[id]?.branchRef;
		if (branchRef == null) return false;
		return scope.branchRef === branchRef || scope.additionalBranchRefs?.includes(branchRef) === true;
	}

	/** Drops an active scope that would hide the WIP row a reveal is about to select. The host only
	 *  switches repositories across repo families now, so a worktree of the shown repo is revealed in
	 *  place — which makes the scope the one remaining thing that can put the target row off screen.
	 *  Asks {@link isWipPillInScope} (the predicate the wrapper renders by) rather than re-deriving
	 *  the rule. No-ops when the row already renders, and when it wouldn't render unscoped either —
	 *  there'd be nothing to reveal, and the details panel still opens on the target regardless.
	 *
	 *  Takes the GRAPH-ROW sha from the host's row-id translation; `isWipPillInScope` and the
	 *  primary-row visibility check key the primary by `uncommitted`, not by its `wip::<path>` row id,
	 *  so it is translated back for that one case. */
	unscopeToRevealWip(rowSha: string): void {
		const gs = this.deps.graphState();
		const scope = gs.scope;
		if (scope == null) return;

		// The host hands us a ROW id (`wip::<path>`), never a revision — so translate the graph's own
		// WIP row back to `uncommitted`, which is the key the primary-row predicates below use.
		const id = isPrimaryWipRowId(rowSha, this.deps.fallbackRepoPath()) ? uncommitted : rowSha;
		if (this.isWipPillInScope(id, scope)) return;

		const { branchesVisibility, includeOnlyRefs, branch } = gs;
		const rendersUnscoped =
			id === uncommitted
				? shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, branch, undefined)
				: filterSecondariesForScopeAndVisibility(
						this.peerWipRows(),
						undefined,
						branchesVisibility,
						includeOnlyRefs,
					)?.[id] != null;
		if (!rendersUnscoped) return;

		gs.clearScope();
	}

	/** In-flight set so repeated hovers over a stats-less pill fire at most one fetch per worktree. */
	private readonly _wipStatsInFlight = new Set<string>();

	/** Lazily fetches a hovered peer WIP pill's stats (the graph's own ride the working-tree push).
	 *  Skips when `graph.showWorktreeWipStats` is off: hover isn't selection, so it mustn't trigger a
	 *  per-worktree `git status` (clicking still reveals the breakdown). Backstop to the bar's own
	 *  `statsOnHover` suppression. */
	onStatsNeeded = (e: CustomEvent<OverviewBarStatsNeededDetail>): void => {
		const { id } = e.detail;
		if (id === uncommitted || this._wipStatsInFlight.has(id)) return;

		const gs = this.deps.graphState();
		if (gs.config?.showWorktreeWipStats === false) return;

		const state = gs.wipStateById?.[id];
		if (state == null || (state.workDirStats != null && !state.workDirStatsStale)) return;

		this._wipStatsInFlight.add(id);
		void this.deps.fetchSelectedWorktreeWipStats(id).finally(() => this._wipStatsInFlight.delete(id));
	};

	/** Coarse wall-clock tick — the one clock dependency {@link _overviewBarItemsSignal} is allowed.
	 *  The bar's agent-staleness buckets need `Date.now()`, which a signal graph would otherwise sample
	 *  once and never revisit (an idle session crossing the 24h threshold would never expire). This
	 *  invalidates the computed at least once a minute — matching the old rebuild-on-any-render
	 *  freshness, and beating it while the app sits idle with no renders happening at all. */
	private readonly _overviewBarClock = signal(0);
	private _clockTimer: ReturnType<typeof setInterval> | undefined;

	/** Last array produced by {@link _overviewBarItemsSignal}, kept ONLY for per-item identity
	 *  preservation — see the computed. */
	private _overviewBarItemsCache: readonly OverviewBarItem[] = [];

	/** The overview/WIP bar's items, computed over the signals it actually reads (repo selection,
	 *  config visibility, WIP topology/status, branch state, merge target, agent sessions) instead of
	 *  rebuilt on every GraphApp render (selection, scroll, search, resize, agent ticks — none of which
	 *  touch the bar). A stable result also fails Lit's `Object.is` check less often, so the bar skips
	 *  re-rendering its pills on unrelated renders entirely. */
	private _overviewBarItemsSignal = computed(() => {
		// Subscribe to the minute tick so staleness-threshold crossings invalidate even when no input
		// data moved; the value itself is unused (`Date.now()` is read fresh on each re-run).
		void this._overviewBarClock.get();

		const next = this.buildItems(Date.now());
		const prev = this._overviewBarItemsCache;

		// Preserve identity PER ITEM, not just for the whole array: reuse each prior item object whose
		// content is unchanged. Without this, one pill changing (e.g. another worktree's agent tick)
		// reallocates the whole array, handing every OTHER pill's already-open hover a fresh `.wip`
		// reference — which churns that hover's settle timer every unrelated tick. `areEqual` is a deep
		// compare, so it covers the nested `wip` and `row marker` payloads too. Content-compared, not
		// identity-compared: nothing in an OverviewBarItem is derived from the clock between threshold
		// crossings, so equal content really means "nothing changed" (an earlier cut carried a sub-minute
		// `lastActivity` number that would have defeated this on every tick while an agent worked —
		// precisely when the bar is busiest; the row-marker legs are shas + counts, so they hold that
		// property).
		const prevById = new Map(prev.map(item => [item.id, item]));
		const merged = next.map(item => {
			const prior = prevById.get(item.id);
			return prior != null && areEqual(item, prior) ? prior : item;
		});
		// Everything reused in the same order → hand back the exact prior array so the bar itself skips
		// re-rendering when a co-dependency changed but no item did.
		if (merged.length === prev.length && merged.every((item, i) => item === prev[i])) return prev;

		this._overviewBarItemsCache = merged;
		return merged;
	});

	/** Read during the host's render so `SignalWatcher` subscribes to the underlying signals. */
	get items(): readonly OverviewBarItem[] {
		return this._overviewBarItemsSignal.get();
	}

	/** `wipRowsById` minus the graph's own worktree. The WIP bar pushes the graph's own pill explicitly
	 *  (always first, always keyed by `uncommitted`), so the peer loop must not re-emit it. Memoized by
	 *  the signal graph on (wipRowsById, primaryWipRowId), so the bar's per-item identity preservation
	 *  always sees a stable input. */
	private _peerWipRowsSignal = computed(() => {
		const wipRowsById = this.deps.graphState().wipRowsById;
		const primaryWipRowId = this.deps.primaryWipRowId();

		let peers = wipRowsById;
		if (wipRowsById != null && primaryWipRowId != null && wipRowsById[primaryWipRowId] != null) {
			const { [primaryWipRowId]: _primary, ...rest } = wipRowsById;
			peers = rest;
		}
		return peers;
	});

	private peerWipRows(): State['wipRowsById'] {
		return this._peerWipRowsSignal.get();
	}

	/** Computes the bar's entries, gated by `gitlens.graph.overviewBar.visibility` (`'never'` hides it
	 *  outright; `'worktrees'`/`'dirtyWorktrees'` additionally require a secondary worktree to exist /
	 *  qualify). When the bar renders, the primary worktree is always the first entry — it carries the
	 *  current branch's HEAD / upstream / merge-target jumps even when nothing else qualifies, but those
	 *  jumps go away along with the bar in the hidden modes. Secondaries follow, most-recent first:
	 *  `'always'`/`'worktrees'` include every peer, while `'dirtyWorktrees'` includes only peers with
	 *  working changes or unpushed commits. Agent state is resolved per-worktree via the
	 *  session-by-worktree index. `now` is passed in by the caller (the computed) so the wall-clock
	 *  read stays next to the tick subscription that keeps it honest. */
	private buildItems(now: number): readonly OverviewBarItem[] {
		const gs = this.deps.graphState();
		const fallbackRepoPath = this.deps.fallbackRepoPath();
		if (fallbackRepoPath == null) return [];

		const visibility = gs.config?.overviewBarVisibility ?? 'dirtyWorktrees';
		if (visibility === 'never') return [];

		// The bar is a GLOBAL affordance: its peers are independent of the graph's active scope /
		// branchesVisibility. (The in-graph WIP rows ARE scope/visibility-filtered — see `getDecoratedRows` —
		// so the bar can intentionally show worktrees the graph has filtered out.)

		// Secondary worktrees — NOT scope/visibility filtered (unlike the graph's WIP rows). A worktree is
		// "dirty" by its fetched `workDirStats` when present, else by the host's cheap `hasChanges` probe —
		// so `dirtyWorktrees` can show the pill before the full breakdown is fetched (lazily, on hover).
		// `always`/`worktrees` include clean/pushed peers too. Ordered by HEAD commit date, most-recent first
		// (`parentDate`).
		const peerWipRows = this.peerWipRows();
		// `worktrees` gates on a secondary EXISTING; every existing secondary also gets a pill below.
		if (visibility === 'worktrees' && (peerWipRows == null || Object.keys(peerWipRows).length === 0)) {
			return [];
		}

		const wipStateById = gs.wipStateById;
		const secondaries =
			peerWipRows != null
				? Object.entries(peerWipRows)
						.map(([sha, meta]) => {
							const state = wipStateById?.[sha];
							const stats = state?.workDirStats;
							const counted = stats != null ? hasDirtyCounts(stats) : undefined;
							// Verified counts decide alone. STALE counts (carried across a watch gap, or
							// contradicted by the probe) decide TOGETHER with the probe bit, either signal
							// enough: whichever is out of date, the worktree qualifies for `dirtyWorktrees` and
							// hovering it buys the authoritative status that settles it. A missing pill has no hover,
							// so erring quiet here is what strands the row.
							const dirty =
								counted != null && state?.workDirStatsStale !== true
									? counted
									: counted === true || state?.hasChanges === true;
							return { sha: sha, meta: meta, state: state, dirty: dirty };
						})
						.filter(({ state, dirty }) =>
							shouldIncludeOverviewBarSecondary(visibility, dirty, state?.hasUnpushed === true),
						)
						.sort((a, b) => (b.meta.parentDate ?? 0) - (a.meta.parentDate ?? 0))
				: [];

		if (visibility === 'dirtyWorktrees' && secondaries.length === 0) return [];

		// Resolve agent state per worktree through a single index (O(1) per lookup; built once over the
		// session list by the state provider's memoized `agentSessionIndex`) instead of re-scanning
		// every session per worktree — mirrors `getAgentStatusByRowSha` in graph-wrapper so the bar and
		// the in-graph WIP rows surface the same indicator.
		const sessionIndex = gs.agentSessionIndex;
		const pickAgent = (repoPath: string): Pick<OverviewBarItem, 'agent' | 'agentCount'> => {
			const status = pickWipRowAgentStatus(
				matchAgentSessionsForWorktree(sessionIndex, { repoPath: repoPath, worktreePath: repoPath }),
				now,
			);
			if (status == null) return {};

			return { agent: status.category, agentCount: status.sessions.length };
		};

		const items: OverviewBarItem[] = [];

		// Primary worktree's WIP — always the first entry when the bar renders, even when the primary is
		// clean (no changes / unpushed / agent): it's the row-marker anchor, carrying the current branch's
		// HEAD / upstream / merge-target jumps, and it stays put as secondaries come and go. Its hot state
		// is computed independent of the graph's filters; WorkDirStats are FILE counts (added/modified/
		// deleted files). A detached HEAD falls back to the worktree basename. Unpushed comes free from
		// `branchState.ahead` (tracked branch); a primary on a local-only branch is intentionally NOT
		// probed — those commits are already visible in the main graph, unlike a hidden secondary's.
		const primaryWipRowId = this.deps.primaryWipRowId();
		const primary = primaryWipRowId != null ? gs.wipStateById?.[primaryWipRowId] : undefined;
		const primaryStats = primary?.workDirStats;
		const primaryDirty = hasDirtyCounts(primaryStats);
		const primaryAhead = gs.branchState?.ahead ?? 0;
		items.push({
			id: uncommitted,
			branch: gs.branch?.name ?? primaryFallbackLabel(fallbackRepoPath),
			repoPath: fallbackRepoPath,
			hasWorkingChanges: primaryDirty,
			// The current branch is always `active` in the overview, so the hover resolves it from there and
			// needs no `branchModel` fallback.
			branchId: gs.branch?.id,
			// HEAD leg ← the host-supplied current-branch tip (reactive); upstream leg ← the `upstreamSha`
			// scalar (jumps even to an unpushed/unloaded upstream tip); merge-target leg ← the client-pulled
			// `rowMarkerMergeTarget` (async, absent on the default branch / detached).
			headSha: gs.branch?.sha,
			upstreamSha: gs.branchState?.upstreamSha,
			upstreamName: gs.branchState?.upstream,
			providerIcon: gs.branchState?.provider?.icon,
			targetSha: gs.rowMarkerMergeTarget?.sha,
			targetName: gs.rowMarkerMergeTarget?.name,
			ahead: primaryAhead,
			wip: {
				hasChanges: primaryDirty,
				...(primaryStats != null && primaryDirty
					? {
							workingTreeState: {
								added: primaryStats.added,
								changed: primaryStats.modified,
								deleted: primaryStats.deleted,
							},
						}
					: {}),
				...(primary?.pausedOpStatus != null ? { pausedOpStatus: primary.pausedOpStatus } : {}),
				...(primary?.hasConflicts === true ? { hasConflicts: true } : {}),
			},
			...(primaryAhead > 0 ? { hasUnpushed: true } : {}),
			...pickAgent(fallbackRepoPath),
			isPrimary: true,
			context: serializeWipContext(fallbackRepoPath, false, primary?.hasConflicts ?? false),
		});

		for (const { sha, meta, state, dirty } of secondaries) {
			const stats = state?.workDirStats;
			const unpushed = state?.hasUnpushed === true;
			items.push({
				id: sha,
				branch: branchNameFromRef(meta.branchRef) ?? meta.label,
				repoPath: meta.repoPath,
				hasWorkingChanges: dirty,
				hasUnpushed: unpushed,
				branchId: meta.branchRef,
				// The host's projection of this worktree's branch. Needed because a worktree branch only
				// lands in `state.overview` when the worktree is open or its last commit is recent — without
				// it, a dirty worktree on an older branch would hover with nothing to show.
				branchModel: meta.branch,
				// A secondary worktree gets NO row-marker legs (and so no `ahead`): its WIP row already sits ON
				// its branch tip, so a "jump to branch" is pointless (only the primary can be far from HEAD);
				// upstream/merge-target tips would also cost a git call per worktree on load. Its unpushed
				// commits ride the pill's `↑` indicator instead, which an `ahead` here would suppress (that
				// suppression exists for the primary, whose upstream leg names the remote). Clicking the pill
				// selects its WIP row; the counts themselves live in the hover.
				wip: {
					hasChanges: dirty,
					// Absent until the breakdown is fetched on hover — the pill renders from the dirty bit.
					// `workDirStatsStale === false` with no `workDirStats` means a forced fetch settled without
					// one (failed/cancelled), so flag it for the hover's terminal "Couldn't load changes"
					// instead of leaving it stuck on "Loading changes…".
					...(stats != null
						? {
								workingTreeState: {
									added: stats.added,
									changed: stats.modified,
									deleted: stats.deleted,
								},
							}
						: state?.workDirStatsStale === false
							? { statsUnavailable: true }
							: {}),
					// A local-only branch has no upstream, so `gl-tracking-status` renders nothing and the
					// hover would silently drop the fact that there's work to push. `ahead` is undefined for
					// these (there's nothing to count against) — it's a presence bit only.
					...(unpushed && state?.ahead == null ? { hasUnpublishedCommits: true } : {}),
					...(state?.pausedOpStatus != null ? { pausedOpStatus: state.pausedOpStatus } : {}),
					...(state?.hasConflicts === true ? { hasConflicts: true } : {}),
				},
				...pickAgent(meta.repoPath),
				isPrimary: false,
				context: serializeWipContext(meta.repoPath, true, state?.hasConflicts ?? false),
			});
		}

		return items;
	}
}
