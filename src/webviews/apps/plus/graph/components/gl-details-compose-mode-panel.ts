import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import { fromNow } from '@gitlens/utils/date.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { DetailsItemTypedContext } from '../../../../plus/graph/detailsProtocol.js';
import { buildFolderContext } from '../../../../plus/graph/detailsProtocol.js';
import type { ProposedCommit, ProposedCommitFile, ScopeSelection } from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { redispatch } from '../../../shared/components/element.js';
import { elementBase, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemAction, TreeItemCheckedDetail } from '../../../shared/components/tree/base.js';
import { treeItemFileDragDataType } from '../../../shared/components/tree/base.js';
import { renderOpenChangesAction } from '../../../shared/components/tree/file-tree-utils.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { countIncludedFiles, prunePathsToFiles, syncAiExcluded } from './aiExclusion.js';
import type { GlCommitsScopePane, ScopeItem } from './gl-commits-scope-pane.js';
import {
	composeModePanelStyles,
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStageStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	panelStaleBannerStyles,
	resumeBarStyles,
} from './gl-details-compose-mode-panel.css.js';
import { getScopeSplitPickerChrome, renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/button.js';
import '../../../shared/components/markdown/markdown.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/split-panel/split-panel.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import './gl-commits-scope-pane.js';
import './gl-categorizing-loading-animation.js';

/** Distance in px from the commit-list's top/bottom edge within which a drag auto-scrolls, and the
 *  per-animation-frame scroll step (a smooth rAF loop, not a per-event jump). */
const composeDragScrollZone = 48;
const composeDragScrollSpeed = 6;

/** Event detail for the per-commit include/exclude toggle in recompose mode. The parent panel
 *  routes this into the refine-excluded set, forwarded to the library's `refinePlan` as
 *  `lockedCommits` so excluded commits are preserved verbatim across the AI recompose. */
export interface ComposeRefineExcludeToggleDetail {
	commitId: string;
	excluded: boolean;
}

/** Event detail for the per-commit "regenerate message" button. The parent routes this back to
 *  the workflow controller, which calls the host to regenerate just this commit's message via
 *  GitLens's internal `ai.actions.generateCommitMessage` against the cached plan's hunks for
 *  this commit. The host mutates the cached plan in place so subsequent refine + apply pick up
 *  the new message; the controller patches the resource/registry so the rendered plan does too. */
export interface ComposeRegenMessageDetail {
	commitId: string;
}

/** Event detail for "Commit All / Commit N" — when `includedCommitIds` is undefined, all
 *  commits in the displayed plan are applied; when set, only those ids are applied and the
 *  rest become unstaged workdir changes (library leftover-patch path). */
export interface ComposeCommitAllDetail {
	includedCommitIds?: readonly string[];
}

/** Event detail for a drag/keyboard reorder of the draft commits. `orderedCommitIds` is the full
 *  set of the plan's commit ids in the new **display** order (top row first). The parent routes it
 *  to the workflow controller, which reorders the resource optimistically and syncs the new order to
 *  the host's cached plan so apply/refine honor it. */
export interface ComposeReorderDetail {
	orderedCommitIds: string[];
}

/** Event detail for dragging a file from one draft commit to another. The parent routes it to the
 *  workflow controller, which asks the host to reassign the file's hunks and returns the re-derived
 *  plan. `fromCommitId` is the commit the file currently belongs to (the selected commit). */
export interface ComposeMoveFileDetail {
	path: string;
	fromCommitId: string;
	toCommitId: string;
}

@customElement('gl-details-compose-mode-panel')
export class GlDetailsComposeModePanel extends LitElement {
	static override styles = [
		elementBase,
		subPanelEnterStyles,
		panelHostStyles,
		panelActionInputStyles,
		panelLoadingStyles,
		panelLoadingStageStyles,
		panelErrorStyles,
		panelStaleBannerStyles,
		panelScopeSplitStyles,
		resumeBarStyles,
		composeModePanelStyles,
	];

	@property({ attribute: 'status' })
	status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

	@property()
	errorMessage?: string;

	/** Persisted preference threaded through to the inner `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'show-search-box' })
	showSearchBox?: boolean;

	/** Persisted preference threaded through to the inner `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	/** Latest phase label streamed from the host while compose is running. Falls back to a
	 *  generic "Composing changes…" when null/undefined. */
	@property()
	progressMessage?: string;

	/** When true, the panel renders an uncancellable "Applying commits…" overlay covering the
	 *  plan. Driven by `composeApplying` in details state — set between an apply-plan click
	 *  and the IPC's resolution. */
	@property({ type: Boolean, reflect: true })
	applying = false;

	@property({ type: Array })
	commits?: ProposedCommit[];

	@property({ type: Object })
	baseCommit?: { sha: string; message: string; author?: string; date?: string };

	@property()
	repoPath?: string;

	@property({ type: Array })
	scopeItems?: ScopeItem[];

	@property({ type: Object })
	scope?: ScopeSelection;

	@property({ type: Boolean })
	stale = false;

	@property({ type: Boolean })
	scopeLoading = false;

	@property({ type: Array })
	files?: readonly GitFileChangeShape[];

	@property({ type: Array })
	aiExcludedFiles?: readonly string[];

	@property()
	fileLayout: ViewFilesLayout = 'auto';

	@property({ type: Object })
	searchContext?: GitCommitSearchContext;

	@property({ type: Object })
	aiModel?: AiModelInfo;

	/** Pushed by the orchestrator from the engaged compose entry's `prompt` field — the *last*
	 *  prompt submitted on this anchor's compose flow (cold-start instructions or whichever
	 *  refine was most recently sent). Drives the Refine input's `.recall`: ArrowUp from cursor
	 *  position 0 loads this back into the Refine field (terminal-style history recall), letting
	 *  the user tweak the prompt that produced the current plan without retyping.
	 *
	 *  Not used to seed the idle scope-picker's input — that reads {@link basePrompt} instead,
	 *  so Restart re-fills with the user's original compose instructions rather than the last
	 *  refine. */
	@property()
	lastPrompt?: string;

	/** Pushed by the orchestrator from the engaged compose entry's `basePrompt` field — the
	 *  *cold-start* instructions for this anchor's compose flow. Diverges from {@link lastPrompt}
	 *  on refine: each refine overwrites `lastPrompt` but leaves `basePrompt` untouched, so the
	 *  original base persists across the session. Drives the idle scope picker's AI-input seed
	 *  on every idle re-render (success → Restart and error → Go Back). Re-mounting `gl-ai-input`
	 *  via the `keyed` directive in `renderIdleState` is what triggers the seed: `.value` is
	 *  one-shot in `firstUpdated`. */
	@property()
	basePrompt?: string;

	@state() private _selectedCommitId?: string;
	/** Mirrors the pane's multi-selection so the "Open Changes" chip can swap to "Open Selected". */
	@state() private _selectedFiles: readonly { path: string }[] = [];
	/** Mirrors the idle curation pane's multi-selection; separate from `_selectedFiles` (ready-state tree) so selection doesn't leak across states. */
	@state() private _idleSelectedFiles: readonly { path: string }[] = [];
	@state() private _excludedFiles = new Set<string>();
	@state() private _aiExcludedSet: ReadonlySet<string> | undefined;
	/** Commit ids the user has excluded from the next "Commit" action. Independent of the
	 *  refine-excluded set — refine-exclusion affects what the AI leaves alone during recompose,
	 *  commit-exclusion affects what gets applied at commit time. Panel-local because it resets
	 *  per plan (a fresh recompose result starts with all commits included). */
	@state() private _excludedCommitIds = new Set<string>();

	/** Panel posture: false = commit (green checkmarks pick what will be committed), true = refine
	 *  (orange checkmarks pick what the AI may reshape). Toggled by the "Refine with AI" checkbox.
	 *  Panel-local; defaults to commit and persists across refine rounds within the engagement. */
	@state() private _refineMode = false;

	/** Drag-reorder transient state. Deliberately NOT `@state` — mutating these must not trigger a
	 *  re-render mid-drag (which would desync the native drag image); the drop indicator is toggled
	 *  by direct class manipulation instead. Cleared on drop/dragend. */
	private _draggedCommitId?: string;
	private _dragOverCommitId?: string;
	private _dragOverBottom = false;
	private _autoScrollDir = 0;
	private _autoScrollRaf?: number;

	/** File-drag (file → commit move) transient state, also not `@state`. `_fileDragSourceCommitId`
	 *  is the selected commit the file is being dragged out of; `_fileDropTargetCommitId` is the
	 *  commit row currently highlighted as the drop target. */
	private _fileDragSourceCommitId?: string;
	private _fileDropTargetCommitId?: string;

	/** Reorder (drag + keyboard) is offered only for a multi-commit plan that isn't mid-operation.
	 *  Excludes/regen don't change order, but a reorder while applying/loading/regenerating could
	 *  race the host's plan mutation, so hold it until those settle. */
	private get reorderEnabled(): boolean {
		return (
			(this.commits?.length ?? 0) > 1 &&
			!this.applying &&
			this.status !== 'loading' &&
			this.regeneratingCommitId == null
		);
	}

	/** Pushed by the orchestrator from `state.composeForwardAvailable`. See review panel for the
	 * full restore-vs-rerun rationale — bar click emits `compose-forward` for the orchestrator
	 * to mutate the resource back to the snapshot (no AI re-run). */
	@property({ type: Boolean, attribute: 'forward-available', reflect: true })
	forwardAvailable = false;

	/** Preview metadata pushed from `state.composeBackPreview` — drives the count display on the
	 * resume bar. Cleared by the orchestrator in lockstep with `forwardAvailable`. */
	@property({ type: Object, attribute: false })
	backPreview?: { commitCount: number; fileCount: number };

	/** Commit ids the user has excluded from the AI recompose (checkbox unchecked in recompose
	 *  mode). Pushed by the orchestrator from `state.composeRefineExcludedCommitIds`; toggling a
	 *  row fires `compose-refine-exclude-toggle`, routed back into the signal, and the set is
	 *  forwarded to `refinePlan` as `lockedCommits`. */
	@property({ type: Object, attribute: false })
	excludedCommitIds: ReadonlySet<string> = new Set();

	/** Commit id currently regenerating its message (sparkle button → spinner). Pushed by the
	 *  orchestrator from `state.composeRegeneratingCommitId`. Drives the in-row icon swap and
	 *  is read here to gate concurrent regen clicks across the plan. */
	@property({ attribute: false })
	regeneratingCommitId?: string;

	get excludedFiles(): ReadonlySet<string> {
		return this._excludedFiles;
	}

	/** Picker selection IDs (within shadow root) for the orchestrator's scope-fetch flow. */
	get selectedIds(): ReadonlySet<string> | undefined {
		const picker = this.renderRoot.querySelector<GlCommitsScopePane>('gl-commits-scope-pane');
		if (picker == null) return undefined;
		return new Set(picker.selectedIds);
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		if (changedProperties.has('aiExcludedFiles')) {
			const result = syncAiExcluded(this.aiExcludedFiles, this._aiExcludedSet, this._excludedFiles);
			if (result != null) {
				this._aiExcludedSet = result.aiExcludedSet;
				if (result.excludedFiles != null) {
					this._excludedFiles = result.excludedFiles;
				}
			}
		}

		if (changedProperties.has('files')) {
			const pruned = prunePathsToFiles(this._excludedFiles, this.files);
			if (pruned != null) {
				this._excludedFiles = pruned;
			}
			this._idleSelectedFiles = [];
		}

		// After a recompose (AI refine) completes, drop back to the commit posture so the user lands
		// on the refined plan ready to commit rather than staying in the recompose input. Guard on the
		// loading -> ready transition (success only) so a failed recompose keeps the posture for a
		// retry, and on `_refineMode` so the initial compose (posture already false) is a no-op.
		if (
			changedProperties.has('status') &&
			changedProperties.get('status') === 'loading' &&
			this.status === 'ready' &&
			this._refineMode
		) {
			this._refineMode = false;
		}

		// A file move can prune the selected commit (its last file moved away); drop the stale
		// selection so the file pane falls back to its empty prompt instead of a dead commit.
		if (changedProperties.has('commits')) {
			if (this._selectedCommitId != null && !this.commits?.some(c => c.id === this._selectedCommitId)) {
				this._selectedCommitId = undefined;
			}
		}

		// Locked commits are owned by the parent (signal-state). When the plan refreshes with
		// commit ids that no longer exist in the new plan, the parent's signal is responsible
		// for pruning them. The panel just renders the current set.
		//
		// Excluded commits, in contrast, are panel-local and need to be pruned here when the
		// plan changes — a refined plan may rename / drop commit ids, so stale entries would
		// silently filter from a commit the user didn't intend to exclude.
		if (changedProperties.has('commits') && this._excludedCommitIds.size > 0) {
			const validIds = new Set(this.commits?.map(c => c.id));
			let changed = false;
			const next = new Set<string>();
			for (const id of this._excludedCommitIds) {
				if (validIds.has(id)) {
					next.add(id);
				} else {
					changed = true;
				}
			}
			if (changed) {
				this._excludedCommitIds = next;
			}
		}
	}

	private getEffectiveFileCount(): number {
		return countIncludedFiles(this.files, this._excludedFiles, this._aiExcludedSet);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', 'Compose Changes');
	}

	override disconnectedCallback(): void {
		this.clearAllDragState();
		super.disconnectedCallback?.();
	}

	/** Recovery for the VS Code webview drag boundary. When a native drag leaves the webview iframe,
	 *  VS Code delivers NO further events to the webview — so if the user releases *outside*, no
	 *  `dragend` ever fires inside and the `.dragging`/indicator classes + drag state are stranded.
	 *  The browser suppresses pointer moves *during* a native drag, so the first `pointermove` after a
	 *  drag started (with no button held) means the drag has ended and we missed the `dragend` — clear
	 *  the moment the cursor moves back over the webview. Attached only while a drag is active
	 *  (dragstart) and removed by {@link clearAllDragState}. */
	private readonly _onDragPointerMove = (e: PointerEvent): void => {
		if (e.buttons !== 0) return;

		this.clearAllDragState();
	};

	private attachDragBoundaryListeners(): void {
		document.addEventListener('pointermove', this._onDragPointerMove);
	}

	private detachDragBoundaryListeners(): void {
		document.removeEventListener('pointermove', this._onDragPointerMove);
	}

	private handleForward = (): void => {
		this.dispatchEvent(new CustomEvent('compose-forward', { bubbles: true, composed: true }));
	};

	private onAiInputType = (): void => {
		this.invalidateForward();
	};

	private invalidateForward(): void {
		if (this.forwardAvailable) {
			this.dispatchEvent(new CustomEvent('compose-forward-invalidate', { bubbles: true, composed: true }));
		}
	}

	private handleCancel = (): void => {
		this.dispatchEvent(new CustomEvent('compose-cancel', { bubbles: true, composed: true }));
	};

	private handleDiscard = (): void => {
		this.dispatchEvent(new CustomEvent('compose-discard', { bubbles: true, composed: true }));
	};

	private renderCancelButton() {
		return html`<gl-button class="compose-cancel" appearance="secondary" @click=${this.handleCancel}
			>Cancel</gl-button
		>`;
	}

	override render() {
		return html`<div class="compose-panel">${this.renderContent()}</div>`;
	}

	private renderContent() {
		// Applying takes precedence — once an apply IPC is in flight, the plan is no longer
		// editable and the action is uncancellable, so we render a loading overlay regardless
		// of whether `status` is still 'ready'.
		if (this.applying) {
			return renderLoadingState('Applying commits…');
		}

		if (this.status === 'idle') {
			return this.renderIdleState();
		}

		if (this.status === 'loading') {
			// Cancel chip lets the user abort an in-flight AI call; the orchestrator wires
			// `compose-cancel` to the actual cancellation plumbing.
			// The animation sits behind the spinner/text/cancel as decoration; it self-removes
			// when this branch is no longer rendered (status flips to 'ready'/'error') and
			// auto-disables under prefers-reduced-motion.
			return html`<div class="panel-loading-stage">
				<gl-categorizing-loading-animation
					class="panel-loading-stage__anim"
					variant="compose"
				></gl-categorizing-loading-animation>
				<div class="panel-loading-stage__foreground">
					${renderLoadingState(this.progressMessage ?? 'Composing changes…')}${this.renderCancelButton()}
				</div>
			</div>`;
		}

		if (this.status === 'error') {
			return renderErrorState(
				this.errorMessage,
				'An error occurred during composition.',
				'compose-error-retry',
				'compose-error-back',
			);
		}

		if (this.status !== 'ready' || !this.commits) return nothing;

		return this.renderPlan();
	}

	private renderIdleState() {
		const hasPicker = (this.scopeItems?.length ?? 0) > 0 || this.scopeLoading;

		// Disable Compose when no files are effectively included (after both user and AI
		// exclusions). Stale user exclusions are pruned in willUpdate.
		const disabled = this.getEffectiveFileCount() === 0;

		// Key the input on the base prompt so a Restart / Go Back into idle remounts the element
		// and reseeds `.value`. `gl-ai-input.value` is one-shot in `firstUpdated`; without a
		// remount the reseed silently no-ops on subsequent renders.
		const aiInput = html`<div class="review-input-row">
			${keyed(
				this.basePrompt,
				html`<gl-ai-input
					class="review-action-input"
					multiline
					active
					rows="2"
					button-label="Compose"
					busy-label="Composing changes…"
					event-name="compose-generate"
					placeholder='Instructions — e.g. "Group by feature, keep perf changes separate"'
					.value=${this.basePrompt}
					.busy=${this.status === 'loading'}
					?disabled=${disabled}
					disabled-reason="Include Files to Compose"
					@input=${this.onAiInputType}
				>
					<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
				</gl-ai-input>`,
			)}
		</div>`;

		if (!hasPicker) {
			return html`
				<div class="review-idle">
					<div class="review-idle__scope">
						<code-icon icon="wand"></code-icon>
						Compose Changes
					</div>
					<div class="review-idle__desc">
						AI will analyze your working changes and unpushed commits to create a clean, logical commit
						sequence.
					</div>
				</div>
				${aiInput}
			`;
		}

		return html`
			<gl-split-panel
				orientation="vertical"
				primary="start"
				class="scope-split"
				position="40"
				.snap=${this._scopeSplitSnap}
			>
				<div slot="start" class="scope-split__picker">
					<gl-commits-scope-pane
						.items=${this.scopeItems ?? []}
						.selection=${this.scopeSelectionIds()}
						?loading=${this.scopeLoading}
						mode="compose"
					></gl-commits-scope-pane>
				</div>
				<div slot="end" class="scope-split__files">
					<div class="scope-files">${this.renderFileCuration()}</div>
				</div>
			</gl-split-panel>
			${aiInput}
		`;
	}

	private renderFileCuration() {
		// Always render the section — empty-text shows the empty state inside the pane so the
		// header / scope context stays visible even when the current scope yields zero files.
		const files = this.files ?? [];

		const aiExcluded = this._aiExcludedSet;

		const checkableStates = new Map<string, { state?: 'checked'; disabled?: boolean; disabledReason?: string }>();
		for (const file of files) {
			const checked = !this._excludedFiles.has(file.path);
			const disabled = aiExcluded?.has(file.path) ?? false;
			if (checked || disabled) {
				checkableStates.set(file.path, {
					...(checked ? { state: 'checked' as const } : {}),
					...(disabled ? { disabled: true, disabledReason: 'Excluded by AI ignore rules' } : {}),
				});
			}
		}

		return html`<div class="scope-files__tree">
			<webview-pane-group flexible>
				<gl-file-tree-pane
					.files=${files}
					?checkable=${true}
					?multi-selectable=${true}
					?show-file-icons=${true}
					.collapsable=${false}
					.filesLayout=${{ layout: this.fileLayout }}
					.checkableStates=${checkableStates}
					.fileActions=${this.idleFileActionsForFile}
					.fileContext=${this.getIdleFileContext}
					.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
					.searchContext=${this.searchContext}
					.showSearchBox=${this.showSearchBox}
					.searchBoxFilter=${this.searchBoxFilter}
					check-verb="Include"
					uncheck-verb="Exclude"
					empty-text="No files changed"
					@file-checked=${this.onFileChecked}
					@gl-check-all=${this.onToggleCheckAll}
					@file-open=${this.redispatch}
					@file-stage=${this.redispatch}
					@file-unstage=${this.redispatch}
					@file-selection-changed=${(e: CustomEvent<{ files: readonly { path: string }[] }>) =>
						(this._idleSelectedFiles = e.detail?.files ?? [])}
					@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
						this.fileLayout = e.detail.layout;
					}}
				>
					${files.length > 0
						? renderOpenChangesAction({
								selectedCount: this._idleSelectedFiles.length,
								slot: 'leading-actions',
								onOpenAll: () => this.onOpenScopeMultiDiff(files),
								onOpenSelected: () => {
									const selectedPaths = new Set(this._idleSelectedFiles.map(f => f.path));
									this.onOpenScopeMultiDiff(files.filter(f => selectedPaths.has(f.path)));
								},
							})
						: nothing}
				</gl-file-tree-pane>
			</webview-pane-group>
		</div>`;
	}

	private idleFileActionsForFile = (_file: GitFileChangeShape): TreeItemAction[] => {
		return [{ icon: 'go-to-file', label: 'Open File', action: 'file-open' }];
	};

	private getIdleFileContext = (file: GitFileChangeShape): string | undefined => {
		if (!this.repoPath) return undefined;

		const context: DetailsItemTypedContext = {
			webviewItem: file.staged ? 'gitlens:file+staged' : 'gitlens:file+unstaged',
			webviewItemValue: {
				type: 'file',
				path: file.path,
				repoPath: this.repoPath,
				sha: uncommitted,
				staged: file.staged,
				status: file.status,
			},
		};
		return serializeWebviewItemContext(context);
	};

	private onFileChecked(e: CustomEvent<TreeItemCheckedDetail>): void {
		if (!e.detail.context) return;

		const [file] = e.detail.context as unknown as GitFileChangeShape[];
		if (!file) return;

		const next = new Set(this._excludedFiles);
		if (e.detail.checked) {
			next.delete(file.path);
		} else {
			next.add(file.path);
		}
		this._excludedFiles = next;
		this.invalidateForward();
	}

	private onToggleCheckAll(e: CustomEvent<{ checked: boolean; paths: readonly string[] }>): void {
		const next = new Set(this._excludedFiles);
		if (e.detail.checked) {
			for (const path of e.detail.paths) {
				next.delete(path);
			}
		} else {
			for (const path of e.detail.paths) {
				next.add(path);
			}
		}
		this._excludedFiles = next;
		this.invalidateForward();
	}

	private _scopeSplitSnap = ({ pos, size }: { pos: number; size: number }): number => {
		const scopeEl = this.renderRoot.querySelector<GlCommitsScopePane>('gl-commits-scope-pane');
		if (!scopeEl || size <= 0) return Math.max(15, Math.min(pos, 70));

		// `contentHeight` measures only the inner scroll pane; the .scope-split__picker wrapper adds
		// padding + a border-bottom. Include that chrome so the fit-content track isn't clamped
		// short of the picker's true height (which would clip its content / desync the divider).
		const maxPercent = Math.min(70, ((scopeEl.contentHeight + getScopeSplitPickerChrome(scopeEl)) / size) * 100);
		return Math.max(15, Math.min(pos, maxPercent));
	};

	private scopeSelectionIds(): readonly string[] | undefined {
		const scope = this.scope;
		if (scope?.type !== 'wip') return undefined;
		return [
			...(scope.includeUnstaged ? ['unstaged'] : []),
			...(scope.includeStaged ? ['staged'] : []),
			...scope.includeShas,
		];
	}

	private renderStaleBanner() {
		return html`<div class="stale-banner" role="status">
			<code-icon icon="warning"></code-icon>
			<span>Working changes have changed since this plan was generated.</span>
		</div>`;
	}

	private renderPlan() {
		if (!this.commits?.length) return nothing;

		const includedCount = this.commits.length - this._excludedCommitIds.size;
		const allIncluded = this._excludedCommitIds.size === 0;
		// "Change Sets" only appears with a count (a partial selection); the whole-set and disabled
		// cases use the plain "Changes" (matching the gate), so the button never reads "0" or "All".
		const commitButtonLabel =
			allIncluded || includedCount === 0 ? 'Commit Changes' : `Commit ${pluralize('Change Set', includedCount)}`;

		// Refine posture mirrors the commit label: it counts the commits the AI is free to touch
		// (checked = editable), i.e. everything minus the refine-excluded ones in the current plan.
		const refineExcludedCount = this.commits.filter(c => this.excludedCommitIds.has(c.id)).length;
		const refineCount = this.commits.length - refineExcludedCount;
		const refineButtonLabel =
			refineExcludedCount === 0 || refineCount === 0
				? 'Recompose Changes'
				: `Recompose ${pluralize('Change Set', refineCount)}`;

		const actions = html`<div class="compose-plan__actions">
			<gl-checkbox
				class="compose-plan__gate"
				?checked=${this._refineMode}
				@gl-change-value=${this.handleToggleRefineMode}
			>
				<code-icon icon="wand"></code-icon> Recompose Changes
			</gl-checkbox>
			${this._refineMode
				? html`<gl-ai-input
						appearance="detached"
						class="review-action-input"
						multiline
						rows="2"
						button-label=${refineButtonLabel}
						?disabled=${refineCount === 0}
						disabled-reason="Include Changes to Recompose"
						busy-label="Recomposing…"
						event-name="compose-refine"
						placeholder='Recompose — e.g. "Merge commits 1 and 2, they&apos;re related"'
						.recall=${this.lastPrompt}
					>
						<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
						<gl-button slot="actions" appearance="secondary" @click=${this.handleDiscard}
							>Discard</gl-button
						>
					</gl-ai-input>`
				: html`<div class="compose-plan__action-row">
						<gl-button
							class="compose-plan__commit"
							full
							aria-disabled=${includedCount === 0 ? 'true' : nothing}
							tooltip=${includedCount === 0 ? 'Include a change set to commit' : nothing}
							@click=${() => {
								if (includedCount === 0) return;

								this.handleCommitAll();
							}}
							>${commitButtonLabel}</gl-button
						>
						<gl-button appearance="secondary" @click=${this.handleDiscard}>Discard</gl-button>
					</div>`}
		</div>`;

		const listEl = html`<div
			class="compose-plan__list scrollable"
			@dragstart=${this.handleDragStart}
			@dragend=${this.handleDragEnd}
			@dragover=${this.handleDragOver}
			@dragleave=${this.handleDragLeave}
			@drop=${this.handleDrop}
		>
			${repeat(
				this.commits,
				commit => commit.id,
				(commit, i) => this.renderProposedCommit(commit, i),
			)}
			${this.baseCommit ? this.renderBaseCommit() : nothing}
		</div>`;

		return html`
			<div
				class="compose-plan ${this._refineMode ? 'compose-plan--refine' : ''}"
				@dragstart=${this.handleFileDragStart}
				@dragend=${this.handleFileDragEnd}
			>
				${this.stale ? this.renderStaleBanner() : nothing}
				<gl-split-panel class="compose-plan__split" orientation="vertical" primary="end" position="50">
					<div slot="start" class="compose-plan__split-start">${listEl}</div>
					<div slot="end" class="compose-plan__split-end">${this.renderSelectedCommitFiles()}</div>
				</gl-split-panel>
				${actions}
			</div>
		`;
	}

	/** Renders a commit message as inline summary + dimmed body continuation (graph-row style).
	 *  Multi-paragraph bodies collapse to a single line with the summary; the popover anchor
	 *  carries the full markdown for hover. */
	private renderCommitMessageInline(message: string) {
		const { summary, body } = splitCommitMessage(message);
		if (!body) {
			return html`<gl-markdown .markdown=${summary} inline></gl-markdown>`;
		}
		return html`<gl-markdown .markdown=${summary} inline></gl-markdown
			><span class="compose-commit__message-body"><gl-markdown .markdown=${body} inline></gl-markdown></span>`;
	}

	private renderProposedCommit(commit: ProposedCommit, index: number) {
		const num = this.commits!.length - index;
		const isSelected = this._selectedCommitId === commit.id;
		const isRefineExcluded = this.excludedCommitIds.has(commit.id);
		const isExcluded = this._excludedCommitIds.has(commit.id);
		// One checkmark per row; posture decides which axis it edits. Checked always means "let
		// this commit flow through" (commit it / let the AI reshape it); unchecked "holds it back".
		const isChecked = this._refineMode ? !isRefineExcluded : !isExcluded;
		const checkLabel = this._refineMode
			? isRefineExcluded
				? 'Excluded when Recomposing'
				: 'Included when Recomposing'
			: isExcluded
				? 'Excluded when Committing'
				: 'Included when Committing';

		const ariaState = [isRefineExcluded ? 'excluded from recompose' : '', isExcluded ? 'excluded from commit' : '']
			.filter(Boolean)
			.join(', ');

		// Per-commit message regen gate. Disabled when AI isn't configured (the existing flow's
		// model-picker entry point is on the bigger Compose/Refine input — keep this button
		// disabled rather than hijack it to open the picker), while the panel is loading/applying
		// any other compose action, and while a regen for *another* commit is in flight.
		const isRegeneratingThis = this.regeneratingCommitId === commit.id;
		const isRegeneratingOther = this.regeneratingCommitId != null && !isRegeneratingThis;
		const regenBlocked = this.aiModel == null || this.status === 'loading' || this.applying || isRegeneratingOther;
		const regenDisabled = regenBlocked && !isRegeneratingThis;
		const regenLabel =
			this.aiModel == null
				? 'AI model required to regenerate commit messages'
				: isRegeneratingThis
					? 'Regenerating commit message…'
					: 'Regenerate Commit Message';

		const reorderEnabled = this.reorderEnabled;
		return html`<div
			class="compose-commit ${isSelected ? 'compose-commit--selected' : ''} ${isExcluded
				? 'compose-commit--excluded'
				: ''} ${isRefineExcluded ? 'compose-commit--refine-excluded' : ''}"
			role="button"
			tabindex="0"
			data-commit-id=${commit.id}
			draggable=${reorderEnabled ? 'true' : 'false'}
			aria-current=${isSelected ? 'true' : 'false'}
			aria-roledescription=${reorderEnabled ? 'Draggable commit, use Alt+Arrow keys to reorder' : nothing}
			aria-label="Commit ${num}, ${pluralize('file', commit.files.length)}${ariaState ? `, ${ariaState}` : ''}"
			@click=${() => this.handleSelectCommit(commit.id)}
			@keydown=${(e: KeyboardEvent) => this.handleCommitKeydown(e, commit.id)}
		>
			<span class="compose-commit__num">
				<span class="compose-commit__grip" aria-hidden="true"
					>${reorderEnabled ? html`<code-icon icon="gripper"></code-icon>` : nothing}</span
				>
				<span class="compose-commit__num-value">${num}</span>
			</span>
			<div class="compose-commit__info">
				<div class="compose-commit__message-row">
					<gl-popover class="compose-commit__message" placement="bottom-start" trigger="hover">
						<span slot="anchor" class="compose-commit__message-content"
							>${this.renderCommitMessageInline(commit.message)}</span
						>
						<gl-markdown slot="content" .markdown=${commit.message}></gl-markdown>
					</gl-popover>
					<gl-tooltip placement="left">
						<gl-button
							class="compose-commit__action compose-commit__action--regen"
							appearance="toolbar"
							aria-label=${regenLabel}
							?disabled=${regenDisabled}
							@click=${(e: Event) => {
								e.stopPropagation();
								if (regenBlocked) return;

								this.handleRegenerateMessage(commit.id);
							}}
						>
							<code-icon
								.icon=${isRegeneratingThis ? 'loading' : 'sparkle'}
								.modifier=${isRegeneratingThis ? 'spin' : ''}
							></code-icon>
						</gl-button>
						<span slot="content">${regenLabel}</span>
					</gl-tooltip>
				</div>
				<span class="compose-commit__stats">
					${pluralize('file', commit.files.length)}
					<span class="compose-commit__additions">+${commit.additions}</span>
					<span class="compose-commit__deletions">&minus;${commit.deletions}</span>
				</span>
			</div>
			<div class="compose-commit__actions">
				<gl-tooltip placement="left">
					<gl-button
						class="compose-commit__check ${isChecked
							? 'compose-commit__check--on'
							: 'compose-commit__check--off'}"
						aria-pressed=${isChecked ? 'true' : 'false'}
						aria-label=${checkLabel}
						@click=${(e: Event) => {
							e.stopPropagation();
							if (this._refineMode) {
								this.handleToggleRefineExcluded(commit.id);
							} else {
								this.handleToggleCommitIncluded(commit.id);
							}
						}}
					>
						<code-icon icon="check"></code-icon>
					</gl-button>
					<span slot="content">${checkLabel}</span>
				</gl-tooltip>
			</div>
		</div>`;
	}

	private renderBaseCommit() {
		const base = this.baseCommit!;
		const shortSha = base.sha.substring(0, 7);
		const headline = base.message?.split('\n')[0]?.trim() || '(no message)';
		const dateLabel = base.date ? fromNow(new Date(base.date)) : undefined;

		return html`<div class="compose-base" title="Anchored at ${shortSha}">
			<span class="compose-base__marker" aria-hidden="true">&#9675;</span>
			<div class="compose-base__body">
				<span class="compose-base__headline">${headline}</span>
				<span class="compose-base__meta">
					<span class="compose-base__sha">${shortSha}</span>
					${base.author
						? html`<span class="compose-base__dot" aria-hidden="true">·</span>
								<span class="compose-base__author">${base.author}</span>`
						: nothing}
					${dateLabel
						? html`<span class="compose-base__dot" aria-hidden="true">·</span>
								<span class="compose-base__date">${dateLabel}</span>`
						: nothing}
				</span>
			</div>
			<span class="compose-base__tag">base</span>
		</div>`;
	}

	private renderSelectedCommitFiles() {
		const commit = this._selectedCommitId ? this.commits?.find(c => c.id === this._selectedCommitId) : undefined;
		const files = commit?.files ?? [];
		const emptyText = commit ? 'No files changed' : 'Select a commit above to see the file changes';

		return html`<gl-file-tree-pane
			.files=${files}
			.filesLayout=${{ layout: this.fileLayout }}
			.collapsable=${false}
			show-file-icons
			header="File Changes"
			empty-text=${emptyText}
			?multi-selectable=${true}
			?draggable-files=${this.reorderEnabled}
			.fileActions=${this.fileActionsForFile}
			.fileContext=${this.getFileContext}
			.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			@file-open=${this.forwardFileEventWithVirtualRef}
			@file-compare-previous=${this.forwardFileEventWithVirtualRef}
			@file-stage=${this.redispatch}
			@file-unstage=${this.redispatch}
			@file-selection-changed=${(e: CustomEvent<{ files: readonly { path: string }[] }>) =>
				(this._selectedFiles = e.detail?.files ?? [])}
			@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
				// Share the same property as the idle-state file tree — separate slots meant
				// the user's layout choice in one view didn't carry over to the other.
				this.fileLayout = e.detail.layout;
			}}
		>
			${files.length > 0
				? renderOpenChangesAction({
						selectedCount: this._selectedFiles.length,
						slot: 'leading-actions',
						onOpenAll: () => this.onOpenMultiDiff(),
						onOpenSelected: () => this.onOpenSelectedChanges(),
					})
				: nothing}
		</gl-file-tree-pane>`;
	}

	/** Opens the selected proposed commit's full change set as a multi-diff (via `compose-open-multi-diff`). */
	private onOpenMultiDiff = (): void => {
		const commit = this.commits?.find(c => c.id === this._selectedCommitId);
		const virtualRef = commit?.virtualRef;
		const files = commit?.files;
		if (virtualRef == null || !files?.length) return;

		this.dispatchEvent(
			new CustomEvent('compose-open-multi-diff', {
				detail: { virtualRef: virtualRef, files: files },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private onOpenSelectedChanges = (): void => {
		const commit = this.commits?.find(c => c.id === this._selectedCommitId);
		const virtualRef = commit?.virtualRef;
		const selectedPaths = new Set(this._selectedFiles.map(f => f.path));
		const files = commit?.files?.filter(f => selectedPaths.has(f.path));
		if (virtualRef == null || !files?.length) return;

		this.dispatchEvent(
			new CustomEvent('compose-open-multi-diff', {
				detail: { virtualRef: virtualRef, files: files },
				bubbles: true,
				composed: true,
			}),
		);
	};

	/** Opens the idle curation scope's change set as a multi-diff (via `scope-open-multi-diff`). */
	private onOpenScopeMultiDiff = (files: readonly GitFileChangeShape[]): void => {
		if (!files.length) return;

		this.dispatchEvent(
			new CustomEvent('scope-open-multi-diff', {
				detail: { files: files },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private fileActionsForFile = (_file: ProposedCommitFile): TreeItemAction[] => {
		return [{ icon: 'go-to-file', label: 'Open File', action: 'file-open' }];
	};

	private getFileContext = (file: ProposedCommitFile): string | undefined => {
		if (!this.repoPath) return undefined;

		let context: DetailsItemTypedContext;
		if (file.anchor === 'committed' && file.anchorSha) {
			context = {
				webviewItem: 'gitlens:file+committed',
				webviewItemValue: {
					type: 'file',
					path: file.path,
					repoPath: this.repoPath,
					sha: file.anchorSha,
					status: file.status,
				},
			};
		} else {
			context = {
				webviewItem: file.staged ? 'gitlens:file+staged' : 'gitlens:file+unstaged',
				webviewItemValue: {
					type: 'file',
					path: file.path,
					repoPath: this.repoPath,
					sha: uncommitted,
					staged: file.staged,
					status: file.status,
				},
			};
		}

		return serializeWebviewItemContext(context);
	};

	private redispatch = redispatch.bind(this);

	/**
	 * Forward `file-open` / `file-compare-previous` with the selected proposed commit's virtual ref
	 * attached on the detail as `virtualRef`, so the details panel can route them through
	 * `FilesService.openVirtualFile*` — synthesizing per-commit content via the virtual FS provider
	 * instead of trying to resolve a non-existent SHA. Falls back to a plain re-dispatch when no
	 * session is active (virtualRef is absent), which preserves today's working-tree behavior.
	 */
	private forwardFileEventWithVirtualRef = (e: CustomEvent<FileChangeListItemDetail>): void => {
		const commit = this.commits?.find(c => c.id === this._selectedCommitId);
		const virtualRef = commit?.virtualRef;
		const detail = virtualRef != null ? { ...e.detail, virtualRef: virtualRef } : e.detail;
		this.dispatchEvent(new CustomEvent(e.type, { detail: detail, bubbles: true, composed: true }));
	};

	private handleSelectCommit(id: string): void {
		this._selectedCommitId = this._selectedCommitId === id ? undefined : id;
	}

	private handleCommitAll(): void {
		const includedCommitIds =
			this._excludedCommitIds.size === 0
				? undefined
				: this.commits?.filter(c => !this._excludedCommitIds.has(c.id)).map(c => c.id);

		this.dispatchEvent(
			new CustomEvent<ComposeCommitAllDetail>('compose-commit-all', {
				detail: { includedCommitIds: includedCommitIds },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleToggleRefineExcluded(commitId: string): void {
		const excluded = !this.excludedCommitIds.has(commitId);
		this.dispatchEvent(
			new CustomEvent<ComposeRefineExcludeToggleDetail>('compose-refine-exclude-toggle', {
				detail: { commitId: commitId, excluded: excluded },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleRegenerateMessage(commitId: string): void {
		this.dispatchEvent(
			new CustomEvent<ComposeRegenMessageDetail>('compose-regen-message', {
				detail: { commitId: commitId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** Emit the new full display order for the parent/controller to apply + sync to the host. */
	private handleReorder(orderedCommitIds: string[]): void {
		this.dispatchEvent(
			new CustomEvent<ComposeReorderDetail>('compose-reorder', {
				detail: { orderedCommitIds: orderedCommitIds },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleCommitKeydown(e: KeyboardEvent, commitId: string): void {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.handleSelectCommit(commitId);
			return;
		}

		// Alt+Arrow (or Alt+J/K) nudges the focused commit one row. The keyed list moves the same
		// DOM node, so focus rides along with it — no manual focus restore needed.
		if (!e.altKey || !this.reorderEnabled) return;

		let offset = 0;
		if (e.key === 'ArrowUp' || e.key === 'k') {
			offset = -1;
		} else if (e.key === 'ArrowDown' || e.key === 'j') {
			offset = 1;
		}
		if (offset === 0) return;

		e.preventDefault();
		this.moveCommitByOffset(commitId, offset);
	}

	private moveCommitByOffset(commitId: string, offset: number): void {
		const ids = this.commits?.map(c => c.id);
		if (ids == null) return;

		const from = ids.indexOf(commitId);
		if (from === -1) return;

		const to = from + offset;
		if (to < 0 || to >= ids.length) return;

		const next = [...ids];
		next.splice(from, 1);
		next.splice(to, 0, commitId);
		this.handleReorder(next);
	}

	private handleDragStart(e: DragEvent): void {
		if (!this.reorderEnabled) return;

		const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.compose-commit');
		const id = row?.dataset.commitId;
		if (row == null || !id) return;

		// Clear any state stranded by a prior drag whose end was lost at the webview boundary.
		this.clearAllDragState();

		this._draggedCommitId = id;
		this.attachDragBoundaryListeners();
		if (e.dataTransfer != null) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', id);
		}
		// Defer the class so the native drag image captures the row at full opacity.
		requestAnimationFrame(() => row.classList.add('dragging'));
	}

	private handleDragEnd(): void {
		this.clearAllDragState();
	}

	private handleDragOver(e: DragEvent): void {
		// A file drag (from the file pane) targets whole commit rows; the commit-reorder logic below
		// only runs for a commit drag. The two are told apart by the drag's data type.
		const fileDrag = e.dataTransfer?.types.includes(treeItemFileDragDataType) ?? false;

		// Auto-scroll the commit list toward off-screen rows when dragging near its edges — for both
		// a commit reorder and a file → commit move.
		if (fileDrag || this._draggedCommitId != null) {
			this.updateAutoScroll(e.clientY);
		}

		if (fileDrag) {
			this.handleFileDragOver(e);
			return;
		}

		if (this._draggedCommitId == null) return;

		const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.compose-commit');
		const id = row?.dataset.commitId;
		if (row == null || !id) return;

		// Signal a valid drop target.
		e.preventDefault();
		if (e.dataTransfer != null) {
			e.dataTransfer.dropEffect = 'move';
		}

		if (id === this._draggedCommitId) {
			this.clearDragOverIndicator();
			return;
		}

		const rect = row.getBoundingClientRect();
		const isBottom = e.clientY > rect.top + rect.height / 2;
		this.updateDragOverIndicator(id, row, isBottom);
	}

	private handleDragLeave(e: DragEvent): void {
		// dragleave fires on every inner-element transition; only act when the drag actually leaves the
		// list, otherwise the indicator flickers off/on between a row and its children.
		const list = this.renderRoot.querySelector<HTMLElement>('.compose-plan__list');
		const related = e.relatedTarget as Node | null;
		if (list == null || related == null || !list.contains(related)) {
			this.clearDragOverIndicator();
			this.clearFileDropTarget();
			this.stopAutoScroll();
		}
	}

	private handleDrop(e: DragEvent): void {
		if (e.dataTransfer?.types.includes(treeItemFileDragDataType)) {
			this.handleFileDrop(e);
			return;
		}

		const draggedId = e.dataTransfer?.getData('text/plain') || this._draggedCommitId;
		const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.compose-commit');
		const targetId = row?.dataset.commitId;
		if (row == null || !draggedId || !targetId || draggedId === targetId) {
			this.clearDragState();
			return;
		}

		e.preventDefault();

		// Recompute the insert side from the actual drop position — dragover events may have been
		// missed or targeted a child element.
		const rect = row.getBoundingClientRect();
		const insertAfter = e.clientY > rect.top + rect.height / 2;

		const ids = this.commits?.map(c => c.id) ?? [];
		const from = ids.indexOf(draggedId);
		if (from === -1 || !ids.includes(targetId)) {
			this.clearDragState();
			return;
		}

		const next = [...ids];
		next.splice(from, 1);
		const target = next.indexOf(targetId);
		next.splice(insertAfter ? target + 1 : target, 0, draggedId);

		this.clearDragState();

		if (next.some((id, i) => id !== ids[i])) {
			this.handleReorder(next);
		}
	}

	/** Smoothly scroll the commit list while a drag hovers within the edge zone, via a rAF loop so it's
	 *  frame-paced rather than jumping at the irregular cadence of `dragover` events. */
	private updateAutoScroll(clientY: number): void {
		const list = this.renderRoot.querySelector<HTMLElement>('.compose-plan__list');
		if (list == null) {
			this.stopAutoScroll();
			return;
		}

		const rect = list.getBoundingClientRect();
		if (clientY < rect.top + composeDragScrollZone) {
			this._autoScrollDir = -1;
		} else if (clientY > rect.bottom - composeDragScrollZone) {
			this._autoScrollDir = 1;
		} else {
			this.stopAutoScroll();
			return;
		}

		this._autoScrollRaf ??= requestAnimationFrame(this._autoScrollTick);
	}

	private readonly _autoScrollTick = (): void => {
		const list = this.renderRoot.querySelector<HTMLElement>('.compose-plan__list');
		if (list == null || this._autoScrollDir === 0) {
			this.stopAutoScroll();
			return;
		}

		list.scrollBy({ top: this._autoScrollDir * composeDragScrollSpeed, behavior: 'instant' });
		this._autoScrollRaf = requestAnimationFrame(this._autoScrollTick);
	};

	private stopAutoScroll(): void {
		if (this._autoScrollRaf != null) {
			cancelAnimationFrame(this._autoScrollRaf);
			this._autoScrollRaf = undefined;
		}
		this._autoScrollDir = 0;
	}

	private updateDragOverIndicator(id: string, row: HTMLElement, isBottom: boolean): void {
		if (this._dragOverCommitId === id && this._dragOverBottom === isBottom) return;

		this.clearDragOverIndicator();
		this._dragOverCommitId = id;
		this._dragOverBottom = isBottom;
		row.classList.add('compose-commit--drag-over');
		row.classList.toggle('compose-commit--drag-over-bottom', isBottom);
	}

	private clearDragOverIndicator(): void {
		this._dragOverCommitId = undefined;
		this._dragOverBottom = false;
		for (const el of this.renderRoot.querySelectorAll(
			'.compose-commit--drag-over, .compose-commit--drag-over-bottom',
		)) {
			el.classList.remove('compose-commit--drag-over', 'compose-commit--drag-over-bottom');
		}
	}

	private clearDragState(): void {
		this.clearDragOverIndicator();
		this._draggedCommitId = undefined;
		for (const el of this.renderRoot.querySelectorAll('.compose-commit.dragging')) {
			el.classList.remove('dragging');
		}
	}

	/** Clears both the commit-reorder and the file-move transient drag state and detaches the
	 *  boundary-recovery listener. Used by the local dragend/drop handlers and each drag start. */
	private clearAllDragState(): void {
		this.detachDragBoundaryListeners();
		this.stopAutoScroll();
		this.clearDragState();
		this.clearFileDropTarget();
		this._fileDragSourceCommitId = undefined;
	}

	/** Capture which commit a file is being dragged out of — only the selected commit's files are
	 *  shown, so the source is unambiguous. Ignores commit-reorder drags (no file data type). */
	private handleFileDragStart(e: DragEvent): void {
		if (!e.dataTransfer?.types.includes(treeItemFileDragDataType)) return;

		// Clear any state stranded by a prior drag whose end was lost at the webview boundary.
		this.clearAllDragState();

		this._fileDragSourceCommitId = this._selectedCommitId;
		this.attachDragBoundaryListeners();
	}

	private handleFileDragEnd(): void {
		this.clearAllDragState();
	}

	private handleFileDragOver(e: DragEvent): void {
		const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.compose-commit');
		const id = row?.dataset.commitId;
		// Can't drop a file back onto the commit it already belongs to.
		if (row == null || !id || id === this._fileDragSourceCommitId) {
			this.clearFileDropTarget();
			return;
		}

		e.preventDefault();
		if (e.dataTransfer != null) {
			e.dataTransfer.dropEffect = 'move';
		}
		this.setFileDropTarget(row, id);
	}

	private handleFileDrop(e: DragEvent): void {
		const path = e.dataTransfer?.getData(treeItemFileDragDataType);
		const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.compose-commit');
		const toCommitId = row?.dataset.commitId;
		const fromCommitId = this._fileDragSourceCommitId;
		this.clearFileDropTarget();
		this._fileDragSourceCommitId = undefined;

		if (!path || !toCommitId || !fromCommitId || toCommitId === fromCommitId) return;

		e.preventDefault();
		this.dispatchEvent(
			new CustomEvent<ComposeMoveFileDetail>('compose-move-file', {
				detail: { path: path, fromCommitId: fromCommitId, toCommitId: toCommitId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private setFileDropTarget(row: HTMLElement, id: string): void {
		if (this._fileDropTargetCommitId === id) return;

		this.clearFileDropTarget();
		this._fileDropTargetCommitId = id;
		row.classList.add('compose-commit--file-drop-target');
	}

	private clearFileDropTarget(): void {
		this._fileDropTargetCommitId = undefined;
		for (const el of this.renderRoot.querySelectorAll('.compose-commit--file-drop-target')) {
			el.classList.remove('compose-commit--file-drop-target');
		}
	}

	private handleToggleCommitIncluded(commitId: string): void {
		const next = new Set(this._excludedCommitIds);
		if (next.has(commitId)) {
			next.delete(commitId);
		} else {
			next.add(commitId);
		}
		this._excludedCommitIds = next;
	}

	private handleToggleRefineMode(e: Event): void {
		this._refineMode = (e.target as { checked?: boolean }).checked ?? !this._refineMode;
	}
}
