import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
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
	resumeBarStyles,
} from './gl-details-compose-mode-panel.css.js';
import { getScopeSplitPickerChrome, renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/ai-input.js';
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

export interface ComposeCommitAllDetail {
	includedCommitIds?: readonly string[];
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

	/** Pushed by the orchestrator from the engaged compose entry's `prompt` field (set when the
	 *  run was dispatched). Per-anchor: each WIP row remembers its own run's prompt across mode
	 *  toggles and anchor switches because it rides on the registry entry. Drives two seeding
	 *  paths in this panel:
	 *
	 *  1. **Idle scope picker** — the AI input's `.value` seeds with `lastPrompt` on every idle
	 *     re-render (success → Restart and error → Go Back). Re-mounting `gl-ai-input` via the
	 *     `keyed` directive in `renderIdleState` is what triggers the seed: `.value` is one-shot
	 *     in `firstUpdated`.
	 *
	 *  2. **Refine input** — passed as `.recall` so ArrowUp from cursor position 0 loads the run's
	 *     prompt back into the Refine field (terminal-style history recall). Lets the user tweak
	 *     the prompt that produced the current plan without retyping. */
	@property()
	lastPrompt?: string;

	@state() private _selectedCommitId?: string;
	@state() private _excludedFiles = new Set<string>();
	@state() private _aiExcludedSet: ReadonlySet<string> | undefined;
	@state() private _excludedCommitIds = new Set<string>();

	/** Pushed by the orchestrator from `state.composeForwardAvailable`. See review panel for the
	 * full restore-vs-rerun rationale — bar click emits `compose-forward` for the orchestrator
	 * to mutate the resource back to the snapshot (no AI re-run). */
	@property({ type: Boolean, attribute: 'forward-available', reflect: true })
	forwardAvailable = false;

	/** Preview metadata pushed from `state.composeBackPreview` — drives the count display on the
	 * resume bar. Cleared by the orchestrator in lockstep with `forwardAvailable`. */
	@property({ type: Object, attribute: false })
	backPreview?: { commitCount: number; fileCount: number };

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
			// The animation sits behind the spinner/text/cancel as decoration; it self-removes
			// when this branch is no longer rendered (status flips to 'ready'/'error') and
			// auto-disables under prefers-reduced-motion.
			return html`<div class="compose-loading-stage">
				<gl-categorizing-loading-animation variant="compose"></gl-categorizing-loading-animation>
				<div class="compose-loading-foreground">
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

		// Key the input on the last-submitted prompt so a Restart / Go Back into idle remounts
		// the element. `gl-ai-input.value` is one-shot in `firstUpdated`; without a remount the
		// reseed silently no-ops on subsequent renders.
		const aiInput = html`<div class="review-input-row">
			${keyed(
				this.lastPrompt,
				html`<gl-ai-input
					class="review-action-input"
					multiline
					active
					rows="2"
					button-label="Compose"
					busy-label="Composing changes…"
					event-name="compose-generate"
					placeholder='Instructions — e.g. "Group by feature, keep perf changes separate"'
					.value=${this.lastPrompt}
					.busy=${this.status === 'loading'}
					?disabled=${disabled}
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

		const isLoading = this.status === 'loading';

		const includedCount = this.commits.length - this._excludedCommitIds.size;
		const allIncluded = this._excludedCommitIds.size === 0;
		const commitButtonLabel = allIncluded ? 'Commit All' : `Commit ${pluralize('Commit', includedCount)}`;

		const commitAllRow = html`<div class="compose-plan__commit-all">
			<gl-button full ?disabled=${includedCount === 0} @click=${this.handleCommitAll}
				>${commitButtonLabel}</gl-button
			>
		</div>`;

		const listEl = html`<div class="compose-plan__list scrollable">
			${this.commits.map((commit, i) => this.renderProposedCommit(commit, i))}
			${this.baseCommit ? this.renderBaseCommit() : nothing}
		</div>`;

		return html`
			<div class="compose-plan">
				${this.stale ? this.renderStaleBanner() : nothing}
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
				.recall=${this.lastPrompt}
			>
				<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
			</gl-ai-input>
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
		const isExcluded = this._excludedCommitIds.has(commit.id);
		const toggleLabel = isExcluded ? 'Include this commit' : 'Exclude this commit';

		return html`<div
			class="compose-commit ${isSelected ? 'compose-commit--selected' : ''} ${isExcluded
				? 'compose-commit--excluded'
				: ''}"
			role="button"
			tabindex="0"
			aria-current=${isSelected ? 'true' : 'false'}
			aria-label="Commit ${num}, ${pluralize('file', commit.files.length)}"
			@click=${() => this.handleSelectCommit(commit.id)}
			@keydown=${(e: KeyboardEvent) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.handleSelectCommit(commit.id);
				}
			}}
		>
			<span class="compose-commit__num">${num}</span>
			<div class="compose-commit__info">
				<gl-popover class="compose-commit__message" hoist placement="bottom-start" trigger="hover">
					<span slot="anchor" class="compose-commit__message-content"
						>${this.renderCommitMessageInline(commit.message)}</span
					>
					<gl-markdown slot="content" .markdown=${commit.message}></gl-markdown>
				</gl-popover>
				<span class="compose-commit__stats">
					${pluralize('file', commit.files.length)}
					<span class="compose-commit__additions">+${commit.additions}</span>
					<span class="compose-commit__deletions">&minus;${commit.deletions}</span>
				</span>
			</div>
			<gl-tooltip placement="left">
				<gl-button
					class="compose-commit__action ${isExcluded ? 'compose-commit__action--excluded' : ''}"
					aria-pressed=${isExcluded ? 'false' : 'true'}
					aria-label=${toggleLabel}
					@click=${(e: Event) => {
						e.stopPropagation();
						this.handleToggleCommitIncluded(commit.id);
					}}
				>
					<code-icon icon="check"></code-icon>
				</gl-button>
				<span slot="content">${toggleLabel}</span>
			</gl-tooltip>
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
			.buttons=${['multi-diff', 'layout', 'search']}
			.fileActions=${this.fileActionsForFile}
			.fileContext=${this.getFileContext}
			.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			@file-open=${this.forwardFileEventWithVirtualRef}
			@file-compare-previous=${this.forwardFileEventWithVirtualRef}
			@file-stage=${this.redispatch}
			@file-unstage=${this.redispatch}
			@gl-file-tree-pane-open-multi-diff=${this.onOpenMultiDiff}
			@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
				// Share the same property as the idle-state file tree — separate slots meant
				// the user's layout choice in one view didn't carry over to the other.
				this.fileLayout = e.detail.layout;
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

	private handleToggleCommitIncluded(commitId: string): void {
		const next = new Set(this._excludedCommitIds);
		if (next.has(commitId)) {
			next.delete(commitId);
		} else {
			next.add(commitId);
		}
		this._excludedCommitIds = next;
	}
}
