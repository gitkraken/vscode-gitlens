import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
	AIReviewDetailResult,
	AIReviewFinding,
	AIReviewFocusArea,
	AIReviewResult,
} from '@gitlens/ai/models/results.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import { serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { DetailsItemTypedContext } from '../../../../plus/graph/detailsProtocol.js';
import { buildFolderContext } from '../../../../plus/graph/detailsProtocol.js';
import type { ScopeSelection } from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { redispatch } from '../../../shared/components/element.js';
import {
	elementBase,
	metadataBarVarsBase,
	subPanelEnterStyles,
} from '../../../shared/components/styles/lit/base.css.js';
import type { TreeItemAction, TreeItemCheckedDetail } from '../../../shared/components/tree/base.js';
import { countIncludedFiles, pruneExcludedToFiles, syncAiExcluded } from './aiExclusion.js';
import type { GlCommitsScopePane, ScopeItem } from './gl-commits-scope-pane.js';
import {
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	panelStaleBannerStyles,
	resumeBarStyles,
	reviewModePanelStyles,
} from './gl-details-review-mode-panel.css.js';
import { formatFindingAsMarkdown, formatFocusAreaAsMarkdown, formatReviewAsMarkdown } from './reviewFormat.js';
import { getScopeSplitPickerChrome, renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/copy-container.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/split-panel/split-panel.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import './gl-categorizing-loading-animation.js';
import './gl-commits-scope-pane.js';

export interface ReviewOpenFileDetail {
	filePath: string;
	line?: number;
}

export interface ReviewAnalyzeAreaDetail {
	focusAreaId: string;
	files: string[];
}

export interface ReviewSendToChatDetail {
	granularity: 'review' | 'focusArea' | 'finding';
	scopeLabel: string;
	reviewMarkdown: string;
}

export interface ReviewCopiedDetail {
	granularity: 'review' | 'focusArea' | 'finding';
}

@customElement('gl-details-review-mode-panel')
export class GlDetailsReviewModePanel extends LitElement {
	static override styles = [
		elementBase,
		metadataBarVarsBase,
		subPanelEnterStyles,
		panelHostStyles,
		panelActionInputStyles,
		panelLoadingStyles,
		panelErrorStyles,
		panelStaleBannerStyles,
		panelScopeSplitStyles,
		resumeBarStyles,
		reviewModePanelStyles,
	];

	@property({ type: Object })
	scope?: ScopeSelection;

	@property({ type: Object })
	result?: AIReviewResult;

	@property({ attribute: 'status' })
	status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

	@property()
	errorMessage?: string;

	@property({ type: Array })
	scopeItems?: ScopeItem[];

	@property({ type: Array })
	files?: readonly GitFileChangeShape[];

	@property({ type: Array })
	aiExcludedFiles?: readonly string[];

	@property({ type: Boolean })
	stale = false;

	@property()
	fileLayout: ViewFilesLayout = 'auto';

	@property()
	repoPath?: string;

	/** Friendly name of the current repo/worktree (basename of the worktree path). Used to
	 *  identify the scope in clipboard markdown and agent prompts. */
	@property()
	repoName?: string;

	/** Whether the current repo is a linked worktree (true) or the primary/main worktree (false).
	 *  Drives the "main worktree" vs "<name> worktree" phrasing in the scope context label. */
	@property({ type: Boolean })
	isLinkedWorktree = false;

	/** Current HEAD branch name. Identifies WIP scope in markdown/agent context. */
	@property()
	branchName?: string;

	@property({ type: Object })
	searchContext?: GitCommitSearchContext;

	@property({ type: Object })
	aiModel?: AiModelInfo;

	@state() private _excludedFiles = new Set<string>();

	/**
	 * Pushed by the orchestrator from `state.reviewForwardAvailable`. True after the user clicked
	 * Back on a successfully-resolved review — the orchestrator owns a snapshot of that result so
	 * the bar's click can RESTORE the previous findings (no AI re-run). The panel only renders
	 * the bar; the orchestrator handles `review-forward` and `review-forward-invalidate`.
	 */
	@property({ type: Boolean, attribute: 'forward-available', reflect: true })
	forwardAvailable = false;

	/** Preview metadata pushed from `state.reviewBackPreview` — drives the count display on the
	 * resume bar. Cleared by the orchestrator in lockstep with `forwardAvailable`. */
	@property({ type: Object, attribute: false })
	backPreview?: { findingCount: number; fileCount: number };

	get excludedFiles(): ReadonlySet<string> {
		return this._excludedFiles;
	}

	/**
	 * Returns the scope picker's currently-selected IDs (within this panel's shadow root).
	 * Exposed so the orchestrator can read scope state without trying to traverse shadow DOM
	 * via `querySelector` (which doesn't pierce shadow boundaries).
	 */
	get selectedIds(): ReadonlySet<string> | undefined {
		const picker = this.renderRoot.querySelector<GlCommitsScopePane>('gl-commits-scope-pane');
		if (picker == null) return undefined;
		return new Set(picker.selectedIds);
	}

	@state() private _expandedAreas = new Set<string>();
	@state() private _dismissedFindings = new Set<string>();
	@state() private _loadingAreas = new Set<string>();
	@state() private _errorAreas = new Set<string>();
	@state() private _aiExcludedSet: ReadonlySet<string> | undefined;

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
		this.setAttribute('aria-label', 'AI Code Review');
	}

	override render() {
		return html` <div class="review-panel">${this.renderContent()}</div> `;
	}

	private renderContent() {
		if (this.status === 'idle') {
			return this.renderIdleState();
		}

		if (this.status === 'loading') {
			return this.renderLoadingWithCancel();
		}

		if (this.status === 'error') {
			return renderErrorState(this.errorMessage, 'An error occurred during review.', 'review-run');
		}

		if (this.status !== 'ready' || !this.result) return nothing;

		return html`${this.renderReadyHeader()} ${this.renderReadyMetadataBar()}
			<div class="review-results scrollable">
				${this.stale ? this.renderStaleBanner() : nothing} ${this.renderOverview()} ${this.renderFocusAreas()}
			</div>`;
	}

	private renderLoadingWithCancel() {
		// Animation sits behind the spinner/cancel as decoration; uses the review color triplet
		// (green/yellow/red) and self-disables under prefers-reduced-motion.
		return html`<div class="review-loading-stage">
			<gl-categorizing-loading-animation variant="review"></gl-categorizing-loading-animation>
			<div class="review-loading-wrap">
				${renderLoadingState('Analyzing changes...')}
				<gl-button class="review-cancel" appearance="secondary" @click=${this.handleCancel}>Cancel</gl-button>
			</div>
		</div>`;
	}

	private renderReadyHeader() {
		// Count files actually included in this review (mirrors what runReview sent: files present
		// in the curation list minus both user and AI exclusions).
		const includedCount = this.getEffectiveFileCount();
		const scopeLabel = this.scopeSummary();
		const findingCount = this.result?.focusAreas.reduce((sum, a) => sum + (a.findings?.length ?? 0), 0) ?? 0;
		const reviewMarkdown = this.result ? formatReviewAsMarkdown(this.result, this.formatOptions()) : '';

		return html`<div class="review-header">
			<gl-button
				class="review-header__back"
				appearance="toolbar"
				density="compact"
				tooltip="Back to Files"
				@click=${this.handleBack}
			>
				<code-icon icon="arrow-left"></code-icon>
			</gl-button>
			<span class="review-header__title">Reviewing ${scopeLabel}</span>
			<span class="review-header__count">
				<span class="review-header__count-item">
					<code-icon icon="search"></code-icon>
					${pluralize('finding', findingCount)}
				</span>
				<span class="review-header__count-item">
					<code-icon icon="files"></code-icon>
					${pluralize('file', includedCount)}
				</span>
			</span>
			<span class="review-header__actions">
				<gl-copy-container
					appearance="toolbar"
					.content=${reviewMarkdown}
					copyLabel="Copy Review Findings"
					copiedLabel="Copied!"
					placement="bottom"
					timeout=${2500}
					@click=${() => this.dispatchCopied('review')}
				>
					<code-icon icon="copy"></code-icon>
				</gl-copy-container>
				<gl-button
					appearance="toolbar"
					density="compact"
					tooltip="Send Review to AI Agent"
					@click=${() => this.handleSendToChat('review')}
				>
					<code-icon icon="comment-discussion"></code-icon>
				</gl-button>
			</span>
		</div>`;
	}

	private formatOptions(): { scopeLabel: string; dismissed: ReadonlySet<string> } {
		return { scopeLabel: this.scopeContextLabel(), dismissed: this._dismissedFindings };
	}

	private buildReviewMarkdown(
		granularity: 'review' | 'focusArea' | 'finding',
		opts: { area?: AIReviewFocusArea; finding?: AIReviewFinding },
	): string {
		if (granularity === 'review') {
			return this.result ? formatReviewAsMarkdown(this.result, this.formatOptions()) : '';
		}
		if (granularity === 'focusArea' && opts.area) {
			return formatFocusAreaAsMarkdown(opts.area, this._dismissedFindings);
		}
		if (granularity === 'finding' && opts.finding) {
			const enclosing = opts.area ? { label: opts.area.label, rationale: opts.area.rationale } : undefined;
			return formatFindingAsMarkdown(opts.finding, enclosing);
		}
		return '';
	}

	private handleSendToChat(
		granularity: 'review' | 'focusArea' | 'finding',
		opts: { area?: AIReviewFocusArea; finding?: AIReviewFinding } = {},
	): void {
		const reviewMarkdown = this.buildReviewMarkdown(granularity, opts);
		if (!reviewMarkdown) return;
		this.dispatchEvent(
			new CustomEvent<ReviewSendToChatDetail>('review-send-to-chat', {
				detail: {
					granularity: granularity,
					scopeLabel: this.scopeContextLabel(),
					reviewMarkdown: reviewMarkdown,
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchCopied(granularity: 'review' | 'focusArea' | 'finding'): void {
		this.dispatchEvent(
			new CustomEvent<ReviewCopiedDetail>('review-copied', {
				detail: { granularity: granularity },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderReadyMetadataBar() {
		const scope = this.scope;
		if (!scope) return nothing;

		// Compare-style scopes render their own compact bar so the result view matches the
		// single-commit framing. Single-commit and WIP scopes inherit the host's bar.
		if (scope.type !== 'compare') return nothing;

		const fromSha = scope.fromSha;
		const toSha = scope.toSha;
		if (!fromSha || !toSha) return nothing;

		const includedCount = scope.includeShas?.length ?? 0;

		return html`<div class="review-metadata">
			<div class="review-metadata__left">
				<gl-commit-sha-copy
					class="review-metadata__sha"
					appearance="toolbar"
					tooltip-placement="bottom"
					copy-label="Copy SHA"
					copied-label="Copied!"
					.sha=${fromSha}
					icon="git-commit"
				></gl-commit-sha-copy>
				<span class="review-metadata__dots">..</span>
				<gl-commit-sha-copy
					class="review-metadata__sha"
					appearance="toolbar"
					tooltip-placement="bottom"
					copy-label="Copy SHA"
					copied-label="Copied!"
					.sha=${toSha}
					icon="git-commit"
				></gl-commit-sha-copy>
			</div>
			${includedCount > 0
				? html`<div class="review-metadata__right">
						<span class="review-metadata__count">${pluralize('commit', includedCount)} selected</span>
					</div>`
				: nothing}
		</div>`;
	}

	private scopeSummary(): string {
		const scope = this.scope;
		if (!scope) return 'changes';
		if (scope.type === 'commit') return 'commit';
		if (scope.type === 'compare') {
			const count = scope.includeShas?.length;
			return count ? pluralize('commit', count) : 'comparison';
		}
		// wip
		const parts: string[] = [];
		if (scope.includeStaged || scope.includeUnstaged) {
			parts.push('working changes');
		}
		const shaCount = scope.includeShas?.length ?? 0;
		if (shaCount > 0) {
			parts.push(pluralize('commit', shaCount));
		}
		return parts.length ? parts.join(' + ') : 'changes';
	}

	/**
	 * Richer scope label intended for clipboard markdown and AI agent prompts — gives the agent
	 * the actual identifiers (worktree name, branch, SHAs) so it can locate the changes the
	 * findings refer to. {@link scopeSummary} is intentionally terse for the visible header.
	 */
	private scopeContextLabel(): string {
		const scope = this.scope;
		const worktreeSuffix = this.repoName
			? this.isLinkedWorktree
				? ` in the \`${this.repoName}\` worktree`
				: ` in the \`${this.repoName}\` repository (main worktree)`
			: '';

		if (!scope) return `changes${worktreeSuffix}`;

		if (scope.type === 'commit') {
			return `commit \`${shortenRevision(scope.sha)}\`${worktreeSuffix}`;
		}

		if (scope.type === 'compare') {
			const range = `\`${shortenRevision(scope.fromSha)}\` … \`${shortenRevision(scope.toSha)}\``;
			const count = scope.includeShas?.length;
			return count
				? `${pluralize('commit', count)} in comparison ${range}${worktreeSuffix}`
				: `comparison between ${range}${worktreeSuffix}`;
		}

		// WIP
		const parts: string[] = [];
		if (scope.includeStaged || scope.includeUnstaged) {
			parts.push(this.branchName ? `WIP changes on \`${this.branchName}\`` : 'WIP changes');
		}
		const shaCount = scope.includeShas?.length ?? 0;
		if (shaCount > 0) {
			parts.push(pluralize('commit', shaCount));
		}
		const wipLabel = parts.length ? parts.join(' + ') : 'changes';
		return `${wipLabel}${worktreeSuffix}`;
	}

	private handleBack = () => {
		this.dispatchEvent(new CustomEvent('review-back', { bubbles: true, composed: true }));
	};

	private renderStaleBanner() {
		return html`<div class="stale-banner" role="status">
			<code-icon icon="warning"></code-icon>
			<span>Working changes have changed since this review was generated.</span>
		</div>`;
	}

	private renderIdleState() {
		// Fallback: compute scope from files if not provided
		const scope = this.scope || (this.files?.length ? { type: 'commit' as const, sha: '' } : undefined);
		if (!scope) return nothing;

		// Disable Start Review when there are no effectively-included files (after both user
		// exclusions and AI-ignored exclusions). Stale exclusions are pruned in willUpdate.
		const hasSelectedFiles = this.getEffectiveFileCount() > 0;

		return html`
			${this.forwardAvailable ? this.renderResumeBar() : nothing}
			${scope.type === 'wip'
				? html`<gl-split-panel
						orientation="vertical"
						primary="start"
						class="scope-split"
						position="40"
						.snap=${this._scopeSplitSnap}
					>
						<div slot="start" class="scope-split__picker">
							<gl-commits-scope-pane
								.items=${this.scopeItems}
								.selection=${this.scopeSelectionIds()}
								mode="review"
							></gl-commits-scope-pane>
						</div>
						<div slot="end" class="scope-split__files">
							<div class="scope-files">${this.renderFileCuration()}</div>
						</div>
					</gl-split-panel>`
				: html`<div class="scope-files">${this.renderFileCuration()}</div>`}
			<div class="review-input-row">
				<gl-ai-input
					class="review-action-input"
					multiline
					active
					rows="2"
					button-label="Start Review"
					busy-label="Reviewing changes…"
					event-name="review-run"
					placeholder='Instructions — e.g. "Focus on security and error handling"'
					?disabled=${!hasSelectedFiles}
					@input=${this.onAiInputType}
				>
					<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
				</gl-ai-input>
			</div>
		`;
	}

	private renderResumeBar() {
		const preview = this.backPreview;
		return html`<button
			class="resume-bar"
			type="button"
			aria-label="Resume Last Review"
			@click=${this.handleForward}
		>
			<span class="resume-bar__title">Resume Last Review</span>
			${preview != null
				? html`<span class="resume-bar__count">
						<span class="resume-bar__count-item">
							<code-icon icon="search"></code-icon>
							${pluralize('finding', preview.findingCount)}
						</span>
						<span class="resume-bar__count-item">
							<code-icon icon="files"></code-icon>
							${pluralize('file', preview.fileCount)}
						</span>
					</span>`
				: nothing}
			<code-icon class="resume-bar__arrow" icon="arrow-right"></code-icon>
		</button>`;
	}

	private handleCancel = (): void => {
		this.dispatchEvent(new CustomEvent('review-cancel', { bubbles: true, composed: true }));
	};

	private handleForward = (): void => {
		// Orchestrator owns the snapshot — it'll mutate the resource back to the prior value
		// without firing a new AI request.
		this.dispatchEvent(new CustomEvent('review-forward', { bubbles: true, composed: true }));
	};

	private onAiInputType = (): void => {
		// User started typing a new prompt — invalidate the forward chip.
		if (this.forwardAvailable) {
			this.dispatchEvent(new CustomEvent('review-forward-invalidate', { bubbles: true, composed: true }));
		}
	};

	private renderFileCuration(files?: readonly GitFileChangeShape[]) {
		// Always render the section — when there are no files, gl-file-tree-pane shows the
		// `empty-text` message inside its body so the section header / scope context stays
		// visible (consistent with the compare empty-state pattern).
		const renderFiles = files ?? this.files ?? [];

		const aiExcluded = this._aiExcludedSet;

		// Build checkableStates from exclusion/disabled sets. AI-excluded files are forced to
		// the unchecked + disabled visual: willUpdate adds them to `_excludedFiles` so `checked`
		// resolves false, leaving `state: undefined` and `disabled: true` (the file-tree-pane
		// then renders the checkbox as unchecked + non-interactive).
		const checkableStates = new Map<string, { state?: 'checked'; disabled?: boolean; disabledReason?: string }>();
		for (const file of renderFiles) {
			const aiDisabled = aiExcluded?.has(file.path) ?? false;
			const checked = !this._excludedFiles.has(file.path);
			if (checked || aiDisabled) {
				checkableStates.set(file.path, {
					...(checked ? { state: 'checked' as const } : {}),
					...(aiDisabled ? { disabled: true, disabledReason: 'Excluded by AI ignore rules' } : {}),
				});
			}
		}

		return html`<div class="scope-files__tree">
			<webview-pane-group flexible>
				<gl-file-tree-pane
					.files=${renderFiles}
					?checkable=${true}
					?show-file-icons=${true}
					.collapsable=${false}
					.filesLayout=${{ layout: this.fileLayout }}
					.checkableStates=${checkableStates}
					.fileActions=${this.fileActionsForFile}
					.fileContext=${this.getFileContext}
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
					@file-compare-working=${this.redispatch}
					@file-open-on-remote=${this.redispatch}
					@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
						this.fileLayout = e.detail.layout;
					}}
				></gl-file-tree-pane>
			</webview-pane-group>
		</div>`;
	}

	private fileActionsForFile = (_file: GitFileChangeShape): TreeItemAction[] => {
		return [{ icon: 'go-to-file', label: 'Open File', action: 'file-open' }];
	};

	private getFileContext = (file: GitFileChangeShape): string | undefined => {
		const scope = this.scope;
		if (!scope || !this.repoPath) return undefined;

		let context: DetailsItemTypedContext | undefined;
		switch (scope.type) {
			case 'wip':
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
				break;
			case 'commit': {
				const submodule = file.submodule != null ? '+submodule' : '';
				context = {
					webviewItem: `gitlens:file+committed${submodule}`,
					webviewItemValue: {
						type: 'file',
						path: file.path,
						repoPath: this.repoPath,
						sha: scope.sha,
						status: file.status,
					},
				};
				break;
			}
			case 'compare':
				context = {
					webviewItem: 'gitlens:file:comparison',
					webviewItemValue: {
						type: 'file',
						path: file.path,
						repoPath: this.repoPath,
						sha: scope.toSha,
						comparisonSha: scope.fromSha,
						status: file.status,
					},
				};
				break;
		}

		return context ? serializeWebviewItemContext(context) : undefined;
	};

	private redispatch = redispatch.bind(this);

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

	private invalidateForward(): void {
		if (this.forwardAvailable) {
			this.dispatchEvent(new CustomEvent('review-forward-invalidate', { bubbles: true, composed: true }));
		}
	}

	private _scopeSplitSnap = ({ pos, size }: { pos: number; size: number }): number => {
		const scopeEl = this.renderRoot.querySelector<GlCommitsScopePane>('gl-commits-scope-pane');
		if (!scopeEl || size <= 0) return Math.max(15, Math.min(pos, 70));

		// Cap at the scope picker's intrinsic height so it can't expand beyond its content.
		// `contentHeight` is only the inner scroll pane; add the .scope-split__picker wrapper's
		// padding + border-bottom or the fit-content track clamps short and clips / desyncs.
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

	private renderOverview() {
		if (!this.result?.overview) return nothing;

		return html`<div class="review-overview">
			<div class="review-overview__text">${this.result.overview}</div>
			${this.result.mode === 'two-pass'
				? html`<span class="review-overview__hint">Select a focus area below to get detailed findings.</span>`
				: nothing}
		</div>`;
	}

	private renderFocusAreas() {
		if (!this.result?.focusAreas.length) {
			return html`<div class="review-clean">
				<code-icon icon="pass"></code-icon>
				<span>No issues found. The changes look good!</span>
			</div>`;
		}

		return html`<div class="review-areas">
			<div class="review-areas__header">Focus Areas</div>
			${this.result.focusAreas.map(area => this.renderFocusArea(area))}
		</div>`;
	}

	private renderFocusArea(area: AIReviewFocusArea) {
		const isExpanded = this._expandedAreas.has(area.id);
		const isLoading = this._loadingAreas.has(area.id);
		const hasError = this._errorAreas.has(area.id);
		// `findings == null` means the area hasn't been analyzed yet (two-pass pass 2 not run);
		// `findings.length === 0` means it was analyzed and the AI found no issues here.
		const isAnalyzed = area.findings != null;
		const hasFindings = isAnalyzed && area.findings.length > 0;
		const isTwoPass = this.result?.mode === 'two-pass';
		const needsAnalyze = isTwoPass && !isAnalyzed && !isLoading && !hasError;

		return html`<div class="review-area ${isExpanded ? 'review-area--expanded' : ''}">
			<div class="review-area__header-row">
				<button
					class="review-area__header"
					@click=${() => this.handleToggleArea(area.id)}
					aria-expanded=${isExpanded}
				>
					<code-icon
						icon=${isExpanded ? 'chevron-down' : 'chevron-right'}
						class="review-area__chevron"
					></code-icon>
					<gl-tooltip
						content=${area.severity === 'critical'
							? 'Critical Issue'
							: area.severity === 'warning'
								? 'Warning (Non-Critical)'
								: 'Suggestion'}
						placement="bottom-start"
					>
						<span class="review-area__severity review-area__severity--${area.severity}">
							<code-icon
								icon=${area.severity === 'critical'
									? 'error'
									: area.severity === 'warning'
										? 'warning'
										: 'info'}
							></code-icon>
						</span>
					</gl-tooltip>
					<span class="review-area__label">${area.label}</span>
					<span class="review-area__file-count">${pluralize('file', area.files.length)}</span>
				</button>
				${this.renderFocusAreaActions(area, { isAnalyzed: isAnalyzed })}
			</div>
			${isExpanded
				? html`<div class="review-area__body">
						<div class="review-area__rationale">${area.rationale}</div>
						<div class="review-area__files">
							${area.files.map(
								f =>
									html`<button class="review-area__file-link" @click=${() => this.handleOpenFile(f)}>
										<code-icon icon="file"></code-icon>
										${f}
									</button>`,
							)}
						</div>
						${needsAnalyze
							? html`<button
									class="review-area__analyze-btn"
									@click=${() => this.handleAnalyzeArea(area)}
								>
									<code-icon icon="search"></code-icon>
									Review Files
								</button>`
							: nothing}
						${isLoading
							? html`<div class="review-area__loading">
									<code-icon icon="loading" modifier="spin"></code-icon>
									Reviewing files...
								</div>`
							: nothing}
						${hasError
							? html`<div class="review-area__error">
									<code-icon icon="error"></code-icon>
									Failed to review files.
									<button class="review-area__retry-btn" @click=${() => this.handleAnalyzeArea(area)}>
										Retry
									</button>
								</div>`
							: nothing}
						${hasFindings
							? this.renderFindings(area.findings, area)
							: isAnalyzed && !isLoading && !hasError
								? html`<div class="review-area__clean">
										<code-icon icon="pass"></code-icon>
										No issues found in these files.
									</div>`
								: nothing}
					</div>`
				: nothing}
		</div>`;
	}

	private renderFocusAreaActions(area: AIReviewFocusArea, state: { isAnalyzed: boolean }) {
		const areaMarkdown = state.isAnalyzed ? formatFocusAreaAsMarkdown(area, this._dismissedFindings) : '';
		const disabled = !state.isAnalyzed;
		const copyLabel = disabled ? "Run 'Review Files' first" : 'Copy Focus Area Findings';
		const sendLabel = disabled ? "Run 'Review Files' first" : 'Send Focus Area to AI Agent';

		return html`<span class="review-area__actions" @click=${(e: Event) => e.stopPropagation()}>
			<gl-copy-container
				appearance="toolbar"
				.content=${areaMarkdown}
				copyLabel=${copyLabel}
				copiedLabel="Copied!"
				placement="bottom"
				timeout=${2500}
				?disabled=${disabled}
				@click=${() => !disabled && this.dispatchCopied('focusArea')}
			>
				<code-icon icon="copy"></code-icon>
			</gl-copy-container>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${sendLabel}
				?disabled=${disabled}
				@click=${() => !disabled && this.handleSendToChat('focusArea', { area: area })}
			>
				<code-icon icon="comment-discussion"></code-icon>
			</gl-button>
		</span>`;
	}

	private renderFindings(findings: readonly AIReviewFinding[], area?: AIReviewFocusArea) {
		const visible = findings.filter(f => !this._dismissedFindings.has(f.id));
		const dismissedCount = findings.length - visible.length;

		return html`<div class="review-findings">
			${visible.map(f => this.renderFinding(f, area))}
			${dismissedCount > 0
				? html`<button class="review-findings__dismissed" @click=${this.handleShowDismissed}>
						${dismissedCount} dismissed finding${dismissedCount > 1 ? 's' : ''}
					</button>`
				: nothing}
		</div>`;
	}

	private renderFinding(finding: AIReviewFinding, area?: AIReviewFocusArea) {
		const findingMarkdown = formatFindingAsMarkdown(
			finding,
			area ? { label: area.label, rationale: area.rationale } : undefined,
		);

		return html`<div class="review-finding" data-severity=${finding.severity}>
			<div class="review-finding__header">
				<span class="review-finding__severity review-finding__severity--${finding.severity}">
					${finding.severity.toUpperCase()}
				</span>
				<span class="review-finding__title">${finding.title}</span>
				<span class="review-finding__actions">
					<gl-copy-container
						appearance="toolbar"
						.content=${findingMarkdown}
						copyLabel="Copy Finding"
						copiedLabel="Copied!"
						placement="bottom"
						timeout=${2500}
						@click=${() => this.dispatchCopied('finding')}
					>
						<code-icon icon="copy"></code-icon>
					</gl-copy-container>
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip="Send to AI Agent"
						@click=${() => this.handleSendToChat('finding', { area: area, finding: finding })}
					>
						<code-icon icon="comment-discussion"></code-icon>
					</gl-button>
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip="Dismiss"
						@click=${() => this.handleDismissFinding(finding.id)}
					>
						<code-icon icon="close"></code-icon>
					</gl-button>
				</span>
			</div>
			<div class="review-finding__description">${finding.description}</div>
			${finding.filePath
				? html`<button
						class="review-finding__location"
						@click=${() => this.handleOpenFile(finding.filePath!, finding.lineRange?.start)}
					>
						<code-icon icon="go-to-file"></code-icon>
						${finding.filePath}${finding.lineRange
							? `:${finding.lineRange.start}${finding.lineRange.end !== finding.lineRange.start ? `-${finding.lineRange.end}` : ''}`
							: ''}
					</button>`
				: nothing}
		</div>`;
	}

	updateFocusAreaFindings(focusAreaId: string, result: AIReviewDetailResult): void {
		if (!this.result) return;

		const areas = this.result.focusAreas.map(area => {
			if (area.id !== focusAreaId) return area;
			return { ...area, findings: result.findings };
		});

		this.result = { ...this.result, focusAreas: areas };
		const nextLoading = new Set(this._loadingAreas);
		nextLoading.delete(focusAreaId);
		this._loadingAreas = nextLoading;
		const nextError = new Set(this._errorAreas);
		nextError.delete(focusAreaId);
		this._errorAreas = nextError;
	}

	setFocusAreaLoading(focusAreaId: string): void {
		this._loadingAreas = new Set([...this._loadingAreas, focusAreaId]);
		const nextError = new Set(this._errorAreas);
		nextError.delete(focusAreaId);
		this._errorAreas = nextError;
	}

	setFocusAreaError(focusAreaId: string): void {
		const nextLoading = new Set(this._loadingAreas);
		nextLoading.delete(focusAreaId);
		this._loadingAreas = nextLoading;
		this._errorAreas = new Set([...this._errorAreas, focusAreaId]);
	}

	private handleToggleArea(areaId: string): void {
		const next = new Set(this._expandedAreas);
		if (next.has(areaId)) {
			next.delete(areaId);
		} else {
			next.add(areaId);
		}
		this._expandedAreas = next;
	}

	private handleAnalyzeArea(area: AIReviewFocusArea): void {
		this._expandedAreas = new Set([...this._expandedAreas, area.id]);
		this.dispatchEvent(
			new CustomEvent<ReviewAnalyzeAreaDetail>('review-analyze-area', {
				detail: { focusAreaId: area.id, files: [...area.files] },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleOpenFile(filePath: string, line?: number): void {
		this.dispatchEvent(
			new CustomEvent<ReviewOpenFileDetail>('review-open-file', {
				detail: { filePath: filePath, line: line },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleDismissFinding(findingId: string): void {
		this._dismissedFindings = new Set([...this._dismissedFindings, findingId]);
	}

	private handleShowDismissed(): void {
		this._dismissedFindings = new Set();
	}
}
