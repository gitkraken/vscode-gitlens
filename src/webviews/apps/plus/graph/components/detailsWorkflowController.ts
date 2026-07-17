import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { AIReviewDetailResult } from '@gitlens/ai/models/results.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { areEqual } from '@gitlens/utils/array.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type {
	ComposeResult,
	ConflictSide,
	ProposedCommit,
	QueuedTakeSide,
	ResolvedFileSummary,
	ResolveResult,
	ReviewResult,
	ScopeSelection,
} from '../../../../plus/graph/graphService.js';
import { subscribeAll } from '../../../shared/events/subscriptions.js';
import type { GraphCrossPaneState } from '../graphCrossPaneState.js';
import { abortRunningOperations } from '../graphCrossPaneState.js';
import type { AnchorKey, AnchorSelection } from './anchorKey.js';
import { anchorKey } from './anchorKey.js';
import type { DetailsActions } from './detailsActions.js';
import type {
	GenerateMessageResult,
	RunningOperation,
	RunningOperationAnchor,
	RunningOperationBucket,
	RunningOperationExecState,
} from './detailsState.js';
import type { ScopeItem } from './gl-commits-scope-pane.js';

/** Modes are panel lenses on the current selection — compose/review only. Compare is no
 *  longer a mode; it has its own lifecycle via {@link DetailsWorkflowController.openCompare}
 *  / {@link DetailsWorkflowController.closeCompare} and lives in a sheet over the panel. */
export type DetailsMode = 'review' | 'compose' | 'resolve';

/** The shape of "who/what is currently selected" that every workflow transition needs. */
export interface DetailsSelection {
	sha: string | undefined;
	shas: string[] | undefined;
	repoPath: string | undefined;
	graphReachability?: GitCommitReachability;
	/**
	 * Optional eager commit shell + per-sha shell map (built from graph row data) so the tail
	 * re-fetch on `exitMode` can paint metadata synchronously instead of flashing blank while
	 * the IPC roundtrip settles.
	 */
	commitLite?: CommitDetails;
	commitLites?: Record<string, CommitDetails>;
}

/** Optional overrides for entering compare mode. When `leftRef` and `rightRef` are both
 *  provided, the controller skips selection-derived ref resolution and merge-target defaulting
 *  — used by external entry points (e.g. sidebar tree compare actions) that already know both
 *  sides of the comparison. */
export interface CompareModeOverrides {
	leftRef?: string;
	leftRefType?: 'branch' | 'tag' | 'commit';
	rightRef?: string;
	rightRefType?: 'branch' | 'tag' | 'commit';
	includeWorkingTree?: boolean;
}

/**
 * The minimal surface a host LitElement must expose so the controller can manage the
 * repo-change subscription for it. Keeps the controller from reaching into element
 * internals.
 */
export interface DetailsWorkflowHost extends ReactiveControllerHost {
	/** Current repo path bound to the host's `repoPath` @property — derived from the active
	 *  selection (with fallback to the graph's selected repo when no selection is held).
	 *  May lag behind `graphRepoPath()` while a selection from a prior repo is still held. */
	readonly repoPath?: string;
	/** The graph's currently-selected repository's path — the user-perceived "which repo
	 *  am I looking at" context. Updates immediately on repo-selector switches, before any
	 *  selection event lands. Used to detect graph repo switches that haven't yet propagated
	 *  to {@link repoPath}. */
	graphRepoPath(): string | undefined;
	/** Returns true when the active selection is the WIP/uncommitted sha. */
	isWipSelection(): boolean;
	/** Refreshes an open branch sheet's enrichment. The sheet owns its own enrichment state and
	 *  cache, so it isn't covered by `refreshWipBranchEnrichment`. No-op when no sheet is open. */
	refreshBranchSheet(): void;
	/** Snapshot of the host's current selection — used to seed `exitMode` when the
	 *  controller forces a mode exit on repo change. */
	currentSelection(): DetailsSelection;
	/** Cross-pane shared state — provided by `gl-graph-app`, consumed by the host element.
	 *  The controller writes the running-modes registry through this so other panes (graph
	 *  row component, etc.) can decorate rows accordingly. */
	readonly crossPaneState: GraphCrossPaneState;
	/** Lands a settled generate-message result: the host routes `message` to the live WIP commit
	 *  input when that worktree is still the selected WIP (no mode active), otherwise into the
	 *  worktree's persisted draft slot. Called by the controller from `onRunSettled` (and on
	 *  re-engage after a disconnected settle) — never while the panel is disconnected. */
	applyGeneratedCommitMessage(repoPath: string, message: string): void;
	/** Reads the live compose/resolve panel's ready-state Refine posture + unsubmitted draft text, so
	 *  the controller can persist them onto the engaged entry on mode-leave (see `hideMode`). Returns
	 *  `undefined` when no refine-capable panel is mounted (e.g. review mode, or no active mode). */
	readEngagedRefineState(): { refineMode: boolean; refineDraft: string } | undefined;
}

/**
 * Lit {@link ReactiveController} that owns the details workflow state machine.
 *
 * **Owned workflow state**
 * - mode transitions (`toggleMode`, `exitMode`)
 * - mode-entry context snapshots + mode-exit cleanup
 * - context locking and fetch suppression
 * - forward/back snapshot behavior (review + compose)
 * - AI run dispatch (`runReview`, `runCompose`)
 * - repo-change subscription (installed/torn down via `hostConnected`/`hostDisconnected`)
 *
 * **Delegates to {@link DetailsActions}** for data operations only — fetch helpers
 * (`fetchDetails`, `fetchCompareDetails`, `fetchAiExcludedFiles`, `refreshCompare`,
 * `fetchBranchCommits`, `initCompareDefaults`), mutation helpers (`refreshWip`), and
 * shared predicates (`isWip`, `isMultiCommit`, `buildScopeFromPicker`).
 *
 * A {@link getScopedCounter} generation guards the async subscribe RPC against rapid
 * repoPath toggles (A → B → A within the round-trip) so stale listeners can't leak.
 */
export class DetailsWorkflowController implements ReactiveController {
	// region Subscription lifecycle state
	private _subscribedRepoPath: string | undefined;
	private readonly _subscriptionGen = getScopedCounter();
	private _subscriptionUnsubscribe: (() => void) | undefined;
	/** `markBranchCompareStale` watch — keyed on the Compare side's effective path (the
	 *  checked-out worktree when distinct from the graph's repo), not `host.repoPath`. Separate
	 *  lifecycle from the fields above because this path can change independently of
	 *  `host.repoPath` (Compare ref change, IWT toggle). See {@link ensureCompareWatchSubscription}. */
	private _subscribedCompareWatchPath: string | undefined;
	private readonly _compareWatchSubscriptionGen = getScopedCounter();
	private _compareWatchSubscriptionUnsubscribe: (() => void) | undefined;
	/** Tracks the graph's user-perceived repo so we can detect repo-selector switches that
	 *  haven't yet propagated to `host.repoPath` (selection from the prior repo can mask the
	 *  change until the user clicks a row in the new repo). `undefined` until the first
	 *  observation, which is treated as a no-op transition (no spurious mode exit on mount). */
	private _lastSeenGraphRepoPath: string | undefined;
	/** Flipped to `true` in `hostDisconnected`. Async settled callbacks (`onRunSettled`) and
	 *  subscription event handlers check this before writing to host-owned signals / disposed
	 *  resources — the registry intentionally outlives the panel (runs survive disconnect), so
	 *  the controller may still receive resolutions after its actions have been disposed. */
	private _disconnected = false;
	// endregion

	// region Workflow state
	/**
	 * Snapshots of the most recent ready review/compose results, captured on `back()` so
	 * `forward()` can restore them via `mutate()` (no AI re-run). Cleared by the panels
	 * when the user types in the AI input or modifies file selection
	 * (`invalidateSnapshot()`) and when selection changes during an active mode.
	 */
	private _reviewBackSnapshot: ReviewResult | undefined;
	private _composeBackSnapshot: ComposeResult | undefined;
	/**
	 * Tracks the anchor the review/compose resource was last fetched for. When the user
	 * re-enters a mode for a DIFFERENT anchor, we reset the resource so the prior result
	 * doesn't render against the new selection.
	 */
	private _reviewFetchedForSelection: AnchorKey | undefined;
	private _composeFetchedForSelection: AnchorKey | undefined;
	private _resolveFetchedForSelection: AnchorKey | undefined;
	// endregion

	constructor(
		private readonly host: DetailsWorkflowHost,
		private readonly actions: DetailsActions,
	) {
		host.addController(this);
	}

	// region ReactiveController lifecycle

	hostConnected(): void {
		// Lit ReactiveControllers receive a fresh `hostConnected` on every reconnect (same
		// controller instance, new host lifecycle). Reset `_disconnected` so a re-mount restores
		// `onRunSettled`'s ability to write to actions/resources for any operations dispatched
		// after this point. (In practice the panel's `disconnectedCallback` disposes the actions,
		// so a fresh remount creates a new actions instance; but this guards the controller
		// against being reused without a refresh of its disposed-state flag.)
		this._disconnected = false;
		this.ensureSubscription(this.host.repoPath);
		this.ensureCompareWatchSubscription(this.compareWatchPath());
	}

	hostDisconnected(): void {
		// Registry survives panel disconnect (owned by gl-graph-app); only repo-selector
		// switch clears it. Resource cancellation is handled by the panel's own dispose.
		// Flag for `onRunSettled` and async subscription callbacks so they stop writing to
		// the disposed `actions` / its resources after we're gone (runs keep going via the
		// host-owned registry, so the settled callbacks WILL still fire). Cancelling in-flight AI
		// runs on teardown is owned by `gl-graph-app` (the registry owner), not the panel.
		this._disconnected = true;
		this.tearDownSubscription();
		this.tearDownCompareWatchSubscription();
	}

	hostUpdate(): void {
		// Trigger 1 — graph repo-selector switch. Fires before `host.repoPath` updates
		// because `host.repoPath` is derived from the selection, which lingers across the
		// switch until the user clicks a row in the new repo. Without this trigger, an
		// active compose/review mode or open compare sheet would persist visibly with
		// prior-repo data while the graph header shows the new repo.
		const graphRepo = this.host.graphRepoPath();
		if (graphRepo !== this._lastSeenGraphRepoPath) {
			const previous = this._lastSeenGraphRepoPath;
			this._lastSeenGraphRepoPath = graphRepo;
			// Skip the first observation (no prior graph repo to compare against — would
			// otherwise spuriously exit on mount).
			if (previous != null) {
				// Repo switcher tears down the whole universe — clear the registry first so
				// sessions from prior repo's worktrees can't resurface against the new repo.
				this.cancelAllRunningOperations();
				// Registry is empty now; clear any active mode that was pointing at the prior repo.
				// Review/compose hide (preserves state-machine shape); compare (in either sheet or
				// pinned form) fully closes. `skipRefetch:true` because the host's current selection
				// is still the OLD repo (Trigger 2 below + the new-repo row click handle the new
				// selection's data); refetching here would land old-repo data into the just-reset
				// new-repo signals when the in-flight RPC resolves.
				const activeMode = this.actions.state.activeMode.get();
				if (activeMode === 'review' || activeMode === 'compose' || activeMode === 'resolve') {
					this.hideMode(this.host.currentSelection(), { skipRefetch: true });
				}
				if (this.actions.state.compareSheetOpen.get() || this.actions.state.compareAsPanel.get()) {
					this.closeCompare();
				}
			}
		}

		// Trigger 2 — panel render-target switched (worktree-row jump or post-repo-switch
		// row click). Re-wires the repo-change subscription. An open compare sheet stays sticky
		// across render-target switches: the comparison is anchored to its own refs and the user
		// explicitly closes the sheet to leave it. Review/compose follow the selection — the
		// panel's `willUpdate → switchAnchorWithinMode` handles the activeMode transition for
		// them, and the registry preserves each anchor's run across the jump.
		if (this.host.repoPath !== this._subscribedRepoPath) {
			const compareOpen = this.actions.state.compareSheetOpen.get() || this.actions.state.compareAsPanel.get();
			const activeMode = this.actions.state.activeMode.get();
			// Reset repo-scoped state only when nothing else has already handled it. `switchAnchorWithinMode`
			// runs from `willUpdate` (before `hostUpdate`) and already calls `resetRepoScopedState` for the
			// active-mode case — running it again here would clobber `branchCommitsFetching` back to false
			// while the in-flight fetch is mid-air, leaving the picker in a "no items + not loading" state
			// that renders as the empty splash. Compare-open uses the same skip rationale as before: the
			// comparison is anchored to its own refs and shouldn't get its repo-scoped chips cleared.
			if (!compareOpen && activeMode == null) {
				// Invalidate every repo-scoped signal so the panel doesn't show the prior worktree's
				// WIP / branch commits / enrichment chips while the new repo's fetches are in flight.
				// `clearEnrichmentCaches` (called inside) handles cache + controller hygiene; this
				// extends it to the state signals that the picker / mode panels read directly.
				this.actions.resetRepoScopedState(this.host.repoPath);
			}
			this.ensureSubscription(this.host.repoPath);
		}

		// Trigger 2b — compare-side worktree-aware staleness watch. Its effective path can change
		// independently of `host.repoPath` (Compare ref change, IWT toggle), so it's re-evaluated
		// on every render; `ensureCompareWatchSubscription` no-ops when the path hasn't changed.
		this.ensureCompareWatchSubscription(this.compareWatchPath());

		// (Trigger 3 — compose `{cancelled:true}` sentinel — removed. The sentinel now arrives via
		// the operation's resolution and is handled by `onRunSettled`, which removes the entry +
		// re-projects the engaged anchor's resource to idle.)
	}

	// endregion

	// region Mode transitions

