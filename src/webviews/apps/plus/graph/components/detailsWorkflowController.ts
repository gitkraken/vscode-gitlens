import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { areEqual } from '@gitlens/utils/array.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type { ComposeResult, ReviewResult, ScopeSelection } from '../../../../plus/graph/graphService.js';
import { subscribeAll } from '../../../shared/events/subscriptions.js';
import type { DetailsActions } from './detailsActions.js';
import type { ScopeItem } from './gl-commits-scope-pane.js';

export type DetailsMode = 'review' | 'compose' | 'compare';

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

/** Optional overrides for entering compare mode. */
export interface CompareModeOverrides {
	rightRef?: string;
	rightRefType?: 'branch' | 'commit';
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
	/** Snapshot of the host's current selection — used to seed `exitMode` when the
	 *  controller forces a mode exit on repo change. */
	currentSelection(): DetailsSelection;
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
	/** Tracks the graph's user-perceived repo so we can detect repo-selector switches that
	 *  haven't yet propagated to `host.repoPath` (selection from the prior repo can mask the
	 *  change until the user clicks a row in the new repo). `undefined` until the first
	 *  observation, which is treated as a no-op transition (no spurious mode exit on mount). */
	private _lastSeenGraphRepoPath: string | undefined;
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
	 * Tracks the sha (or shas-key) the review/compose resource was last fetched for.
	 * When the user re-enters a mode for a DIFFERENT selection, we reset the resource so
	 * the prior result doesn't render against the new selection. closeMode handles the
	 * "selection changed while IN the mode" case; this handles "selection changed while
	 * OUT of the mode, then re-entered".
	 */
	private _reviewFetchedForSelection: string | undefined;
	private _composeFetchedForSelection: string | undefined;
	// endregion

	constructor(
		private readonly host: DetailsWorkflowHost,
		private readonly actions: DetailsActions,
	) {
		host.addController(this);
	}

	// region ReactiveController lifecycle

	hostConnected(): void {
		this.ensureSubscription(this.host.repoPath);
	}

	hostDisconnected(): void {
		this.tearDownSubscription();
	}

	hostUpdate(): void {
		// Trigger 1 — graph repo-selector switch. Fires before `host.repoPath` updates
		// because `host.repoPath` is derived from the selection, which lingers across the
		// switch until the user clicks a row in the new repo. Without this trigger, an
		// active compose/review/compare mode would persist visibly with prior-repo data
		// while the graph header shows the new repo.
		const graphRepo = this.host.graphRepoPath();
		if (graphRepo !== this._lastSeenGraphRepoPath) {
			const previous = this._lastSeenGraphRepoPath;
			this._lastSeenGraphRepoPath = graphRepo;
			// Skip the first observation (no prior graph repo to compare against — would
			// otherwise spuriously exit on mount).
			if (previous != null) {
				this.exitModeIfRepoMismatch(graphRepo);
			}
		}

		// Trigger 2 — panel render target switched. Covers the worktree-row-jump case
		// (selection moves between rows whose `repoPath`s differ) and the post-graph-switch
		// row click (where `host.repoPath` updates after the user lands somewhere in the
		// new repo). Re-wires the repo-change subscription either way.
		if (this.host.repoPath !== this._subscribedRepoPath) {
			this.exitModeIfRepoMismatch(this.host.repoPath);
			// Drop webview-side enrichment caches + abort in-flight fetches keyed to the
			// prior render target. No value-collision risk (keys include repoPath); this
			// is memory hygiene + prevents stale-write races from slow fetches that have
			// no key gate (notably `fetchBranchCommits`).
			this.actions.clearEnrichmentCaches();
			this.ensureSubscription(this.host.repoPath);
		}
	}

	/**
	 * Exit any active mode whose `activeModeRepoPath` doesn't match the supplied repo.
	 * Re-reads state on every call so callers can invoke this from independent triggers
	 * (graph switch + render-target switch) within the same `hostUpdate` cycle without
	 * worrying about ordering — the second call is a no-op if the first already exited.
	 */
	private exitModeIfRepoMismatch(currentRepo: string | undefined): void {
		const state = this.actions.state;
		const activeMode = state.activeMode.get();
		const activeModeRepo = state.activeModeRepoPath.get();
		if (activeMode != null && activeModeRepo != null && currentRepo != null && activeModeRepo !== currentRepo) {
			this.exitMode(this.host.currentSelection());
		}
	}

