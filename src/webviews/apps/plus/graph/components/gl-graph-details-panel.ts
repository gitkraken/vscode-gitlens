import type { Remote } from '@eamodio/supertalk';
import { consume, provide } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { StashApplyCommandArgs } from '../../../../../commands/stashApply.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type { GraphServices, VirtualRefShape } from '../../../../plus/graph/graphService.js';
import type { FileChangeListItemDetail } from '../../../commitDetails/components/gl-details-base.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import type { DetailsActions } from './detailsActions.js';
import { getReviewDiffEndpoints, scopeSelectionEqual } from './detailsActions.js';
import { detailsActionsContext, detailsStateContext, detailsWorkflowContext } from './detailsContext.js';
import { resolveDetailsActions } from './detailsResolver.js';
import type { DetailsContext, DetailsState } from './detailsState.js';
import { createDetailsState } from './detailsState.js';
import type { DetailsSelection } from './detailsWorkflowController.js';
import { DetailsWorkflowController } from './detailsWorkflowController.js';
import type { ReviewAnalyzeAreaDetail, ReviewOpenFileDetail } from './gl-details-review-mode-panel.js';
import '../../../commitDetails/components/gl-details-commit-panel.js';
import '../../../commitDetails/components/gl-details-wip-panel.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/progress.js';
import './gl-details-multicommit-panel.js';
import './gl-details-compose-mode-panel.js';
import './gl-details-review-mode-panel.js';
import './gl-commit-box.js';
import './gl-details-agent-status.js';
import './gl-details-compare-mode-panel.js';
import './gl-details-wip-empty-pane.js';
import './gl-details-wip-header.js';

interface ResolvedContent {
	content: ReturnType<typeof html> | typeof nothing;
	ariaLabel: string;
	context: DetailsContext;
}

@customElement('gl-graph-details-panel')
export class GlGraphDetailsPanel extends SignalWatcher(LitElement) {
	@consume({ context: graphServicesContext, subscribe: true })
	@state()
	private _remoteServices?: Remote<GraphServices>;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: typeof graphStateContext.__context__;

	@provide({ context: detailsStateContext })
	private _state: DetailsState = createDetailsState();

	@provide({ context: detailsActionsContext })
	private _actions!: DetailsActions;

	/**
	 * Workflow state machine + repo-change subscription controller. Lit ReactiveController —
	 * auto-wired into `hostConnected` / `hostDisconnected` / `hostUpdate` so subscription
	 * lifecycle follows the panel's lifecycle. See {@link DetailsWorkflowController}.
	 */
	@provide({ context: detailsWorkflowContext })
	private _workflow!: DetailsWorkflowController;

	private _servicesResolved = false;

	private _lastWorkingTreeStats?: unknown;
	private _lastBranchState?: unknown;

	@property({ attribute: 'sha' })
	sha?: string;

	@property({ type: Array })
	shas?: string[];

	@property({ attribute: 'repo-path' })
	repoPath?: string;

	@property({ type: Object })
	graphReachability?: GitCommitReachability;

	/**
	 * Commit shell (sha, message, author/committer, parents, repoPath — no files/stats) built
	 * from the graph row data. Forwarded to {@link DetailsActions.fetchDetails} so the panel can
	 * paint commit metadata synchronously on cold-cache selections, before the full fetch returns.
	 * Hydration is best-effort: cache hits and the subsequent full fetch take precedence.
	 */
	@property({ attribute: false })
	commitLite?: CommitDetails;

	/**
	 * Per-sha commit shells for multi-commit selections. Forwarded to
	 * {@link DetailsActions.fetchCompareDetails} to skip the from/to `getCommit` IPCs entirely
	 * when the lites are present.
	 */
	@property({ attribute: false })
	commitLites?: Record<string, CommitDetails>;

	private get isMultiCommit(): boolean {
		return this.shas != null && this.shas.length >= 2;
	}

	private get isWip(): boolean {
		return this.sha === uncommitted;
	}

	/** Active mode used for telemetry — combines `activeMode` (review/compose/compare) and the
	 *  effective selection context (commit/wip/multicommit). Returns `'none'` when no selection. */
	get currentMode(): 'commit' | 'wip' | 'multicommit' | 'review' | 'compose' | 'compare' | 'none' {
		const active = this._state.activeMode.get();
		if (active != null) return active;
		if (this.sha == null && (this.shas == null || this.shas.length === 0)) return 'none';
		return this.isMultiCommit ? 'multicommit' : this.isWip ? 'wip' : 'commit';
	}

	/** Returns the effective context, respecting mode lock when active. */
	private get effectiveContext(): DetailsContext {
		return (
			this._state.activeModeContext.get() ?? (this.isMultiCommit ? 'multicommit' : this.isWip ? 'wip' : 'commit')
		);
	}

	private get effectiveRepoPath(): string | undefined {
		return this._state.activeModeRepoPath.get() ?? this._state.wip.get()?.repo?.path ?? this.repoPath;
	}

	/** Returns snapshotted shas when in a mode, live shas otherwise. */
	private get effectiveShas(): string[] | undefined {
		return this._state.activeModeShas.get() ?? this.shas;
	}

	/** Public so the workflow controller can snapshot the selection when forcing a mode
	 *  exit on repo change. Implements `DetailsWorkflowHost.currentSelection`. */
	currentSelection(): DetailsSelection {
		return {
			sha: this.sha,
			shas: this.shas,
			repoPath: this.repoPath,
			graphReachability: this.graphReachability,
			commitLite: this.commitLite,
			commitLites: this.commitLites,
		};
	}

	/** The graph's currently-selected repository's path — the user-perceived "which repo
	 *  am I looking at" context. Updates immediately on repo-selector switches, before any
	 *  selection event lands. Implements `DetailsWorkflowHost.graphRepoPath`. */
	graphRepoPath(): string | undefined {
		const repoId = this._graphState?.selectedRepository;
		const repos = this._graphState?.repositories;
		if (repoId != null) {
			const found = repos?.find(r => r.id === repoId)?.path;
			if (found != null) return found;
		}
		return repos?.[0]?.path;
	}

	/** Shared `@toggle-mode` handler — every sub-panel's toggle-mode wires to this. */
	private handleToggleMode = (e: CustomEvent<{ mode: 'review' | 'compose' | 'compare' }>): void => {
		this.suppressContentOverflow();
		this._workflow.toggleMode(e.detail.mode, this.currentSelection());
	};

	/** Shared handler for `compose-cancel` / `review-cancel` — exits the active mode. */
	private handleCancelMode = (): void => {
		this.suppressContentOverflow();
		this._workflow.exitMode(this.currentSelection());
	};