	toggleMode(mode: DetailsMode, selection: DetailsSelection): void {
		const { sha, shas, repoPath } = selection;
		const state = this.actions.state;
		const resources = this.actions.resources;

		// If already active, deactivate. This is "toggle-out maintains" — just hide the panel;
		// the registry entry + any in-flight run persist. Close-from-`'backed'` is the only path
		// that destroys (single-click, no confirm — Restart already moved the result to a forward
		// snapshot, so close discarding the backed entry is the user's natural follow-through).
		if (state.activeMode.get() === mode) {
			// If the engaged anchor's entry is `'backed'`, this is the destroy path
			// (Restart-then-close). Otherwise just hide.
			const engagedEntry = this.host.crossPaneState.runningOperations.get().get(
				anchorKey({
					sha: state.activeModeSha.get(),
					shas: state.activeModeShas.get(),
					repoPath: state.activeModeRepoPath.get(),
				}),
			)?.[mode];
			if (engagedEntry?.execState === 'backed') {
				this.destroyEngagedOperation(mode);
			} else {
				// User explicitly dismissed this mode on this anchor — forget so a return
				// doesn't auto-restore it. The registry entry (if any) is left intact.
				this.forgetMode(selection);
				this.hideMode(selection);
			}
			return;
		}

		const isWip = this.actions.isWip(sha);
		const isMultiCommit = this.actions.isMultiCommit(shas);

		// Activation guards — only apply when entering a mode. Compose and resolve are WIP-only
		// (resolve operates on the conflicted files of a paused merge/rebase, which live on the WIP).
		if ((mode === 'compose' || mode === 'resolve') && !isWip) return;

		// Switching to a different mode while one is already active. Both kinds may coexist
		// per anchor — the other kind's run keeps going and its chip overlay stays.
		if (state.activeMode.get() != null) {
			this.hideMode(selection);
		}

		// Initialize mode-specific state. Resolve has no commit/diff scope — it operates on the
		// paused op's conflicted-file set read directly from `state.wip` — so skip scope building.
		if (mode !== 'resolve') {
			const scope = this.buildDefaultScope(sha, isWip, isMultiCommit);
			if (scope) {
				state.scope.set(scope);
				resources.scopeFiles.cancel();
				if (repoPath) {
					void resources.scopeFiles.fetch(repoPath, scope);
				}
			}
		}
		const newKey = this.selectionKey(sha, shas, repoPath);
		if (mode === 'review') {
			// Cached result belongs to a different selection — reset so the panel returns to
			// idle file-curation for THIS selection (otherwise we render A's findings against B).
			// Also reset when the resource has any non-idle value but no fetched-for marker
			// (e.g. mutate'd via Forward, or hot-reload), to avoid rendering stale findings.
			const reviewHasValue = resources.review.value.get() != null;
			if (reviewHasValue && this._reviewFetchedForSelection !== newKey) {
				resources.review.reset();
				this.review.invalidateSnapshot();
				this.review.invalidateErrorRecovery();
				this._reviewFetchedForSelection = undefined;
			} else {
				resources.review.cancel();
			}
		} else if (mode === 'compose') {
			const composeHasValue = resources.compose.value.get() != null;
			if (composeHasValue && this._composeFetchedForSelection !== newKey) {
				resources.compose.reset();
				this.compose.invalidateContinuation();
				this.compose.invalidateSnapshot();
				this.compose.invalidateErrorRecovery();
				this._composeFetchedForSelection = undefined;
			} else {
				resources.compose.cancel();
			}
		} else {
			const resolveHasValue = resources.resolve.value.get() != null;
			if (resolveHasValue && this._resolveFetchedForSelection !== newKey) {
				resources.resolve.reset();
				this.resolve.invalidateErrorRecovery();
				this._resolveFetchedForSelection = undefined;
			} else {
				resources.resolve.cancel();
			}
		}
		state.aiExcludedFiles.set(undefined);
		void this.actions.fetchAiExcludedFiles(repoPath, sha, shas);

		state.activeMode.set(mode);
		state.wipStale.set(false);
		state.activeModeContext.set(isMultiCommit ? 'multicommit' : isWip ? 'wip' : 'commit');
		state.activeModeRepoPath.set(repoPath);
		state.activeModeSha.set(sha);
		state.activeModeShas.set(shas);

		// Compose and review each remember their own AI model — refresh `state.aiModel` so
		// the now-active panel's chip reflects its scope (not whichever scope was active
		// previously). Signals don't notify on change here, so this is the hook point.
		void this.actions.refreshScopedAiModel();

		// Remember this anchor's mode so a subsequent return restores it.
		this.rememberMode(selection, mode);

		// Fetch branch commits for the WIP scope picker when the current cache is missing or
		// belongs to a different repo. Repo mismatch happens when the user switches between
		// worktree-row anchors while in mode — `resetRepoScopedState` clears branchCommits AFTER
		// `toggleMode` already evaluated the gate, leaving a window where the picker would
		// render empty waiting for a fetch that never started. Checking the last-fetched
		// repoPath catches that case explicitly.
		if (isWip && !state.branchCommitsFetching.get()) {
			const lastFetchedRepoPath = this.actions.branchCommitsFetchedRepoPath();
			if (state.branchCommits.get() == null || lastFetchedRepoPath !== repoPath) {
				void this.actions.fetchBranchCommits(repoPath);
			}
		}

		// Project the engaged anchor's entry into the resource (or leave it idle for ENABLED /
		// `'generating'` / `'backed'` cases — the panel reads `execState` from the entry).
		this.projectEngagedAnchor(mode, { sha: sha, shas: shas, repoPath: repoPath });
	}

	/** Opens the compare sheet, seeded from the current selection (or explicit overrides from
	 *  external callers like sidebar tree compare actions). Compare is selection-decoupled
	 *  once opened — the user can navigate the graph freely and the sheet's refs are unaffected.
	 *  Re-calling `openCompare` while the sheet is already open replaces the comparison only when
	 *  explicit overrides are provided; otherwise it's a no-op. */
	openCompare(selection: DetailsSelection, compareOverrides?: CompareModeOverrides): void {
		const { sha, shas, repoPath } = selection;
		const state = this.actions.state;

		// Already-open (sheet OR pinned) + no explicit overrides = no-op (re-clicking the same
		// entry point shouldn't reset the user's in-flight comparison).
		const alreadyOpen = state.compareSheetOpen.get() || state.compareAsPanel.get();
		if (alreadyOpen && compareOverrides?.leftRef == null && compareOverrides?.rightRef == null) {
			return;
		}

		const isWip = this.actions.isWip(sha);
		const isMultiCommit = this.actions.isMultiCommit(shas);

		// Activation guard: need a seed for either side (WIP / commit / multi-commit pivot /
		// explicit override). The selection-derived seeds now populate the rightRef (Compare side);
		// the leftRef (Base) is filled later by either explicit overrides or `initCompareDefaults`
		// using the merge target.
		if (
			!isWip &&
			!state.commit.get() &&
			!state.commitTo.get() &&
			!compareOverrides?.leftRef &&
			!compareOverrides?.rightRef
		) {
			return;
		}

		// Determine right ref (Compare side) from context. Order matters: check the active selection
		// shape (isWip / isMultiCommit) BEFORE falling back to lingering single-commit state,
		// otherwise multi-commit pivot picks up a stale `commit` from a prior selection.
		const wip = state.wip.get();
		const commitTo = state.commitTo.get();
		const commitFrom = state.commitFrom.get();
		const commit = state.commit.get();
		let leftRef: string | undefined;
		let leftRefType: 'branch' | 'tag' | 'commit' | undefined;
		let rightRef: string | undefined;
		let rightRefType: 'branch' | 'tag' | 'commit' | undefined;
		// Branch whose merge target seeds the left ref (Base). WIP uses the current branch; a
		// single commit uses the branch it's reachable from (stashes use stashOnRef).
		let mergeTargetBranchName: string | undefined;
		if (isWip) {
			rightRef = wip?.branch?.name;
			rightRefType = 'branch';
			mergeTargetBranchName = wip?.branch?.name;
		} else if (isMultiCommit && commitTo && commitFrom) {
			// Pivot from a multi-commit compare panel: the two sides of the existing comparison
			// become the left (Base = older = `commitFrom`) and right (Compare = newer = `commitTo`)
			// of the new ref-to-ref comparison.
			leftRef = commitFrom.shortSha;
			leftRefType = 'commit';
			rightRef = commitTo.shortSha;
			rightRefType = 'commit';
		} else if (commit) {
			rightRef = commit.shortSha;
			rightRefType = 'commit';
			if (commit.stashOnRef) {
				mergeTargetBranchName = commit.stashOnRef;
			} else {
				const branchRefs = state.reachability
					.get()
					?.refs?.filter((r): r is Extract<typeof r, { refType: 'branch' }> => r.refType === 'branch');
				mergeTargetBranchName = (branchRefs?.find(r => r.current) ?? branchRefs?.[0])?.name;
			}
		}

		// Explicit overrides win — used when sidebar/external entry points already know both sides.
		if (compareOverrides?.leftRef != null) {
			leftRef = compareOverrides.leftRef;
			leftRefType = compareOverrides.leftRefType ?? 'branch';
		}
		if (compareOverrides?.rightRef != null) {
			rightRef = compareOverrides.rightRef;
			rightRefType = compareOverrides.rightRefType ?? 'commit';
		}

		state.branchCompareLeftRef.set(leftRef);
		state.branchCompareLeftRefType.set(leftRefType);
		state.branchCompareRightRef.set(rightRef);
		state.branchCompareRightRefType.set(rightRefType);
		state.branchCompareIncludeWorkingTree.set(compareOverrides?.includeWorkingTree ?? false);
		state.branchCompareRightRefWorktreePath.set(undefined);
		state.branchCompareMergeBase.set(undefined);
		state.branchCompareAheadCount.set(0);
		state.branchCompareBehindCount.set(0);
		state.branchCompareAllFilesCount.set(0);
		state.branchCompareAheadCommits.set([]);
		state.branchCompareBehindCommits.set([]);
		state.branchCompareAheadFiles.set([]);
		state.branchCompareBehindFiles.set([]);
		state.branchCompareAheadLoaded.set(false);
		state.branchCompareBehindLoaded.set(false);
		state.branchCompareAheadHasMore.set(false);
		state.branchCompareBehindHasMore.set(false);
		state.branchCompareAheadLimit.set(100);
		state.branchCompareBehindLimit.set(100);
		state.branchCompareAheadLoadingMore.set(false);
		state.branchCompareBehindLoadingMore.set(false);
		state.branchCompareAllFiles.set([]);
		state.branchCompareActiveTab.set('ahead');
		state.branchCompareSelectedCommitShaByTab.set(new Map());
		state.branchCompareActiveView.set('files');
		state.branchCompareEnrichmentRequested.set(false);
		state.branchCompareAutolinksByScope.set(new Map());
		state.branchCompareEnrichedAutolinksByScope.set(new Map());
		state.branchCompareContributorsByScope.set(new Map());
		state.branchCompareEnrichmentLoading.set(new Map());
		state.branchCompareContributorsLoading.set(new Map());
		state.branchCompareCommitFilesLoading.set(new Map());

		if (leftRef == null && rightRef != null) {
			// Compare side seeded but no base yet — let `initCompareDefaults` fill the left side
			// (Base) using the merge target. It also kicks the initial refresh.
			void this.actions.initCompareDefaults(repoPath, mergeTargetBranchName);
		} else if (leftRef != null && rightRef == null) {
			// Base seeded but no Compare side — typically from an external entry point that
			// overrides only `leftRef`. The current branch (from `branchName`) is the most
			// useful default for Compare. Guard against seeding it when the current branch is
			// IDENTICAL to leftRef — otherwise we'd produce a degenerate self-comparison (same
			// class of bug the merge-target chip fix addressed). When they collide, leave
			// rightRef unset so the user can pick one manually rather than silently rendering
			// "Up to date".
			const branchName = state.wip.get()?.branch?.name;
			if (branchName != null && branchName !== leftRef) {
				state.branchCompareRightRef.set(branchName);
				state.branchCompareRightRefType.set('branch');
			}
			void this.actions.refreshCompare(repoPath);
		} else {
			void this.actions.refreshCompare(repoPath);
		}

		// Always open as a sheet — the panel form is opt-in via `openCompareAsPanel`. Any prior
		// panel state is dismissed: a fresh open re-establishes the lighter preview shape, and
		// the user re-commits to the panel form if they want it. To get back to a sheet from a
		// panel, the user closes and re-opens.
		state.compareAsPanel.set(false);
		state.compareSheetOpen.set(true);
	}

	/** Promotes the compare sheet into a side-by-side or top/bottom panel — a nested split
	 *  inside the details panel. Compare leaves the sheet (which dismisses) and reappears
	 *  beside (or above) the underlying details content in a dedicated split. Refs/tab/scroll
	 *  persist via the shared signals. Optional `orientation` lets the caller specify
	 *  side-by-side ('horizontal') vs top/bottom ('vertical'); defaults to whatever is set. */
	openCompareAsPanel(orientation?: 'horizontal' | 'vertical'): void {
		const state = this.actions.state;
		if (!state.compareSheetOpen.get() && !state.compareAsPanel.get()) return;

		if (orientation != null) {
			state.compareSplitOrientation.set(orientation);
		}
		state.compareSheetOpen.set(false);
		state.compareAsPanel.set(true);
	}

	/** Closes compare entirely, regardless of which form it's currently in. Compare has no
	 *  run state to preserve; this fully resets the branchCompare* signals back to idle. */
	closeCompare(): void {
		const state = this.actions.state;
		if (!state.compareSheetOpen.get() && !state.compareAsPanel.get()) return;

		state.compareSheetOpen.set(false);
		state.compareAsPanel.set(false);
		state.branchCompareLeftRef.set(undefined);
		state.branchCompareLeftRefType.set(undefined);
		state.branchCompareRightRef.set(undefined);
		state.branchCompareRightRefType.set(undefined);
		state.branchCompareIncludeWorkingTree.set(false);
		state.branchCompareRightRefWorktreePath.set(undefined);
		state.branchCompareMergeBase.set(undefined);
		state.branchCompareStale.set(false);
		state.branchCompareAheadCount.set(0);
		state.branchCompareBehindCount.set(0);
		state.branchCompareAllFilesCount.set(0);
		state.branchCompareAheadCommits.set([]);
		state.branchCompareBehindCommits.set([]);
		state.branchCompareAheadFiles.set([]);
		state.branchCompareBehindFiles.set([]);
		state.branchCompareAheadLoaded.set(false);
		state.branchCompareBehindLoaded.set(false);
		state.branchCompareAheadHasMore.set(false);
		state.branchCompareBehindHasMore.set(false);
		state.branchCompareAheadLimit.set(100);
		state.branchCompareBehindLimit.set(100);
		state.branchCompareAheadLoadingMore.set(false);
		state.branchCompareBehindLoadingMore.set(false);
		state.branchCompareAllFiles.set([]);
		state.branchCompareActiveTab.set('ahead');
		state.branchCompareSelectedCommitShaByTab.set(new Map());
		state.branchCompareActiveView.set('files');
		state.branchCompareEnrichmentRequested.set(false);
		state.branchCompareAutolinksByScope.set(new Map());
		state.branchCompareEnrichedAutolinksByScope.set(new Map());
		state.branchCompareContributorsByScope.set(new Map());
		state.branchCompareEnrichmentLoading.set(new Map());
		state.branchCompareContributorsLoading.set(new Map());
		state.branchCompareCommitFilesLoading.set(new Map());
	}

	/** Reserved for any path that needs to fully tear down review/compose without going through
	 *  the toggle gate. Today this is unreachable from external callers — review/compose toggle-out
	 *  goes through {@link hideMode} (run preserved); destroy goes through
	 *  {@link destroyEngagedOperation} (Back-then-close gate). Kept here so the cleanup contract is
	 *  explicit if a future flow needs it. */
	exitMode(selection: DetailsSelection): void {
		const wasMode = this.actions.state.activeMode.get();
		const wasSha = this.actions.state.activeModeSha.get();
		const wasShas = this.actions.state.activeModeShas.get();

		this.actions.state.activeMode.set(null);
		this.actions.state.activeModeContext.set(null);
		this.actions.state.activeModeRepoPath.set(undefined);
		this.actions.state.activeModeSha.set(undefined);
		this.actions.state.activeModeShas.set(undefined);
		this.actions.state.scope.set(undefined);
		this.actions.state.aiExcludedFiles.set(undefined);

		// Mode left — chip falls back to the global default until a new mode is entered.
		void this.actions.refreshScopedAiModel();

		const selectionChanged = wasSha !== selection.sha || !areEqual(wasShas, selection.shas);
		if (selectionChanged) {
			if (wasMode === 'review') {
				this.actions.resources.review.reset();
				this.review.invalidateSnapshot();
				this.review.invalidateErrorRecovery();
				this._reviewFetchedForSelection = undefined;
			} else if (wasMode === 'compose') {
				this.actions.resources.compose.reset();
				this.compose.invalidateSnapshot();
				this.compose.invalidateErrorRecovery();
				this.compose.invalidateContinuation();
				this._composeFetchedForSelection = undefined;
			} else if (wasMode === 'resolve') {
				this.actions.resources.resolve.reset();
				this.resolve.invalidateErrorRecovery();
				this._resolveFetchedForSelection = undefined;
				this.actions.state.resolveFocusedFilePaths.set(undefined);
			}
		}

		this.refetchForSelection(selection);
	}