	// endregion

	// region Mode transitions

	toggleMode(mode: DetailsMode, selection: DetailsSelection, compareOverrides?: CompareModeOverrides): void {
		const { sha, shas, repoPath } = selection;
		const state = this.actions.state;
		const resources = this.actions.resources;

		// If already active, deactivate (leaving a mode is always allowed, even if the current
		// selection wouldn't pass the activation guards below).
		if (state.activeMode.get() === mode) {
			this.exitMode(selection);
			return;
		}

		const isWip = this.actions.isWip(sha);
		const isMultiCommit = this.actions.isMultiCommit(shas);

		// Activation guards — only apply when entering a mode.
		if (mode === 'compose' && !isWip) return;
		if (mode === 'compare' && !isWip && !state.commit.get() && !state.commitTo.get()) return;

		// Deactivate other mode if active.
		if (state.activeMode.get() != null) {
			this.exitMode(selection);
		}

		// Initialize mode-specific state.
		if (mode === 'review' || mode === 'compose') {
			const scope = this.buildDefaultScope(sha, isWip, isMultiCommit);
			if (scope) {
				state.scope.set(scope);
				resources.scopeFiles.cancel();
				if (repoPath) {
					void resources.scopeFiles.fetch(repoPath, scope);
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
					this._reviewFetchedForSelection = undefined;
				} else {
					resources.review.cancel();
				}
			} else {
				const composeHasValue = resources.compose.value.get() != null;
				if (composeHasValue && this._composeFetchedForSelection !== newKey) {
					resources.compose.reset();
					this.compose.invalidateSnapshot();
					this._composeFetchedForSelection = undefined;
				} else {
					resources.compose.cancel();
				}
			}
			state.aiExcludedFiles.set(undefined);
			void this.actions.fetchAiExcludedFiles(repoPath, sha, shas);
		}

		if (mode === 'compare') {
			// Determine left ref based on context. Order matters: check the active selection
			// shape (isWip / isMultiCommit) BEFORE falling back to lingering single-commit state,
			// otherwise multi-commit pivot picks up a stale `commit` from a prior selection.
			const wip = state.wip.get();
			const commitTo = state.commitTo.get();
			const commitFrom = state.commitFrom.get();
			const commit = state.commit.get();
			let leftRef: string | undefined;
			let leftRefType: 'branch' | 'commit' | undefined;
			let rightRef: string | undefined;
			let rightRefType: 'branch' | 'commit' | undefined;
			if (isWip) {
				leftRef = wip?.branch?.name;
				leftRefType = 'branch';
			} else if (isMultiCommit && commitTo && commitFrom) {
				// Pivot from a multi-commit compare panel: the two sides of the existing
				// comparison become the left and right sides of the new ref-to-ref comparison.
				leftRef = commitTo.shortSha;
				leftRefType = 'commit';
				rightRef = commitFrom.shortSha;
				rightRefType = 'commit';
			} else if (commit) {
				// Use the branch name if the commit is a branch tip, otherwise the SHA.
				const branchRefs = state.reachability
					.get()
					?.refs?.filter((r): r is Extract<typeof r, { refType: 'branch' }> => r.refType === 'branch');
				const currentBranch = branchRefs?.find(r => r.current) ?? branchRefs?.[0];
				if (currentBranch?.name) {
					leftRef = currentBranch.name;
					leftRefType = 'branch';
				} else {
					leftRef = commit.shortSha;
					leftRefType = 'commit';
				}
			}
			state.branchCompareLeftRef.set(leftRef);
			state.branchCompareLeftRefType.set(leftRefType);
			state.branchCompareIncludeWorkingTree.set(false);
			state.branchCompareAheadCount.set(0);
			state.branchCompareBehindCount.set(0);
			state.branchCompareAheadCommits.set([]);
			state.branchCompareBehindCommits.set([]);
			state.branchCompareAheadLoaded.set(false);
			state.branchCompareBehindLoaded.set(false);
			state.branchCompareAllFiles.set([]);
			state.branchCompareActiveTab.set('all');
			state.branchCompareSelectedCommitShaByTab.set(new Map());
			state.branchCompareActiveView.set('files');
			state.branchCompareEnrichmentRequested.set(false);
			state.branchCompareAutolinksByScope.set(new Map());
			state.branchCompareEnrichedAutolinksByScope.set(new Map());
			state.branchCompareContributorsByScope.set(new Map());
			state.branchCompareEnrichmentLoading.set(false);
			state.branchCompareContributorsLoading.set(false);

			if (compareOverrides?.rightRef) {
				state.branchCompareRightRef.set(compareOverrides.rightRef);
				state.branchCompareRightRefType.set(compareOverrides.rightRefType ?? 'branch');
				void this.actions.refreshCompare(repoPath);
			} else if (rightRef) {
				state.branchCompareRightRef.set(rightRef);
				state.branchCompareRightRefType.set(rightRefType);
				void this.actions.refreshCompare(repoPath);
			} else {
				state.branchCompareRightRef.set(undefined);
				state.branchCompareRightRefType.set(undefined);
				void this.actions.initCompareDefaults(repoPath);
			}
		}

		state.activeMode.set(mode);
		state.wipStale.set(false);
		state.activeModeContext.set(isMultiCommit ? 'multicommit' : isWip ? 'wip' : 'commit');
		state.activeModeRepoPath.set(repoPath);
		state.activeModeSha.set(sha);
		state.activeModeShas.set(shas);

		// Fetch branch commits for WIP scope picker if not already loaded.
		if (isWip && !state.branchCommits.get() && !state.branchCommitsFetching.get()) {
			void this.actions.fetchBranchCommits(state.wip.get()?.repo?.path ?? repoPath);
		}
	}

