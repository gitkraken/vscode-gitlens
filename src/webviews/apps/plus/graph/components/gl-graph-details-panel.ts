import type { Remote } from '@eamodio/supertalk';
import { consume, provide } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { GraphServices } from '../../../../plus/graph/graphService.js';
import type { FileChangeListItemDetail } from '../../../commitDetails/components/gl-details-base.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import type { DetailsActions } from './detailsActions.js';
import { scopeSelectionEqual } from './detailsActions.js';
import { detailsActionsContext, detailsStateContext, detailsWorkflowContext } from './detailsContext.js';
import { resolveDetailsActions } from './detailsResolver.js';
import type { DetailsState } from './detailsState.js';
import { createDetailsState } from './detailsState.js';
import { DetailsWorkflowController } from './detailsWorkflowController.js';
import type { ReviewDrillDetail, ReviewOpenFileDetail } from './gl-graph-review-panel.js';
import '../../../commitDetails/components/gl-commit-details.js';
import '../../../commitDetails/components/gl-wip-details.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/progress.js';
import './gl-graph-compare-panel.js';
import './gl-graph-compose-panel.js';
import './gl-graph-review-panel.js';
import './gl-commit-box.js';
import './gl-graph-wip-compare-panel.js';
import './gl-wip-empty-state.js';
import './gl-wip-header.js';

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

	private get isCompare(): boolean {
		return this.shas != null && this.shas.length >= 2;
	}

	private get isWip(): boolean {
		return this.sha === uncommitted;
	}

	/** Returns the effective context, respecting mode lock when active. */
	private get effectiveContext(): 'wip' | 'commit' | 'compare' {
		return this._state.activeModeContext.get() ?? (this.isCompare ? 'compare' : this.isWip ? 'wip' : 'commit');
	}

	private get effectiveRepoPath(): string | undefined {
		return this._state.activeModeRepoPath.get() ?? this._state.wip.get()?.repo?.path ?? this.repoPath;
	}

	/** Returns snapshotted shas when in a mode, live shas otherwise. */
	private get effectiveShas(): string[] | undefined {
		return this._state.activeModeShas.get() ?? this.shas;
	}

	/** The current selection passed into workflow transitions. */
	private currentSelection(): {
		sha: string | undefined;
		shas: string[] | undefined;
		repoPath: string | undefined;
		graphReachability?: import('@gitlens/git/providers/commits.js').GitCommitReachability;
	} {
		return {
			sha: this.sha,
			shas: this.shas,
			repoPath: this.repoPath,
			graphReachability: this.graphReachability,
		};
	}

	/** Shared `@toggle-mode` handler — every sub-panel's toggle-mode wires to this. */
	private handleToggleMode = (e: CustomEvent<{ mode: 'review' | 'compose' | 'compare' }>): void => {
		this.suppressContentOverflow();
		this._workflow.toggleMode(e.detail.mode, this.currentSelection());
	};

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
		this.addEventListener('contextmenu', this.handleContextMenuProxy);
		this.addEventListener('switch-model', this.handleSwitchModel);
	}

	private handleSwitchModel = (): void => {
		this._actions?.switchAIModel();
	};

	private handleContextMenuProxy = (e: MouseEvent) => {
		// The contextmenu event has crossed shadow DOM boundaries (composed: true) from the
		// originating tree-view inside one of the embedded details/review/compose panels.
		// Find the gl-tree-view that set data-vscode-context and copy it onto this host
		// element (which is in light DOM) so VS Code's injected library can read it.
		const path = e.composedPath();
		const source = path.find(
			el => el instanceof HTMLElement && el.tagName === 'GL-TREE-VIEW' && el.dataset.vscodeContext,
		) as HTMLElement | undefined;
		if (!source) return;

		this.dataset.vscodeContext = source.dataset.vscodeContext;
		setTimeout(() => {
			delete this.dataset.vscodeContext;
		}, 100);
	};

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
		this.removeEventListener('contextmenu', this.handleContextMenuProxy);
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
			if (this.isCompare) {
				void this._actions.fetchCompareDetails(this.shas, this.repoPath);
			} else {
				void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability);
			}
		}
	}

	override updated(changedProperties: Map<string, unknown>): void {
		if (changedProperties.has('_remoteServices') && this._remoteServices != null && !this._servicesResolved) {
			this._servicesResolved = true;
			void this.resolveServices(this._remoteServices);
		}

		// React to repo-relevant signal changes (working tree, branch state). WIP data refreshes
		// even during active modes so the scope picker and file list stay current. The scope
		// picker uses ID-based selection, so item list changes don't clobber the user's drag.
		//
		// We only check OBJECT IDENTITY here — the host's `notifyDidChangeWorkingTree` does the
		// authoritative dedup (including a stagedCount fingerprint so external SCM stage/unstage
		// fires through). A value-based equality check at this layer would silently drop those
		// staging-only notifications because added/deleted/modified totals don't change when a
		// file moves between staged and unstaged.
		if (this._graphState != null) {
			const wts = this._graphState.workingTreeStats;
			const bs = this._graphState.branchState;
			const wtsChanged = wts !== this._lastWorkingTreeStats;
			const bsChanged =
				bs !== this._lastBranchState &&
				!branchStateEqual(
					bs as BranchStateLike | undefined,
					this._lastBranchState as BranchStateLike | undefined,
				);
			if (wtsChanged || bsChanged) {
				this._lastWorkingTreeStats = wts;
				this._lastBranchState = bs;
				if (this.isWip) {
					// Quiet refresh: replace the WIP file list without clearing enrichment, so
					// the merge-target badge / autolinks / issues don't flicker through empty.
					const repoPath = this.effectiveRepoPath;
					if (repoPath != null) {
						void this._actions?.refetchWipQuiet(repoPath);
					}
					// Also refresh branch commits when in a mode that shows the scope picker
					if (this._state.activeMode.get() != null) {
						void this._actions?.fetchBranchCommits(this.effectiveRepoPath);
					}
				}
			}
		}

		if (changedProperties.has('sha') || changedProperties.has('shas') || changedProperties.has('repoPath')) {
			if (changedProperties.has('shas') && this._state.activeMode.get() == null) {
				this._state.swapped.set(false);
			}

			// Selection moved — invalidate the Forward chip snapshots so we never restore an
			// AI result captured for a different commit/WIP after the user navigates elsewhere.
			if (this._workflow) {
				this._workflow.review.invalidateSnapshot();
				this._workflow.compose.invalidateSnapshot();
			}

			// Data fetches for sha/shas/repoPath changes happen in willUpdate so loading=true
			// is observable during render (avoids a blank frame between prop change and the
			// signal-driven re-render). Repo-change subscription re-wires via the controller's
			// hostUpdate hook.
		}

		// Cache the currently-resolved content so the next render can reuse it during a
		// transient data clear (prevents the skeleton from flashing while a fetch is in flight).
		const current = this.resolveContent();
		if (current != null) {
			this._lastResolved = current;
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
		if (this.isCompare) {
			void this._actions.fetchCompareDetails(this.shas, this.repoPath);
		} else {
			void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability);
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

	private _lastResolved:
		| {
				content: ReturnType<typeof html> | typeof nothing;
				ariaLabel: string;
				context: 'wip' | 'commit' | 'compare';
		  }
		| undefined;

	private resolveContent():
		| {
				content: ReturnType<typeof html> | typeof nothing;
				ariaLabel: string;
				context: 'wip' | 'commit' | 'compare';
		  }
		| undefined {
		// When in a mode, lock rendering to the context that was active when the mode was entered.
		const ctx = this._state.activeModeContext.get();
		if (ctx != null) {
			if (ctx === 'compare') {
				return { ariaLabel: 'Comparing commits', content: this.renderCompare(), context: 'compare' };
			}
			if (ctx === 'wip') {
				return { ariaLabel: 'Working changes details', content: this.renderWip(), context: 'wip' };
			}
			return { ariaLabel: 'Commit details', content: this.renderCommit(), context: 'commit' };
		}

		if (this.isCompare && this._state.commitFrom.get() != null && this._state.commitTo.get() != null) {
			return { ariaLabel: 'Comparing commits', content: this.renderCompare(), context: 'compare' };
		}
		if (this.isWip && this._state.wip.get() != null) {
			return { ariaLabel: 'Working changes details', content: this.renderWip(), context: 'wip' };
		}
		if (this._state.commit.get() != null) {
			return { ariaLabel: 'Commit details', content: this.renderCommit(), context: 'commit' };
		}
		return undefined;
	}

	override render() {
		const current = this.resolveContent();
		// Preserve the last-rendered content while a fetch is in flight so we don't flash to
		// a skeleton on transient signal clears (e.g. sha → uncommittedSha swap). Only reuse
		// the cache when the effective context matches — otherwise we'd show stale wip content
		// while the user navigated to a commit (or vice versa). The cache itself is written
		// in updated() so render stays free of `this` assignments.
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

		return html`
			<gl-wip-header
				.wip=${wip}
				.activeMode=${activeMode}
				.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
				.loading=${this.isLoading}
				.autolinks=${this._state.wipAutolinks.get()}
				.issues=${this._state.wipIssues.get()}
				.mergeTargetStatus=${this._state.wipMergeTarget.get()}
				.mergeTargetStatusLoading=${this._state.wipMergeTargetLoading.get()}
				@toggle-mode=${this.handleToggleMode}
				@refresh-wip=${() => {
					this._actions.refreshWip();
					void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability);
				}}
				@switch-branch=${() => this._actions.switchBranch(this.effectiveRepoPath)}
				@create-branch=${() => this._actions.createBranch(this.effectiveRepoPath)}
				@compare-with-merge-target=${(
					e: CustomEvent<{ rightRef: string; rightRefType: 'branch' | 'commit' }>,
				) => {
					e.preventDefault();
					this.suppressContentOverflow();
					this._workflow.toggleMode('compare', this.currentSelection(), {
						rightRef: e.detail.rightRef,
						rightRefType: e.detail.rightRefType,
					});
				}}
				@publish-branch=${() => void this._actions.services.repository.push(this.effectiveRepoPath!)}
				@pull=${() => void this._actions.services.repository.pull(this.effectiveRepoPath!)}
				@push=${() => void this._actions.services.repository.push(this.effectiveRepoPath!)}
				@fetch=${() => void this._actions.services.repository.fetch(this.effectiveRepoPath!)}
				@remove-associated-issue=${(e: CustomEvent<{ entityId: string }>) =>
					void this._actions.removeAssociatedIssue(e.detail.entityId)}
			></gl-wip-header>
			${activeMode === 'review'
				? this.renderReviewBody()
				: activeMode === 'compose'
					? this.renderComposeBody()
					: activeMode === 'compare'
						? this.renderCompareRefsBody()
						: hasChanges
							? html`
									<div class="commit-panel__files">
										<gl-wip-details
											variant="embedded"
											file-icons
											checkbox-mode
											.wip=${wip}
											.files=${wip.changes?.files}
											.preferences=${this._state.preferences.get()}
											.orgSettings=${this._state.orgSettings.get()}
											.isUncommitted=${true}
											.filesCollapsable=${false}
											@file-open=${this.handleFileOpen}
											@file-compare-working=${this.handleFileCompareWorking}
											@file-compare-previous=${this.handleFileComparePrevious}
											@file-more-actions=${this.handleFileMoreActions}
											@file-stage=${this.handleFileStage}
											@file-unstage=${this.handleFileUnstage}
											@stage-all=${this.handleStageAll}
											@unstage-all=${this.handleUnstageAll}
											@stash-save=${() => this._actions.stashSave(this.effectiveRepoPath)}
											@change-files-layout=${this.handleChangeFilesLayout}
											@open-multiple-changes=${this.handleOpenMultipleChanges}
										></gl-wip-details>
									</div>
									<gl-commit-box
										.message=${this._state.commitMessage.get()}
										.amend=${this._state.amend.get()}
										.generating=${this._state.generating.get()}
										.branchName=${branchName}
										.canCommit=${this._actions.canCommit()}
										.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
										.commitError=${this._state.commitError.get()}
										@message-change=${(e: CustomEvent<{ value: string }>) => {
											this._state.commitMessage.set(e.detail.value);
											this._state.commitError.set(undefined);
										}}
										@amend-change=${(e: CustomEvent<{ checked: boolean }>) => {
											this._state.amend.set(e.detail.checked);
											if (e.detail.checked) {
												void this._actions.loadLastCommitMessage(this.effectiveRepoPath);
											} else {
												this._state.commitMessage.set('');
											}
										}}
										@commit=${() => void this._actions.commit(this.effectiveRepoPath, this.sha)}
										@generate-message=${() =>
											void this._actions.generateMessage(this.effectiveRepoPath)}
										@compose=${() => this._workflow.toggleMode('compose', this.currentSelection())}
									></gl-commit-box>
								`
							: html`
									<gl-wip-empty-state
										.wip=${wip}
										.aiEnabled=${false}
										@switch-branch=${() => this._actions.switchBranch(this.effectiveRepoPath)}
										@create-branch=${() => this._actions.createBranch(this.effectiveRepoPath)}
										@start-work=${() => this._actions.startWork()}
										@apply-stash=${() => this._actions.applyStash(this.effectiveRepoPath)}
										@new-worktree=${() => this._actions.createWorktree()}
										@publish-branch=${() =>
											void this._actions.services.repository.push(this.effectiveRepoPath!)}
										@pull=${() =>
											void this._actions.services.repository.pull(this.effectiveRepoPath!)}
										@push=${() =>
											void this._actions.services.repository.push(this.effectiveRepoPath!)}
									></gl-wip-empty-state>
								`}
		`;
	}

	private renderComposeBody() {
		const scopeItems = this._actions.buildWipScopeItems();
		const handleCompose = (e: CustomEvent<{ prompt?: string }>) => {
			const panel =
				this.querySelector<import('./gl-graph-compose-panel.js').GlGraphComposePanel>('gl-graph-compose-panel');
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
			composeStatus === 'success' ? (composeResult != null ? 'ready' : 'idle') : composeStatus;

		const scopeFilesValue = this._actions.resources.scopeFiles.value.get();
		const fallbackFiles = this._state.wip.get()?.changes?.files;
		const composeFiles = scopeFilesValue ?? fallbackFiles;

		return html`<gl-graph-compose-panel
			.status=${mappedComposeStatus}
			.commits=${composeResult?.commits}
			.baseCommit=${composeResult?.baseCommit}
			.errorMessage=${composeError}
			.repoPath=${this.effectiveRepoPath}
			.stale=${this._state.wipStale.get()}
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
			@compose-commit-all=${() =>
				void this._actions.composeCommitAll(this.effectiveRepoPath, this.sha, this.graphReachability)}
			@compose-commit-to=${(e: CustomEvent<{ upToIndex: number }>) =>
				void this._actions.composeCommitTo(this.effectiveRepoPath, e.detail.upToIndex)}
			@compose-open-composer=${() => this._actions.openComposer(this.effectiveRepoPath)}
			@scope-change=${(e: CustomEvent<{ selectedIds: string[] }>) =>
				this.handleScopeChange(scopeItems, new Set(e.detail.selectedIds))}
			@file-open=${this.handleComposeFileOpen}
			@file-stage=${this.handleFileStage}
			@file-unstage=${this.handleFileUnstage}
			@change-files-layout=${this.handleChangeFilesLayout}
		></gl-graph-compose-panel>`;
	}

	private renderCompareRefsBody() {
		const branch = this._state.wip.get()?.branch;
		const repoPath = this.effectiveRepoPath;
		// The left ref has a worktree if it matches the current branch (which is always in a worktree)
		const hasWorktree = this._state.branchCompareLeftRef.get() === branch?.name;
		const activeTab = this._state.branchCompareActiveTab.get();
		const compareFiles =
			activeTab === 'ahead'
				? this._state.branchCompareAheadFiles.get()
				: this._state.branchCompareBehindFiles.get();
		const leftRef = this._state.branchCompareLeftRef.get();

		return html`<gl-graph-wip-compare-panel
			.branchName=${branch?.name}
			.repoPath=${repoPath}
			.preferences=${this._state.preferences.get()}
			.leftRef=${leftRef}
			.leftRefType=${this._state.branchCompareLeftRefType.get()}
			.rightRef=${this._state.branchCompareRightRef.get()}
			.rightRefType=${this._state.branchCompareRightRefType.get()}
			.includeWorkingTree=${this._state.branchCompareIncludeWorkingTree.get()}
			.hasWorktree=${hasWorktree}
			.aheadCount=${this._state.branchCompareAheadCount.get()}
			.behindCount=${this._state.branchCompareBehindCount.get()}
			.aheadCommits=${this._state.branchCompareAheadCommits.get()}
			.behindCommits=${this._state.branchCompareBehindCommits.get()}
			.compareFiles=${compareFiles}
			.loading=${this._actions.resources.branchCompare.loading.get()}
			.activeTab=${activeTab}
			.selectedCommitSha=${this._state.branchCompareSelectedCommitSha.get()}
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
			@toggle-working-tree=${() => this._actions.toggleCompareWorkingTree(repoPath)}
			@switch-tab=${(e: CustomEvent<{ tab: 'ahead' | 'behind' }>) =>
				this._actions.switchCompareTab(e.detail.tab, repoPath)}
			@scope-to-commit=${(e: CustomEvent<{ sha: string | undefined }>) =>
				this._actions.selectCompareCommit(e.detail.sha, repoPath)}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
		></gl-graph-wip-compare-panel>`;
	}

	/** When the user has scoped the compare file list to a single commit, file actions should
	 *  resolve against THAT commit (so "previous" means commit~1, not the comparison's other side).
	 *  Otherwise fall through to the comparison's left ref (branch-vs-branch semantics). */
	private compareFileRef(leftRef: string | undefined): string | undefined {
		const selected = this._state.branchCompareSelectedCommitSha.get();
		return selected ?? leftRef;
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
				? this.renderReviewBody()
				: activeMode === 'compare'
					? this.renderCompareRefsBody()
					: nothing;

		return html`<gl-commit-details
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
			@change-files-layout=${this.handleChangeFilesLayout}
			@toggle-mode=${this.handleToggleMode}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
		></gl-commit-details>`;
	}

	private renderCompare() {
		const activeMode = this._state.activeMode.get();
		const subPanelContent =
			activeMode === 'review'
				? this.renderReviewBody()
				: activeMode === 'compare'
					? this.renderCompareRefsBody()
					: nothing;
		const swapped = this._state.swapped.get();
		const shas = this.effectiveShas;
		const repoPath = this.effectiveRepoPath;
		const rawBetweenCount = this._state.compareBetweenCount.get();
		const betweenCount = Math.max(0, rawBetweenCount != null ? rawBetweenCount - 1 : (shas?.length ?? 0) - 2);

		return html`<gl-graph-compare-panel
			variant="embedded"
			file-icons
			.commitFrom=${this._state.commitFrom.get()}
			.commitTo=${this._state.commitTo.get()}
			.files=${this._state.compareFiles.get()}
			.stats=${this._state.compareStats.get()}
			.preferences=${this._state.preferences.get()}
			.orgSettings=${this._state.orgSettings.get()}
			.autolinks=${this._state.compareAutolinks.get()}
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
			@enrich-autolinks=${() => void this._actions.enrichAutolinks(repoPath!, shas!)}
			@select-commit=${(e: CustomEvent<{ sha: string }>) => this.handleSelectCommit(e.detail.sha)}
			@change-files-layout=${this.handleChangeFilesLayout}
			@toggle-mode=${this.handleToggleMode}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
		></gl-graph-compare-panel>`;
	}

	private renderReviewBody() {
		const ctx = this.effectiveContext;
		const scopeFilesValue = this._actions.resources.scopeFiles.value.get();
		// Fall back to the context's file list until the scoped fetch resolves (avoids flash of empty tree).
		const fallbackFiles =
			ctx === 'wip'
				? this._state.wip.get()?.changes?.files
				: ctx === 'compare'
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
			reviewStatus === 'success' ? (reviewResult != null ? 'ready' : 'idle') : reviewStatus;

		return html`<gl-graph-review-panel
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
				const panel =
					this.querySelector<import('./gl-graph-review-panel.js').GlGraphReviewPanel>(
						'gl-graph-review-panel',
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
			@review-drill=${(e: CustomEvent<ReviewDrillDetail>) => this.handleReviewDrill(e)}
			@review-open-file=${(e: CustomEvent<ReviewOpenFileDetail>) =>
				this._actions.openFileByPath(e.detail.filePath, this.effectiveRepoPath)}
			@review-back=${() => this._workflow.review.back()}
			@review-forward=${() => this._workflow.review.forward()}
			@review-forward-invalidate=${() => this._workflow.review.invalidateSnapshot()}
			@scope-change=${(e: CustomEvent<{ selectedIds: string[] }>) =>
				this.handleScopeChange(scopeItems, new Set(e.detail.selectedIds))}
			@file-open=${this.handleReviewFileOpen}
			@file-stage=${this.handleFileStage}
			@file-unstage=${this.handleFileUnstage}
			@file-compare-working=${this.handleFileCompareWorking}
			@file-open-on-remote=${this.handleFileOpenOnRemote}
			@change-files-layout=${this.handleChangeFilesLayout}
		></gl-graph-review-panel>`;
	}

	private handleScopeChange(
		scopeItems: import('./gl-details-scope-pane.js').ScopeItem[] | undefined,
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
		const scope = this._state.scope.get();
		// Compare/commit scopes carry a real ref; wip scope is uncommitted (no ref).
		const ref = scope?.type === 'commit' ? scope.sha : scope?.type === 'compare' ? scope.toSha : undefined;
		this._actions.openFile(e.detail, ref);
	};

	private handleComposeFileOpen = (e: CustomEvent<FileChangeListItemDetail>) => {
		// Compose files are working-tree changes — open without a ref so the working file is shown.
		this._actions.openFile(e.detail);
	};

	private async handleReviewDrill(e: CustomEvent<ReviewDrillDetail>): Promise<void> {
		const repoPath = this.effectiveRepoPath;
		const scope = this._state.scope.get();
		const reviewValue = this._actions.resources.review.value.get();
		const reviewResult = reviewValue && 'result' in reviewValue ? reviewValue.result : undefined;
		if (!repoPath || !scope || !reviewResult) return;

		const { focusAreaId, files } = e.detail;
		const panel =
			this.querySelector<import('./gl-graph-review-panel.js').GlGraphReviewPanel>('gl-graph-review-panel');
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
				panel?.updateFocusAreaFindings(focusAreaId, result.result);
			}
		} catch {
			panel?.setFocusAreaError(focusAreaId);
		}
	}

	private handleSelectCommit(sha: string) {
		this.dispatchEvent(new CustomEvent('select-commit', { detail: { sha: sha }, bubbles: true, composed: true }));
	}

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