	/** Hide the engaged panel without disturbing any in-flight or completed running operation.
	 *  Registry entries + their AbortControllers are left intact, so the run keeps going and the
	 *  chip overlay + WIP-row adornment stay live. Used by toggle-out, X-close (non-destructive),
	 *  and the anchor-switch state-clear half of {@link switchAnchorWithinMode}. */
	private hideMode(selection: DetailsSelection, options?: { skipRefetch?: boolean }): void {
		// Read the active mode BEFORE clearing it so we can scope the error-recovery invalidation
		// to just the mode the user was in. The two kinds can have coexisting state when both
		// are running for the same anchor (the registry supports this); clearing both kinds'
		// recovery on a hide that only ends one of them would silently erase the other's state.
		const exitingMode = this.actions.state.activeMode.get();

		// Capture the compose/resolve panel's Refine posture + unsubmitted draft onto the outgoing
		// anchor's entry BEFORE the signals + panel are torn down, so toggling the chip off/on or
		// switching rows restores them. `currentAnchor()` + the panel DOM still reflect the outgoing
		// anchor here. `hideMode` is the single choke point for every preserve-leave (toggle-out,
		// mode-switch, row-switch), so one capture here covers all of them. Fresh-result / discard /
		// destroy / repo-switch paths remove the entry, so the `entry != null` guard no-ops there.
		if (exitingMode === 'compose' || exitingMode === 'resolve') {
			this.captureEngagedRefineState(exitingMode);
		}

		this.actions.state.activeMode.set(null);
		this.actions.state.activeModeContext.set(null);
		this.actions.state.activeModeRepoPath.set(undefined);
		this.actions.state.activeModeSha.set(undefined);
		this.actions.state.activeModeShas.set(undefined);
		this.actions.state.scope.set(undefined);
		this.actions.state.aiExcludedFiles.set(undefined);
		// Bump the fetch-generation so any still-in-flight `fetchAiExcludedFiles` (from the
		// `toggleMode` tail) can't write a stale result back into the just-cleared signal after
		// the user has left the mode. The generation guard inside the fetch only triggers when a
		// NEW fetch starts; without this explicit bump, a toggle-off-and-stay-off path leaves
		// the in-flight resolution able to repopulate the signal.
		this.actions.invalidateAiExcludedFilesFetch();
		// Error-recovery state is engagement-scoped — it belongs to the mode the user was in
		// when the error occurred. Without this clear, anchor B's mode-X error retry/Go-Back
		// could reach for anchor A's prior session prompt/value/last-action (backFromError reads
		// `*PreErrorValue` and `mutate`s it in). Scope to `exitingMode` so a hide that ends only
		// one of two coexisting kinds doesn't erase the other's recovery state.
		if (exitingMode === 'review') {
			this.review.invalidateErrorRecovery();
		} else if (exitingMode === 'compose') {
			this.compose.invalidateErrorRecovery();
			this.compose.invalidateContinuation();
		} else if (exitingMode === 'resolve') {
			// The focused-file scope is an input of the engagement that set it (per-file/multi-select
			// entry points) — clear it on exit so a later chip-initiated session defaults back to all
			// conflicted files instead of silently re-scoping to the previous session's file(s).
			this.actions.state.resolveFocusedFilePaths.set(undefined);
		}
		// On repo-switch, the caller (Trigger 1 in hostUpdate) will follow up with the new
		// repo's selection arriving. Refetching here uses `host.currentSelection()` which is
		// still the OLD repo's selection until the user clicks a row in the new repo — the
		// in-flight fetch would set `_lastFetchedKey` and write old-repo data into the (now
		// reset by Trigger 2) repo-scoped signals on resolution. Skip the refetch on that path.
		if (!options?.skipRefetch) {
			this.refetchForSelection(selection);
		}
	}

	/** Persist the outgoing compose/resolve panel's live Refine posture + unsubmitted draft onto its
	 *  registry entry, so a later return to this anchor restores them. Reads the live panel through the
	 *  host; no-ops when there's no entry (fresh result / discarded / destroyed / repo-switched away).
	 *  Routed through {@link registerRunningOperation} — whose dedup guard compares the refine fields —
	 *  so an unchanged snapshot (e.g. leaving with the gate closed) doesn't churn the registry. */
	private captureEngagedRefineState(kind: 'compose' | 'resolve'): void {
		const snapshot = this.host.readEngagedRefineState();
		if (snapshot == null) return;

		const entry = this.host.crossPaneState.runningOperations.get().get(anchorKey(this.currentAnchor()))?.[kind];
		if (entry == null) return;

		this.registerRunningOperation({
			...entry,
			refineMode: snapshot.refineMode || undefined,
			refineDraft: snapshot.refineDraft.trim() ? snapshot.refineDraft : undefined,
		});
	}

	/** The workflow object for a mode — exposes the common `invalidateSnapshot`/`invalidateErrorRecovery`
	 *  surface so generic hide/destroy/anchor-switch paths can call it without a per-site ternary. */
	private workflowFor(kind: DetailsMode): { invalidateSnapshot: () => void; invalidateErrorRecovery: () => void } {
		return kind === 'review' ? this.review : kind === 'compose' ? this.compose : this.resolve;
	}

	/** The resource for a mode — narrowed to the common `reset`/`cancel` surface (kind-specific
	 *  `mutate`/`value` are accessed via explicit per-kind branches where their types matter). */
	private resourceFor(kind: DetailsMode): { reset: () => void; cancel: () => void } {
		return kind === 'review'
			? this.actions.resources.review
			: kind === 'compose'
				? this.actions.resources.compose
				: this.actions.resources.resolve;
	}