	/** Explicit exit of whatever mode is active. No-op if no mode is active. */
	exitMode(selection: DetailsSelection): void {
		const { sha, shas, repoPath, graphReachability, commitLite, commitLites } = selection;

		// Snapshot mode + selection BEFORE clearing so we can detect whether the selection
		// moved while in the mode. If it did, also reset the mode's resource so re-entering
		// the mode for the new selection starts from idle.
		const wasMode = this.actions.state.activeMode.get();
		const wasSha = this.actions.state.activeModeSha.get();
		const wasShas = this.actions.state.activeModeShas.get();

		this.actions.resources.review.cancel();
		this.actions.resources.compose.cancel();
		this.actions.state.activeMode.set(null);
		this.actions.state.activeModeContext.set(null);
		this.actions.state.activeModeRepoPath.set(undefined);
		this.actions.state.activeModeSha.set(undefined);
		this.actions.state.activeModeShas.set(undefined);
		this.actions.state.scope.set(undefined);
		this.actions.state.aiExcludedFiles.set(undefined);

		const selectionChanged = wasSha !== sha || !areEqual(wasShas, shas);
		if (selectionChanged) {
			if (wasMode === 'review') {
				this.actions.resources.review.reset();
				this.review.invalidateSnapshot();
				this._reviewFetchedForSelection = undefined;
			} else if (wasMode === 'compose') {
				this.actions.resources.compose.reset();
				this.compose.invalidateSnapshot();
				this._composeFetchedForSelection = undefined;
			}
		}

		// Re-fetch data if selection changed while mode was active. fetchDetails /
		// fetchCompareDetails early-return on a cache hit, so when selection didn't change
		// this is a no-op (avoids a visible skeleton flash while the wip/commit resource
		// reloads into data we already have). Forward the eager commit shells so a
		// selection-changed-while-in-mode exit paints metadata synchronously instead of
		// flashing blank during the IPC roundtrip.
		if (this.actions.isMultiCommit(shas)) {
			void this.actions.fetchCompareDetails(shas, repoPath, commitLites);
		} else {
			void this.actions.fetchDetails(sha, repoPath, graphReachability, { commitLite: commitLite });
		}
	}

	// endregion

	// region Review workflow

	/** Review workflow snapshot controls. Arrow-function object so `this` bindings are stable. */
	readonly review = {
		back: (): void => {
			// Snapshot a successfully-resolved value so forward() can restore it without re-running
			// the AI. Reset returns the panel to the idle file-curation view; mutate() on forward()
			// puts the value back without spending tokens.
			if (this.actions.resources.review.status.get() === 'success') {
				const value = this.actions.resources.review.value.get();
				if (value != null) {
					this._reviewBackSnapshot = value;
					this.actions.state.reviewForwardAvailable.set(true);
				}
			}
			this.actions.resources.review.reset();
		},
		forward: (): boolean => {
			const snapshot = this._reviewBackSnapshot;
			if (snapshot == null) return false;
			this.actions.resources.review.mutate(snapshot);
			// Keep the snapshot so a subsequent back → forward cycle still works; the chip is
			// driven by `reviewForwardAvailable` which the panel hides outside the idle state.
			return true;
		},
		invalidateSnapshot: (): void => {
			this._reviewBackSnapshot = undefined;
			this.actions.state.reviewForwardAvailable.set(false);
		},
	};