	/** External entry point — invoked when the extension requests entering compare mode with
	 *  explicit left/right refs (e.g. from a sidebar tree compare action). The current graph
	 *  selection is left untouched; both sides of the comparison are driven by the supplied
	 *  overrides. */
	openCompareMode(params: {
		repoPath: string;
		leftRef: string;
		leftRefType?: 'branch' | 'tag' | 'commit';
		rightRef: string;
		rightRefType?: 'branch' | 'tag' | 'commit';
		includeWorkingTree?: boolean;
	}): void {
		this.suppressContentOverflow();
		const selection: DetailsSelection = {
			...this.currentSelection(),
			repoPath: params.repoPath,
		};
		this._workflow.toggleMode('compare', selection, {
			leftRef: params.leftRef,
			leftRefType: params.leftRefType,
			rightRef: params.rightRef,
			rightRefType: params.rightRefType,
			includeWorkingTree: params.includeWorkingTree,
		});
	}

	private get isLoading(): boolean {
		if (!this._actions) {
			return this.sha != null || (this.shas != null && this.shas.length > 0);
		}
		const r = this._actions.resources;
		return r.commit.loading.get() || r.wip.loading.get() || r.compare.loading.get();
	}

	override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('switch-model', this.handleSwitchModel);
	}

	private handleSwitchModel = (): void => {
		this._actions?.switchAIModel();
	};

	private readonly _contextMenuProxy = new ContextMenuProxyController(this);

	private suppressContentOverflow(): void {
		const el = this.querySelector<HTMLElement>('.details-content');
		if (el) {
			el.style.overflow = 'hidden';
			// Match the sub-panel-enter animation duration (0.2s)
			setTimeout(() => (el.style.overflow = ''), 250);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.removeEventListener('switch-model', this.handleSwitchModel);
		// Repo-change subscription teardown is handled by DetailsWorkflowController via its
		// `hostDisconnected` hook — no manual cleanup needed here.
		this._state.resetAll();
		this._actions?.dispose();
	}

	/** Exposed for {@link DetailsWorkflowController}'s subscription filter. */
	isWipSelection(): boolean {
		return this.isWip;
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		// Start selection-driven fetches BEFORE render so the resource's `loading` signal is
		// already true by the time `render()` evaluates `isLoading`. Without this, the render
		// right after `sha` changes sees loading=false, commit=null, and would fall through
		// to the "return nothing" branch — a blank frame between the prop change and the
		// signal-driven re-render. Mode-active transitions skip the fetch (user stays in
		// their current mode's resource).
		if (
			this._servicesResolved &&
			this._actions != null &&
			this._state.activeMode.get() == null &&
			(changedProperties.has('sha') || changedProperties.has('shas') || changedProperties.has('repoPath'))
		) {
			if (this.isMultiCommit) {
				void this._actions.fetchCompareDetails(this.shas, this.repoPath, this.commitLites);
			} else {
				// Only ask the host for search-context when the graph actually has search results —
				// the host returns undefined when there's no active search, so the IPC is wasted in
				// the common no-search case.
				const searchActive = this._graphState?.searchResults != null;
				void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability, {
					searchActive: searchActive,
					commitLite: this.commitLite,
				});
			}
		}

		if (this._graphState != null) {
			const wts = this._graphState.workingTreeStats;
			const bs = this._graphState.branchState;
			const wtsChanged = wts !== this._lastWorkingTreeStats;
			const bsChanged =
				bs !== this._lastBranchState &&
				!branchStateEqual(bs, this._lastBranchState as BranchStateLike | undefined);
			if (wtsChanged || bsChanged) {
				this._lastWorkingTreeStats = wts;
				this._lastBranchState = bs;
				if (this.isWip) {
					const repoPath = this.effectiveRepoPath;
					if (repoPath != null) {
						void this._actions?.refetchWipQuiet(repoPath);
					}
					if (this._state.activeMode.get() != null) {
						void this._actions?.fetchBranchCommits(this.effectiveRepoPath);
					}
				}
			}
		}

		// Resolve content for this render cycle here (not in render) so render stays free of
		// `this` assignments. willUpdate runs synchronously immediately before render, so the
		// cached value is always fresh by the time render reads it.
		const current = this._actions != null ? this.resolveContent() : undefined;
		this._resolvedThisCycle = current;
		if (current != null) {
			this._lastResolved = current;
		}
	}

	override updated(changedProperties: Map<string, unknown>): void {
		if (changedProperties.has('_remoteServices') && this._remoteServices != null && !this._servicesResolved) {
			this._servicesResolved = true;
			void this.resolveServices(this._remoteServices);
		}

		if (changedProperties.has('sha') || changedProperties.has('shas') || changedProperties.has('repoPath')) {
			if (changedProperties.has('shas') && this._state.activeMode.get() == null) {
				this._state.swapped.set(false);
			}

			// Selection moved — invalidate the Forward chip snapshots so we never restore an
			// AI result captured for a different commit/WIP after the user navigates elsewhere.
			// Skip while a mode is active: the details pane is scope-locked to the entry-time
			// selection, so external graph navigation must not mutate mode-owned state.
			if (this._workflow && this._state.activeMode.get() == null) {
				this._workflow.review.invalidateSnapshot();
				this._workflow.compose.invalidateSnapshot();

				// `changedProperties.get(k)` returns the previous value only when `k` actually
				// changed; otherwise fall back to the current value (the prior selection had
				// the same value, by definition).
				const prevSha = changedProperties.has('sha')
					? (changedProperties.get('sha') as string | undefined)
					: this.sha;
				const prevWasWip = prevSha === uncommitted;
				const repoChanged =
					changedProperties.has('repoPath') && changedProperties.get('repoPath') !== this.repoPath;

				if (repoChanged) {
					// Repo identity changed (worktree switch, repo swap, etc.). Commit-form
					// state is per-repo — it was authored against the prior repo's HEAD and
					// would be wrong for the new repo. Wipe everything so the new repo's WIP
					// (whether reached now or later) starts fresh. The form isn't visible
					// during this transition, so clearing is invisible to the user.
					this._state.amend.set(false);
					this._state.amendBaseSha.set(undefined);
					this._state.commitMessage.set('');
					this._state.commitMessageDirty.set(false);
					this._state.commitError.set(undefined);
					this._state.generating.set(false);
				} else if (prevWasWip && !this.isWip) {
					// Leaving WIP within the same repo (clicking a commit to inspect): clear
					// only per-attempt status. amend stays put — the HEAD-move check below
					// validates it on return. commitMessage stays put — preserve the user's
					// typing across brief round-trips.
					this._state.commitError.set(undefined);
					this._state.generating.set(false);
				}
			}

			// Data fetches for sha/shas/repoPath changes happen in willUpdate so loading=true
			// is observable during render (avoids a blank frame between prop change and the
			// signal-driven re-render). Repo-change subscription re-wires via the controller's
			// hostUpdate hook.
		}

		// Auto-clear amend if its basis HEAD has moved (external commit, pull, fetch, etc.).
		// amend is bound to a specific commit identity; if that commit is no longer the tip,
		// silently amending the new HEAD would surprise the user. Cheap signal reads on
		// no-amend renders — guard early.
		if (this._state.amend.get()) {
			const base = this._state.amendBaseSha.get();
			const head = this._state.wip.get()?.branch?.reference?.sha;
			if (base != null && head != null && base !== head) {
				this._state.amend.set(false);
				this._state.amendBaseSha.set(undefined);
				// If the message is an auto-loaded snapshot of the OLD HEAD's message, it's
				// now stale data — clear it so the user doesn't accidentally commit it as a
				// new commit (the manual uncheck path also clears for the same reason). If
				// the user has typed or AI-generated, preserve their work.
				if (!this._state.commitMessageDirty.get()) {
					this._state.commitMessage.set('');
				}
			}
		}
	}

	private async resolveServices(services: Remote<GraphServices>): Promise<void> {
		// Service resolution + resource wiring lives in `detailsResolver.ts` — this element
		// stays focused on lifecycle and render routing.
		this._actions = await resolveDetailsActions(services, this._state);
		// Instantiating the controller auto-attaches it via `host.addController(this)`; Lit
		// fires `hostConnected` immediately (since we're already connected), which sets up
		// the repo-change subscription without an extra call here.
		this._workflow = new DetailsWorkflowController(this, this._actions);

		// Fetch capabilities in parallel
		void this._actions.fetchCapabilities();
		if (this.isMultiCommit) {
			void this._actions.fetchCompareDetails(this.shas, this.repoPath, this.commitLites);
		} else {
			// Mirror the willUpdate path: only fire searchContext IPC when the graph has live
			// search results. Without this, a panel that resolves services while search is active
			// would skip getSearchContext for the initial selection until the user changes shas.
			const searchActive = this._graphState?.searchResults != null;
			void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability, {
				searchActive: searchActive,
				commitLite: this.commitLite,
			});
		}

		// If we're in a mode that needs branch commits and they haven't loaded yet, fetch now
		if (
			this.isWip &&
			this._state.activeMode.get() != null &&
			!this._state.branchCommits.get() &&
			!this._state.branchCommitsFetching.get()
		) {
			void this._actions.fetchBranchCommits(this.effectiveRepoPath);
		}
	}

	private _lastResolved: ResolvedContent | undefined;
	private _resolvedThisCycle: ResolvedContent | undefined;

	private resolveByContext(ctx: DetailsContext): ResolvedContent {
		switch (ctx) {
			case 'multicommit':
				return {
					ariaLabel: 'Multiple commits selected',
					content: this.renderMultiCommit(),
					context: 'multicommit',
				};
			case 'wip':
				return { ariaLabel: 'Working changes details', content: this.renderWip(), context: 'wip' };
			case 'commit':
				return { ariaLabel: 'Commit details', content: this.renderCommit(), context: 'commit' };
		}
	}

	private resolveContent(): ResolvedContent | undefined {
		// When in a mode, lock rendering to the context that was active when the mode was entered.
		const ctx = this._state.activeModeContext.get();
		if (ctx != null) return this.resolveByContext(ctx);

		if (this.isMultiCommit && this._state.commitFrom.get() != null && this._state.commitTo.get() != null) {
			return this.resolveByContext('multicommit');
		}
		if (this.isWip && this._state.wip.get() != null) return this.resolveByContext('wip');
		if (this._state.commit.get() != null) return this.resolveByContext('commit');
		return undefined;
	}

	override render() {
		const current = this._resolvedThisCycle;
		// Preserve the last-rendered content while a fetch is in flight so we don't flash to
		// a skeleton on transient signal clears (e.g. sha → uncommittedSha swap). Only reuse
		// the cache when the effective context matches — otherwise we'd show stale wip content
		// while the user navigated to a commit (or vice versa).
		const resolved =
			current ??
			(this.isLoading && this._lastResolved?.context === this.effectiveContext ? this._lastResolved : undefined);

		if (resolved == null && !this.isLoading) return nothing;

		// "Stale" covers both: cached content shown while loading, and current content shown while
		// a background refresh is running.
		const stale = resolved != null && (this.isLoading || current == null);
		return html`<div
			role="region"
			aria-label=${resolved?.ariaLabel ?? 'Commit details'}
			aria-busy=${resolved == null || stale}
			aria-live="polite"
			class=${stale ? 'details-content details-stale' : 'details-content'}
		>
			${resolved != null
				? resolved.content
				: html`<div class="details-skeleton">
						<div class="details-skeleton__header">
							<div class="details-skeleton__avatar"></div>
							<div class="details-skeleton__lines">
								<div class="details-skeleton__line" style="width: 60%"></div>
								<div
									class="details-skeleton__line details-skeleton__line--short"
									style="width: 40%"
								></div>
							</div>
						</div>
						<div class="details-skeleton__bar"></div>
						<div class="details-skeleton__body">
							<div class="details-skeleton__line" style="width: 90%"></div>
							<div class="details-skeleton__line" style="width: 70%"></div>
							<div class="details-skeleton__line details-skeleton__line--short" style="width: 50%"></div>
						</div>
					</div>`}
		</div>`;
	}

	private renderWip() {
		const wip = this._state.wip.get();
		if (!wip) return nothing;

		const branchName = wip.branch?.name ?? 'unknown';
		const activeMode = this._state.activeMode.get();
		const hasChanges = (wip.changes?.files?.length ?? 0) > 0;
		const branchAgentSessions = this.getBranchAgentSessions(wip.repo?.path, wip.branch?.name);

		return html`
			<gl-details-wip-header
				.wip=${wip}
				.activeMode=${activeMode}
				.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
				.experimentalFeaturesEnabled=${this._graphState?.config?.experimentalFeaturesEnabled === true}
				.loading=${this.isLoading}
				.autolinks=${this._state.wipAutolinks.get()}
				.issues=${this._state.wipIssues.get()}
				.mergeTargetStatus=${this._state.wipMergeTarget.get()}
				.mergeTargetStatusLoading=${this._state.wipMergeTargetLoading.get()}
				@toggle-mode=${this.handleToggleMode}
				@refresh-wip=${this.handleRefreshWip}
				@switch-branch=${this.handleSwitchBranch}
				@create-branch=${this.handleCreateBranch}
				@compare-with-merge-target=${this.handleCompareWithMergeTarget}
				@publish-branch=${this.handlePublishBranch}
				@pull=${this.handlePull}
				@push=${this.handlePush}
				@fetch=${this.handleFetch}
				@remove-associated-issue=${this.handleRemoveAssociatedIssue}
			></gl-details-wip-header>
			${branchAgentSessions != null && activeMode == null
				? html`<gl-details-agent-status .sessions=${branchAgentSessions}></gl-details-agent-status>`
				: nothing}
			${activeMode === 'review'
				? this.renderReviewMode()
				: activeMode === 'compose'
					? this.renderComposeMode()
					: activeMode === 'compare'
						? this.renderCompareMode()
						: hasChanges
							? html`
									<div class="commit-panel__files">
										<gl-details-wip-panel
											variant="embedded"
											file-icons
											checkbox-mode
											?bulk-conflict-actions=${wip.changes?.pausedOpStatus?.type === 'rebase'}
											.wip=${wip}
											.files=${wip.changes?.files}
											.preferences=${this._state.preferences.get()}
											.orgSettings=${this._state.orgSettings.get()}
											.isUncommitted=${true}
											.filesCollapsable=${false}
											@file-open=${this.handleFileOpen}
											@file-compare-working=${this.handleFileCompareWorking}
											@file-compare-previous=${this.handleFileComparePrevious}
											@file-open-current=${this.handleFileOpenConflictCurrent}
											@file-open-incoming=${this.handleFileOpenConflictIncoming}
											@file-more-actions=${this.handleFileMoreActions}
											@file-stage=${this.handleFileStage}
											@file-unstage=${this.handleFileUnstage}
											@stage-all=${this.handleStageAll}
											@unstage-all=${this.handleUnstageAll}
											@stash-save=${this.handleStashSave}
											@resolve-all-current=${this.handleResolveAllCurrent}
											@resolve-all-incoming=${this.handleResolveAllIncoming}
											@change-files-layout=${this.handleChangeFilesLayout}
											@open-multiple-changes=${this.handleOpenMultipleChanges}
										></gl-details-wip-panel>
									</div>
									<gl-commit-box
										.message=${this._state.commitMessage.get()}
										.amend=${this._state.amend.get()}
										.generating=${this._state.generating.get()}
										.branchName=${branchName}
										.canCommit=${this._actions.canCommit()}
										.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
										.experimentalFeaturesEnabled=${this._graphState?.config
											?.experimentalFeaturesEnabled === true}
										.commitError=${this._state.commitError.get()}
										@message-change=${this.handleCommitMessageChange}
										@amend-change=${this.handleAmendChange}
										@commit=${this.handleCommit}
										@generate-message=${this.handleGenerateMessage}
										@compose=${this.handleCompose}
									></gl-commit-box>
								`
							: html`
									<gl-details-wip-empty-pane
										.wip=${wip}
										.aiEnabled=${false}
										@switch-branch=${this.handleSwitchBranch}
										@create-branch=${this.handleCreateBranch}
										@start-work=${this.handleStartWork}
										@apply-stash=${this.handleApplyStash}
										@new-worktree=${this.handleNewWorktree}
										@publish-branch=${this.handlePublishBranch}
										@pull=${this.handlePull}
										@push=${this.handlePush}
									></gl-details-wip-empty-pane>
								`}
		`;
	}

	private renderComposeMode() {
		const scopeItems = this._actions.buildWipScopeItems();
		const handleCompose = (e: CustomEvent<{ prompt?: string }>) => {
			// Gate the AI call behind a configured model: if the user hasn't picked one,
			// open the picker first so the click never produces a silent no-op. The user
			// re-clicks Compose after selecting — keeps the dispatch path single-shot.
			if (this._state.aiModel.get() == null) {
				this._actions.switchAIModel();
				return;
			}
			const panel = this.querySelector<import('./gl-details-compose-mode-panel.js').GlDetailsComposeModePanel>(
				'gl-details-compose-mode-panel',
			);
			const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
			this._workflow.runCompose(
				this.effectiveRepoPath,
				e.detail?.prompt,
				excludedFiles,
				panel?.selectedIds,
				scopeItems ?? undefined,
			);
		};

		const composeResource = this._actions.resources.compose;
		const composeValue = composeResource.value.get();
		const composeResult = composeValue && 'result' in composeValue ? composeValue.result : undefined;
		const composeStatus = composeResource.status.get();
		const composeError =
			composeResource.error.get() ??
			(composeValue && 'error' in composeValue ? composeValue.error.message : undefined);
		const mappedComposeStatus: 'idle' | 'loading' | 'ready' | 'error' =
			composeStatus === 'success'
				? composeResult != null
					? 'ready'
					: composeError != null
						? 'error'
						: 'idle'
				: composeStatus;

		const scopeFilesValue = this._actions.resources.scopeFiles.value.get();
		const fallbackFiles = this._state.wip.get()?.changes?.files;
		const composeFiles = scopeFilesValue ?? fallbackFiles;

		return html`<gl-details-compose-mode-panel
			.status=${mappedComposeStatus}
			.commits=${composeResult?.commits}
			.baseCommit=${composeResult?.baseCommit}
			.errorMessage=${composeError}
			.repoPath=${this.effectiveRepoPath}
			.stale=${this._state.wipStale.get()}
			.scope=${this._state.scope.get()}
			.scopeItems=${scopeItems}
			.scopeLoading=${this._state.branchCommitsFetching.get()}
			.files=${composeFiles}
			.aiExcludedFiles=${this._state.aiExcludedFiles.get()}
			.fileLayout=${this._state.preferences.get()?.files?.layout ?? 'auto'}
			.aiModel=${this._state.aiModel.get()}
			?forward-available=${this._state.composeForwardAvailable.get()}
			@compose-generate=${handleCompose}
			@compose-refine=${handleCompose}
			@compose-back=${() => this._workflow.compose.back()}
			@compose-forward=${() => this._workflow.compose.forward()}
			@compose-forward-invalidate=${() => this._workflow.compose.invalidateSnapshot()}
			@compose-cancel=${this.handleCancelMode}
			@compose-commit-all=${() =>
				void this._actions.composeCommitAll(this.effectiveRepoPath, this.sha, this.graphReachability)}
			@compose-commit-to=${(e: CustomEvent<{ upToIndex: number }>) =>
				void this._actions.composeCommitTo(
					this.effectiveRepoPath,
					e.detail.upToIndex,
					this.sha,
					this.graphReachability,
				)}
			@compose-open-composer=${() => this._actions.openComposer(this.effectiveRepoPath)}
			@compose-open-multi-diff=${this.handleComposeOpenMultiDiff}
			@scope-change=${(e: CustomEvent<{ selectedIds: string[] }>) =>
				this.handleScopeChange(scopeItems, new Set(e.detail.selectedIds))}
			@load-more=${() => void this._actions.loadMoreBranchCommits(this.effectiveRepoPath)}
			@file-open=${this.handleComposeFileOpen}
			@file-compare-previous=${this.handleComposeFileComparePrevious}
			@file-stage=${this.handleFileStage}
			@file-unstage=${this.handleFileUnstage}
			@change-files-layout=${this.handleChangeFilesLayout}
		></gl-details-compose-mode-panel>`;
	}

	private renderCompareMode() {
		const branch = this._state.wip.get()?.branch;
		const repoPath = this.effectiveRepoPath;
		// The left ref has a worktree if it matches the current branch (which is always in a worktree)
		const hasWorktree = this._state.branchCompareLeftRef.get() === branch?.name;
		const activeTab = this._state.branchCompareActiveTab.get();
		const allFiles = this._state.branchCompareAllFiles.get() ?? [];
		const leftRef = this._state.branchCompareLeftRef.get();

		const autolinksByScope = this._state.branchCompareAutolinksByScope.get();
		const enrichedByScope = this._state.branchCompareEnrichedAutolinksByScope.get();
		const contributorsByScope = this._state.branchCompareContributorsByScope.get();
		const activeView = this._state.branchCompareActiveView.get();

		return html`<gl-details-compare-mode-panel
			.branchName=${branch?.name}
			.repoPath=${repoPath}
			.preferences=${this._state.preferences.get()}
			.leftRef=${leftRef}
			.leftRefType=${this._state.branchCompareLeftRefType.get()}
			.rightRef=${this._state.branchCompareRightRef.get()}
			.rightRefType=${this._state.branchCompareRightRefType.get()}
			.includeWorkingTree=${this._state.branchCompareIncludeWorkingTree.get()}
			.stale=${this._state.branchCompareStale.get()}
			.hasWorktree=${hasWorktree}
			.aheadCount=${this._state.branchCompareAheadCount.get()}
			.behindCount=${this._state.branchCompareBehindCount.get()}
			.allFilesCount=${this._state.branchCompareAllFilesCount.get()}
			.aheadCommits=${this._state.branchCompareAheadCommits.get()}
			.behindCommits=${this._state.branchCompareBehindCommits.get()}
			.aheadFiles=${this._state.branchCompareAheadFiles.get()}
			.behindFiles=${this._state.branchCompareBehindFiles.get()}
			.aheadLoaded=${this._state.branchCompareAheadLoaded.get()}
			.behindLoaded=${this._state.branchCompareBehindLoaded.get()}
			.allFiles=${allFiles}
			.loading=${this._actions.resources.branchCompareSummary.loading.get() ||
			this._actions.resources.branchCompareSide.loading.get()}
			.errorMessage=${this._actions.resources.branchCompareSummary.error.get() ??
			this._actions.resources.branchCompareSide.error.get()}
			.activeTab=${activeTab}
			.selectedCommitSha=${this._state.branchCompareSelectedCommitSha.get()}
			.activeView=${activeView}
			.autolinks=${autolinksByScope.get(activeTab) ?? []}
			.enrichedItems=${enrichedByScope.get(activeTab) ?? []}
			.contributors=${contributorsByScope.get(activeTab) ?? []}
			.contributorsLoading=${this._state.branchCompareContributorsLoading.get().get(activeTab) ?? false}
			.enrichmentLoading=${this._state.branchCompareEnrichmentLoading.get().get(activeTab) ?? false}
			.commitFilesLoadingByShas=${this._state.branchCompareCommitFilesLoading.get()}
			.enrichmentRequested=${this._state.branchCompareEnrichmentRequested.get()}
			.autolinksEnabled=${this._state.autolinksEnabled.get()}
			.hasIntegrationsConnected=${this._state.hasIntegrationsConnected.get()}
			.hasAccount=${this._state.hasAccount.get()}
			@file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFile(e.detail, this.compareFileRef(leftRef))}
			@file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileComparePrevious(e.detail, this.compareFileRef(leftRef))}
			@file-compare-working=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileCompareWorking(e.detail, this.compareFileRef(leftRef))}
			@file-more-actions=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.executeFileAction(e.detail, this.compareFileRef(leftRef))}
			@change-files-layout=${this.handleChangeFilesLayout}
			@change-ref=${(e: CustomEvent<{ side: 'left' | 'right' }>) =>
				void this._actions.changeCompareRef(e.detail.side, repoPath)}
			@swap-refs=${() => this._actions.swapCompareRefs(repoPath)}
			@open-in-search-and-compare=${() => this._actions.openCompareInSearchAndCompare(repoPath)}
			@toggle-working-tree=${() => this._actions.toggleCompareWorkingTree(repoPath)}
			@refresh-compare=${() => this._actions.refreshBranchCompare(repoPath)}
			@switch-tab=${(e: CustomEvent<{ tab: 'all' | 'ahead' | 'behind' }>) =>
				this._actions.switchCompareTab(e.detail.tab, repoPath)}
			@scope-to-commit=${(e: CustomEvent<{ sha: string | undefined }>) =>
				this._actions.selectCompareCommit(e.detail.sha, repoPath)}
			@switch-view=${(e: CustomEvent<{ view: 'files' | 'contributors' }>) =>
				this._actions.setBranchCompareActiveView(e.detail.view, repoPath)}
			@request-enrichment=${() => this._actions.requestBranchCompareEnrichment(repoPath)}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
		></gl-details-compare-mode-panel>`;
	}

	/** When the user has scoped the compare file list to a single commit, file actions should
	 *  resolve against THAT commit (so "previous" means commit~1, not the comparison's other side).
	 *  Otherwise fall through to the comparison's left ref (branch-vs-branch semantics). */
	private compareFileRef(leftRef: string | undefined): string | undefined {
		const selected = this._state.branchCompareSelectedCommitSha.get();
		return selected ?? leftRef;
	}

	/**
	 * Filter the graph-state's agent sessions to those tied to the given branch within the given
	 * repo path. Mirrors the matcher used by `gl-graph-overview` so the details-panel agent display
	 * sees the same set of sessions the overview card does.
	 */
	private getBranchAgentSessions(
		repoPath: string | undefined,
		branchName: string | undefined,
	): AgentSessionState[] | undefined {
		if (repoPath == null || branchName == null) return undefined;
		const all = this._graphState?.agentSessions;
		if (all == null || all.length === 0) return undefined;

		const matches = all.filter(s => s.workspacePath === repoPath && s.branch === branchName);
		return matches.length > 0 ? matches : undefined;
	}

	private get commitBranchRef(): { name: string; remote: boolean } | undefined {
		const reachability = this._state.reachability.get();
		if (reachability?.refs?.length) {
			const branches = reachability.refs.filter(
				(r): r is Extract<typeof r, { refType: 'branch' }> => r.refType === 'branch',
			);
			const current = branches.find(r => r.current);
			if (current) return { name: current.name, remote: current.remote };
			if (branches.length > 0) return { name: branches[0].name, remote: branches[0].remote };
		}
		return undefined;
	}

	private renderCommit() {
		const commit = this._state.commit.get();
		if (!commit) return nothing;

		const activeMode = this._state.activeMode.get();
		const subPanelContent =
			activeMode === 'review'
				? this.renderReviewMode()
				: activeMode === 'compare'
					? this.renderCompareMode()
					: nothing;

		return html`<gl-details-commit-panel
			variant="embedded"
			file-icons
			compare-enabled
			.commit=${commit}
			.loading=${this.isLoading}
			.files=${commit.files}
			.preferences=${this._state.preferences.get()}
			.orgSettings=${this._state.orgSettings.get()}
			.searchContext=${this._state.searchContext.get()}
			.isUncommitted=${commit.sha === uncommitted}
			.filesCollapsable=${false}
			.autolinksEnabled=${this._state.autolinksEnabled.get()}
			.autolinks=${this._state.autolinks.get()}
			.formattedMessage=${this._state.formattedMessage.get()}
			.autolinkedIssues=${this._state.autolinkedIssues.get()}
			.pullRequest=${this._state.pullRequest.get()}
			.signature=${this._state.signature.get()}
			.hasAccount=${this._state.hasAccount.get()}
			.hasIntegrationsConnected=${this._state.hasIntegrationsConnected.get()}
			.hasRemotes=${this._state.hasRemotes.get()}
			.explain=${this._state.explain.get()}
			.reachability=${this._state.reachability.get()}
			.reachabilityState=${this._state.reachabilityState.get()}
			.branchName=${commit.stashOnRef ?? this.commitBranchRef?.name}
			.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
			.experimentalFeaturesEnabled=${this._graphState?.config?.experimentalFeaturesEnabled === true}
			.activeMode=${activeMode}
			.subPanelContent=${subPanelContent}
			@file-open=${this.handleFileOpen}
			@file-open-on-remote=${this.handleFileOpenOnRemote}
			@file-compare-working=${this.handleFileCompareWorking}
			@file-compare-previous=${this.handleFileComparePrevious}
			@file-more-actions=${this.handleFileMoreActions}
			@explain-commit=${(e: CustomEvent<{ prompt?: string }>) =>
				void this._actions.explainCommit(e.detail?.prompt)}
			@load-reachability=${() => void this._actions.loadReachability()}
			@refresh-reachability=${() => this._actions.refreshReachability()}
			@open-on-remote=${(e: CustomEvent<{ sha: string }>) =>
				this._actions.openOnRemote(commit.repoPath ?? this.repoPath, e.detail.sha)}
			@gl-stash-apply=${(e: CustomEvent<StashApplyCommandArgs>) =>
				void this._actions.services.commands.execute('gitlens.stashesApply', e.detail)}
			@change-files-layout=${this.handleChangeFilesLayout}
			@toggle-mode=${this.handleToggleMode}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
		></gl-details-commit-panel>`;
	}

	private renderMultiCommit() {
		const activeMode = this._state.activeMode.get();
		const subPanelContent =
			activeMode === 'review'
				? this.renderReviewMode()
				: activeMode === 'compare'
					? this.renderCompareMode()
					: nothing;
		const swapped = this._state.swapped.get();
		const shas = this.effectiveShas;
		const repoPath = this.effectiveRepoPath;
		const rawBetweenCount = this._state.compareBetweenCount.get();
		const betweenCount = Math.max(0, rawBetweenCount != null ? rawBetweenCount - 1 : (shas?.length ?? 0) - 2);

		return html`<gl-details-multicommit-panel
			variant="embedded"
			file-icons
			.commitFrom=${this._state.commitFrom.get()}
			.commitTo=${this._state.commitTo.get()}
			.files=${this._state.compareFiles.get()}
			.stats=${this._state.compareStats.get()}
			.preferences=${this._state.preferences.get()}
			.orgSettings=${this._state.orgSettings.get()}
			.autolinks=${this._state.compareAutolinks.get()}
			.autolinksLoading=${this._state.compareAutolinksLoading.get()}
			.autolinksEnabled=${this._state.autolinksEnabled.get()}
			.hasAccount=${this._state.hasAccount.get()}
			.hasIntegrationsConnected=${this._state.hasIntegrationsConnected.get()}
			.signatureFrom=${this._state.signatureFrom.get()}
			.signatureTo=${this._state.signatureTo.get()}
			.enrichedItems=${this._state.compareEnrichedItems.get()}
			.enrichmentLoading=${this._state.compareEnrichmentLoading.get()}
			.loading=${this.isLoading}
			.swapped=${swapped}
			.betweenCount=${betweenCount}
			.explainBusy=${this._state.compareExplainBusy.get()}
			.filesCollapsable=${false}
			.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
			.experimentalFeaturesEnabled=${this._graphState?.config?.experimentalFeaturesEnabled === true}
			.activeMode=${this._state.activeMode.get()}
			.subPanelContent=${subPanelContent}
			@file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFile(e.detail, this._actions.toSha(shas, swapped))}
			@file-compare-between=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileCompareBetween(
					e.detail,
					this._actions.fromSha(shas, swapped),
					this._actions.toSha(shas, swapped),
				)}
			@file-compare-working=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileCompareWorking(e.detail, this._actions.toSha(shas, swapped))}
			@file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileComparePrevious(e.detail, this._actions.fromSha(shas, swapped))}
			@file-more-actions=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.executeFileAction(e.detail, this._actions.toSha(shas, swapped))}
			@swap-selection=${() => this._actions.swap(shas)}
			@gl-explain=${(e: CustomEvent<{ prompt?: string }>) =>
				this._actions.compareExplain(shas, repoPath, e.detail?.prompt)}
			@enrich-autolinks=${() => {
				const fromSha = this._actions.fromSha(shas, swapped);
				const toSha = this._actions.toSha(shas, swapped);
				if (repoPath != null && fromSha != null && toSha != null) {
					void this._actions.enrichAutolinks(repoPath, fromSha, toSha);
				}
			}}
			@select-commit=${(e: CustomEvent<{ sha: string }>) => this.handleSelectCommit(e.detail.sha)}
			@change-files-layout=${this.handleChangeFilesLayout}
			@toggle-mode=${this.handleToggleMode}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
		></gl-details-multicommit-panel>`;
	}

	private renderReviewMode() {
		const ctx = this.effectiveContext;
		const scopeFilesValue = this._actions.resources.scopeFiles.value.get();
		// Fall back to the context's file list until the scoped fetch resolves (avoids flash of empty tree).
		const fallbackFiles =
			ctx === 'wip'
				? this._state.wip.get()?.changes?.files
				: ctx === 'multicommit'
					? this._state.compareFiles.get()
					: this._state.commit.get()?.files;
		const reviewFiles = scopeFilesValue ?? fallbackFiles;

		const scopeItems = this._actions.buildWipScopeItems();

		const reviewResource = this._actions.resources.review;
		const reviewValue = reviewResource.value.get();
		const reviewResult = reviewValue && 'result' in reviewValue ? reviewValue.result : undefined;
		const reviewStatus = reviewResource.status.get();
		const reviewError =
			reviewResource.error.get() ??
			(reviewValue && 'error' in reviewValue ? reviewValue.error.message : undefined);
		const mappedReviewStatus: 'idle' | 'loading' | 'ready' | 'error' =
			reviewStatus === 'success'
				? reviewResult != null
					? 'ready'
					: reviewError != null
						? 'error'
						: 'idle'
				: reviewStatus;

		return html`<gl-details-review-mode-panel
			.scope=${this._state.scope.get()}
			.result=${reviewResult}
			.status=${mappedReviewStatus}
			.errorMessage=${reviewError}
			.stale=${this._state.wipStale.get()}
			.scopeItems=${scopeItems}
			.files=${reviewFiles}
			.aiExcludedFiles=${this._state.aiExcludedFiles.get()}
			.fileLayout=${this._state.preferences.get()?.files?.layout ?? 'auto'}
			.repoPath=${this.effectiveRepoPath}
			.aiModel=${this._state.aiModel.get()}
			?forward-available=${this._state.reviewForwardAvailable.get()}
			@review-run=${(e: CustomEvent<{ prompt?: string }>) => {
				// Same model gate as compose — open the picker first when no model is set.
				if (this._state.aiModel.get() == null) {
					this._actions.switchAIModel();
					return;
				}
				const panel =
					this.querySelector<import('./gl-details-review-mode-panel.js').GlDetailsReviewModePanel>(
						'gl-details-review-mode-panel',
					);
				const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
				this._workflow.runReview(
					this.effectiveRepoPath,
					e.detail?.prompt,
					excludedFiles,
					panel?.selectedIds,
					scopeItems ?? undefined,
				);
			}}
			@review-analyze-area=${(e: CustomEvent<ReviewAnalyzeAreaDetail>) => this.handleReviewAnalyzeArea(e)}
			@review-open-file=${(e: CustomEvent<ReviewOpenFileDetail>) => {
				const endpoints = getReviewDiffEndpoints(this._state.scope.get());
				if (!endpoints) return;
				this._actions.openFileByPath(e.detail.filePath, this.effectiveRepoPath, {
					lhs: endpoints.lhs,
					rhs: endpoints.rhs,
					line: e.detail.line,
				});
			}}
			@review-back=${() => this._workflow.review.back()}
			@review-forward=${() => this._workflow.review.forward()}
			@review-forward-invalidate=${() => this._workflow.review.invalidateSnapshot()}
			@review-cancel=${this.handleCancelMode}
			@scope-change=${(e: CustomEvent<{ selectedIds: string[] }>) =>
				this.handleScopeChange(scopeItems, new Set(e.detail.selectedIds))}
			@load-more=${() => void this._actions.loadMoreBranchCommits(this.effectiveRepoPath)}
			@file-open=${this.handleReviewFileOpen}
			@file-stage=${this.handleFileStage}
			@file-unstage=${this.handleFileUnstage}
			@file-compare-working=${this.handleFileCompareWorking}
			@file-open-on-remote=${this.handleFileOpenOnRemote}
			@change-files-layout=${this.handleChangeFilesLayout}
		></gl-details-review-mode-panel>`;
	}

	private handleScopeChange(
		scopeItems: import('./gl-commits-scope-pane.js').ScopeItem[] | undefined,
		selectedIds: ReadonlySet<string> | undefined,
	): void {
		const newScope = this._actions.buildScopeFromPicker(selectedIds, scopeItems);
		if (!newScope) return;
		// Skip when the resolved selection is structurally unchanged — otherwise a benign items
		// refresh (e.g. WIP tick) triggers redundant renders and a scopeFiles re-fetch.
		if (scopeSelectionEqual(this._state.scope.get(), newScope)) return;
		this._state.scope.set(newScope);
		if (this.effectiveRepoPath) {
			void this._actions.resources.scopeFiles.fetch(this.effectiveRepoPath, newScope);
		}
	}

	private handleReviewFileOpen = (e: CustomEvent<FileChangeListItemDetail>) => {
		// Open in a diff editor matching the review's reference frame, mirroring the AI link path.
		const endpoints = getReviewDiffEndpoints(this._state.scope.get());
		if (!endpoints) return;
		this._actions.openFileByPath(e.detail.path, this.effectiveRepoPath, {
			lhs: endpoints.lhs,
			rhs: endpoints.rhs,
		});
	};

	private handleComposeFileOpen = (e: CustomEvent<FileChangeListItemDetail>) => {
		// Prefer the virtual ref attached by gl-graph-compose-panel so the file opens at the
		// *virtual* state produced by that proposed commit. Falls back to working-tree when the
		// virtual session isn't active (e.g. handler start failed).
		const virtualRef = (e.detail as FileChangeListItemDetail & { virtualRef?: VirtualRefShape }).virtualRef;
		if (virtualRef != null) {
			this._actions.openVirtualFile(e.detail, virtualRef);
			return;
		}
		this._actions.openFile(e.detail);
	};

	private handleComposeFileComparePrevious = (e: CustomEvent<FileChangeListItemDetail>) => {
		// Per-proposed-commit "compare with previous" only makes sense against the virtual chain;
		// drop the event when no virtual ref is attached rather than silently opening a non-sensical diff.
		const virtualRef = (e.detail as FileChangeListItemDetail & { virtualRef?: VirtualRefShape }).virtualRef;
		if (virtualRef == null) return;
		this._actions.openVirtualFileComparePrevious(e.detail, virtualRef);
	};

	private handleComposeOpenMultiDiff = (
		e: CustomEvent<{ virtualRef: VirtualRefShape; files: readonly FileChangeListItemDetail[] }>,
	) => {
		const { virtualRef, files } = e.detail;
		if (!files.length) return;
		this._actions.openVirtualMultipleChanges(virtualRef, files);
	};

	private async handleReviewAnalyzeArea(e: CustomEvent<ReviewAnalyzeAreaDetail>): Promise<void> {
		const repoPath = this.effectiveRepoPath;
		const scope = this._state.scope.get();
		const reviewValue = this._actions.resources.review.value.get();
		const reviewResult = reviewValue && 'result' in reviewValue ? reviewValue.result : undefined;
		if (!repoPath || !scope || !reviewResult) return;

		const { focusAreaId, files } = e.detail;
		const panel =
			this.querySelector<import('./gl-details-review-mode-panel.js').GlDetailsReviewModePanel>(
				'gl-details-review-mode-panel',
			);
		panel?.setFocusAreaLoading(focusAreaId);

		const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;

		try {
			const result = await this._actions.services.graphInspect.reviewFocusArea(
				repoPath,
				scope,
				focusAreaId,
				files,
				reviewResult.overview,
				undefined,
				excludedFiles,
			);

			if ('error' in result && result.error) {
				panel?.setFocusAreaError(focusAreaId);
			} else if ('result' in result && result.result) {
				const reviewResource = this._actions.resources.review;
				const current = reviewResource.value.get();
				if (current != null && 'result' in current) {
					reviewResource.mutate({
						result: {
							...current.result,
							focusAreas: current.result.focusAreas.map(area =>
								area.id === focusAreaId ? { ...area, findings: result.result.findings } : area,
							),
						},
					});
				}
				panel?.updateFocusAreaFindings(focusAreaId, result.result);
			}
		} catch {
			panel?.setFocusAreaError(focusAreaId);
		}
	}

	private handleSelectCommit(sha: string) {
		this.dispatchEvent(new CustomEvent('select-commit', { detail: { sha: sha }, bubbles: true, composed: true }));
	}

	private handleRefreshWip = () => {
		this._actions.refreshWip();
		void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability);
	};

	private handleSwitchBranch = () => this._actions.switchBranch(this.effectiveRepoPath);

	private handleCreateBranch = () => this._actions.createBranch(this.effectiveRepoPath);

	private handlePublishBranch = () => void this._actions.services.repository.push(this.effectiveRepoPath!);

	private handlePull = () => void this._actions.services.repository.pull(this.effectiveRepoPath!);

	private handlePush = () => void this._actions.services.repository.push(this.effectiveRepoPath!);

	private handleFetch = () => void this._actions.services.repository.fetch(this.effectiveRepoPath!);

	private handleRemoveAssociatedIssue = (e: CustomEvent<{ entityId: string }>) =>
		void this._actions.removeAssociatedIssue(e.detail.entityId);

	private handleStashSave = () => this._actions.stashSave(this.effectiveRepoPath);

	private handleStartWork = () => this._actions.startWork();

	private handleApplyStash = () => this._actions.applyStash(this.effectiveRepoPath);

	private handleNewWorktree = () => this._actions.createWorktree();

	private handleCompareWithMergeTarget = (
		e: CustomEvent<{ rightRef: string; rightRefType: 'branch' | 'commit' }>,
	) => {
		e.preventDefault();
		this.suppressContentOverflow();
		this._workflow.toggleMode('compare', this.currentSelection(), {
			rightRef: e.detail.rightRef,
			rightRefType: e.detail.rightRefType,
		});
	};

	private handleCommitMessageChange = (e: CustomEvent<{ value: string }>) => {
		this._state.commitMessage.set(e.detail.value);
		// User typed (or pasted): mark the message as user-authored so a HEAD-move auto-clear
		// won't drop their work. An empty value also counts as dirty — they explicitly cleared
		// the box and don't want it re-populated by the auto-load path.
		this._state.commitMessageDirty.set(true);
		this._state.commitError.set(undefined);
	};

	private handleAmendChange = (e: CustomEvent<{ checked: boolean }>) => {
		this._state.amend.set(e.detail.checked);
		if (e.detail.checked) {
			// Bind the amend intent to the HEAD it was authored against. If HEAD moves later
			// (external commit, pull, etc.), the panel auto-clears amend in `updated()` so the
			// user doesn't inadvertently amend a different commit than they had in mind.
			this._state.amendBaseSha.set(this._state.wip.get()?.branch?.reference?.sha);
			// Only auto-load HEAD's message into an empty box. If the user has already typed
			// something, skip the RPC entirely — never displace their work.
			if (this._state.commitMessage.get() === '') {
				void this._actions.loadLastCommitMessage(this.effectiveRepoPath);
			}
		} else {
			this._state.amendBaseSha.set(undefined);
			this._state.commitMessage.set('');
			this._state.commitMessageDirty.set(false);
		}
	};

	private handleCommit = () => void this._actions.commit(this.effectiveRepoPath, this.sha);

	private handleGenerateMessage = () => void this._actions.generateMessage(this.effectiveRepoPath);

	private handleCompose = () => this._workflow.toggleMode('compose', this.currentSelection());

	private handleFileOpen = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFile(e.detail, this.sha);
	};

	private handleFileOpenOnRemote = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileOnRemote(e.detail, this.sha);
	};

	private handleFileCompareWorking = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileCompareWorking(e.detail, this.sha);
	};

	private handleFileComparePrevious = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileComparePrevious(e.detail, this.sha);
	};

	private handleFileMoreActions = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.executeFileAction(e.detail, this.sha);
	};

	private handleFileOpenConflictCurrent = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openConflictChanges(e.detail, 'current');
	};

	private handleFileOpenConflictIncoming = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openConflictChanges(e.detail, 'incoming');
	};

	private handleFileStage = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.stageFile(e.detail);
	};

	private handleFileUnstage = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.unstageFile(e.detail);
	};

	private handleStageAll = () => {
		this._actions.stageAll(this.effectiveRepoPath);
	};

	private handleUnstageAll = () => {
		this._actions.unstageAll(this.effectiveRepoPath);
	};

	private handleResolveAllCurrent = () => {
		this._actions.resolveAllConflicts(this.effectiveRepoPath, 'current');
	};

	private handleResolveAllIncoming = () => {
		this._actions.resolveAllConflicts(this.effectiveRepoPath, 'incoming');
	};

	private handleChangeFilesLayout = (e: CustomEvent<{ layout: ViewFilesLayout }>) => {
		this._actions.changeFilesLayout(e.detail.layout);
	};

	private handleOpenMultipleChanges = (e: CustomEvent<OpenMultipleChangesArgs>) => {
		this._actions.openMultipleChanges(e.detail);
	};
}

interface BranchStateLike {
	ahead?: number;
	behind?: number;
	upstream?: string;
	worktree?: boolean;
}

function branchStateEqual(a: BranchStateLike | undefined, b: BranchStateLike | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	return a.ahead === b.ahead && a.behind === b.behind && a.upstream === b.upstream && a.worktree === b.worktree;
}
