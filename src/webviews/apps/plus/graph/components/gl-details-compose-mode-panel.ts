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
import type { ProposedCommit, ProposedCommitFile, ScopeSelection } from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { redispatch } from '../../../shared/components/element.js';
import { elementBase, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemAction, TreeItemCheckedDetail } from '../../../shared/components/tree/base.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
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
import '../../../shared/components/chips/action-chip.js';
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
			const next = this.aiExcludedFiles?.length ? new Set(this.aiExcludedFiles) : undefined;
			const prev = this._aiExcludedSet;
			const sameSize = (next?.size ?? 0) === (prev?.size ?? 0);
			const sameContent = sameSize && (!next || [...next].every(p => prev?.has(p)));
			if (!sameContent) {
				this._aiExcludedSet = next;
				if (this.aiExcludedFiles?.length) {
					const merged = new Set(this._excludedFiles);
					let dirty = false;
					for (const path of this.aiExcludedFiles) {
						if (!merged.has(path)) {
							merged.add(path);
							dirty = true;
						}
					}
					if (dirty) {
						this._excludedFiles = merged;
					}
				}
			}
		}

		if (changedProperties.has('files') && this._excludedFiles.size > 0) {
			// Prune exclusions whose paths are no longer in the current scoped file list.
			const current = new Set((this.files ?? []).map(f => f.path));
			let changed = false;
			const next = new Set<string>();
			for (const path of this._excludedFiles) {
				if (current.has(path)) {
					next.add(path);
				} else {
					changed = true;
				}
			}
			if (changed) {
				this._excludedFiles = next;
			}
		}
	}

	private getEffectiveFileCount(): number {
		const files = this.files;
		if (!files?.length) return 0;
		const ai = this._aiExcludedSet;
		let count = 0;
		for (const f of files) {
			if (this._excludedFiles.has(f.path)) continue;
			if (ai?.has(f.path)) continue;
			count++;
		}
		return count;
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
		return html`<gl-tooltip hoist placement="bottom" content="Resume Last Compose">
			<button class="review-forward" @click=${this.handleForward}>
				<code-icon icon="history"></code-icon>
				<span>Resume Last Compose</span>
				<code-icon class="review-forward__action" icon="arrow-right"></code-icon>
			</button>
		</gl-tooltip>`;
	}

	private handleCancel = (): void => {
		this.dispatchEvent(new CustomEvent('compose-cancel', { bubbles: true, composed: true }));
	};

	private renderCancelChip() {
		return html`<gl-action-chip
			class="compose-cancel"
			icon="stop-circle"
			label="Cancel"
			overlay="tooltip"
			@click=${this.handleCancel}
		>
			<span>Cancel</span>
		</gl-action-chip>`;
	}

	override render() {
		return html`<div class="compose-panel">${this.renderContent()}</div>`;
	}

	private renderContent() {
		if (this.status === 'idle') {
			return this.renderIdleState();
		}

		if (this.status === 'loading') {
			// Cancel chip lets the user abort an in-flight AI call; the orchestrator wires
			// `compose-cancel` to the actual cancellation plumbing.
			return html`${renderLoadingState('Composing changes...')}${this.renderCancelChip()}`;
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

	private onToggleCheckAll(e: CustomEvent<{ checked: boolean }>): void {
		if (e.detail.checked) {
			this._excludedFiles = new Set<string>();
		} else {
			const aiExcluded = this._aiExcludedSet;
			const next = new Set<string>();
			for (const file of this.files ?? []) {
				if (!aiExcluded?.has(file.path)) {
					next.add(file.path);
				}
			}
			this._excludedFiles = next;
		}
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

		const filesContent = this.renderSelectedCommitFiles();
		const hasFiles = filesContent !== nothing;
		const isLoading = this.status === 'loading';
		const totalFiles = this.commits.reduce((sum, c) => sum + c.files.length, 0);

		const commitAllRow = html`<div class="compose-plan__commit-all">
			<gl-button full @click=${this.handleCommitAll}>Commit All</gl-button>
		</div>`;

		const listEl = html`<div class="compose-plan__list scrollable">
			${this.commits.map((commit, i) => this.renderProposedCommit(commit, i))}
			${this.baseCommit ? this.renderBaseCommit() : nothing}
		</div>`;

		const body = hasFiles
			? html`<gl-split-panel class="compose-plan__split" orientation="vertical" primary="end" position="50">
					<div slot="start" class="compose-plan__split-start">${listEl}</div>
					<div slot="end" class="compose-plan__split-end">${commitAllRow}${filesContent}</div>
				</gl-split-panel>`
			: listEl;

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
				${body}
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
			${hasFiles ? nothing : html`<div class="compose-plan__actions">${commitAllRow}</div>`}
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
				: html`<gl-tooltip placement="left" hoist>
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
		if (!this._selectedCommitId) return nothing;
		const commit = this.commits?.find(c => c.id === this._selectedCommitId);
		if (!commit?.files.length) return nothing;

		return html`<gl-file-tree-pane
			.files=${commit.files}
			.filesLayout=${{ layout: this._fileLayout }}
			.collapsable=${false}
			show-file-icons
			header="File Changes"
			.fileActions=${this.fileActionsForFile}
			.fileContext=${this.getFileContext}
			@file-open=${this.redispatch}
			@file-compare-previous=${this.handleFileCompareAsOpen}
			@file-stage=${this.redispatch}
			@file-unstage=${this.redispatch}
			@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
				this._fileLayout = e.detail.layout;
			}}
		></gl-file-tree-pane>`;
	}

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

	/** Re-dispatch `file-compare-previous` as `file-open` (the composer maps the "compare" affordance to open). */
	private handleFileCompareAsOpen = (e: CustomEvent<FileChangeListItemDetail>): void => {
		this.dispatchEvent(new CustomEvent('file-open', { detail: e.detail, bubbles: true, composed: true }));
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