	/** Destroy the engaged anchor's `(kind)` operation — aborts the controller, removes the
	 *  registry entry, clears the back-snapshot, resets the resource, untoggles the mode. This
	 *  is the back-then-close gate's destroy step; reachable from the X close and from the
	 *  active-toggle click when the engaged entry's `execState === 'backed'`. */
	private destroyEngagedOperation(kind: DetailsMode): void {
		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);
		const entry = this.host.crossPaneState.runningOperations.get().get(key)?.[kind];
		entry?.abortController?.abort();
		this.removeRunningOperation(key, kind);
		this.workflowFor(kind).invalidateSnapshot();
		this.resourceFor(kind).reset();
		// Forget on the engaged anchor (what's being destroyed), not the host's current selection —
		// they can diverge (e.g. destroy via the active-toggle chip while the host's selection
		// already moved to a different row).
		this.forgetMode(anchor);
		this.hideMode(this.host.currentSelection());
	}

	/** Shared tail for `exitMode`/`hideMode`: re-fetch the current selection's data so the
	 *  panel returns to plain WIP/commit view content. `fetchDetails`/`fetchCompareDetails`
	 *  early-return on a cache hit, so this is a no-op when the selection didn't change.
	 *  Forwards eager commit shells so metadata paints synchronously. */
	private refetchForSelection(selection: DetailsSelection): void {
		const { sha, shas, repoPath, graphReachability, commitLite, commitLites } = selection;
		if (this.actions.isMultiCommit(shas)) {
			void this.actions.fetchCompareDetails(shas, repoPath, commitLites);
		} else {
			void this.actions.fetchDetails(sha, repoPath, graphReachability, { commitLite: commitLite });
		}
	}

	/** Called when the panel's selection changes while a compose/review mode is active. The
	 *  prior anchor's running operation (if any) is left intact in the registry — its in-flight
	 *  run keeps going; switching back later re-attaches. The new anchor's `toggleMode` tail
	 *  projects its own entry (loading if generating, result if complete, idle if none).
	 *
	 *  Compose only works on WIP anchors — switching to a non-WIP anchor while in compose mode
	 *  hides compose (the WIP's compose run keeps going in the background). */
	switchAnchorWithinMode(newSelection: DetailsSelection): void {
		const state = this.actions.state;
		const mode = state.activeMode.get();
		if (mode == null) return;

		// Same anchor? Nothing to do (selection-change can fire even when the user clicks the
		// already-selected row).
		const prevRepoPath = state.activeModeRepoPath.get();
		const prevKey = anchorKey({
			sha: state.activeModeSha.get(),
			shas: state.activeModeShas.get(),
			repoPath: prevRepoPath,
		});
		const nextKey = anchorKey(newSelection);
		if (prevKey === nextKey) return;

		// Back-snapshots are engagement-scoped: they belong to whatever anchor the user backed
		// from. Carrying them across an anchor switch would let `forward()` on the new anchor
		// restore the prior anchor's result via `resource.mutate(snapshot)`. The compose snapshot
		// has the same risk (commits from anchor A surfacing on anchor B). Invalidating both
		// here also clears `*ForwardAvailable` and `*BackPreview` so the new anchor's header
		// doesn't render a stale Resume affordance. The new anchor's own back-snapshot, if any,
		// gets rebuilt when the user clicks Back on it.
		this.review.invalidateSnapshot();
		this.compose.invalidateSnapshot();
		// Resolve has no Resume snapshot (apply is terminal) — this is a deliberate no-op kept for
		// uniformity so every mode's snapshot is invalidated on an anchor switch.
		this.resolve.invalidateSnapshot();

		// On row switch the mode does NOT follow — just hide. The prior anchor's `toggleMode`
		// already called `rememberMode`, so returning to a remembered WIP anchor restores below.
		this.hideMode(newSelection);

		// Then, if the new anchor is a WIP with a remembered mode, restore it atomically in
		// the same willUpdate cycle. The panel's `else-if` restore branch can't catch this on
		// its own: that branch evaluates `activeMode == null` at the TOP of willUpdate, which
		// was non-null when we entered, so it's already been skipped. Without this restore here
		// the user would land on the new WIP with no mode even when they had previously toggled
		// one on, making the per-WIP memory feel "hit or miss" depending on whether they came
		// from a mode-active anchor or a no-mode anchor. Commits don't get auto-restore (memory
		// is intentionally gated to WIPs — re-clicking a commit shouldn't ambient-enter review).
		if (this.actions.isWip(newSelection.sha)) {
			const remembered = this.getRememberedMode(newSelection);
			if (remembered != null) {
				this.toggleMode(remembered, newSelection);
			}
		}
	}

	// endregion

	// region Review workflow

	/** Review workflow snapshot controls. Arrow-function object so `this` bindings are stable. */
	readonly review = {
		back: (): void => {
			// Snapshot a successfully-resolved value so forward() can restore it without re-running
			// the AI. Also transition the engaged anchor's registry entry to `'backed'` — that's
			// the state that makes Close destructive (the Back-then-close gate). The chip overlay
			// stays as `pass` (a result still exists, just not currently displayed).
			// The transition + resource reset MUST be gated on a successful snapshot capture:
			// otherwise we land on a backed entry with `forwardAvailable === false`, the panel
			// shows idle, the chip shows pass, and the only escape is destructive Close. The
			// outer status check guards against a non-success state; the inner `value != null`
			// guards against the (rare) success-without-value race where the resource was reset
			// between the status read and the value read.
			if (this.actions.resources.review.status.get() !== 'success') return;

			const value = this.actions.resources.review.value.get();
			if (value == null) return;

			this.enterReviewBacked(value);
			this.transitionEngagedEntryExecState('review', 'backed');
		},
		forward: (): boolean => {
			const snapshot = this._reviewBackSnapshot;
			if (snapshot == null) return false;

			this.actions.resources.review.mutate(snapshot);
			this.transitionEngagedEntryExecState('review', 'complete');
			// Clear the back-preview so the header reverts to plain counts — the result is now
			// visible in the panel, so the Resume affordance no longer applies. A subsequent
			// `back()` will re-snapshot from the now-active value, so the cycle still works.
			this.actions.state.reviewBackPreview.set(undefined);
			this.actions.state.reviewForwardAvailable.set(false);
			return true;
		},
		invalidateSnapshot: (): void => {
			this._reviewBackSnapshot = undefined;
			this.actions.state.reviewForwardAvailable.set(false);
			this.actions.state.reviewBackPreview.set(undefined);
		},
		// "Go Back" from the error pane. Lands on the idle scope picker — same destination as
		// Restart on a successful run — with the last-submitted prompt seeded for retyping. When
		// a prior successful result existed (e.g. a refine failed from a ready plan), it's loaded
		// into the back-snapshot so the Resume bar offers a one-click restore (no AI re-run).
		// When the first attempt errored, no Resume — clean idle.
		// The prompt is left intact so the panel's gl-ai-input pre-fills on re-render.
		// Registry entry is updated alongside the resource — the panel mapping reads entry
		// first, so a stale 'error' entry would mask the restored state. Sequencing: entry
		// first, then resource, so the panel's next render sees the consistent target state.
		backFromError: (): void => {
			const prev = this.actions.state.reviewPreErrorValue.get();
			const anchor = this.currentAnchor();
			const key = anchorKey(anchor);
			const entry = this.host.crossPaneState.runningOperations.get().get(key)?.review;
			if (prev != null && 'result' in prev) {
				// Repoint the entry at the prior successful result in `'backed'` so a later
				// re-engage projects the right thing, and forward() can transition this back
				// to `'complete'` without losing the payload.
				if (entry != null) {
					this.registerRunningOperation({ ...entry, execState: 'backed', result: prev });
				}
				this.enterReviewBacked(prev);
			} else {
				// No prior plan to surface via Resume. Keep the entry in `'backed'` with no
				// result so the run's `prompt` survives and re-seeds the AI input on the idle
				// re-render — same shape as the Cancel button + `{cancelled:true}` sentinel paths.
				this.enterBackedNoResult('review');
			}
			// Pre-error value consumed. The prompt rides on the engaged entry's `prompt` field
			// and survives through both branches via the spread / no-result re-register.
			this.actions.state.reviewPreErrorValue.set(undefined);
		},
		retryFromError: (
			repoPath: string | undefined,
			excludedFiles: string[] | undefined,
			effectiveFilesCount: number,
			selectedIds?: ReadonlySet<string>,
			scopeItems?: ScopeItem[],
		): void => {
			// Re-submit with the engaged run's prompt — the entry carries it from the original
			// `dispatchOperation`, so retry-after-error doesn't depend on a global signal.
			const entry = this.host.crossPaneState.runningOperations.get().get(anchorKey(this.currentAnchor()))?.review;
			this.runReview(repoPath, entry?.prompt, excludedFiles, effectiveFilesCount, selectedIds, scopeItems);
		},
		invalidateErrorRecovery: (): void => {
			this.actions.state.reviewPreErrorValue.set(undefined);
		},
		// Two-pass detail enrichment lands here. The render projection at the panel reads
		// `entry.result ?? resource.value` — entry first — so mutating only the resource leaves
		// a stale entry result that masks the new findings on the next render. Update both, entry
		// first (same sequencing as `backFromError`), so the panel sees the enriched result.
		enrichFocusAreaFindings: (focusAreaId: string, detail: AIReviewDetailResult): void => {
			const anchor = this.currentAnchor();
			const key = anchorKey(anchor);
			const entry = this.host.crossPaneState.runningOperations.get().get(key)?.review;
			const current = entry?.result ?? this.actions.resources.review.value.get();
			if (current == null || !('result' in current)) return;

			const enriched: ReviewResult = {
				result: {
					...current.result,
					focusAreas: current.result.focusAreas.map(area =>
						area.id === focusAreaId ? { ...area, findings: detail.findings } : area,
					),
				},
			};

			if (entry != null) {
				this.registerRunningOperation({ ...entry, result: enriched });
			}
			this.actions.resources.review.mutate(enriched);
		},
		// Destructive discard from the ready state — throw away the findings and exit to the plain
		// view. Review produces read-only findings with no host session (unlike resolve), so
		// `destroyEngagedOperation` is the complete teardown: abort + remove entry + reset + hide.
		discard: (): void => {
			this.actions.sendTelemetryEvent('graphDetails/review/discarded');
			this.destroyEngagedOperation('review');
		},
	};

	runReview(
		repoPath: string | undefined,
		instructions: string | undefined,
		excludedFiles: string[] | undefined,
		effectiveFilesCount: number,
		selectedIds?: ReadonlySet<string>,
		scopeItems?: ScopeItem[],
		options?: { mode?: 'refine' },
	): void {
		const scope = this.actions.buildScopeFromPicker(selectedIds, scopeItems) ?? this.actions.state.scope.get();
		if (!repoPath || !scope) return;

		this.actions.state.scope.set(scope);
		this.actions.state.wipStale.set(false);
		this.review.invalidateSnapshot();
		// Snapshot the pre-error state so Back/Retry can recover. Only stash the value when it
		// holds a result — an error/cancelled sentinel isn't useful to restore.
		const currentValue = this.actions.resources.review.value.get();
		this.actions.state.reviewPreErrorValue.set(
			currentValue != null && 'result' in currentValue ? currentValue : undefined,
		);
		// Follow-up only when explicitly requested by the ready-state input AND there's a result
		// to follow up on AND guidance to follow up with — an empty submit or a restart from idle
		// is a fresh run, never a continuation
		const refine =
			options?.mode === 'refine' && instructions != null && currentValue != null && 'result' in currentValue;
		this._reviewFetchedForSelection = this.selectionKey();
		this.dispatchOperation(
			'review',
			instructions,
			controller =>
				this.actions.startReview(
					repoPath,
					scope,
					instructions,
					excludedFiles,
					controller.signal,
					refine ? { mode: 'refine' } : undefined,
				),
			{
				excludedFilesCount: excludedFiles?.length ?? 0,
				effectiveFilesCount: effectiveFilesCount,
				refine: refine,
			},
		);
	}

	// endregion

	// region Compose workflow

	readonly compose = {
		// Discard a ready plan and exit compose mode — full teardown back to plain WIP details.
		// Working-tree changes are untouched; only the in-memory plan + mode state are dropped.
		discard: (): void => {
			this.destroyEngagedOperation('compose');
		},
		back: (): void => {
			// See `review.back` for rationale on the conditional transition. The original code
			// transitioned the entry to `'backed'` unconditionally even when no snapshot was
			// captured, leaving the user stuck with no forward path and a destructive close.
			if (this.actions.resources.compose.status.get() !== 'success') return;

			const value = this.actions.resources.compose.value.get();
			if (value == null || !('result' in value)) return;

			this.enterComposeBacked(value);
			this.transitionEngagedEntryExecState('compose', 'backed');
		},
		forward: (): boolean => {
			const snapshot = this._composeBackSnapshot;
			if (snapshot == null) return false;

			this.actions.resources.compose.mutate(snapshot);
			this.transitionEngagedEntryExecState('compose', 'complete');
			// Clear the back-preview so the header reverts to plain counts — the result is now
			// visible in the panel, so the Resume affordance no longer applies. A subsequent
			// `back()` will re-snapshot from the now-active value, so the cycle still works.
			this.actions.state.composeBackPreview.set(undefined);
			this.actions.state.composeForwardAvailable.set(false);
			return true;
		},
		invalidateSnapshot: (): void => {
			this._composeBackSnapshot = undefined;
			this.actions.state.composeForwardAvailable.set(false);
			this.actions.state.composeBackPreview.set(undefined);
		},
		// "Go Back" from the error pane. Lands on the idle scope picker — same destination as
		// Restart on a successful run — with the last-submitted prompt seeded. When the failed
		// action was Commit All or a refine from a ready plan, `composePreErrorValue` holds the
		// prior plan; we load it into the back-snapshot so the Resume bar offers a one-click
		// restore (no AI re-run). When the first attempt errored, clean idle, no Resume.
		// Registry entry is updated alongside the resource — the panel mapping reads entry
		// first, so a stale 'error' entry would mask the restored state. Sequencing: entry
		// first, then resource, so the panel's next render sees the consistent target state.
		backFromError: (): void => {
			const prev = this.actions.state.composePreErrorValue.get();
			const anchor = this.currentAnchor();
			const key = anchorKey(anchor);
			const entry = this.host.crossPaneState.runningOperations.get().get(key)?.compose;
			if (prev != null && 'result' in prev) {
				// Repoint the entry at the prior successful result in `'backed'` so a later
				// re-engage projects the right thing, and forward() can transition this back
				// to `'complete'` without losing the payload.
				if (entry != null) {
					this.registerRunningOperation({ ...entry, execState: 'backed', result: prev });
				}
				this.enterComposeBacked(prev);
			} else {
				// No prior plan to surface via Resume. Keep the entry in `'backed'` with no
				// result so the run's `prompt` survives and re-seeds the AI input on the idle
				// re-render — same shape as the Cancel button + `{cancelled:true}` sentinel paths.
				this.enterBackedNoResult('compose');
			}
			// Pre-error value + action tracking consumed. Clearing `composeLastFailedAction` /
			// `composeLastCommitAllIncludedIds` prevents a stale `'commit-all'` from steering a
			// later `retryFromError` into the commit-all branch against a plan that's no longer
			// in the resource. The prompt rides on the engaged entry's `prompt` field and
			// survives through both branches via the spread / no-result re-register.
			this.actions.state.composePreErrorValue.set(undefined);
			this.actions.state.composeLastFailedAction.set(undefined);
			this.actions.state.composeLastCommitAllIncludedIds.set(undefined);
		},
		retryFromError: (
			repoPath: string | undefined,
			sha: string | undefined,
			graphReachability: GitCommitReachability | undefined,
			excludedFiles: string[] | undefined,
			aiExcludedFiles: string[] | undefined,
			effectiveFilesCount: number,
			selectedIds?: ReadonlySet<string>,
			scopeItems?: ScopeItem[],
		): void => {
			const action = this.actions.state.composeLastFailedAction.get();
			const anchor = this.currentAnchor();
			const key = anchorKey(anchor);
			const entry = this.host.crossPaneState.runningOperations.get().get(key)?.compose;
			if (action === 'commit-all') {
				// composeCommitAll's early return requires a value holding `result` — restore the
				// plan via mutate before re-attempting, otherwise the action no-ops. Also restore
				// the engaged entry so the panel mapping sees a coherent 'complete' state during
				// the retry's apply window (composeApplying takes precedence visually anyway, but
				// this keeps the registry truthful).
				const prev = this.actions.state.composePreErrorValue.get();
				if (prev != null) {
					if (entry != null) {
						this.registerRunningOperation({ ...entry, execState: 'complete', result: prev });
					}
					this.actions.resources.compose.mutate(prev);
				}
				const includedIds = this.actions.state.composeLastCommitAllIncludedIds.get();
				void this.compose.applyPlan(sha, graphReachability, includedIds);
			} else {
				// Re-submit with the engaged run's prompt — the entry carries it from the original
				// `dispatchOperation`, so retry-after-error doesn't depend on a global signal.
				this.runCompose(
					repoPath,
					entry?.prompt,
					excludedFiles,
					aiExcludedFiles,
					effectiveFilesCount,
					selectedIds,
					scopeItems,
				);
			}
		},
		invalidateErrorRecovery: (): void => {
			this.actions.state.composePreErrorValue.set(undefined);
			this.actions.state.composeLastFailedAction.set(undefined);
			this.actions.state.composeLastCommitAllIncludedIds.set(undefined);
		},
		/** Drop the cross-call continuation state — the cacheKey that drives refine and the
		 *  locked-commits set. Called on mode exit / destroy / anchor switch so a returning
		 *  user enters cold compose instead of resuming a stale session. The host's cache is
		 *  keyed per-repo and cleaned up on its own cold-start path; a stale key here is
		 *  benign (the host treats it as a missing entry and runs cold) but clearing keeps the
		 *  webview state truthful. */
		invalidateContinuation: (): void => {
			this.actions.state.composeCurrentCacheKey.set(undefined);
			this.actions.state.composeRefineExcludedCommitIds.set(new Set());
			// Drop any in-flight per-commit message regen handle too. The RPC's own
			// `finally` clears it, but an anchor switch can leave the signal pointing at
			// a commit that no longer belongs to the panel's current plan.
			this.actions.state.composeRegeneratingCommitId.set(undefined);
		},
		// Wraps `composeCommitAll` so the registry entry stays in sync with the resource on
		// apply failure. Without this, the action mutates only the resource (legacy of the
		// pre-registry architecture) and the entry retains its prior 'complete' result —
		// shadowing the resource error in the panel mapping and hiding the error from the user.
		applyPlan: async (
			sha: string | undefined,
			graphReachability: GitCommitReachability | undefined,
			includedCommitIds: readonly string[] | undefined,
		): Promise<void> => {
			const repoPath = this.actions.state.activeModeRepoPath.get();
			// Capture the engaged anchor BEFORE the await — the action's success branch clears
			// the `activeMode*` signals (so `currentAnchor()` after the await reflects the host's
			// current selection, not the compose engagement). The registry entry to remove is
			// keyed by the engaged anchor, not the current selection.
			const engagedAnchor = this.currentAnchor();
			// Capture the plan size for telemetry before composeCommitAll clears the resource.
			const planValue = this.actions.resources.compose.value.get();
			const planCommitsCount = planValue != null && 'result' in planValue ? planValue.result.commits.length : 0;
			const includedCount = includedCommitIds?.length ?? planCommitsCount;
			const excludedCount = Math.max(0, planCommitsCount - includedCount);
			// Capture stale BEFORE the await — `composeCommitAll` resets `wipStale` on success.
			const stale = this.actions.state.wipStale.get();
			const startedAt = performance.now();
			await this.actions.composeCommitAll(repoPath, sha, graphReachability, includedCommitIds);
			const duration = performance.now() - startedAt;
			// The host may have disconnected (panel close, repo switch torn down everything) while
			// `composeCommitAll`'s RPC was in flight. Writing to the host-owned registry or the
			// disposed resource after that is the same UB `onRunSettled` guards against.
			if (this._disconnected) return;

			const resourceValue = this.actions.resources.compose.value.get();
			if (resourceValue != null && 'error' in resourceValue) {
				this.actions.sendTelemetryEvent('graphDetails/compose/applyPlan/failed', {
					'plan.commits.count': planCommitsCount,
					'commits.count': includedCount,
					'commits.excluded.count': excludedCount,
					stale: stale,
					duration: duration,
				});
				// Failure path — sync the registry entry to the error state so the panel mapping
				// surfaces it (resource error otherwise gets shadowed by the entry's prior result).
				const entry = this.host.crossPaneState.runningOperations.get().get(anchorKey(engagedAnchor))?.compose;
				if (entry == null) return;

				this.registerRunningOperation({ ...entry, execState: 'error', result: resourceValue });
				return;
			}

			this.actions.sendTelemetryEvent('graphDetails/compose/applyPlan/completed', {
				'plan.commits.count': planCommitsCount,
				'commits.count': includedCount,
				'commits.excluded.count': excludedCount,
				stale: stale,
				duration: duration,
			});

			// The action cleared the resource + engagement signals but cannot reach the
			// cross-pane registry. Remove the stale `'complete'` entry so the WIP-row adornment
			// and chip overlay drop the pass icon (otherwise the row keeps signaling a compose
			// result for a plan that has already been committed). Also forget the mode so a
			// return-visit doesn't auto-restore compose on this anchor.
			this.removeRunningOperation(anchorKey(engagedAnchor), 'compose');
			this.forgetMode(engagedAnchor);
		},
		/**
		 * Per-commit message regeneration. Calls the host's `regenerateProposedCommitMessage`
		 * RPC against the cached plan's current cache key, then patches just the targeted
		 * commit's `message` into both the resource and the engaged registry entry so the
		 * panel mapping (entry's `result` shadows the resource) reflects the new message
		 * immediately.
		 *
		 * The host also mutates its own cached plan; that keeps refine continuation honest —
		 * a later refine sees the regenerated message in `priorPlan` and (if the commit is
		 * locked) the library's locked-commit substitution preserves it verbatim.
		 *
		 * Concurrency: one in-flight regen at a time via `composeRegeneratingCommitId`. A
		 * second click while busy is dropped; the panel also disables the icon during refine /
		 * applying / loading states.
		 */
		regenerateCommitMessage: async (commitId: string): Promise<void> => {
			if (!commitId) return;

			// Drop the click if another regen is already in flight — the panel's render is the
			// primary gate (disabled icon), but a second message can race the disabled state.
			if (this.actions.state.composeRegeneratingCommitId.get() != null) return;

			const repoPath = this.actions.state.activeModeRepoPath.get();
			const cacheKey = this.actions.state.composeCurrentCacheKey.get();
			if (!repoPath || !cacheKey) return;

			// Capture the engaged entry up front — an anchor switch / mode exit mid-call
			// invalidates it; we'll re-resolve later and bail if it's gone.
			const engagedAnchor = this.currentAnchor();
			const engagedKey = anchorKey(engagedAnchor);

			this.actions.state.composeRegeneratingCommitId.set(commitId);
			const startedAt = performance.now();
			try {
				const result = await this.actions.services.graphInspect.regenerateProposedCommitMessage(
					repoPath,
					cacheKey,
					commitId,
					// No per-call abort signal yet — the host owns cancellation via its own
					// `_aiCancellations` registry, and the user can't currently cancel a regen
					// individually. Add an AbortController here if per-commit cancel becomes a
					// requirement.
					undefined,
				);
				if (this._disconnected) return;

				// User exited compose / switched anchors while the call was in flight. The
				// engaged entry no longer applies; drop the result rather than write into a
				// foreign state. The host has already mutated its own cache — benign on next
				// compose run (cache is per-repo and replaced on each generate).
				const stillEngaged =
					this.actions.state.activeMode.get() === 'compose' &&
					this.actions.state.activeModeRepoPath.get() === repoPath &&
					this.actions.state.composeCurrentCacheKey.get() === cacheKey;
				if (!stillEngaged) return;

				if ('cancelled' in result) {
					this.actions.sendTelemetryEvent('graphDetails/compose/regenerateMessage/failed', {
						'failure.reason': 'cancelled',
						duration: performance.now() - startedAt,
					});
					return;
				}
				if ('error' in result) {
					this.actions.sendTelemetryEvent('graphDetails/compose/regenerateMessage/failed', {
						'failure.reason': 'error',
						'failure.error.message': result.error.message,
						duration: performance.now() - startedAt,
					});
					return;
				}

				// Patch the resource. The resource's value is the source of truth for the
				// post-engagement projection; the registry entry's result shadows it for the
				// panel mapping, so we update both.
				const currentValue = this.actions.resources.compose.value.get();
				if (currentValue == null || !('result' in currentValue)) return;

				const patchedCommits = currentValue.result.commits.map(c =>
					c.id === result.result.commitId ? { ...c, message: result.result.message } : c,
				);
				const patched = {
					...currentValue,
					result: { ...currentValue.result, commits: patchedCommits },
				};
				this.actions.resources.compose.mutate(patched);

				const entry = this.host.crossPaneState.runningOperations.get().get(engagedKey)?.compose;
				if (entry?.execState === 'complete') {
					this.registerRunningOperation({ ...entry, result: patched });
				}

				this.actions.sendTelemetryEvent('graphDetails/compose/regenerateMessage/completed', {
					duration: performance.now() - startedAt,
				});
			} catch (ex) {
				if (this._disconnected) return;

				this.actions.sendTelemetryEvent('graphDetails/compose/regenerateMessage/failed', {
					'failure.reason': 'error',
					'failure.error.message': ex instanceof Error ? ex.message : String(ex),
					duration: performance.now() - startedAt,
				});
			} finally {
				if (!this._disconnected) {
					// Only clear when we're still the in-flight regen — a parallel run (e.g.
					// future per-commit concurrency) shouldn't have its handle stomped by a
					// settling earlier call. Today only one is in flight at a time, so this
					// reduces to a simple clear; the equality guard documents the invariant.
					if (this.actions.state.composeRegeneratingCommitId.get() === commitId) {
						this.actions.state.composeRegeneratingCommitId.set(undefined);
					}
				}
			}
		},

		/**
		 * Reorder the draft commits after a drag or keyboard move. `orderedDisplayIds` is the full
		 * set of the plan's commit ids in the new **display** order (top row first). The resource is
		 * reordered optimistically for a snappy render, then the new order is synced to the host's
		 * cached plan so apply and any subsequent refine honor it. A sync failure (stale plan) reverts
		 * the optimistic order — provided a newer reorder hasn't superseded ours in the meantime.
		 */
		reorderCommits: async (orderedDisplayIds: string[]): Promise<void> => {
			if (!orderedDisplayIds.length) return;

			const repoPath = this.actions.state.activeModeRepoPath.get();
			const cacheKey = this.actions.state.composeCurrentCacheKey.get();
			if (!repoPath || !cacheKey) return;

			const engagedKey = anchorKey(this.currentAnchor());

			const currentValue = this.actions.resources.compose.value.get();
			if (currentValue == null || !('result' in currentValue)) return;

			// Resolve the new order against the current commits; bail if it isn't an exact
			// permutation (a stale gesture racing a plan swap).
			const byId = new Map(currentValue.result.commits.map(c => [c.id, c]));
			if (orderedDisplayIds.length !== byId.size) return;

			const reordered: ProposedCommit[] = [];
			for (const id of orderedDisplayIds) {
				const commit = byId.get(id);
				if (commit == null) return;

				reordered.push(commit);
			}

			const priorCommits = currentValue.result.commits;
			// No-op if the order is unchanged.
			if (reordered.every((c, i) => c === priorCommits[i])) return;

			// Optimistically reorder the resource (drives the panel re-render) and shadow the
			// running-operation entry, mirroring the regen patch below.
			const patched = { ...currentValue, result: { ...currentValue.result, commits: reordered } };
			this.actions.resources.compose.mutate(patched);
			const entry = this.host.crossPaneState.runningOperations.get().get(engagedKey)?.compose;
			if (entry?.execState === 'complete') {
				this.registerRunningOperation({ ...entry, result: patched });
			}

			const startedAt = performance.now();
			try {
				// The host's canonical order is tip-last; the display is reversed (newest first).
				const libraryOrder = [...orderedDisplayIds].reverse();
				const result = await this.actions.services.graphInspect.reorderProposedCommits(
					repoPath,
					cacheKey,
					libraryOrder,
				);
				if (this._disconnected) return;

				if ('error' in result) {
					this.revertComposeReorder(engagedKey, reordered, priorCommits);
					this.actions.sendTelemetryEvent('graphDetails/compose/reorder/failed', {
						'plan.commits.count': reordered.length,
						'failure.error.message': result.error.message,
						duration: performance.now() - startedAt,
					});
					return;
				}

				this.actions.sendTelemetryEvent('graphDetails/compose/reorder/completed', {
					'plan.commits.count': reordered.length,
					duration: performance.now() - startedAt,
				});
			} catch (ex) {
				if (this._disconnected) return;

				this.revertComposeReorder(engagedKey, reordered, priorCommits);
				this.actions.sendTelemetryEvent('graphDetails/compose/reorder/failed', {
					'plan.commits.count': reordered.length,
					'failure.error.message': ex instanceof Error ? ex.message : String(ex),
					duration: performance.now() - startedAt,
				});
			}
		},

		/**
		 * Move the files in `paths` from one draft commit to another after a drag drop. `paths` is the
		 * multi-selection when the dragged row is part of it, else just the dragged file. Unlike reorder,
		 * this changes the affected commits' content (and may drop an emptied commit), so the host owns
		 * the result: it returns the re-derived plan and we replace the resource `commits` wholesale (no
		 * optimistic step — the recomputed files/stats/patch and prune can't be predicted locally).
		 */
		moveFile: async (fromCommitId: string, toCommitId: string, paths: string[]): Promise<void> => {
			if (!fromCommitId || !toCommitId || fromCommitId === toCommitId || paths.length === 0) return;

			const repoPath = this.actions.state.activeModeRepoPath.get();
			const cacheKey = this.actions.state.composeCurrentCacheKey.get();
			if (!repoPath || !cacheKey) return;

			const engagedKey = anchorKey(this.currentAnchor());
			const startedAt = performance.now();
			try {
				const result = await this.actions.services.graphInspect.moveComposeFile(
					repoPath,
					cacheKey,
					fromCommitId,
					toCommitId,
					paths,
				);
				if (this._disconnected) return;

				const stillEngaged =
					this.actions.state.activeMode.get() === 'compose' &&
					this.actions.state.activeModeRepoPath.get() === repoPath &&
					this.actions.state.composeCurrentCacheKey.get() === cacheKey;
				if (!stillEngaged) return;

				if ('error' in result) {
					this.actions.sendTelemetryEvent('graphDetails/compose/moveFile/failed', {
						'failure.error.message': result.error.message,
						duration: performance.now() - startedAt,
					});
					return;
				}

				const currentValue = this.actions.resources.compose.value.get();
				if (currentValue == null || !('result' in currentValue)) return;

				const patched = {
					...currentValue,
					result: { ...currentValue.result, commits: result.result.commits },
				};
				this.actions.resources.compose.mutate(patched);
				const entry = this.host.crossPaneState.runningOperations.get().get(engagedKey)?.compose;
				if (entry?.execState === 'complete') {
					this.registerRunningOperation({ ...entry, result: patched });
				}

				this.actions.sendTelemetryEvent('graphDetails/compose/moveFile/completed', {
					'plan.commits.count': result.result.commits.length,
					duration: performance.now() - startedAt,
				});
			} catch (ex) {
				if (this._disconnected) return;

				this.actions.sendTelemetryEvent('graphDetails/compose/moveFile/failed', {
					'failure.error.message': ex instanceof Error ? ex.message : String(ex),
					duration: performance.now() - startedAt,
				});
			}
		},
	};

	/**
	 * Restore the pre-reorder commit order after a failed host sync — but only when our optimistic
	 * array is still the live value. A newer reorder that landed while the sync was in flight owns
	 * the resource now, so reverting would stomp it.
	 */
	private revertComposeReorder(
		engagedKey: AnchorKey,
		optimisticCommits: readonly ProposedCommit[],
		priorCommits: ProposedCommit[],
	): void {
		const latest = this.actions.resources.compose.value.get();
		if (latest == null || !('result' in latest) || latest.result.commits !== optimisticCommits) return;

		const reverted = { ...latest, result: { ...latest.result, commits: priorCommits } };
		this.actions.resources.compose.mutate(reverted);
		const entry = this.host.crossPaneState.runningOperations.get().get(engagedKey)?.compose;
		if (entry?.execState === 'complete') {
			this.registerRunningOperation({ ...entry, result: reverted });
		}
	}

	runCompose(
		repoPath: string | undefined,
		instructions: string | undefined,
		excludedFiles: string[] | undefined,
		aiExcludedFiles: string[] | undefined,
		effectiveFilesCount: number,
		selectedIds?: ReadonlySet<string>,
		scopeItems?: ScopeItem[],
	): void {
		const scope = this.actions.buildScopeFromPicker(selectedIds, scopeItems) ?? this.actions.state.scope.get();
		if (!repoPath || !scope) return;

		this.actions.state.scope.set(scope);
		this.actions.state.wipStale.set(false);
		this.compose.invalidateSnapshot();
		// Snapshot the pre-error state so Back/Retry can recover. The value snapshot only
		// captures a result-bearing value — an error/cancelled sentinel isn't useful to restore.
		const currentValue = this.actions.resources.compose.value.get();
		this.actions.state.composePreErrorValue.set(
			currentValue != null && 'result' in currentValue ? currentValue : undefined,
		);
		this.actions.state.composeLastFailedAction.set('generate');
		this.actions.state.composeLastCommitAllIncludedIds.set(undefined);
		this._composeFetchedForSelection = this.selectionKey();

		// Refine continuation: a successfully-resolved prior plan in the resource + a tracked
		// cache key means the user is refining. Cold start otherwise. Locked-commit ids and
		// the prior key are forwarded as `startCompose` options; the host routes to
		// `refinePlanForGraphDetails` when `mode === 'refine'`.
		const priorCacheKey = this.actions.state.composeCurrentCacheKey.get();
		const isRefine = priorCacheKey != null && currentValue != null && 'result' in currentValue;
		const excludedCommitIds = isRefine ? this.actions.state.composeRefineExcludedCommitIds.get() : undefined;

		// On refine, carry the prior entry's `basePrompt` so the original cold-start instructions
		// keep driving the idle AI-input seed; the refine's own instructions still land on the
		// entry's `prompt` for retry/recall. Cold-start passes undefined so dispatchOperation
		// defaults `basePrompt` to `instructions`.
		const priorComposeEntry = isRefine
			? this.host.crossPaneState.runningOperations.get().get(anchorKey(this.currentAnchor()))?.compose
			: undefined;
		const basePrompt = isRefine ? priorComposeEntry?.basePrompt : undefined;

		this.dispatchOperation(
			'compose',
			instructions,
			controller =>
				this.actions.startCompose(
					repoPath,
					scope,
					instructions,
					excludedFiles,
					aiExcludedFiles,
					controller.signal,
					isRefine
						? {
								priorCacheKey: priorCacheKey,
								mode: 'refine' as const,
								excludedCommitIds: excludedCommitIds?.size ? [...excludedCommitIds] : undefined,
							}
						: undefined,
				),
			{
				excludedFilesCount: excludedFiles?.length ?? 0,
				effectiveFilesCount: effectiveFilesCount,
				refine: isRefine,
			},
			basePrompt,
		);
	}

	// endregion

	// region Resolve workflow

	/** AI conflict-resolution workflow controls. Resolve is WIP-anchored like compose but simpler:
	 *  no scope picker, no Back/Resume snapshot (apply is terminal). Arrow-function object so `this`
	 *  bindings are stable. */
	readonly resolve = {
		// Resolve has no Back/Resume snapshot — nothing to clear. Present so the generic
		// hide/destroy/anchor-switch paths can call it uniformly across all modes.
		invalidateSnapshot: (): void => {
			/* no-op */
		},
		// Resolve has no prior-result Resume/snapshot, so there's no error-recovery value to clear —
		// a no-op kept for the uniform workflow surface (mirrors invalidateSnapshot above).
		invalidateErrorRecovery: (): void => {
			/* no-op */
		},
		// "Go Back" from the error pane — resolve has no prior-result Resume, so land on clean idle
		// (the conflicted-file list). Drop the error entry so the panel maps to idle.
		backFromError: (): void => {
			const anchor = this.currentAnchor();
			this.removeRunningOperation(anchorKey(anchor), 'resolve');
			this.actions.resources.resolve.reset();
		},
		// Retry after error — re-run with the same scope (single file or all) and the run's prompt.
		// Read the scope off the entry (survives a row-switch-and-return that clears the signal),
		// falling back to the signal for a never-settled run.
		retryFromError: (): void => {
			const entry = this.host.crossPaneState.runningOperations
				.get()
				.get(anchorKey(this.currentAnchor()))?.resolve;
			this.runResolve(
				this.actions.state.activeModeRepoPath.get(),
				entry?.focusedFilePaths ?? this.actions.state.resolveFocusedFilePaths.get(),
				entry?.prompt,
			);
		},
		// Apply the (optionally filtered) resolutions to the working tree. Terminal: on success the
		// registry entry is removed and the mode forgotten (no Back/Resume for an applied set). On
		// failure the entry is synced to the error state so the panel surfaces it.
		applyResolutions: async (includedFilePaths?: readonly string[]): Promise<void> => {
			const repoPath = this.actions.state.activeModeRepoPath.get();
			const engagedAnchor = this.currentAnchor();
			// Capture the resolution-set size before the await — `applyResolutions` resets the
			// resource on success.
			const planValue = this.actions.resources.resolve.value.get();
			const resolutionsCount =
				planValue != null && 'result' in planValue ? planValue.result.resolutions.length : 0;
			const appliedCount = includedFilePaths?.length ?? resolutionsCount;
			const excludedCount = Math.max(0, resolutionsCount - appliedCount);
			const startedAt = performance.now();
			await this.actions.applyResolutions(repoPath, includedFilePaths);
			const duration = performance.now() - startedAt;
			if (this._disconnected) return;

			const resourceValue = this.actions.resources.resolve.value.get();
			if (resourceValue != null && 'error' in resourceValue) {
				this.actions.sendTelemetryEvent('graphDetails/resolve/applyResolutions/failed', {
					'resolutions.count': resolutionsCount,
					'applied.count': appliedCount,
					'excluded.count': excludedCount,
					duration: duration,
				});
				const entry = this.host.crossPaneState.runningOperations.get().get(anchorKey(engagedAnchor))?.resolve;
				if (entry == null) return;

				this.registerRunningOperation({ ...entry, execState: 'error', result: resourceValue });
				return;
			}

			this.actions.sendTelemetryEvent('graphDetails/resolve/applyResolutions/completed', {
				'resolutions.count': resolutionsCount,
				'applied.count': appliedCount,
				'excluded.count': excludedCount,
				duration: duration,
			});
			this.removeRunningOperation(anchorKey(engagedAnchor), 'resolve');
			this.forgetMode(engagedAnchor);
		},
		// Discard the pending resolutions without applying — drop the host session, clear the entry,
		// forget the mode, and hide the panel back to the plain WIP view.
		discard: (): void => {
			const repoPath = this.actions.state.activeModeRepoPath.get();
			const anchor = this.currentAnchor();
			const planValue = this.actions.resources.resolve.value.get();
			this.actions.sendTelemetryEvent('graphDetails/resolve/discarded', {
				'resolutions.count':
					planValue != null && 'result' in planValue ? planValue.result.resolutions.length : 0,
			});
			void this.actions.discardResolutions(repoPath);
			this.removeRunningOperation(anchorKey(anchor), 'resolve');
			this.actions.resources.resolve.reset();
			this.forgetMode(anchor);
			this.hideMode(this.host.currentSelection());
		},
		// Per-file feedback retry — re-resolve just `filePath` with `feedback`, replacing its resolution
		// in place (other files untouched). `resolveRetryingFiles` drives the row's busy spinner.
		retryFile: async (filePath: string, feedback: string): Promise<void> => {
			const repoPath = this.actions.state.activeModeRepoPath.get();
			if (!repoPath) return;

			const busy = this.actions.state.resolveRetryingFiles;
			busy.set(new Set(busy.get()).add(filePath));
			const controller = new AbortController();
			try {
				const result = await this.actions.reresolveFile(repoPath, filePath, feedback, controller.signal);
				// Host may have torn down while the RPC was in flight — writing to the disposed resource
				// or host-owned registry after that is UB (same guard as `onRunSettled`).
				if (this._disconnected) return;

				if ('result' in result) {
					this.mergeResolvedFile(result.result);
				}
			} finally {
				const next = new Set(this.actions.state.resolveRetryingFiles.get());
				next.delete(filePath);
				this.actions.state.resolveRetryingFiles.set(next);
			}
		},
		// Manual take-side fallback for a skipped/errored row — queues the chosen side as a pending
		// resolution (applied on Apply, dropped on Discard, like AI resolutions) and promotes the
		// matching rows without re-running the AI. `resolveStagingFiles` drives the row's busy spinner.
		takeSide: async (filePath: string, side: ConflictSide): Promise<void> => {
			const repoPath = this.actions.state.activeModeRepoPath.get();
			if (!repoPath) return;

			const busy = this.actions.state.resolveStagingFiles;
			busy.set(new Set(busy.get()).add(filePath));
			try {
				const result = await this.actions.takeConflictSide(repoPath, filePath, side);
				if (this._disconnected) return;

				if ('result' in result) {
					this.promoteToResolved(result.result.resolved);
				}
			} finally {
				const next = new Set(this.actions.state.resolveStagingFiles.get());
				next.delete(filePath);
				this.actions.state.resolveStagingFiles.set(next);
			}
		},
	};

	/** Replaces one file's resolution in the engaged resolve result (resource + registry entry) in
	 *  place after a per-file feedback retry — others untouched. Mirrors `review.enrichFocusAreaFindings`. */
	private mergeResolvedFile(summary: ResolvedFileSummary): void {
		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);
		const entry = this.host.crossPaneState.runningOperations.get().get(key)?.resolve;
		const current = entry?.result ?? this.actions.resources.resolve.value.get();
		if (current == null || !('result' in current)) return;

		const merged: ResolveResult = {
			result: {
				...current.result,
				resolutions: current.result.resolutions.map(r => (r.filePath === summary.filePath ? summary : r)),
			},
		};
		if (entry != null) {
			this.registerRunningOperation({ ...entry, result: merged });
		}
		this.actions.resources.resolve.mutate(merged);
	}

	/** Promotes the take-side files the host just queued out of `skipped`/`errors` into `resolutions`
	 *  (as synthetic summaries, so each row shows "kept current/took incoming/deleted") without an AI
	 *  re-run. The host's `resolved` list is the source of truth — it includes the chosen file plus,
	 *  for a rename/rename, the losing target queued as `deleted` — so the panel mirrors exactly what
	 *  will be applied. These resolutions carry no `content`; the queued take-ours/theirs/deleted
	 *  strategy is applied by the library on Apply. */
	private promoteToResolved(resolved: readonly QueuedTakeSide[]): void {
		if (resolved.length === 0) return;

		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);
		const entry = this.host.crossPaneState.runningOperations.get().get(key)?.resolve;
		const current = entry?.result ?? this.actions.resources.resolve.value.get();
		if (current == null || !('result' in current)) return;

		const byPath = new Map(resolved.map(r => [r.filePath, r]));
		const summaries: ResolvedFileSummary[] = resolved.map(r => ({
			filePath: r.filePath,
			strategy: r.strategy,
			reasoning: '',
			confidence: 1,
		}));

		const resolutions = [...current.result.resolutions.filter(r => !byPath.has(r.filePath)), ...summaries];
		const skipped = current.result.skipped?.filter(s => !byPath.has(s.filePath));
		const errors = current.result.errors?.filter(e => !byPath.has(e.filePath));

		const merged: ResolveResult = {
			result: {
				resolutions: resolutions,
				skipped: skipped != null && skipped.length > 0 ? skipped : undefined,
				errors: errors != null && errors.length > 0 ? errors : undefined,
			},
		};
		if (entry != null) {
			this.registerRunningOperation({ ...entry, result: merged });
		}
		this.actions.resources.resolve.mutate(merged);
	}

	/** Runs the resolver over `focusedFilePaths` — the user-checked subset from the idle file tree
	 *  (the full conflict set when everything is checked). Stored on `resolveFocusedFilePaths` so the
	 *  whole-run Refine and `retryFromError` re-run the same scope. */
	runResolve(
		repoPath: string | undefined,
		focusedFilePaths: readonly string[] | undefined,
		instructions: string | undefined,
	): void {
		if (!repoPath) return;

		this.actions.state.wipStale.set(false);
		this.actions.state.resolveFocusedFilePaths.set(focusedFilePaths);
		// A prior result-bearing value means this run is a Refine (re-resolve) rather than a fresh run
		// — used only for the `refine` telemetry flag below.
		const currentValue = this.actions.resources.resolve.value.get();
		this._resolveFetchedForSelection = this.selectionKey();
		this.dispatchOperation(
			'resolve',
			instructions,
			controller => this.actions.startResolve(repoPath, focusedFilePaths, instructions, controller.signal),
			{
				// `excludedFilesCount`/`effectiveFilesCount` are unused on the resolve telemetry path
				// (see `fireRunTelemetry`, which reports `files.focused.count` + the per-strategy
				// `result.*.count`s), so they stay 0 rather than carrying a misleading scope size.
				// `focused`/`focusedCount` describe the scoped run — the checked subset; both fall to
				// undefined/0 for a whole-run over all conflicts.
				excludedFilesCount: 0,
				effectiveFilesCount: 0,
				refine: currentValue != null && 'result' in currentValue,
				focused: focusedFilePaths != null && focusedFilePaths.length > 0,
				focusedCount: focusedFilePaths?.length ?? 0,
			},
			undefined,
			focusedFilePaths,
		);
	}

	// endregion

	// region Dispatch

	/** Common dispatch path for `runReview` / `runCompose`. Aborts any prior in-flight run on the
	 *  same `(anchor, kind)`; clears the engaged resource; creates a fresh `AbortController`;
	 *  invokes `start` (the direct-RPC call) with the controller's signal; registers a
	 *  `'generating'` entry immediately so adornments + chip overlays show the spinner; wires the
	 *  promise to `onRunSettled` with stale-guard. `prompt` lands on the entry as "last
	 *  submitted" (drives `retryFromError` + Refine ArrowUp recall); `basePrompt` lands as
	 *  "original cold-start instructions" (drives the AI-input seed on Restart). When
	 *  `basePrompt` is undefined the entry's `basePrompt` defaults to `prompt` — correct for
	 *  cold-start callers and modes without a refine concept (review/resolve). Refine callers
	 *  pass the prior entry's `basePrompt` so the base survives across refines. */
	private dispatchOperation(
		kind: DetailsMode,
		prompt: string | undefined,
		start: (controller: AbortController) => Promise<ReviewResult | ComposeResult | ResolveResult>,
		runContext: {
			excludedFilesCount: number;
			effectiveFilesCount: number;
			refine: boolean;
			focused?: boolean;
			focusedCount?: number;
		},
		basePrompt?: string,
		/** Resolve-only run scope, persisted on the entry so it survives anchor switches. */
		focusedFilePaths?: readonly string[],
	): void {
		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);

		// Abort any prior run on THIS (anchor, kind). Other anchors / the other kind on the same
		// anchor are untouched.
		const prior = this.host.crossPaneState.runningOperations.get().get(key)?.[kind];
		prior?.abortController?.abort();

		const controller = new AbortController();
		// Clear the engaged resource so the panel doesn't show a stale prior result while generating.
		this.resourceFor(kind).reset();

		const promise = start(controller);
		const startedAt = performance.now();

		// Register `'generating'` immediately — drives the adornment + chip spinner at once. Carry
		// `prompt` on the entry from the start: subsequent `{...entry, ...}` spreads in
		// `back()` / `backFromError()` / `onRunSettled` / `applyPlan` preserve it without each
		// site needing to know about the field.
		this.registerRunningOperation({
			kind: kind,
			anchor: anchor,
			execState: 'generating',
			abortController: controller,
			promise: promise,
			prompt: prompt,
			basePrompt: basePrompt ?? prompt,
			focusedFilePaths: focusedFilePaths,
		});

		promise.then(
			result => {
				this.fireRunTelemetry(kind, prompt, runContext, controller, startedAt, result, undefined);
				this.onRunSettled(kind, anchor, controller, result, undefined);
			},
			(ex: unknown) => {
				this.fireRunTelemetry(kind, prompt, runContext, controller, startedAt, undefined, ex);
				this.onRunSettled(kind, anchor, controller, undefined, ex);
			},
		);
	}

	/** Emits the per-outcome `graphDetails/<mode>/<action>/{completed,cancelled,failed}` telemetry.
	 *  Privacy-safe: payload is built from the controller's scope state + AI-model identifiers +
	 *  result counts — no file paths, no code content, no repo paths. */
	private fireRunTelemetry(
		kind: DetailsMode,
		prompt: string | undefined,
		runContext: {
			excludedFilesCount: number;
			effectiveFilesCount: number;
			refine: boolean;
			focused?: boolean;
			focusedCount?: number;
		},
		controller: AbortController,
		startedAt: number,
		result: ReviewResult | ComposeResult | ResolveResult | undefined,
		ex: unknown,
	): void {
		const duration = performance.now() - startedAt;

		// Cancellation — user clicked Cancel (aborted controller), OR host-side `{cancelled:true}`
		// sentinel from the compose/resolve RPC. Aborted-signal takes precedence so AbortError-on-reject
		// and the success-path race both resolve to a cancelled outcome.
		const isCancelled =
			controller.signal.aborted || (result != null && 'cancelled' in result && result.cancelled === true);
		const isError = ex != null || (result != null && 'error' in result);

		// Resolve curates a checked conflict-file set (not a commit scope), so it builds a
		// focused-files + instructions + AI-model payload instead of compose/review's scope context.
		if (kind === 'resolve') {
			const resolveBase = {
				...this.actions.buildAIModelTelemetryContext(),
				'customInstructions.used': (prompt?.length ?? 0) > 0,
				'customInstructions.length': prompt?.length ?? 0,
				refine: runContext.refine,
				focused: runContext.focused ?? false,
				'files.focused.count': runContext.focusedCount ?? 0,
				duration: duration,
			};

			if (isCancelled) {
				this.actions.sendTelemetryEvent('graphDetails/resolve/generateResolutions/cancelled', resolveBase);
				return;
			}
			if (isError) {
				this.actions.sendTelemetryEvent('graphDetails/resolve/generateResolutions/failed', resolveBase);
				return;
			}

			if (result != null && 'result' in result && 'resolutions' in result.result) {
				const r = result.result;
				let ai = 0;
				let takeOurs = 0;
				let takeTheirs = 0;
				let deleted = 0;
				let skipped = 0;
				for (const res of r.resolutions) {
					switch (res.strategy) {
						case 'ai':
							ai++;
							break;
						case 'take-ours':
							takeOurs++;
							break;
						case 'take-theirs':
							takeTheirs++;
							break;
						case 'deleted':
							deleted++;
							break;
						case 'skipped':
							skipped++;
							break;
					}
				}
				this.actions.sendTelemetryEvent('graphDetails/resolve/generateResolutions/completed', {
					...resolveBase,
					'result.resolutions.count': r.resolutions.length,
					'result.errors.count': r.errors?.length ?? 0,
					'result.skipped.count': r.skipped?.length ?? 0,
					'result.strategy.ai.count': ai,
					'result.strategy.takeOurs.count': takeOurs,
					'result.strategy.takeTheirs.count': takeTheirs,
					'result.strategy.deleted.count': deleted,
					'result.strategy.skipped.count': skipped,
				});
			}
			return;
		}

		const baseContext = this.actions.buildModeTelemetryContext(
			prompt,
			runContext.excludedFilesCount,
			runContext.effectiveFilesCount,
		);
		const composeOnly = kind === 'compose' ? { refine: runContext.refine } : {};

		if (isCancelled) {
			this.actions.sendTelemetryEvent(
				kind === 'compose'
					? 'graphDetails/compose/generatePlan/cancelled'
					: 'graphDetails/review/generateReview/cancelled',
				{ ...baseContext, ...composeOnly, duration: duration },
			);
			return;
		}

		// Error (thrown or `{ error }` payload).
		if (ex != null || (result != null && 'error' in result)) {
			this.actions.sendTelemetryEvent(
				kind === 'compose'
					? 'graphDetails/compose/generatePlan/failed'
					: 'graphDetails/review/generateReview/failed',
				{ ...baseContext, ...composeOnly, duration: duration },
			);
			return;
		}

		// Success.
		if (kind === 'compose' && result != null && 'result' in result && 'commits' in result.result) {
			const commits = result.result.commits;
			let filesCount = 0;
			let additions = 0;
			let deletions = 0;
			for (const c of commits) {
				filesCount += c.files.length;
				additions += c.additions;
				deletions += c.deletions;
			}
			this.actions.sendTelemetryEvent('graphDetails/compose/generatePlan/completed', {
				...baseContext,
				refine: runContext.refine,
				duration: duration,
				'result.commits.count': commits.length,
				'result.files.count': filesCount,
				'result.additions.count': additions,
				'result.deletions.count': deletions,
			});
		} else if (kind === 'review' && result != null && 'result' in result && 'focusAreas' in result.result) {
			const r = result.result;
			let findingCount = 0;
			let critical = 0;
			let warning = 0;
			let suggestion = 0;
			for (const area of r.focusAreas) {
				if (area.findings == null) continue;

				findingCount += area.findings.length;
				for (const f of area.findings) {
					if (f.severity === 'critical') {
						critical++;
					} else if (f.severity === 'warning') {
						warning++;
					} else if (f.severity === 'suggestion') {
						suggestion++;
					}
				}
			}
			this.actions.sendTelemetryEvent('graphDetails/review/generateReview/completed', {
				...baseContext,
				duration: duration,
				'result.mode': r.mode,
				'result.focusAreas.count': r.focusAreas.length,
				'result.findings.count': findingCount,
				'result.severity.critical.count': critical,
				'result.severity.warning.count': warning,
				'result.severity.suggestion.count': suggestion,
			});
		}
	}

	/** Mutates the engaged anchor's `(kind)` entry's `execState`. No-op if the entry doesn't
	 *  exist or is already at the target state. Used by Back (`'complete' → 'backed'`) and
	 *  Forward (`'backed' → 'complete'`). */
	private transitionEngagedEntryExecState(kind: 'review' | 'compose', execState: RunningOperationExecState): void {
		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);
		const entry = this.host.crossPaneState.runningOperations.get().get(key)?.[kind];
		if (entry == null || entry.execState === execState) return;

		this.registerRunningOperation(
			entry.kind === 'review' ? { ...entry, execState: execState } : { ...entry, execState: execState },
		);
	}

	/** Shared back-into-idle setup for review: wire the back-snapshot + Resume affordances and
	 *  reset the resource so the panel maps to `'idle'`. Used by both `back()` (success → Restart)
	 *  and `backFromError()` (error → Go Back) so the two paths can't drift. The caller is
	 *  responsible for the entry transition (`back()` uses `transitionEngagedEntryExecState` on a
	 *  `'complete'` entry; `backFromError()` does a full `registerRunningOperation` because it's
	 *  also moving the entry's `result` off the error sentinel onto the prior value). */
	private enterReviewBacked(value: ReviewResult): void {
		this._reviewBackSnapshot = value;
		this.actions.state.reviewForwardAvailable.set(true);
		if ('result' in value) {
			const filesSet = new Set<string>();
			let findingCount = 0;
			for (const area of value.result.focusAreas) {
				findingCount += area.findings?.length ?? 0;
				for (const f of area.files) {
					filesSet.add(f);
				}
			}
			this.actions.state.reviewBackPreview.set({
				findingCount: findingCount,
				fileCount: filesSet.size,
			});
		} else {
			this.actions.state.reviewBackPreview.set(undefined);
		}
		this.actions.resources.review.reset();
	}

	/** Compose counterpart to {@link enterReviewBacked}. Only result-bearing values are valid;
	 *  callers gate on `'result' in value` before invoking. */
	private enterComposeBacked(value: Extract<ComposeResult, { result: unknown }>): void {
		this._composeBackSnapshot = value;
		this.actions.state.composeForwardAvailable.set(true);
		const totalFiles = value.result.commits.reduce((sum, c) => sum + c.files.length, 0);
		this.actions.state.composeBackPreview.set({
			commitCount: value.result.commits.length,
			fileCount: totalFiles,
		});
		this.actions.resources.compose.reset();
	}

	/** Move the engaged anchor's `(kind)` entry to `'backed'` with **no result** — used by the
	 *  three "lost run" paths (Cancel button, host-side `{cancelled:true}` sentinel, no-prev
	 *  `backFromError`). Preserves `entry.prompt` so the AI input seeds with the run's prompt on
	 *  the next idle render. Clears any back-snapshot + Resume affordances so the panel doesn't
	 *  offer a "restore plan/findings" that isn't there. No-op if there's no entry. */
	private enterBackedNoResult(kind: 'review' | 'compose'): void {
		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);
		const entry = this.host.crossPaneState.runningOperations.get().get(key)?.[kind];
		if (entry == null) return;

		this.registerRunningOperation(
			entry.kind === 'review'
				? {
						...entry,
						execState: 'backed',
						result: undefined,
						abortController: undefined,
						promise: undefined,
					}
				: {
						...entry,
						execState: 'backed',
						result: undefined,
						abortController: undefined,
						promise: undefined,
					},
		);
		(kind === 'review' ? this.review : this.compose).invalidateSnapshot();
		(kind === 'review' ? this.actions.resources.review : this.actions.resources.compose).reset();
	}

	// endregion

	// region Private helpers

	/** Build a default {@link ScopeSelection} for entering review/compose mode. */
	private buildDefaultScope(
		sha: string | undefined,
		isWip: boolean,
		isMultiCommit: boolean,
	): ScopeSelection | undefined {
		if (isMultiCommit && this.actions.state.commitFrom.get() && this.actions.state.commitTo.get()) {
			return {
				type: 'compare',
				fromSha: this.actions.state.commitFrom.get()!.sha,
				toSha: this.actions.state.commitTo.get()!.sha,
			};
		}
		if (isWip) {
			const wip = this.actions.state.wip.get();
			const files = wip?.changes?.files ?? [];
			const hasUnstaged = files.some(f => !f.staged);
			const hasStaged = files.some(f => f.staged);

			// Working/staged changes win over commits — if the user has either, default to those.
			if (hasUnstaged || hasStaged) {
				return {
					type: 'wip',
					includeUnstaged: hasUnstaged,
					includeStaged: hasStaged,
					includeShas: [],
				};
			}

			// No working/staged changes — fall back to unpushed commits if any.
			const commits = this.actions.state.branchCommits.get();
			const unpushedShas = commits?.filter(c => !c.pushed).map(c => c.sha) ?? [];
			if (unpushedShas.length > 0) {
				return { type: 'wip', includeUnstaged: false, includeStaged: false, includeShas: unpushedShas };
			}

			// No unpushed — fall back to the most recent commit (HEAD = first entry, log is newest-first).
			if (commits?.length) {
				return {
					type: 'wip',
					includeUnstaged: false,
					includeStaged: false,
					includeShas: [commits[0].sha],
				};
			}

			// Commits not loaded yet — defer; fetchBranchCommits will re-derive once they arrive.
			return { type: 'wip', includeUnstaged: false, includeStaged: false, includeShas: [] };
		}
		if (sha) return { type: 'commit', sha: sha };
		return undefined;
	}

	/** Stale-fetch detection key on mode re-entry. Same scheme as the registry's key (the two
	 *  must agree so a re-entry against an anchor with a saved snapshot is recognized as the
	 *  same selection). Defaults to the currently-active mode's locked anchor. */
	private selectionKey(sha?: string, shas?: string[], repoPath?: string): AnchorKey {
		return anchorKey({
			sha: sha ?? this.actions.state.activeModeSha.get(),
			shas: shas ?? this.actions.state.activeModeShas.get(),
			repoPath: repoPath ?? this.actions.state.activeModeRepoPath.get(),
		});
	}

	/** Builds a {@link RunningOperationAnchor} from the currently-active mode's locked selection. */
	private currentAnchor(): RunningOperationAnchor {
		const state = this.actions.state;
		return {
			kind: state.activeModeContext.get() ?? 'wip',
			repoPath: state.activeModeRepoPath.get() ?? '',
			sha: state.activeModeSha.get(),
			shas: state.activeModeShas.get(),
		};
	}

	/** Settled-callback for `runReview`/`runCompose` — fires when the live promise resolves
	 *  (success), rejects (error), or settles after a cancel (early-bails). Updates the registry
	 *  entry to `'complete'` / `'error'` (or removes it for the compose `{cancelled:true}`
	 *  sentinel), then projects into the engaged-anchor resource if still engaged. Always
	 *  publishes the entry update — adornments + chip overlays refresh even when not engaged. */
	private onRunSettled(
		kind: 'review' | 'compose' | 'resolve' | 'generateMessage',
		anchor: RunningOperationAnchor,
		controller: AbortController,
		result: ReviewResult | ComposeResult | ResolveResult | GenerateMessageResult | undefined,
		ex: unknown,
	): void {
		// Stale guard first — these are host-owned registry reads, safe even after disconnect, so
		// they precede the disconnect bail below. A newer same-(anchor,kind) run replaced this entry
		// (re-run), or the run was explicitly cancelled / repo-switched: this settlement is orphaned.
		const key = anchorKey(anchor);
		const current = this.host.crossPaneState.runningOperations.get().get(key)?.[kind];
		if (current?.abortController !== controller) return;
		if (controller.signal.aborted) return;

		// generate-message routes to the WIP input/draft, not a resource, so it skips the review/compose
		// `_disconnected` resource-write bail below (teardown aborts these runs; the guard above drops late settles).
		if (kind === 'generateMessage') {
			this.settleGenerateMessage(
				anchor,
				current as Extract<RunningOperation, { kind: 'generateMessage' }>,
				result as GenerateMessageResult | undefined,
				ex,
			);
			return;
		}

		// Disconnect guard: the panel intentionally lets in-flight runs survive disconnect
		// (registry is host-owned), so the promise can still resolve after `actions` has been
		// disposed. Writing to a disposed Resource is UB; bail. The registry entry stays as
		// `'generating'` — that's the worst case, and the next mount's `projectEngagedAnchor`
		// will resync it from the entry. Repo-switch already calls `cancelAllRunningOperations`
		// to abort everything, so we don't strand entries indefinitely.
		if (this._disconnected) return;

		// Compose `{cancelled:true}` sentinel — host-side library cancel without an abort. Same
		// shape as the user-clicked Cancel: preserve the entry+prompt in `'backed'` with no
		// result so the AI input re-seeds on the idle re-render. The user didn't ask to forget
		// what they typed.
		if (kind === 'compose' && result != null && 'cancelled' in result && result.cancelled === true) {
			this.enterBackedNoResult(kind);
			return;
		}

		// Resolve `{cancelled:true}` sentinel — host-side cancel without an abort. Resolve has no
		// Back/Resume, so drop the entry and return the panel to idle (the conflicted-file list).
		if (kind === 'resolve' && result != null && 'cancelled' in result && result.cancelled === true) {
			this.removeRunningOperation(key, 'resolve');
			this.projectIfEngaged('resolve', anchor);
			return;
		}

		let execState: RunningOperationExecState;
		// `kind` is narrowed to 'review' | 'compose' | 'resolve' here (generate-message returned
		// above), so the settled value is a review/compose/resolve result.
		let value: ReviewResult | ComposeResult | ResolveResult | undefined = result as
			| ReviewResult
			| ComposeResult
			| ResolveResult
			| undefined;
		if (ex != null) {
			execState = 'error';
			const message = ex instanceof Error ? ex.message : typeof ex === 'string' ? ex : 'Run failed';
			value = { error: { message: message } };
		} else if (result != null && 'error' in result) {
			execState = 'error';
		} else {
			execState = 'complete';
		}

		// Compose-only: capture the new cacheKey from the host so refine + commit-to-here can
		// thread the session back. Clears the post-commit "Committed N of M" banner once the
		// follow-up plan has actually landed (the user has visible work to refine again).
		if (kind === 'compose' && execState === 'complete' && value != null && 'result' in value) {
			const composeValue = value as Extract<ComposeResult, { result: unknown }>;
			const newCacheKey = (composeValue.result as { cacheKey?: string }).cacheKey;
			if (newCacheKey != null) {
				this.actions.state.composeCurrentCacheKey.set(newCacheKey);
			}
		}

		// Always update the entry — drives adornment + chip overlay refresh even when not engaged.
		// Carry forward the live entry's `prompt` (seeds the AI input on Restart) and `focusedFilePaths`
		// (resolve scope — so Refine/retry after a row-switch-and-return re-run the same subset instead
		// of widening to all conflicts). `abortController` + `promise` are intentionally dropped: the run
		// is settled, those fields are stale (per RunningOperationBase docs).
		this.registerRunningOperation({
			kind: kind,
			anchor: anchor,
			execState: execState,
			result: value,
			prompt: current.prompt,
			basePrompt: current.basePrompt,
			focusedFilePaths: current.focusedFilePaths,
		} as RunningOperation);
		// If still engaged, project the result into the panel-bound Resource.
		this.projectIfEngaged(kind, anchor);
	}

	/** Settle a generate-message run: apply a non-empty message via the host (live input or draft, host
	 *  decides) and remove the entry. Ephemeral — nothing is stored; errors land nothing. */
	private settleGenerateMessage(
		anchor: RunningOperationAnchor,
		entry: Extract<RunningOperation, { kind: 'generateMessage' }>,
		result: GenerateMessageResult | undefined,
		ex: unknown,
	): void {
		const message = ex == null ? (result?.message ?? '') : '';
		const duration = entry.startedAt != null ? performance.now() - entry.startedAt : undefined;
		const context = entry.telemetryContext;

		if (message) {
			this.host.applyGeneratedCommitMessage(anchor.repoPath, message);
			this.actions.sendTelemetryEvent('graph/wip/generateMessage/succeeded', {
				amend: context?.amend,
				hasExistingMessage: context?.hasExistingMessage,
				duration: duration,
				'result.length': message.length,
			});
		} else {
			this.actions.sendTelemetryEvent('graph/wip/generateMessage/failed', {
				amend: context?.amend,
				hasExistingMessage: context?.hasExistingMessage,
				duration: duration,
				reason: ex != null ? 'error' : 'empty',
			});
		}

		this.removeRunningOperation(anchorKey(anchor), 'generateMessage');
	}

	/** Generate-commit-message entry point (panel sparkle). Tracks the run under its WIP anchor in the
	 *  shared registry (survives selection changes, concurrent per worktree). A second invocation while
	 *  generating cancels that worktree's run — the sparkle doubles as a cancel affordance. */
	runGenerateMessage(repoPath: string | undefined): void {
		if (!repoPath) return;

		const anchor: RunningOperationAnchor = { kind: 'wip', repoPath: repoPath, sha: uncommitted };
		const key = anchorKey(anchor);

		const existing = this.host.crossPaneState.runningOperations.get().get(key)?.generateMessage;
		if (existing?.execState === 'generating') {
			const duration = existing.startedAt != null ? performance.now() - existing.startedAt : undefined;
			existing.abortController?.abort();
			this.removeRunningOperation(key, 'generateMessage');
			this.actions.sendTelemetryEvent('graph/wip/generateMessage/cancelled', { duration: duration });
			return;
		}

		const state = this.actions.state;
		const wip = state.wip.get();
		const files = wip?.changes?.files;
		const currentMessage = state.commitMessage.get().trim();
		const amend = state.amend.get();
		const hasStagedFiles = files?.some(f => f.staged) ?? false;

		const telemetryContext = {
			amend: amend,
			hasExistingMessage: currentMessage.length > 0,
		};

		this.actions.sendTelemetryEvent('graph/wip/generateMessage/started', {
			...telemetryContext,
			'message.length': currentMessage.length,
			hasStagedFiles: hasStagedFiles,
			'files.staged.count': files?.filter(f => f.staged).length ?? 0,
			'files.total.count': files?.length ?? 0,
		});

		const controller = new AbortController();
		const promise = this.startGenerateMessage(repoPath, controller.signal);
		this.registerRunningOperation({
			kind: 'generateMessage',
			anchor: anchor,
			execState: 'generating',
			abortController: controller,
			promise: promise,
			startedAt: performance.now(),
			telemetryContext: telemetryContext,
		});
		promise.then(
			result => this.onRunSettled('generateMessage', anchor, controller, result, undefined),
			(ex: unknown) => this.onRunSettled('generateMessage', anchor, controller, undefined, ex),
		);
	}

	/** Builds the generate-message RPC promise from the current WIP form state, mirroring `commit`'s
	 *  staged-vs-all amend decision. A `null` host result maps to an empty message. */
	private startGenerateMessage(repoPath: string, signal: AbortSignal): Promise<GenerateMessageResult> {
		const state = this.actions.state;
		const currentMessage = state.commitMessage.get().trim() || undefined;

		let amend: { sha: string; all: boolean } | undefined;
		if (state.amend.get()) {
			const amendingSha = state.amendBaseSha.get();
			if (amendingSha != null) {
				const wip = state.wip.get();
				const hasStagedFiles = wip?.changes?.files?.some(f => f.staged) ?? false;
				const smartCommit = state.preferences.get()?.enableSmartCommit ?? false;
				amend = { sha: amendingSha, all: !hasStagedFiles && smartCommit };
			}
		}

		return this.actions.services.graphInspect
			.generateCommitMessage(repoPath, currentMessage, amend, signal)
			.then(result =>
				result
					? { message: result.body ? `${result.summary}\n\n${result.body}` : result.summary }
					: { message: '' },
			);
	}

	/** True when the given anchor matches the currently-engaged-mode's locked anchor. Engaged
	 *  ≡ the anchor `toggleMode` last bound `activeMode*` to. */
	private isAnchorEngaged(anchor: RunningOperationAnchor): boolean {
		const state = this.actions.state;
		if (state.activeMode.get() == null) return false;

		const engagedKey = anchorKey({
			sha: state.activeModeSha.get(),
			shas: state.activeModeShas.get(),
			repoPath: state.activeModeRepoPath.get(),
		});
		return engagedKey === anchorKey(anchor);
	}

	/** Calls {@link projectEngagedAnchor} only if `anchor` is the currently-engaged anchor. */
	private projectIfEngaged(kind: DetailsMode, anchor: RunningOperationAnchor): void {
		if (!this.isAnchorEngaged(anchor)) return;

		this.projectEngagedAnchor(kind, anchor);
	}

	/** Project an anchor's registry entry into the engaged resource so the panel renders the
	 *  right thing. `'generating'`/`'backed'` → `resource.reset()` (panel reads `execState`
	 *  from the entry for its `mappedStatus`). `'complete'`/`'error'` with a `result` →
	 *  `resource.mutate(result)`. No entry / wrong kind → `resource.reset()` (ENABLED-idle). */
	private projectEngagedAnchor(kind: DetailsMode, selection: AnchorSelection): void {
		const entry = this.host.crossPaneState.runningOperations.get().get(anchorKey(selection))?.[kind];
		const resource = this.resourceFor(kind);
		if (entry == null) {
			resource.reset();
			return;
		}
		if (entry.execState === 'generating' || entry.execState === 'backed') {
			resource.reset();
			return;
		}

		if (entry.result != null) {
			if (entry.kind === 'review') {
				this.actions.resources.review.mutate(entry.result);
			} else if (entry.kind === 'compose') {
				this.actions.resources.compose.mutate(entry.result);
			} else if (entry.kind === 'resolve') {
				this.actions.resources.resolve.mutate(entry.result);
			}
		} else {
			resource.reset();
		}
	}

	/** Adds or replaces the `(anchor, kind)` entry in the per-anchor bucket map. Bails early when
	 *  the new entry equals the existing one (kind + execState + result reference + controller
	 *  identity) to avoid no-op signal churn — the registry feeds row adornments and chip
	 *  overlays; a same-value re-register would trigger a full React re-resolve cycle for nothing. */
	private registerRunningOperation(op: RunningOperation): void {
		const signal = this.host.crossPaneState.runningOperations;
		const current = signal.get();
		const key = anchorKey(op.anchor);
		const bucket = current.get(key);
		const existing = bucket?.[op.kind];
		if (
			existing?.kind === op.kind &&
			existing.execState === op.execState &&
			// `result` is absent on the generate-message arm, present on review/compose — compare via
			// cast so the dedup is uniform across kinds (undefined === undefined for generate-message).
			(existing as { result?: unknown }).result === (op as { result?: unknown }).result &&
			existing.abortController === op.abortController &&
			existing.promise === op.promise &&
			// Include the captured Refine posture/draft so a refine-only update (same execState + result,
			// written by `captureEngagedRefineState` on mode-leave) isn't dropped as a no-op.
			existing.refineMode === op.refineMode &&
			existing.refineDraft === op.refineDraft
		) {
			return;
		}

		const next = new Map(current);
		next.set(key, { ...(bucket ?? {}), [op.kind]: op });
		signal.set(next);
	}

	/** Removes a single-kind entry from the bucket at `(key)`. If the bucket becomes empty, the
	 *  whole bucket is removed (so the row-keyed adornment translation can short-circuit). */
	private removeRunningOperation(key: AnchorKey, kind: 'review' | 'compose' | 'resolve' | 'generateMessage'): void {
		const signal = this.host.crossPaneState.runningOperations;
		const current = signal.get();
		const bucket = current.get(key);
		if (bucket?.[kind] == null) return;

		// Drop only this kind; preserve the other kinds that may share the anchor. Static keys (no
		// dynamic delete) so each slot's discriminated type is preserved.
		const nextBucket: RunningOperationBucket = {
			review: kind === 'review' ? undefined : bucket.review,
			compose: kind === 'compose' ? undefined : bucket.compose,
			resolve: kind === 'resolve' ? undefined : bucket.resolve,
			generateMessage: kind === 'generateMessage' ? undefined : bucket.generateMessage,
		};
		const next = new Map(current);
		if (
			nextBucket.review == null &&
			nextBucket.compose == null &&
			nextBucket.resolve == null &&
			nextBucket.generateMessage == null
		) {
			next.delete(key);
		} else {
			next.set(key, nextBucket);
		}
		signal.set(next);
	}

	/** Aborts every in-flight operation across every anchor + clears the registry. Called on
	 *  repo-selector switches (per spec, switching repos tears down the whole universe of
	 *  running operations silently). NOT called on `hostDisconnected` — runs intentionally
	 *  survive panel disconnect; the registry is owned by `gl-graph-app`. */
	private cancelAllRunningOperations(): void {
		// Shared abort-and-clear core (also used by gl-graph-app teardown); this method layers on the
		// controller-only resets below.
		abortRunningOperations(this.host.crossPaneState);
		this._reviewBackSnapshot = undefined;
		this._composeBackSnapshot = undefined;
		this.actions.resources.review.reset();
		this.actions.resources.compose.reset();
		this.actions.resources.resolve.reset();
		// Prior repo's anchors are gone — drop their remembered modes too.
		const modes = this.host.crossPaneState.lastModeByAnchor;
		if (modes.get().size > 0) {
			modes.set(new Map());
		}
	}

	/** Records the user's intent to be in `mode` on `selection`'s anchor. Read by the panel on
	 *  selection-arrival to restore the mode (see `gl-graph-details-panel.ts` `willUpdate`).
	 *  Forgotten by explicit user-close paths; preserved across anchor navigation. */
	private rememberMode(selection: DetailsSelection, mode: DetailsMode): void {
		const signal = this.host.crossPaneState.lastModeByAnchor;
		const current = signal.get();
		const key = anchorKey(selection);
		if (current.get(key) === mode) return;

		const next = new Map(current);
		next.set(key, mode);
		signal.set(next);
	}

	/** Forgets the remembered mode for `anchor`'s key. Called from user-dismissal endpoints
	 *  (toggle-off, X-close hide, destroy) so a subsequent return doesn't auto-restore a mode
	 *  the user explicitly closed. Accepts the wider `AnchorSelection` so `RunningOperationAnchor`
	 *  (engaged-anchor shape) flows in without an adapter. */
	private forgetMode(anchor: AnchorSelection): void {
		const signal = this.host.crossPaneState.lastModeByAnchor;
		const current = signal.get();
		const key = anchorKey(anchor);
		if (!current.has(key)) return;

		const next = new Map(current);
		next.delete(key);
		signal.set(next);
	}

	/** Reads the remembered mode for `selection`'s anchor, or `undefined` if none. */
	getRememberedMode(selection: DetailsSelection): DetailsMode | undefined {
		return this.host.crossPaneState.lastModeByAnchor.get().get(anchorKey(selection));
	}

	/** Explicitly aborts an in-flight `'generating'` operation at the engaged anchor and returns
	 *  the panel to ENABLED-idle. Wired to the in-flight Cancel button on the review/compose
	 *  spinners (via `compose-cancel` / `review-cancel` events). This is the only path that
	 *  manually kills a generating run. The entry is preserved in `'backed'` with no result so
	 *  the run's `prompt` survives — the user gets it back on the next idle render and can adjust
	 *  + retry without retyping. */
	cancelOperation(kind: DetailsMode): void {
		const anchor = this.currentAnchor();
		const key = anchorKey(anchor);
		const entry = this.host.crossPaneState.runningOperations.get().get(key)?.[kind];
		entry?.abortController?.abort();
		if (kind === 'resolve') {
			// Resolve has no Back/Resume — cancelling returns to idle (the conflicted-file list).
			this.removeRunningOperation(key, 'resolve');
			this.actions.resources.resolve.reset();
			return;
		}

		this.enterBackedNoResult(kind);
	}

	/** Marks review/compose running operations for the given repo paths as `'orphaned'` and aborts
	 *  any still-`'generating'` ones (the host AI work is pointless if the anchor is gone); the saved
	 *  result (if any) remains accessible so the user can still view it. Generate-message entries are
	 *  instead aborted and dropped — they have no `'orphaned'` UI or in-registry result to preserve. */
	orphanRunningOperationsForRepoPaths(removedRepoPaths: ReadonlySet<string>): void {
		const signal = this.host.crossPaneState.runningOperations;
		const current = signal.get();
		let touched = false;
		const next = new Map(current);
		for (const [key, bucket] of current) {
			let nextBucket: RunningOperationBucket | undefined;
			const review = bucket.review;
			if (review != null && review.execState !== 'orphaned' && removedRepoPaths.has(review.anchor.repoPath)) {
				review.abortController?.abort();
				nextBucket ??= { ...bucket };
				nextBucket.review = {
					...review,
					execState: 'orphaned',
					abortController: undefined,
					promise: undefined,
				};
				touched = true;
			}
			const compose = bucket.compose;
			if (compose != null && compose.execState !== 'orphaned' && removedRepoPaths.has(compose.anchor.repoPath)) {
				compose.abortController?.abort();
				nextBucket ??= { ...bucket };
				nextBucket.compose = {
					...compose,
					execState: 'orphaned',
					abortController: undefined,
					promise: undefined,
				};
				touched = true;
			}
			const resolve = bucket.resolve;
			if (resolve != null && resolve.execState !== 'orphaned' && removedRepoPaths.has(resolve.anchor.repoPath)) {
				resolve.abortController?.abort();
				nextBucket ??= { ...bucket };
				nextBucket.resolve = {
					...resolve,
					execState: 'orphaned',
					abortController: undefined,
					promise: undefined,
				};
				touched = true;
			}
			const generateMessage = bucket.generateMessage;
			if (generateMessage != null && removedRepoPaths.has(generateMessage.anchor.repoPath)) {
				generateMessage.abortController?.abort();
				nextBucket ??= { ...bucket };
				delete nextBucket.generateMessage;
				touched = true;
			}
			if (nextBucket != null) {
				if (
					nextBucket.review == null &&
					nextBucket.compose == null &&
					nextBucket.resolve == null &&
					nextBucket.generateMessage == null
				) {
					next.delete(key);
				} else {
					next.set(key, nextBucket);
				}
			}
		}
		if (touched) {
			signal.set(next);
		}
		// Remembered mode entries for pruned anchors are left in place — they're keyed by the
		// dead anchor and the user can't navigate back to it, so they're effectively unreachable.
		// Repo-switch teardown clears the bulk; this avoids reparsing keys for a microcleanup.
	}

	// endregion

	// region Subscription

	/**
	 * Keeps `refreshWipBranchEnrichment` wired to the current repo's change events so the
	 * WIP issue row and merge-target stay in sync after out-of-band commands write to git
	 * config (associate/unassociate issue, set-merge-target, etc.).
	 *
	 * The Supertalk RPC marshals subscription methods as `Promise<Unsubscribe>`, so we
	 * must await the result — a synchronous assignment would capture the Promise (which
	 * isn't callable) and break teardown.
	 */
	private ensureSubscription(repoPath: string | undefined): void {
		if (repoPath === this._subscribedRepoPath) return;

		this._subscriptionUnsubscribe?.();
		this._subscriptionUnsubscribe = undefined;
		this._subscribedRepoPath = repoPath;

		if (repoPath == null) return;

		const gen = this._subscriptionGen.next();
		void (async () => {
			const unsubscribe = await subscribeAll([
				() =>
					this.actions.services.repository.onRepositoryChanged(repoPath, data => {
						const relevant = data.changes.some(
							c => c === 'gkConfig' || c === 'config' || c === 'heads' || c === 'remoteProviders',
						);
						if (!relevant) return;

						// The branch sheet fetches the same enrichment but owns its own state/cache, so the
						// WIP refresh below doesn't cover it — refresh it regardless of the selection.
						this.host.refreshBranchSheet();

						if (!this.host.isWipSelection()) return;

						this.actions.refreshWipBranchEnrichment();
					}),
			]);
			if (typeof unsubscribe !== 'function') return;
			if (gen !== this._subscriptionGen.current || this._subscribedRepoPath !== repoPath) {
				unsubscribe();
				return;
			}

			this._subscriptionUnsubscribe = unsubscribe;
		})();
	}

	private tearDownSubscription(): void {
		this._subscriptionGen.next();
		this._subscriptionUnsubscribe?.();
		this._subscriptionUnsubscribe = undefined;
		this._subscribedRepoPath = undefined;
		// Reset so a future reconnect treats the first hostUpdate as a fresh observation
		// (no spurious mode exit on re-attach).
		this._lastSeenGraphRepoPath = undefined;
	}

	/** The effective staleness-watch path: the Compare side's worktree when the comparison's
	 *  rightRef is checked out in a worktree distinct from the graph's repo, else `host.repoPath`
	 *  (already correct in that case — same repo the graph is showing). */
	private compareWatchPath(): string | undefined {
		// Only watch while a working-tree comparison is open — `markBranchCompareStale` drops every
		// event unless the compare sheet/panel is open AND include-working-tree is on, so an
		// always-on watch would hold an FS-watch lease (and shorten the shared working-tree debounce
		// for other subscribers of the repo) for a callback that can't fire.
		const compareOpen = this.actions.state.compareSheetOpen.get() || this.actions.state.compareAsPanel.get();
		if (!compareOpen || !this.actions.state.branchCompareIncludeWorkingTree.get()) return undefined;

		return this.actions.state.branchCompareRightRefWorktreePath.get() ?? this.host.repoPath;
	}

	/**
	 * Keeps `markBranchCompareStale` wired to the Compare side's effective path rather than
	 * `host.repoPath` — when the Compare ref is checked out in a secondary worktree, edits there
	 * (not in the graph's current repo) are what should stale the comparison. Secondary worktrees
	 * are typically not surfaced/registered `Repository` instances, so this goes through
	 * `onRepositoryOrWorktreeChanged` (works by path + git dir directly) rather than
	 * `onRepositoryChanged`/`onRepositoryWorkingChanged` (which require a registered `Repository`
	 * and silently no-op otherwise). Separate lifecycle from {@link ensureSubscription} — this
	 * path can change (Compare ref switch, IWT toggle) without `host.repoPath` changing.
	 */
	private ensureCompareWatchSubscription(path: string | undefined): void {
		if (path === this._subscribedCompareWatchPath) return;

		this._compareWatchSubscriptionUnsubscribe?.();
		this._compareWatchSubscriptionUnsubscribe = undefined;
		this._subscribedCompareWatchPath = path;

		if (path == null) return;

		const gen = this._compareWatchSubscriptionGen.next();
		void (async () => {
			const unsubscribe = await subscribeAll([
				() =>
					this.actions.services.repository.onRepositoryOrWorktreeChanged(path, () =>
						this.actions.markBranchCompareStale(),
					),
			]);
			if (typeof unsubscribe !== 'function') return;
			if (gen !== this._compareWatchSubscriptionGen.current || this._subscribedCompareWatchPath !== path) {
				unsubscribe();
				return;
			}

			this._compareWatchSubscriptionUnsubscribe = unsubscribe;
		})();
	}

	private tearDownCompareWatchSubscription(): void {
		this._compareWatchSubscriptionGen.next();
		this._compareWatchSubscriptionUnsubscribe?.();
		this._compareWatchSubscriptionUnsubscribe = undefined;
		this._subscribedCompareWatchPath = undefined;
	}

	// endregion
}
