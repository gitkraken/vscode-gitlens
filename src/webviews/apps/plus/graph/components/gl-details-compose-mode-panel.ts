import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
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
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { countIncludedFiles, pruneExcludedToFiles, syncAiExcluded } from './aiExclusion.js';
import type { GlCommitsScopePane, ScopeItem } from './gl-commits-scope-pane.js';
import {
	composeModePanelStyles,
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	panelStaleBannerStyles,
} from './gl-details-compose-mode-panel.css.js';
import { renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/button.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/split-panel/split-panel.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import './gl-commits-scope-pane.js';

export interface ComposeCommitDetail {
	upToIndex: number;
}

@customElement('gl-details-compose-mode-panel')
export class GlDetailsComposeModePanel extends LitElement {
	static override styles = [
		elementBase,
		subPanelEnterStyles,
		panelHostStyles,
		panelActionInputStyles,
		panelLoadingStyles,
		panelErrorStyles,
		panelStaleBannerStyles,
		panelScopeSplitStyles,
		composeModePanelStyles,
	];

	@property({ attribute: 'status' })
	status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

	@property()
	errorMessage?: string;

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

	@state() private _selectedCommitId?: string;
	@state() private _committedUpTo = -1;
	@state() private _fileLayout: ViewFilesLayout = 'auto';
	@state() private _excludedFiles = new Set<string>();
	@state() private _aiExcludedSet: ReadonlySet<string> | undefined;

	/** Pushed by the orchestrator from `state.composeForwardAvailable`. See review panel for the
	 * full restore-vs-rerun rationale — chip click emits `compose-forward` for the orchestrator
	 * to mutate the resource back to the snapshot (no AI re-run). */
	@property({ type: Boolean, attribute: 'forward-available', reflect: true })
	forwardAvailable = false;

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
			const pruned = pruneExcludedToFiles(this._excludedFiles, this.files);
			if (pruned != null) {
				this._excludedFiles = pruned;
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
		// Flip overflow from hidden to auto only after the slide-up settles, preventing
		// scrollbar flicker as the transform animates.
		this.addEventListener('animationend', this.onAnimationEnd);
	}

	override disconnectedCallback(): void {
		this.removeEventListener('animationend', this.onAnimationEnd);
		super.disconnectedCallback?.();
	}

	private onAnimationEnd = (e: AnimationEvent): void => {
		if (e.animationName === 'sub-panel-enter') {
			this.setAttribute('data-anim-done', '');
		}
	};

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

	private renderForwardChip() {
		return html`<gl-button
			class="review-forward"
			appearance="toolbar"
			density="tight"
			tooltip="Resume Last Compose"
			@click=${this.handleForward}
			>Resume Last Compose<code-icon slot="suffix" icon="arrow-right"></code-icon
		></gl-button>`;
	}

	private handleCancel = (): void => {
		this.dispatchEvent(new CustomEvent('compose-cancel', { bubbles: true, composed: true }));
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
			return html`${renderLoadingState(this.progressMessage ?? 'Composing changes…')}${this.renderCancelButton()}`;
		}

		if (this.status === 'error') {
			return renderErrorState(this.errorMessage, 'An error occurred during composition.', 'compose-generate');
		}

		if (this.status !== 'ready' || !this.commits) return nothing;

		return this.renderPlan();
	}

	private renderIdleState() {
		const hasPicker = (this.scopeItems?.length ?? 0) > 0 || this.scopeLoading;

		// Disable Compose when no files are effectively included (after both user and AI
		// exclusions). Stale user exclusions are pruned in willUpdate.
		const disabled = this.getEffectiveFileCount() === 0;

		const aiInput = html`<div class="review-input-row">
			<gl-ai-input
				class="review-action-input"
				multiline
				active
				rows="2"
				button-label="Compose"
				busy-label="Composing changes…"
				event-name="compose-generate"
				placeholder='Instructions — e.g. "Group by feature, keep perf changes separate"'
				.busy=${this.status === 'loading'}
				?disabled=${disabled}
				@input=${this.onAiInputType}
			>
				<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
			</gl-ai-input>
		</div>`;

		const forwardBar = this.forwardAvailable ? this.renderForwardChip() : nothing;

		if (!hasPicker) {
			return html`
				${forwardBar}
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
			${forwardBar}
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
					?show-file-icons=${true}
					.collapsable=${false}
					.filesLayout=${{ layout: this.fileLayout }}
					.checkableStates=${checkableStates}
					.fileActions=${this.idleFileActionsForFile}
					.fileContext=${this.getIdleFileContext}
					.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
					.searchContext=${this.searchContext}
					check-verb="Include"
					uncheck-verb="Exclude"
					empty-text="No files changed"
					@file-checked=${this.onFileChecked}
					@gl-check-all=${this.onToggleCheckAll}
					@file-open=${this.redispatch}
					@file-stage=${this.redispatch}
					@file-unstage=${this.redispatch}
					@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
						this.fileLayout = e.detail.layout;
					}}
				></gl-file-tree-pane>
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

		const maxPercent = Math.min(70, (scopeEl.contentHeight / size) * 100);
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

		const isLoading = this.status === 'loading';
		const totalFiles = this.commits.reduce((sum, c) => sum + c.files.length, 0);

		const commitAllRow = html`<div class="compose-plan__commit-all">
			<gl-button full @click=${this.handleCommitAll}>Commit All</gl-button>
		</div>`;

		const listEl = html`<div class="compose-plan__list scrollable">
			${this.commits.map((commit, i) => this.renderProposedCommit(commit, i))}
			${this.baseCommit ? this.renderBaseCommit() : nothing}
		</div>`;

		return html`
			<div class="compose-plan">
				${this.stale ? this.renderStaleBanner() : nothing}
				<div class="compose-plan__header">
					<gl-button
						class="compose-plan__back"
						appearance="toolbar"
						density="compact"
						tooltip="Back to Compose"
						@click=${this.handleBack}
					>
						<code-icon icon="arrow-left"></code-icon>
					</gl-button>
					<span class="compose-plan__title">Compose Plan</span>
					<span class="compose-plan__count">
						<span class="compose-plan__count-item">
							<code-icon icon="git-commit"></code-icon>
							${pluralize('commit', this.commits.length)}
						</span>
						<span class="compose-plan__count-item">
							<code-icon icon="files"></code-icon>
							${pluralize('file', totalFiles)}
						</span>
					</span>
				</div>
				<gl-split-panel class="compose-plan__split" orientation="vertical" primary="end" position="50">
					<div slot="start" class="compose-plan__split-start">${listEl}</div>
					<div slot="end" class="compose-plan__split-end">
						${commitAllRow}${this.renderSelectedCommitFiles()}
					</div>
				</gl-split-panel>
			</div>
			<gl-ai-input
				class="review-action-input"
				multiline
				active
				rows="2"
				button-label="Refine"
				busy-label="Recomposing…"
				event-name="compose-refine"
				placeholder='Refine — e.g. "Merge commits 1 and 2, they&apos;re related"'
				.busy=${isLoading}
			>
				<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
			</gl-ai-input>
		`;
	}

	private renderProposedCommit(commit: ProposedCommit, index: number) {
		const num = this.commits!.length - index;
		const isSelected = this._selectedCommitId === commit.id;
		const isCommitted = index > this.commits!.length - 1 - this._committedUpTo;
		const isNext = index === this.commits!.length - 1 - this._committedUpTo;

		return html`<div
			class="compose-commit ${isSelected ? 'compose-commit--selected' : ''} ${isCommitted
				? 'compose-commit--committed'
				: ''}"
			@click=${() => this.handleSelectCommit(commit.id)}
		>
			<span class="compose-commit__num">${num}</span>
			<div class="compose-commit__info">
				<span class="compose-commit__message">${commit.message}</span>
				<span class="compose-commit__stats">
					${pluralize('file', commit.files.length)}
					<span class="compose-commit__additions">+${commit.additions}</span>
					<span class="compose-commit__deletions">&minus;${commit.deletions}</span>
				</span>
			</div>
			${isCommitted
				? nothing
				: html`<gl-tooltip placement="left">
						<button
							class="compose-commit__action ${isNext ? 'compose-commit__action--next' : ''}"
							aria-label="Commit Up To Here"
							@click=${(e: Event) => {
								e.stopPropagation();
								this.handleCommitTo(index);
							}}
						>
							<code-icon icon="check"></code-icon>
						</button>
						<span slot="content">Commit Up To Here</span>
					</gl-tooltip>`}
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
			.filesLayout=${{ layout: this._fileLayout }}
			.collapsable=${false}
			show-file-icons
			header="File Changes"
			empty-text=${emptyText}
			.buttons=${['multi-diff', 'layout', 'search']}
			.fileActions=${this.fileActionsForFile}
			.fileContext=${this.getFileContext}
			.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
			@file-open=${this.forwardFileEventWithVirtualRef}
			@file-compare-previous=${this.forwardFileEventWithVirtualRef}
			@file-stage=${this.redispatch}
			@file-unstage=${this.redispatch}
			@gl-file-tree-pane-open-multi-diff=${this.onOpenMultiDiff}
			@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
				this._fileLayout = e.detail.layout;
			}}
		></gl-file-tree-pane>`;
	}

	/**
	 * Bridge the file tree's `gl-file-tree-pane-open-multi-diff` event into a
	 * `compose-open-multi-diff` event carrying the selected proposed commit's virtualRef and the
	 * file list. The graph details panel routes this through `openVirtualMultipleChanges` so the
	 * multi-diff editor sees per-commit synthesized content from the virtual FS provider.
	 */
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

	private handleBack(): void {
		this.dispatchEvent(new CustomEvent('compose-back', { bubbles: true, composed: true }));
	}

	private handleSelectCommit(id: string): void {
		this._selectedCommitId = this._selectedCommitId === id ? undefined : id;
	}

	private handleCommitAll(): void {
		this.dispatchEvent(new CustomEvent('compose-commit-all', { bubbles: true, composed: true }));
	}

	private handleCommitTo(index: number): void {
		this.dispatchEvent(
			new CustomEvent<ComposeCommitDetail>('compose-commit-to', {
				detail: { upToIndex: index },
				bubbles: true,
				composed: true,
			}),
		);
	}
}