	runReview(
		repoPath: string | undefined,
		instructions: string | undefined,
		excludedFiles: string[] | undefined,
		selectedIds?: ReadonlySet<string>,
		scopeItems?: ScopeItem[],
	): void {
		const scope = this.actions.buildScopeFromPicker(selectedIds, scopeItems) ?? this.actions.state.scope.get();
		if (!repoPath || !scope) return;

		this.actions.state.scope.set(scope);
		this.actions.state.wipStale.set(false);
		// A fresh review run invalidates any pending Forward (we're about to overwrite the value).
		this.review.invalidateSnapshot();
		this._reviewFetchedForSelection = this.selectionKey();
		void this.actions.resources.review.fetch(repoPath, scope, instructions, excludedFiles);
	}

	// endregion

	// region Compose workflow

	readonly compose = {
		back: (): void => {
			if (this.actions.resources.compose.status.get() === 'success') {
				const value = this.actions.resources.compose.value.get();
				if (value != null) {
					this._composeBackSnapshot = value;
					this.actions.state.composeForwardAvailable.set(true);
				}
			}
			this.actions.resources.compose.reset();
		},
		forward: (): boolean => {
			const snapshot = this._composeBackSnapshot;
			if (snapshot == null) return false;
			this.actions.resources.compose.mutate(snapshot);
			return true;
		},
		invalidateSnapshot: (): void => {
			this._composeBackSnapshot = undefined;
			this.actions.state.composeForwardAvailable.set(false);
		},
	};

	runCompose(
		repoPath: string | undefined,
		instructions: string | undefined,
		excludedFiles: string[] | undefined,
		selectedIds?: ReadonlySet<string>,
		scopeItems?: ScopeItem[],
	): void {
		const scope = this.actions.buildScopeFromPicker(selectedIds, scopeItems) ?? this.actions.state.scope.get();
		if (!repoPath || !scope) return;

		this.actions.state.scope.set(scope);
		this.actions.state.wipStale.set(false);
		this.compose.invalidateSnapshot();
		this._composeFetchedForSelection = this.selectionKey();
		void this.actions.resources.compose.fetch(repoPath, scope, instructions, excludedFiles);
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

	/**
	 * Stable per-selection key used to detect when an AI resource is stale on mode re-entry.
	 * Pass explicit `sha`/`shas`/`repoPath` to key a pending-transition selection, or omit to
	 * key the currently-active mode's selection. `repoPath` is part of the key because WIP
	 * rows in different worktrees all share `sha === uncommitted` — without it, switching
	 * between WIP rows would render the prior worktree's compose/review result against the
	 * new one.
	 */
	private selectionKey(sha?: string, shas?: string[], repoPath?: string): string {
		const effectiveSha = sha ?? this.actions.state.activeModeSha.get() ?? '';
		const effectiveShas = shas ?? this.actions.state.activeModeShas.get() ?? [];
		const effectiveRepoPath = repoPath ?? this.actions.state.activeModeRepoPath.get() ?? '';
		const selectionPart = effectiveShas.length ? effectiveShas.join(',') : effectiveSha;
		return `${effectiveRepoPath}|${selectionPart}`;
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
						if (this.host.isWipSelection()) {
							const relevant = data.changes.some(
								c => c === 'gkConfig' || c === 'config' || c === 'heads',
							);
							if (relevant) {
								this.actions.refreshWipBranchEnrichment();
							}
						}

						const compareRelevant = data.changes.some(c => c === 'index' || c === 'head' || c === 'heads');
						if (compareRelevant) {
							this.actions.markBranchCompareStale();
						}
					}),
				() =>
					this.actions.services.repository.onRepositoryWorkingChanged(repoPath, () =>
						this.actions.markBranchCompareStale(),
					),
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

	// endregion
}
