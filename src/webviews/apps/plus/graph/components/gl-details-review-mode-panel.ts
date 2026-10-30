import * as l10n from '@vscode/l10n';
import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { repeat } from 'lit/directives/repeat.js';
import { isMac } from '@env/platform.js';
import type {
	AIReviewDetailResult,
	AIReviewFinding,
	AIReviewFocusArea,
	AIReviewOrientResult,
	AIReviewResult,
} from '@gitlens/ai/models/results.js';
import { getReviewFindingLocations } from '@gitlens/ai/models/results.js';
import { redispatch } from '@gitlens/components/components/element.js';
import {
	boxSizingBase,
	metadataBarVarsBase,
	subPanelEnterStyles,
} from '@gitlens/components/components/styles/lit/base.css.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { KeyMap, ViewFilesLayout } from '../../../../../config.js';
import { getWipFileWebviewItem, serializeWebviewItemContext } from '../../../../../system/webview.js';
import type { DetailsItemTypedContext } from '../../../../plus/graph/detailsProtocol.js';
import { buildFolderContext } from '../../../../plus/graph/detailsProtocol.js';
import type {
	DeepReviewAvailability,
	ReviewReadingAction,
	ScopeFile,
	ScopeSelection,
} from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { GlAiInput } from '../../../shared/components/ai-input.js';
import type {
	TreeItemAction,
	TreeItemCheckedDetail,
	TreeItemDecoration,
} from '../../../shared/components/tree/base.js';
import { renderOpenChangesAction } from '../../../shared/components/tree/file-tree-utils.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { countIncludedFiles } from './aiExclusion.js';
import type { GlCommitsScopePane, ScopeItem } from './gl-commits-scope-pane.js';
import {
	panelActionInputStyles,
	panelErrorStyles,
	panelHostStyles,
	panelLoadingStageStyles,
	panelLoadingStyles,
	panelScopeSplitStyles,
	reviewModePanelStyles,
} from './gl-details-review-mode-panel.css.js';
import type { ReviewFormatOptions } from './reviewFormat.js';
import {
	formatFindingAsMarkdown,
	formatFindingForAgentContext,
	formatFocusAreaAsMarkdown,
	formatReviewAsMarkdown,
	formatReviewForAgentContext,
	getReviewFindingTitle,
	getReviewFocusAreaLabel,
} from './reviewFormat.js';
import type {
	ReviewComment,
	ReviewFileFindings,
	ReviewFileIdentity,
	ReviewFindingCounts,
	ReviewFindingsContent,
	ReviewFindingState,
	ReviewProgress,
	ReviewReply,
	ReviewSession,
} from './reviewSession.js';
import {
	agentFocusAreaId,
	countReviewFindingStates,
	emptyReviewSession,
	getClosedFindingIds,
	getReviewFileFindings,
	getReviewFileProgress,
	getReviewProgress,
	getReviewReadingOrder,
	getReviewReadingShortcut,
	getReviewReplies,
	getStaleFindingIds,
	isReviewComplete,
	userFocusAreaId,
} from './reviewSession.js';
import { scopeSplitSnap, wipScopeSelectionIds } from './shared-panel-helpers.js';
import { renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import '../../../shared/components/actions/action-item.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/button.js';
import '@gitlens/components/components/codeIcon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/copy-container.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '@gitlens/components/components/overlays/tooltip.js';
import '../../../shared/components/split-panel/split-panel.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import './gl-categorizing-loading-animation.js';
import './gl-commits-scope-pane.js';

/** A plan's group is already an ordering — its pane lists files flat, in that order. */
export interface ReviewReadingStepDetail {
	action: ReviewReadingAction;
	path: string;
}

export interface ReviewOpenFileDetail {
	filePath: string;
	line?: number;
	lineEnd?: number;
}

export interface ReviewFilesViewedDetail {
	files: ReviewFileIdentity[];
	viewed: boolean;
}

export interface ReviewFileExcludedDetail {
	path: string;
	excluded: boolean;
}

export interface ReviewFindingStateDetail {
	findingId: string;
	state: ReviewFindingState | undefined;
}

export interface ReviewFindingNoteDetail {
	findingId: string;
	text: string;
}

export interface ReviewFindingDeleteDetail {
	findingId: string;
}

export interface ReviewFindingNoteDeleteDetail {
	findingId: string;
	noteId: string;
}

export interface ReviewDeepReviewDetail {
	prompt?: string;
	scopeLabel: string;
	files: string[];
	/** The earlier review's findings as context (see `formatReviewForAgentContext`); absent without one */
	priorFindings?: string;
	/** A question on one finding instead of a whole review (see `DeepReviewArgs.focus`) */
	focus?: { findingId: string; finding: string; question?: string };
}

export interface ReviewAnalyzeAreaDetail {
	focusAreaId: string;
	files: string[];
}

export interface ReviewSendToChatDetail {
	granularity: 'review' | 'focusArea' | 'finding';
	scopeLabel: string;
	reviewMarkdown: string;
	/** What the reader asked for along with the hand-off — their reply on the finding's thread */
	instructions?: string;
}

export interface ReviewCopiedDetail {
	granularity: 'review' | 'focusArea' | 'finding';
}

/** Areas that join a result outside the run that made it: the reader's comments come and go without a
 *  run, and Review in Repo's findings are appended as the agent reports them. Neither makes a result a
 *  new one, and each opens when it first appears, so the reader sees it land. */
const outOfRunFocusAreaIds: ReadonlySet<string> = new Set([userFocusAreaId, agentFocusAreaId]);

/** How long Review in Repo stays off after a click — long enough to absorb a double click, short enough
 *  that the reader is never stuck waiting on the agent */
export const deepReviewClickGuardMs = 5000;

/** A reading plan's pane's key — its group's place in the plan, -1 for the files the plan left out. */
function orientPaneKey(index: number): string {
	return `orient:${index}`;
}

/** True when `next` is a same-run delta of `prev` — same focus areas (count + ids in same
 *  order), only `findings` per area may differ. Used by `willUpdate` to skip the per-result
 *  state reset for two-pass detail enrichment, which produces a new `result` object reference
 *  but the same logical run. */
function isSameRunResultDelta(prev: AIReviewResult | undefined, next: AIReviewResult | undefined): boolean {
	if (prev == null || next == null) return false;

	const prevAreas = prev.focusAreas.filter(a => !outOfRunFocusAreaIds.has(a.id));
	const nextAreas = next.focusAreas.filter(a => !outOfRunFocusAreaIds.has(a.id));
	if (prevAreas.length !== nextAreas.length) return false;

	for (let i = 0; i < prevAreas.length; i++) {
		if (prevAreas[i].id !== nextAreas[i].id) return false;
	}
	return true;
}

@customElement('gl-details-review-mode-panel')
export class GlDetailsReviewModePanel extends LitElement {
	static override styles = [
		boxSizingBase,
		metadataBarVarsBase,
		subPanelEnterStyles,
		panelHostStyles,
		panelActionInputStyles,
		panelLoadingStyles,
		panelLoadingStageStyles,
		panelErrorStyles,
		panelScopeSplitStyles,
		reviewModePanelStyles,
	];

	@property({ type: Object })
	scope?: ScopeSelection;

	@property({ type: Object })
	result?: AIReviewResult;

	/** Persisted preference threaded through to the inner `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'show-search-box' })
	showSearchBox?: boolean;

	/** Persisted preference threaded through to the inner `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	@property({ attribute: 'status' })
	status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';

	@property()
	errorMessage?: string;

	@property({ type: Array })
	scopeItems?: ScopeItem[];

	/** True while branch commits are being fetched. Renders a "Loading commits…" placeholder
	 *  in the scope picker so the picker doesn't appear empty during the cross-anchor fetch
	 *  window (worktree switch in mode, etc.). */
	@property({ type: Boolean })
	scopeLoading = false;

	@property({ type: Array })
	files?: readonly ScopeFile[];

	@property({ type: Array })
	aiExcludedFiles?: readonly string[];

	/** The anchor's review session — viewed marks, set-aside files, finding states. Pushed from the
	 *  registry entry; every edit goes back up as an event, so the panel never owns a copy. */
	@property({ attribute: false })
	session?: ReviewSession;

	/** What the host reports about the editor: the review file whose diff is active, when one is. */
	@property({ attribute: false })
	reading?: { active?: string };

	/** The content the AI findings were made against, from the registry entry — to mark the ones whose
	 *  file has changed since. */
	@property({ attribute: false })
	findingsContent?: ReviewFindingsContent;

	/** Findings with a file that changed since they were made. */
	private _staleFindings?: ReadonlySet<string>;

	/** The orient depth's reading plan: groups the checklist by concern with a line of context per file. */
	@property({ attribute: false })
	orient?: AIReviewOrientResult;

	@property({ type: Boolean, attribute: 'orient-running' })
	orientRunning = false;

	@property()
	orientError?: string;

	/** The delegated deep review on this anchor, while one is open or once it reported done. */
	@property({ attribute: false })
	deepReview?: {
		active: boolean;
		done: boolean;
		count: number;
		purpose?: 'review' | 'ask';
		handOff?: 'pending' | 'failed' | 'delivered';
		hidden?: boolean;
	};

	/** Set for a moment after Review in Repo is clicked, so a double click starts one review. A running review
	 *  never holds the button: the agent may never say it is done, and a new start simply replaces it. */
	@state() private _deepReviewClickGuard = false;
	private _deepReviewClickTimer?: ReturnType<typeof setTimeout>;

	/** Whether a deep review can start here at all; unknown (`undefined`) keeps the depth offered. */
	@property({ attribute: false })
	deepReviewAvailability?: DeepReviewAvailability;

	/** `gitlens.keymap`, for naming the reading shortcuts in the panel's hints. */
	@property()
	keymap?: KeyMap;

	/** Notes from the reading plan by path, for the file rows' decorations. */
	private _orientNotes?: ReadonlyMap<string, string>;

	/** Findings by path, for the file rows' marks — open count and worst severity, or all closed. */
	private _fileFindings?: ReadonlyMap<string, ReviewFileFindings>;

	/** Whether AI review is on at all. Reading the files and the checklist don't need it. */
	@property({ type: Boolean, attribute: 'ai-enabled' })
	aiEnabled = false;

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

	/** Pushed by the orchestrator from the engaged review entry's `prompt` field (set when the
	 *  run was dispatched). Seeds the AI input on every idle re-render — both on success → Restart
	 *  (`back()`) and on error → Go Back (`backFromError()`) — so the user can tweak rather than
	 *  retype. Per-anchor: each commit/WIP row remembers its own run's prompt across mode toggles
	 *  and anchor switches because it rides on the registry entry. Re-mounting `gl-ai-input` (via
	 *  the `keyed` directive in `renderIdleState`) is what triggers the seed: `gl-ai-input.value`
	 *  is one-shot in `firstUpdated`. */
	@property()
	lastPrompt?: string;

	@property() idleDraft?: string;

	get idleDraftLive(): string | undefined {
		if (this.status !== 'idle' && this.status !== 'ready') return undefined;
		return this.renderRoot.querySelector<GlAiInput>('gl-ai-input.review-action-input')?.currentValue;
	}

	/** Files the AI run leaves out: the session's set-aside files plus the AI-ignore rules. Rebuilt in
	 *  `willUpdate` rather than per read, so the orchestrator's capture sees a stable identity. */
	get excludedFiles(): ReadonlySet<string> {
		return this._runExclusions;
	}
	@state() private _runExclusions: ReadonlySet<string> = emptyReviewSession.excluded;

	/** Each checklist pane's files in the order it renders them, by pane key — the reading order's source. */
	@state() private _treeOrders: ReadonlyMap<string, readonly string[]> = new Map();
	/** The reading order last announced to the host-facing side, to announce only changes. */
	private _announcedOrder?: readonly string[];
	/** Bumped with the session so the file tree re-reads its callbacks (decorations, row actions). */
	@state() private _sessionRevision = 0;

	/** Mirrors the pane's multi-selection so the "Open Changes" chip can swap to "Open Selected". */
	@state() private _selectedFiles: readonly { path: string }[] = [];

	/**
	 * Pushed by the orchestrator from `state.reviewForwardAvailable`. True after the user clicked
	 * Back on a successfully-resolved review — the orchestrator holds a snapshot of that result
	 * behind the header's Resume snippet. The panel's only job is to emit
	 * `review-forward-invalidate` when the user edits the idle inputs.
	 */
	@property({ type: Boolean, attribute: 'forward-available', reflect: true })
	forwardAvailable = false;

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
	@state() private _showClosedFindings = false;
	@state() private _loadingAreas = new Set<string>();
	@state() private _errorAreas = new Set<string>();
	@state() private _aiExcludedSet: ReadonlySet<string> | undefined;

	override willUpdate(changedProperties: Map<string, unknown>): void {
		if (changedProperties.has('aiExcludedFiles')) {
			this._aiExcludedSet = this.aiExcludedFiles?.length ? new Set(this.aiExcludedFiles) : undefined;
		}

		if (changedProperties.has('orient')) {
			this._orientNotes = this.orient
				? new Map(this.orient.groups.flatMap(g => g.files.map(f => [f.path, f.note] as const)))
				: undefined;
			this._sessionRevision++;
		}

		if (changedProperties.has('aiExcludedFiles') || changedProperties.has('session')) {
			const excluded = this.session?.excluded ?? emptyReviewSession.excluded;
			this._runExclusions = this._aiExcludedSet?.size ? new Set([...excluded, ...this._aiExcludedSet]) : excluded;
			this._sessionRevision++;
		}

		if (changedProperties.has('result') || changedProperties.has('session')) {
			const findings = getReviewFileFindings(this.result, this.session);
			this._fileFindings = findings.size ? findings : undefined;
			if (changedProperties.has('result')) {
				this._sessionRevision++;
			}
		}

		if (
			changedProperties.has('result') ||
			changedProperties.has('files') ||
			changedProperties.has('findingsContent')
		) {
			const stale = getStaleFindingIds(this.result, this.findingsContent, this.files);
			this._staleFindings = stale.size ? stale : undefined;
		}

		if (changedProperties.has('files')) {
			this._selectedFiles = [];
		}

		// Per-result derived state (expand/dismiss/load/error sets) is keyed by area + finding
		// ids that the AI emits. Different review results (anchor switch, restart, refine re-run,
		// Forward-restore, backFromError mutate) can produce colliding ids, so we must clear these
		// when the result genuinely changes — but NOT when it's a same-run delta from
		// `updateFocusAreaFindings` or the orchestrator's parallel resource-mutation (two-pass
		// per-area details). Discriminator: a delta keeps all of the prior result's area ids
		// (same areas, same order, only `findings` enriched per area). A fresh run produces a
		// different set of area ids. We rely on the AI emitting deterministic-ish area ids within
		// a run; cross-run collisions on those ids are tolerated because cross-run = different
		// id set => fresh.
		if (changedProperties.has('result') && changedProperties.get('result') !== this.result) {
			const prev = changedProperties.get('result') as AIReviewResult | undefined;
			const next = this.result;
			const isSameRunDelta = isSameRunResultDelta(prev, next);

			if (!isSameRunDelta) {
				this._expandedAreas = new Set();
				this._showClosedFindings = false;
				this._loadingAreas = new Set();
				this._errorAreas = new Set();
				// Auto-expand when there's only a single focus area on a freshly-set result.
				// Runs against the just-cleared expanded set so a Forward/anchor-switch with a
				// single-area result lands fully visible.
				if (this.result?.focusAreas.length === 1) {
					this._expandedAreas = new Set([this.result.focusAreas[0].id]);
				}
			}
			// A first comment, or the agent's first finding, opens its area, so the reader sees it land
			for (const id of outOfRunFocusAreaIds) {
				if (prev?.focusAreas.some(a => a.id === id) !== true && next?.focusAreas.some(a => a.id === id)) {
					this._expandedAreas = new Set([...this._expandedAreas, id]);
				}
			}
		}
	}

	private getEffectiveFileCount(): number {
		return countIncludedFiles(this.files, this.excludedFiles, this._aiExcludedSet);
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'region');
		this.setAttribute('aria-label', l10n.t('Review Changes'));
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		clearTimeout(this._deepReviewClickTimer);
		this._deepReviewClickTimer = undefined;
		this._deepReviewClickGuard = false;
	}

	override render() {
		return html` <div class="review-panel">${this.renderContent()}</div> `;
	}

	private renderContent() {
		if (this.status === 'idle') {
			return this.renderIdleState();
		}

		if (this.status === 'loading') {
			return html`${this.renderWithChecklist(this.renderLoadingWithCancel(), l10n.t('Reviewing the diff…'))}${this.renderDeepReviewStrip()}`;
		}

		if (this.status === 'error') {
			// A failed run takes nothing of the reader's with it: their comments stay below the error, as
			// they show in a review, and Go Back brings the rest back
			const comments = this.result?.focusAreas.find(a => a.id === userFocusAreaId);
			return html`${this.renderWithChecklist(
				html`${renderErrorState(
					this.errorMessage,
					l10n.t('An error occurred during review.'),
					'review-error-retry',
					'review-error-back',
				)}${
					comments != null
						? html`<div class="review-results review-results--after-error scrollable">
								${this.renderFocusArea(comments)}
							</div>`
						: nothing
				}`,
			)}${this.renderDeepReviewStrip()}`;
		}

		if (this.status !== 'ready' || !this.result) return nothing;

		// The back arrow is the main header's close button in this sub-state (see
		// `gl-details-header.inResultsView`). The Copy + Send-to-chat actions live in an always-visible
		// footer beneath the scrollable results so they stay reachable regardless of scroll position.
		const open = countReviewFindingStates(this.result, this.session).open;
		let description = formatPlural(
			l10n.t('{count, plural, one{{count} finding open} other{{count} findings open}}'),
			{ count: open },
		);
		// Findings that came in on files already read put those back in the queue — say so where they land
		const { requeued } = getReviewProgress(this.session, this.files);
		if (requeued > 0) {
			description += ` · ${formatPlural(
				l10n.t(
					'{count, plural, one{{count} viewed file back in the queue} other{{count} viewed files back in the queue}}',
				),
				{ count: requeued },
			)}`;
		}
		return html`${this.renderWithChecklist(
			html`<div class="review-results scrollable">${this.renderOverview()} ${this.renderFocusAreas()}</div>`,
			description,
		)}${this.renderDeepReviewStrip()}${this.renderReadyActions()}${this.renderReviewInput()}`;
	}

	/** Which of the two panes below are folded to their headers — kept across remounts of the panel, the
	 *  way VS Code keeps a view's collapsed sections */
	private static readonly collapsedPanes = { files: false, findings: false };
	@state() private _filesCollapsed = GlDetailsReviewModePanel.collapsedPanes.files;
	@state() private _findingsCollapsed = GlDetailsReviewModePanel.collapsedPanes.findings;

	private togglePane(pane: 'files' | 'findings'): void {
		if (pane === 'files') {
			this._filesCollapsed = !this._filesCollapsed;
			GlDetailsReviewModePanel.collapsedPanes.files = this._filesCollapsed;
		} else {
			this._findingsCollapsed = !this._findingsCollapsed;
			GlDetailsReviewModePanel.collapsedPanes.findings = this._findingsCollapsed;
		}
	}

	/** The Findings pane's header: folds the pane like the checklist's, and carries what acts on all the
	 *  findings at once. */
	private renderFindingsHeader(description?: string) {
		const collapsed = this._findingsCollapsed;
		return html`<div class="review-pane-header" @click=${() => this.togglePane('findings')}>
			<button
				class="review-pane-header__toggle"
				aria-expanded=${collapsed ? 'false' : 'true'}
				aria-label=${collapsed ? l10n.t('Expand Findings') : l10n.t('Collapse Findings')}
				@click=${(e: Event) => {
					e.stopPropagation();
					this.togglePane('findings');
				}}
			>
				<code-icon icon=${collapsed ? 'chevron-right' : 'chevron-down'}></code-icon>
			</button>
			<span class="review-pane-header__title">${l10n.t('Findings')}</span>
			${description ? html`<span class="review-pane-header__description">${description}</span>` : nothing}
			${this.status === 'ready' && this.result != null ? this.renderFindingsHeaderActions(this.result) : nothing}
		</div>`;
	}

	/** What acts on all the findings at once, as icons: to the agent, to the clipboard, and — while there are
	 *  AI or agent findings — away. The same as the actions above the instructions box. */
	private renderFindingsHeaderActions(result: AIReviewResult) {
		return html`<span class="review-pane-header__actions" @click=${(e: Event) => e.stopPropagation()}>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${l10n.t('Address Findings with Agent')}
				aria-label=${l10n.t('Address Findings with Agent')}
				@click=${() => this.handleSendToChat('review')}
			>
				<code-icon icon="comment-discussion-sparkle"></code-icon>
			</gl-button>
			<gl-copy-container
				appearance="toolbar"
				.content=${formatReviewAsMarkdown(result, this.formatOptions())}
				copyLabel=${l10n.t('Copy Review Findings')}
				copiedLabel=${l10n.t('Copied!')}
				placement="bottom"
				timeout=${2500}
				@click=${() => this.dispatchCopied('review')}
			>
				<code-icon icon="copy"></code-icon>
			</gl-copy-container>
			${
				this.hasReviewFindings
					? html`<gl-button
							appearance="toolbar"
							density="compact"
							tooltip=${l10n.t('Delete Findings')}
							aria-label=${l10n.t('Delete Findings')}
							@click=${this.handleDiscard}
						>
							<code-icon icon="trash"></code-icon>
						</gl-button>`
					: nothing
			}
		</span>`;
	}

	/** The reader's checklist stays up while the AI runs and after it answers — the findings are one
	 *  lens on the changeset, not a screen that replaces it. Each half is a pane that folds to its header,
	 *  as views do in VS Code: the other takes the height, and the divider rests until both are open.
	 *  Folding only hides a pane's body, so the tree keeps its folders and the findings their scroll. */
	private renderWithChecklist(aiContent: TemplateResult, findingsDescription?: string) {
		const files = this._filesCollapsed;
		const findings = this._findingsCollapsed;
		const folded = files && findings ? 'both' : files ? 'files' : findings ? 'findings' : undefined;
		const progress = getReviewProgress(this.session, this.files);
		return html`<gl-split-panel
			orientation="vertical"
			class="review-split${folded != null ? ` review-split--folded review-split--folded-${folded}` : ''}"
			position="40"
			?disabled=${folded != null}
		>
			<div slot="start" class="review-split__files">
				${this.renderChecklistHeader(progress)}
				<div class="scope-files review-split__body" ?hidden=${files}>
					${this.renderFileCuration(undefined, true)}
				</div>
			</div>
			<div slot="end" class="review-split__ai">
				${this.renderFindingsHeader(findingsDescription)}
				<div class="review-split__body" ?hidden=${findings}>${aiContent}</div>
			</div>
		</gl-split-panel>`;
	}

	/** Whether anything but the reader's own comments is showing — what there is to discard. */
	private get hasReviewFindings(): boolean {
		return this.result?.focusAreas.some(a => a.id !== userFocusAreaId) === true;
	}

	/** What a review with findings adds to the instructions box below: the findings to the agent, to the
	 *  clipboard, or away — the reader's own comments stay. */
	private renderReadyActions() {
		if (!this.result) return nothing;

		const reviewMarkdown = formatReviewAsMarkdown(this.result, this.formatOptions());
		return html`<div class="review-footer">
			<gl-button class="review-footer__primary" @click=${() => this.handleSendToChat('review')}>
				<code-icon icon="comment-discussion-sparkle" slot="prefix"></code-icon>
				${l10n.t('Address Findings with Agent')}
			</gl-button>
			<gl-copy-container
				class="review-footer__copy"
				.content=${reviewMarkdown}
				copyLabel=${l10n.t('Copy Review Findings')}
				copiedLabel=${l10n.t('Copied!')}
				placement="top"
				timeout=${2500}
				@click=${() => this.dispatchCopied('review')}
			>
				<gl-button appearance="secondary" aria-label=${l10n.t('Copy Review Findings')}>
					<code-icon icon="copy"></code-icon>
				</gl-button>
			</gl-copy-container>
			${
				this.hasReviewFindings
					? html`<gl-button
							appearance="secondary"
							aria-label=${l10n.t('Delete Findings')}
							tooltip=${l10n.t('Delete Findings')}
							@click=${this.handleDiscard}
						>
							<code-icon icon="trash"></code-icon>
						</gl-button>`
					: nothing
			}
		</div>`;
	}

	private renderLoadingWithCancel() {
		// Animation sits behind the spinner/cancel as decoration; uses the review color triplet
		// (green/yellow/red) and self-disables under prefers-reduced-motion.
		return html`<div class="panel-loading-stage">
			<gl-categorizing-loading-animation
				class="panel-loading-stage__anim"
				variant="review"
			></gl-categorizing-loading-animation>
			<div class="panel-loading-stage__foreground review-loading-wrap">
				${renderLoadingState(l10n.t('Analyzing changes...'))}
				<gl-button class="review-cancel" appearance="secondary" @click=${this.handleCancel}
					>${l10n.t('Cancel')}</gl-button
				>
			</div>
		</div>`;
	}

	private formatOptions(): ReviewFormatOptions {
		return {
			scopeLabel: this.scopeContextLabel(),
			dismissed: getClosedFindingIds(this.session),
			notes: this.session?.notes,
		};
	}

	private buildReviewMarkdown(
		granularity: 'review' | 'focusArea' | 'finding',
		opts: { area?: AIReviewFocusArea; finding?: AIReviewFinding },
	): string {
		if (granularity === 'review') {
			return this.result ? formatReviewAsMarkdown(this.result, this.formatOptions()) : '';
		}
		if (granularity === 'focusArea' && opts.area) {
			return formatFocusAreaAsMarkdown(opts.area, getClosedFindingIds(this.session), this.session?.notes);
		}
		if (granularity === 'finding' && opts.finding) {
			const enclosing = opts.area
				? {
						label: opts.area.label,
						labelIsFallback: opts.area.labelIsFallback,
						rationale: opts.area.rationale,
					}
				: undefined;
			return formatFindingAsMarkdown(opts.finding, enclosing, this.session?.notes.get(opts.finding.id));
		}
		return '';
	}

	/** Send-to-Agent for one finding by id — the editor's thread action reaches the panel this way.
	 *  `remark` is what the reader said on the thread along with the hand-off: the thing to act on. */
	sendFindingToAgent(findingId: string, remark?: string): void {
		const found = this.findFinding(findingId);
		if (found == null) return;

		const instructions = remark
			? `The reader's latest remark on this finding, from its thread, is what to act on: "${remark}"`
			: undefined;
		this.handleSendToChat('finding', { area: found.area, finding: found.finding, instructions: instructions });
	}

	/** A reader's question on one finding, for the review agent: goes as a focused Review in Repo — into
	 *  the running channel and session when there is one — with the finding and its thread as context. */
	askReviewer(findingId: string, question?: string): void {
		const found = this.findFinding(findingId);
		if (found == null) return;

		const context = formatFindingForAgentContext(
			found.finding,
			this.session?.findingStates.get(findingId),
			this.session?.notes.get(findingId),
		);
		this.dispatchEvent(
			new CustomEvent<ReviewDeepReviewDetail>('review-deep-review', {
				detail: {
					scopeLabel: this.scopeContextLabel(),
					files: this.readingOrder,
					focus: { findingId: findingId, finding: context, question: question },
				},
				bubbles: true,
				composed: true,
			}),
		);
	}

	private findFinding(findingId: string): { area: AIReviewFocusArea; finding: AIReviewFinding } | undefined {
		for (const area of this.result?.focusAreas ?? []) {
			const finding = area.findings?.find(f => f.id === findingId);
			if (finding != null) return { area: area, finding: finding };
		}
		return undefined;
	}

	private handleSendToChat(
		granularity: 'review' | 'focusArea' | 'finding',
		opts: { area?: AIReviewFocusArea; finding?: AIReviewFinding; instructions?: string } = {},
	): void {
		const reviewMarkdown = this.buildReviewMarkdown(granularity, opts);
		if (!reviewMarkdown) return;

		this.dispatchEvent(
			new CustomEvent<ReviewSendToChatDetail>('review-send-to-chat', {
				detail: {
					granularity: granularity,
					scopeLabel: this.scopeContextLabel(),
					reviewMarkdown: reviewMarkdown,
					instructions: opts.instructions,
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

	private scopeSummary(): string {
		const scope = this.scope;
		if (!scope) return l10n.t('changes');
		if (scope.type === 'commit') return l10n.t('commit');
		if (scope.type === 'compare') {
			const count = scope.includeShas?.length;
			return count
				? formatPlural(l10n.t('{count, plural, one{{count} commit} other{{count} commits}}'), { count: count })
				: l10n.t('comparison');
		}

		// wip
		const hasWorkingChanges = scope.includeStaged || scope.includeUnstaged;
		const shaCount = scope.includeShas?.length ?? 0;
		if (hasWorkingChanges && shaCount > 0) {
			return formatPlural(
				l10n.t(
					'{count, plural, one{working changes + {count} commit} other{working changes + {count} commits}}',
				),
				{ count: shaCount },
			);
		}
		if (hasWorkingChanges) return l10n.t('working changes');
		if (shaCount > 0) {
			return formatPlural(l10n.t('{count, plural, one{{count} commit} other{{count} commits}}'), {
				count: shaCount,
			});
		}
		return l10n.t('changes');
	}

	/**
	 * Richer scope label intended for clipboard markdown and AI agent prompts — gives the agent
	 * the actual identifiers (worktree name, branch, SHAs) so it can locate the changes the
	 * findings refer to. {@link scopeSummary} is intentionally terse for the visible header.
	 */
	private scopeContextLabel(): string {
		const scope = this.scope;
		let label: string;
		if (!scope) {
			label = l10n.t('changes');
			return this.withWorktreeContext(label);
		}

		if (scope.type === 'commit') {
			label = l10n.t('commit `{revision}`', { revision: shortenRevision(scope.sha) });
			return this.withWorktreeContext(label);
		}

		if (scope.type === 'compare') {
			const count = scope.includeShas?.length;
			label = count
				? formatPlural(
						l10n.t(
							'{count, plural, one{{count} commit in comparison `{from}` … `{to}`} other{{count} commits in comparison `{from}` … `{to}`}}',
						),
						{
							count: count,
							from: shortenRevision(scope.fromSha),
							to: shortenRevision(scope.toSha),
						},
					)
				: l10n.t('comparison between `{from}` … `{to}`', {
						from: shortenRevision(scope.fromSha),
						to: shortenRevision(scope.toSha),
					});
			return this.withWorktreeContext(label);
		}

		// WIP
		const hasWorkingChanges = scope.includeStaged || scope.includeUnstaged;
		const shaCount = scope.includeShas?.length ?? 0;
		if (hasWorkingChanges && shaCount > 0) {
			if (this.branchName) {
				label = formatPlural(
					l10n.t(
						'{count, plural, one{WIP changes on `{branch}` + {count} commit} other{WIP changes on `{branch}` + {count} commits}}',
					),
					{ branch: this.branchName, count: shaCount },
				);
			} else {
				label = formatPlural(
					l10n.t('{count, plural, one{WIP changes + {count} commit} other{WIP changes + {count} commits}}'),
					{ count: shaCount },
				);
			}
		} else if (hasWorkingChanges) {
			label = this.branchName
				? l10n.t('WIP changes on `{branch}`', { branch: this.branchName })
				: l10n.t('WIP changes');
		} else if (shaCount > 0) {
			label = formatPlural(l10n.t('{count, plural, one{{count} commit} other{{count} commits}}'), {
				count: shaCount,
			});
		} else {
			label = l10n.t('changes');
		}
		return this.withWorktreeContext(label);
	}

	private withWorktreeContext(scopeLabel: string): string {
		if (!this.repoName) return scopeLabel;

		return this.isLinkedWorktree
			? l10n.t('{scope} in the `{worktree}` worktree', { scope: scopeLabel, worktree: this.repoName })
			: l10n.t('{scope} in the `{repository}` repository (main worktree)', {
					scope: scopeLabel,
					repository: this.repoName,
				});
	}

	private renderIdleState() {
		// Fallback: compute scope from files if not provided
		const scope = this.scope ?? (this.files?.length ? { type: 'commit' as const, sha: '' } : undefined);
		if (!scope) return nothing;

		// Disable Review Diff when there are no effectively-included files (after both user
		// exclusions and AI-ignored exclusions). Stale exclusions are pruned in willUpdate.
		const hasSelectedFiles = this.getEffectiveFileCount() > 0;

		return html`
			${
				scope.type === 'wip'
					? html`<gl-split-panel
							orientation="vertical"
							primary="start"
							class="scope-split"
							position="40"
							.snap=${this._scopeSplitSnap}
						>
							<div slot="start" class="scope-split__picker">
								${this.renderScopePresets()}
								<gl-commits-scope-pane
									.items=${this.scopeItems}
									.selection=${this.scopeSelectionIds()}
									?loading=${this.scopeLoading}
									mode="review"
								></gl-commits-scope-pane>
							</div>
							<div slot="end" class="scope-split__files">
								<div class="scope-files">${this.renderFileCuration()}</div>
							</div>
						</gl-split-panel>`
					: html`<div class="scope-files">${this.renderFileCuration()}</div>`
			}
			${this.renderDeepReviewStrip()} ${this.renderReviewInput(hasSelectedFiles)}
		`;
	}

	/** The instructions box with its depths — Review Diff, Orient, Review in Repo — the same before a run and
	 *  alongside its findings, so a review can be run again, re-planned or handed to the agent from either. */
	private renderReviewInput(hasSelectedFiles = this.getEffectiveFileCount() > 0) {
		return this.aiEnabled
			? html`<div class="review-input-row">
					${keyed(
						this.idleDraft ?? this.lastPrompt,
						html`<gl-ai-input
							class="review-action-input"
							multiline
							active
							rows="2"
							button-label=${l10n.t('Review Diff')}
							busy-label=${l10n.t('Reviewing the diff…')}
							event-name="review-run"
							placeholder=${l10n.t('Instructions — e.g. "Focus on security and error handling"')}
							.value=${this.idleDraft ?? this.lastPrompt}
							?disabled=${!hasSelectedFiles}
							@input=${this.onAiInputType}
						>
							<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
							<gl-button
								slot="footer"
								class="review-orient__button"
								appearance="toolbar"
								density="compact"
								tooltip=${l10n.t(
									'Orient: group and order the files with one line of context each — a map for your own read, not findings',
								)}
								?disabled=${this.orientRunning || !hasSelectedFiles}
								@click=${this.handleOrient}
							>
								<code-icon icon=${this.orientRunning ? 'loading' : 'zap'} slot="prefix"></code-icon>
								${this.orientRunning ? l10n.t('Orienting…') : l10n.t('Orient')}
							</gl-button>
							<gl-button
								slot="footer"
								class="review-deep__button"
								appearance="toolbar"
								density="compact"
								tooltip=${
									this.deepReviewUnavailableReason ??
									l10n.t(
										'Review in Repo: hand the changes to your agent — it can build, test and trace call paths in the repository, and its findings stream back into this review',
									)
								}
								?disabled=${this.isDeepReviewDisabled(hasSelectedFiles)}
								@click=${this.handleDeepReview}
							>
								<code-icon
									icon=${this._deepReviewClickGuard ? 'loading' : 'robot'}
									slot="prefix"
								></code-icon>
								${l10n.t('Review in Repo')}
							</gl-button>
						</gl-ai-input>`,
					)}
					${this.orientError ? html`<div class="review-orient__error">${this.orientError}</div>` : nothing}
				</div>`
			: nothing;
	}

	/** Review in Repo is off only where it can't start, and for a moment after a click — a review under way
	 *  doesn't hold it, since its running state is the status strip's to show. */
	private isDeepReviewDisabled(hasSelectedFiles: boolean): boolean {
		return !hasSelectedFiles || this.deepReviewUnavailableReason != null || this._deepReviewClickGuard;
	}

	/** Takes a click on Review in Repo: false while the guard from the last one is still on, otherwise turns
	 *  the guard on for {@link deepReviewClickGuardMs} — and off again then, whatever the channel did. */
	private takeDeepReviewClick(): boolean {
		if (this._deepReviewClickGuard) return false;

		this._deepReviewClickGuard = true;
		clearTimeout(this._deepReviewClickTimer);
		this._deepReviewClickTimer = setTimeout(() => {
			this._deepReviewClickTimer = undefined;
			this._deepReviewClickGuard = false;
		}, deepReviewClickGuardMs);
		return true;
	}

	/** Why the deep depth is off here, when the host has said it can't start — the button's tooltip. */
	private get deepReviewUnavailableReason(): string | undefined {
		const availability = this.deepReviewAvailability;
		if (availability == null || availability.available) return undefined;
		return availability.reason === 'no-channel'
			? l10n.t('Review in Repo needs the GitLens local channel, which is not available in this environment')
			: l10n.t('Review in Repo needs an AI agent, and none is available in this editor');
	}

	private readingShortcut(key: ReviewReadingAction): string | undefined {
		return getReviewReadingShortcut(this.keymap, key, isMac);
	}

	/** A control's label with its shortcut after it, when the keymap has one. */
	private withReadingShortcut(label: string, key: ReviewReadingAction): string {
		const shortcut = this.readingShortcut(key);
		return shortcut == null ? label : l10n.t('{label} ({shortcut})', { label: label, shortcut: shortcut });
	}

	private onTreeOrderChanged(key: string, e: CustomEvent<{ paths: string[] }>): void {
		e.stopPropagation();
		const paths = e.detail.paths;
		const known = this._treeOrders.get(key);
		if (known != null && known.length === paths.length && known.every((p, i) => p === paths[i])) return;

		const next = new Map(this._treeOrders);
		next.set(key, paths);
		this._treeOrders = next;
	}

	/** The plan's panes, kept across renders while the plan and the files are the same objects — a fresh
	 *  `files` array per render would make every pane rebuild its model on every render. */
	private _orientPanes?: {
		orient: AIReviewOrientResult;
		files: readonly ScopeFile[];
		panes: { key: string; label: string; summary?: string; files: ScopeFile[] }[];
	};

	private getOrientPanes(orient: AIReviewOrientResult, renderFiles: readonly ScopeFile[]) {
		const cached = this._orientPanes;
		if (cached?.orient === orient && cached.files === renderFiles) return cached.panes;

		const byPath = new Map(renderFiles.map(f => [f.path, f]));
		const placed = new Set<string>();
		const panes: { key: string; label: string; summary?: string; files: ScopeFile[] }[] = [];
		for (const [index, group] of orient.groups.entries()) {
			const files: ScopeFile[] = [];
			for (const { path } of group.files) {
				const file = byPath.get(path);
				if (file == null || placed.has(path)) continue;

				placed.add(path);
				files.push(file);
			}
			if (files.length === 0) continue;

			// The label and summary say what the group is; its kind only ordered it
			// Keyed by the group's place in the plan, which a group emptied out of the scope doesn't shift
			panes.push({
				key: orientPaneKey(index),
				label: getReviewFocusAreaLabel(group),
				summary: group.summary || undefined,
				files: files,
			});
		}
		const rest = renderFiles.filter(f => !placed.has(f.path));
		if (rest.length > 0) {
			panes.push({ key: orientPaneKey(-1), label: l10n.t('Not in the plan'), files: rest });
		}

		this._orientPanes = { orient: orient, files: renderFiles, panes: panes };
		return panes;
	}

	/** The checklist's files top to bottom: the plan's panes in turn, or the one tree. */
	private get treeOrder(): string[] | undefined {
		// A plan's panes go by their place, not their label — two groups can read the same — and each keeps
		// only its own files, so an order left by an earlier plan's pane in that place can't pull a file
		// across groups
		const panes = this.orient != null ? this._orientPanes?.panes : undefined;
		const paths =
			panes != null
				? panes.flatMap(pane => {
						const own = new Set(pane.files.map(f => f.path));
						return (this._treeOrders.get(pane.key) ?? []).filter(p => own.has(p));
					})
				: [...(this._treeOrders.get('tree') ?? [])];
		return paths.length > 0 ? paths : undefined;
	}

	/** The files to read in order — the plan's order first, then the checklist top to bottom. */
	get readingOrder(): string[] {
		return getReviewReadingOrder(this.session, this.files, this.treeOrder);
	}

	override updated(): void {
		const order = this.readingOrder;
		const announced = this._announcedOrder;
		if (announced != null && announced.length === order.length && announced.every((p, i) => p === order[i])) {
			return;
		}

		this._announcedOrder = order;
		this.dispatchEvent(
			new CustomEvent<{ paths: string[] }>('review-reading-order', {
				detail: { paths: order },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderReadingOrEnding(readingInHeader = false) {
		const progress = getReviewProgress(this.session, this.files);
		if (!isReviewComplete(progress)) {
			if (progress.total === 0 || readingInHeader) return nothing;

			return this.renderReadingStrip(progress);
		}

		const counts = countReviewFindingStates(this.result, this.session);
		const parts = [
			formatPlural(l10n.t('{count, plural, one{{count} file viewed} other{{count} files viewed}}'), {
				count: progress.viewed,
			}),
		];
		if (this.result != null) {
			parts.push(
				formatPlural(l10n.t('{count, plural, one{{count} finding open} other{{count} findings open}}'), {
					count: counts.open,
				}),
			);
			if (counts.dismissed > 0) {
				parts.push(l10n.t('{count} dismissed', { count: counts.dismissed }));
			}
		}

		return html`<div class="review-done" role="status">
			<code-icon class="review-done__icon" icon="pass-filled"></code-icon>
			<div class="review-done__body">
				<div class="review-done__title">${l10n.t('Review complete')}</div>
				<div class="review-done__counts">${parts.join(' · ')}</div>
			</div>
			<div class="review-done__actions">
				<gl-copy-container
					.content=${this.formatSummaryMarkdown(progress, counts)}
					copyLabel=${l10n.t('Copy Summary')}
					copiedLabel=${l10n.t('Copied!')}
					placement="top"
					timeout=${2500}
				>
					<gl-button appearance="secondary" density="compact">
						<code-icon icon="copy" slot="prefix"></code-icon>${l10n.t('Copy Summary')}
					</gl-button>
				</gl-copy-container>
				${
					counts.open > 0
						? html`<gl-button
								appearance="secondary"
								density="compact"
								@click=${() => this.handleSendToChat('review')}
							>
								<code-icon icon="comment-discussion-sparkle" slot="prefix"></code-icon>
								${l10n.t('Address Remaining with Agent')}
							</gl-button>`
						: nothing
				}
			</div>
		</div>`;
	}

	private renderReadingHint() {
		const shortcut = this.readingShortcut('markViewed');
		return shortcut == null
			? l10n.t('Open a file to read it; mark files viewed as you go')
			: l10n.t('Open a file to read it; {shortcut} in the diff marks it viewed and opens the next', {
					shortcut: shortcut,
				});
	}

	/** Follows the editor: the review file whose diff is active gets its place in the order and the steps
	 *  from there; with no review diff active the strip reads as plain progress. */
	private renderReadingStrip(progress: ReviewProgress) {
		const paths = this.readingOrder;
		const index = this.reading?.active != null ? paths.indexOf(this.reading.active) : -1;
		const active = paths[index];
		if (active == null) {
			return html`<div class="review-walk" role="status">
				<div class="review-walk__body">
					<div class="review-walk__title">
						${l10n.t('{viewed} of {total} viewed', { viewed: progress.viewed, total: progress.total })}
					</div>
					<div class="review-walk__hint">${this.renderReadingHint()}</div>
				</div>
			</div>`;
		}

		return html`<div class="review-walk review-walk--reading" role="status">
			<div class="review-walk__body">
				<div class="review-walk__title">
					${l10n.t('Reading {index} of {total}', { index: index + 1, total: paths.length })}
				</div>
				<div class="review-walk__file">${active}</div>
			</div>
			${this.renderReadingActions(active)}
		</div>`;
	}

	private renderReadingActions(active: string) {
		// The buttons sit in a header that folds on click — a step must not fold it
		return html`<div class="review-walk__actions" @click=${(e: Event) => e.stopPropagation()}>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${this.withReadingShortcut(l10n.t('Previous File in Review'), 'previous')}
				aria-label=${l10n.t('Previous File in Review')}
				@click=${() => this.handleReadingStep('previous', active)}
			>
				<code-icon icon="arrow-left"></code-icon>
			</gl-button>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${this.withReadingShortcut(l10n.t('Mark Viewed & Next'), 'markViewed')}
				@click=${() => this.handleReadingStep('markViewed', active)}
			>
				<code-icon icon="check" slot="prefix"></code-icon>${l10n.t('Mark Viewed & Next')}
			</gl-button>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${this.withReadingShortcut(l10n.t('Next File in Review'), 'next')}
				aria-label=${l10n.t('Next File in Review')}
				@click=${() => this.handleReadingStep('next', active)}
			>
				<code-icon icon="arrow-right"></code-icon>
			</gl-button>
		</div>`;
	}

	/** The checklist pane's header is the reading strip, beside the chevron that folds the pane: the file
	 *  being read and its steps, or the progress, or the review's end. Folded, it keeps to one line — what
	 *  is being read and how many files are viewed — and the steps stay at hand. */
	private renderChecklistHeader(progress: ReviewProgress) {
		const collapsed = this._filesCollapsed;
		const paths = this.readingOrder;
		const index = this.reading?.active != null ? paths.indexOf(this.reading.active) : -1;
		const active = index >= 0 ? paths[index] : undefined;
		const viewed = l10n.t('{viewed}/{total} viewed', { viewed: progress.viewed, total: progress.total });

		let title: string;
		let detail: TemplateResult | typeof nothing = nothing;
		let suffix = false;
		if (active != null) {
			title = l10n.t('Reading {index} of {total}', { index: index + 1, total: paths.length });
			detail = html`<div class="review-walk__file">${active}</div>`;
			suffix = true;
		} else if (progress.total === 0) {
			title = l10n.t('Checklist');
		} else if (isReviewComplete(progress)) {
			title = l10n.t('Review complete');
			suffix = true;
		} else {
			title = l10n.t('{viewed} of {total} viewed', { viewed: progress.viewed, total: progress.total });
			detail = html`<div class="review-walk__hint">${this.renderReadingHint()}</div>`;
		}

		return html`<div
			class="review-pane-header review-pane-header--checklist${collapsed ? ' review-pane-header--collapsed' : ''}"
			@click=${() => this.togglePane('files')}
		>
			<button
				class="review-pane-header__toggle"
				aria-expanded=${collapsed ? 'false' : 'true'}
				aria-label=${collapsed ? l10n.t('Expand Checklist') : l10n.t('Collapse Checklist')}
				@click=${(e: Event) => {
					e.stopPropagation();
					this.togglePane('files');
				}}
			>
				<code-icon icon=${collapsed ? 'chevron-right' : 'chevron-down'}></code-icon>
			</button>
			<div class="review-walk__body" role="status">
				<div class="review-walk__title">
					${title}${
						collapsed && suffix
							? html`<span class="review-pane-header__description">${viewed}</span>`
							: nothing
					}
				</div>
				${collapsed ? nothing : detail}
			</div>
			${
				collapsed && active != null
					? html`<span class="review-pane-header__file" title=${active}>${active}</span>`
					: nothing
			}
			${active != null ? this.renderReadingActions(active) : nothing}
		</div>`;
	}

	private handleReadingStep(action: ReviewReadingAction, path: string): void {
		this.dispatchEvent(
			new CustomEvent<ReviewReadingStepDetail>('review-reading-step', {
				detail: { action: action, path: path },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private formatSummaryMarkdown(progress: ReviewProgress, counts: ReviewFindingCounts): string {
		const lines = [
			`## ${l10n.t('Review of {scope}', { scope: this.scopeContextLabel() })}`,
			'',
			`- ${l10n.t('Files viewed: {count}', { count: progress.viewed })}`,
		];
		if (this.result != null) {
			lines.push(
				`- ${l10n.t('Findings: {open} open, {dismissed} dismissed', {
					open: counts.open,
					dismissed: counts.dismissed,
				})}`,
			);
			if (counts.open > 0) {
				lines.push('', formatReviewAsMarkdown(this.result, this.formatOptions()));
			}
		}
		return lines.join('\n');
	}

	private handleCancel = (): void => {
		this.dispatchEvent(new CustomEvent('review-cancel', { bubbles: true, composed: true }));
	};

	private handleDiscard = (): void => {
		this.dispatchEvent(new CustomEvent('review-discard', { bubbles: true, composed: true }));
	};

	private onAiInputType = (): void => {
		// User started typing a new prompt — invalidate the forward chip.
		if (this.forwardAvailable) {
			this.dispatchEvent(new CustomEvent('review-forward-invalidate', { bubbles: true, composed: true }));
		}
	};

	/** Each plan group's own layout — the groups' toggles are independent, starting from the checklist's
	 *  layout. Kept per plan, so a plan's panes don't take another plan's toggles at the same place, and a
	 *  plan shown again has its own back. Memoized per group for the same reason as `paneFilesLayout`. */
	private readonly _orientPaneLayouts = new WeakMap<AIReviewOrientResult, Map<string, { layout: ViewFilesLayout }>>();
	private getOrientPaneLayouts(): Map<string, { layout: ViewFilesLayout }> {
		// Only the plan's panes ask, so there is one
		const orient = this.orient!;
		let layouts = this._orientPaneLayouts.get(orient);
		if (layouts == null) {
			layouts = new Map();
			this._orientPaneLayouts.set(orient, layouts);
		}
		return layouts;
	}

	private orientPaneLayout(key: string): { layout: ViewFilesLayout } {
		const layouts = this.getOrientPaneLayouts();
		let cached = layouts.get(key);
		if (cached == null) {
			cached = { layout: this.fileLayout };
			layouts.set(key, cached);
		}
		return cached;
	}

	private setOrientPaneLayout(key: string, layout: ViewFilesLayout): void {
		this.getOrientPaneLayouts().set(key, { layout: layout });
		this.requestUpdate();
	}

	/** Memoized `.filesLayout` payload for the inner pane — a fresh literal per render would trip
	 * the pane's tree-model rebuild via Lit's reference-equality dirty check. */
	private _paneFilesLayout?: { layout: ViewFilesLayout };
	private get paneFilesLayout(): { layout: ViewFilesLayout } {
		let cached = this._paneFilesLayout;
		if (cached?.layout !== this.fileLayout) {
			cached = { layout: this.fileLayout };
			this._paneFilesLayout = cached;
		}
		return cached;
	}

	/** Cache key for the baked-in row contexts: `getFileContext` reads both `scope` and `repoPath`,
	 * so both must key the revision — keying on either alone leaves rows on a stale context when
	 * the other changes. Memoized on identity so the stringify runs only when the scope actually
	 * changes rather than on every parent render. */
	private _contextRevision?: { scope: ScopeSelection | undefined; repoPath: string | undefined; value: string };
	private get contextRevision(): string {
		const cached = this._contextRevision;
		if (cached != null && cached.scope === this.scope && cached.repoPath === this.repoPath) {
			return cached.value;
		}

		const value = `${this.repoPath ?? ''}|${this.scope ? JSON.stringify(this.scope) : ''}`;
		this._contextRevision = { scope: this.scope, repoPath: this.repoPath, value: value };
		return value;
	}

	/** @param readingInHeader the reading strip is the pane's header (see {@link renderChecklistHeader}), so
	 *  the body leaves it out and keeps only the review's ending */
	private renderFileCuration(files?: readonly ScopeFile[], readingInHeader = false) {
		// Always render the section — when there are no files, gl-file-tree-pane shows the
		// `empty-text` message inside its body so the section header / scope context stays
		// visible (consistent with the compare empty-state pattern).
		const renderFiles = files ?? this.files ?? [];

		// The checkbox is the reader's Viewed mark. Set-aside files keep their row (so they can be
		// brought back) but leave the reading order; AI-ignore only annotates — a human may still want to skim
		// what the AI shouldn't read.
		const session = this.session;
		const checkableStates = new Map<string, { state?: 'checked'; disabled?: boolean; disabledReason?: string }>();
		for (const file of renderFiles) {
			if (session?.excluded.has(file.path)) {
				checkableStates.set(file.path, { disabled: true, disabledReason: l10n.t('Excluded from this review') });
			} else if (getReviewFileProgress(session, file) === 'viewed') {
				checkableStates.set(file.path, { state: 'checked' });
			}
		}

		if (this.orient != null) return this.renderOrientPlan(renderFiles, checkableStates, readingInHeader);

		return html`${this.renderReadingOrEnding(readingInHeader)}
			<div class="scope-files__tree">
				<webview-pane-group flexible>
					<gl-file-tree-pane
						.files=${renderFiles}
						?checkable=${true}
						?multi-selectable=${true}
						?show-file-icons=${true}
						.collapsable=${false}
						.revealPath=${this.reading?.active}
						reveal-only
						@tree-order-changed=${(e: CustomEvent<{ paths: string[] }>) => this.onTreeOrderChanged('tree', e)}
						.filesLayout=${this.paneFilesLayout}
						.checkableStates=${checkableStates}
						.fileActions=${this.fileActionsForFile}
						.fileDecorations=${this.decorationsForFile}
						.fileContext=${this.getFileContext}
						.contextRevision=${`${this.contextRevision}:${this._sessionRevision}`}
						.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
						selection-action="file-compare-range"
						@file-compare-range=${(e: CustomEvent<FileChangeListItemDetail>) =>
							this.handleOpenFile(e.detail.path)}
						.searchContext=${this.searchContext}
						.showSearchBox=${this.showSearchBox}
						.searchBoxFilter=${this.searchBoxFilter}
						check-action="viewed"
						empty-text=${l10n.t('No files changed')}
						@file-checked=${this.onFileChecked}
						@gl-check-all=${this.onToggleCheckAll}
						@review-file-exclude=${(e: CustomEvent<FileChangeListItemDetail>) =>
							this.dispatchFileExcluded(e.detail.path, true)}
						@review-file-include=${(e: CustomEvent<FileChangeListItemDetail>) =>
							this.dispatchFileExcluded(e.detail.path, false)}
						@review-file-findings=${this.onOpenFileFindings}
						@file-open=${this.redispatch}
						@file-stage=${this.redispatch}
						@file-unstage=${this.redispatch}
						@file-compare-working=${this.redispatch}
						@file-open-on-remote=${this.redispatch}
						@file-selection-changed=${(e: CustomEvent<{ files: readonly { path: string }[] }>) =>
							(this._selectedFiles = e.detail?.files ?? [])}
						@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) => {
							this.fileLayout = e.detail.layout;
						}}
					>
						${
							renderFiles.length > 0
								? renderOpenChangesAction({
										selectedCount: this._selectedFiles.length,
										slot: 'leading-actions',
										onOpenAll: () => this.onOpenScopeMultiDiff(renderFiles),
										onOpenSelected: () => {
											const selectedPaths = new Set(this._selectedFiles.map(f => f.path));
											this.onOpenScopeMultiDiff(
												renderFiles.filter(f => selectedPaths.has(f.path)),
											);
										},
									})
								: nothing
						}
					</gl-file-tree-pane>
				</webview-pane-group>
			</div>`;
	}

	/** The checklist reshaped by the reading plan: one pane per group, in reading order, each file with
	 *  its line of context; files the plan didn't place come last. */
	private renderOrientPlan(
		renderFiles: readonly ScopeFile[],
		checkableStates: Map<string, { state?: 'checked'; disabled?: boolean; disabledReason?: string }>,
		readingInHeader = false,
	) {
		const orient = this.orient!;
		const panes = this.getOrientPanes(orient, renderFiles);

		return html`${this.renderReadingOrEnding(readingInHeader)}
			<div class="scope-files__tree scope-files__tree--flow">
				<div class="review-orient">
					<div class="review-orient__body">
						<div class="review-orient__title">${l10n.t('Reading plan')}</div>
						<p class="review-orient__overview">${orient.overview}</p>
					</div>
					<div class="review-orient__actions">
						<gl-button
							appearance="toolbar"
							density="compact"
							tooltip=${l10n.t('Drop the plan and go back to the file tree')}
							@click=${this.handleOrientClear}
						>
							${l10n.t('Dismiss Plan')}
						</gl-button>
					</div>
				</div>
				<webview-pane-group>
					${repeat(
						panes,
						pane => pane.key,
						pane => html`<gl-file-tree-pane
							flow
							header=${pane.label}
							.files=${pane.files}
							.revealPath=${this.reading?.active}
							reveal-only
							@tree-order-changed=${(e: CustomEvent<{ paths: string[] }>) =>
								this.onTreeOrderChanged(pane.key, e)}
							?checkable=${true}
							?multi-selectable=${true}
							?show-file-icons=${true}
							.filesLayout=${this.orientPaneLayout(pane.key)}
							@change-files-layout=${(e: CustomEvent<{ layout: ViewFilesLayout }>) =>
								this.setOrientPaneLayout(pane.key, e.detail.layout)}
							.checkableStates=${checkableStates}
							.fileActions=${this.fileActionsForFile}
							.fileDecorations=${this.decorationsForFile}
							.fileContext=${this.getFileContext}
							.contextRevision=${`${this.contextRevision}:${this._sessionRevision}`}
							.folderContext=${(folder: { relativePath: string }) => buildFolderContext(this.repoPath, folder)}
							selection-action="file-compare-range"
							@file-compare-range=${(e: CustomEvent<FileChangeListItemDetail>) =>
								this.handleOpenFile(e.detail.path)}
							check-action="viewed"
							@file-checked=${this.onFileChecked}
							@gl-check-all=${this.onToggleCheckAll}
							@review-file-exclude=${(e: CustomEvent<FileChangeListItemDetail>) =>
								this.dispatchFileExcluded(e.detail.path, true)}
							@review-file-include=${(e: CustomEvent<FileChangeListItemDetail>) =>
								this.dispatchFileExcluded(e.detail.path, false)}
							@review-file-findings=${this.onOpenFileFindings}
							@file-open=${this.redispatch}
							@file-stage=${this.redispatch}
							@file-unstage=${this.redispatch}
							@file-compare-working=${this.redispatch}
							@file-open-on-remote=${this.redispatch}
						>
							${
								pane.summary
									? html`<p slot="before-tree" class="review-orient__group-summary">
											${pane.summary}
										</p>`
									: nothing
							}
						</gl-file-tree-pane>`,
					)}
				</webview-pane-group>
			</div>`;
	}

	private handleOrient = (): void => {
		this.dispatchEvent(
			new CustomEvent<{ prompt?: string; scopeLabel: string }>('review-orient', {
				// The scope's label goes along for an Orient too large for the model, which the agent plans instead
				detail: { prompt: this.idleDraftLive || undefined, scopeLabel: this.scopeContextLabel() },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private handleDeepReview = (): void => {
		if (!this.takeDeepReviewClick()) return;

		// What an earlier run found goes along — every finding, open or closed, with what the reader said —
		// so the agent adds to it rather than finding it again
		const priorFindings = this.result
			? formatReviewForAgentContext(this.result, this.session?.findingStates, this.session?.notes)
			: '';
		this.dispatchEvent(
			new CustomEvent<ReviewDeepReviewDetail>('review-deep-review', {
				detail: {
					prompt: this.idleDraftLive || undefined,
					scopeLabel: this.scopeContextLabel(),
					files: this.readingOrder,
					priorFindings: priorFindings || undefined,
				},
				bubbles: true,
				composed: true,
			}),
		);
	};

	private handleDeepReviewHide = (): void => {
		this.dispatchEvent(new CustomEvent('review-deep-review-hide', { bubbles: true, composed: true }));
	};

	/** The deep review's status strip — while the agent works and once it reported done. */
	private renderDeepReviewStrip() {
		const deep = this.deepReview;
		if (deep?.hidden || deep == null || (!deep.active && !deep.done) || deep.purpose === 'ask') return nothing;

		// Until an agent has the prompt nothing is running — the reader is picking one, or a failed hand-over's
		// Retry is waiting in a notification; finished once the agent said so, though its channel may stay open
		// for what it reports later
		const handOff = deep.active && deep.handOff !== 'delivered' ? deep.handOff : undefined;
		const running = deep.active && !deep.done;
		let icon: string;
		let text: string;
		if (handOff === 'pending') {
			icon = 'loading';
			text = l10n.t('Starting the agent…');
		} else if (handOff === 'failed') {
			icon = 'warning';
			text = l10n.t("The agent didn't start — see the notification");
		} else {
			icon = running ? 'loading' : 'robot';
			text = `${running ? l10n.t('Review in Repo running') : l10n.t('Review in Repo finished')} · ${
				running
					? formatPlural(
							l10n.t('{count, plural, one{{count} finding so far} other{{count} findings so far}}'),
							{ count: deep.count },
						)
					: formatPlural(l10n.t('{count, plural, one{{count} finding} other{{count} findings}}'), {
							count: deep.count,
						})
			}`;
		}
		return html`<div class="review-deep" role="status">
			<code-icon class="review-deep__icon" icon=${icon}></code-icon>
			<span class="review-deep__text">${text}</span>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip=${l10n.t('Hide — what the agent reports still lands in the review')}
				aria-label=${l10n.t('Hide')}
				@click=${this.handleDeepReviewHide}
			>
				<code-icon icon="close"></code-icon>
			</gl-button>
		</div>`;
	}

	private handleOrientClear = (): void => {
		this.dispatchEvent(new CustomEvent('review-orient-clear', { bubbles: true, composed: true }));
	};

	private fileActionsForFile = (file: GitFileChangeShape): TreeItemAction[] => {
		const excluded = this.session?.excluded.has(file.path) ?? false;
		return [
			{ icon: 'go-to-file', label: l10n.t('Open File'), action: 'file-open' },
			excluded
				? {
						icon: 'eye',
						label: l10n.t('Include in Review'),
						action: 'review-file-include',
						multiBehavior: 'single',
					}
				: {
						icon: 'eye-closed',
						label: l10n.t('Exclude from Review'),
						action: 'review-file-exclude',
						multiBehavior: 'single',
					},
		];
	};

	private decorationsForFile = (file: ScopeFile): TreeItemDecoration[] | undefined => {
		if (this.session?.excluded.has(file.path)) {
			return [
				{
					type: 'text',
					label: l10n.t('excluded'),
					tooltip: l10n.t('Excluded from this review'),
					kind: 'muted',
					position: 'before',
				},
			];
		}

		const decorations: TreeItemDecoration[] = [];
		const progress = getReviewFileProgress(this.session, file);
		if (progress === 'changed') {
			decorations.push({
				type: 'text',
				label: l10n.t('changed since viewed'),
				tooltip: l10n.t('This file changed after you marked it as viewed'),
				kind: 'modified',
				position: 'before',
			});
		} else if (progress === 'requeued') {
			decorations.push({
				type: 'text',
				label: l10n.t('new findings since viewed'),
				tooltip: l10n.t('New findings came in on this file after you marked it as viewed'),
				kind: 'modified',
				position: 'before',
			});
		}
		if (this._aiExcludedSet?.has(file.path)) {
			decorations.push({
				type: 'icon',
				icon: 'sparkle',
				muted: true,
				label: l10n.t('Excluded from AI review by ignore rules'),
				position: 'before',
			});
		}
		const findings = this._fileFindings?.get(file.path);
		if (findings != null) {
			decorations.push(this.getFindingsDecoration(findings));
		}
		const note = this._orientNotes?.get(file.path);
		if (note) {
			decorations.push({ type: 'text', label: note, tooltip: note, kind: 'muted', position: 'after' });
		}
		return decorations.length ? decorations : undefined;
	};

	/** The row's findings mark: the open count in the color of the worst one, or the closed count, muted,
	 *  once every finding on the file has been dismissed. The findings themselves sit in the
	 *  diff as comment threads, which the tooltip says. */
	private getFindingsDecoration(findings: ReviewFileFindings): TreeItemDecoration {
		const action = findings.target != null ? 'review-file-findings' : undefined;
		if (findings.open === 0) {
			const closed = formatPlural(
				l10n.t('{count, plural, one{{count} finding, dismissed} other{{count} findings, all dismissed}}'),
				{ count: findings.closed },
			);
			return {
				type: 'count',
				icon: 'comment',
				count: findings.closed,
				kind: 'muted',
				label: closed,
				tooltip: action ? `${closed} · ${l10n.t('Click to open the diff on the first one')}` : closed,
				position: 'after',
				...(action ? { action: action } : {}),
			};
		}

		const open = formatPlural(l10n.t('{count, plural, one{{count} finding open} other{{count} findings open}}'), {
			count: findings.open,
		});
		const severity =
			findings.severity === 'critical'
				? l10n.t('Critical')
				: findings.severity === 'warning'
					? l10n.t('Warning')
					: l10n.t('Suggestion');
		const parts = [open, l10n.t('{severity} at worst', { severity: severity })];
		if (findings.closed > 0) {
			parts.push(l10n.t('{count} dismissed', { count: findings.closed }));
		}
		parts.push(
			action ? l10n.t('Click to open the diff on the first open one') : l10n.t('Shown as comments in the diff'),
		);
		return {
			type: 'count',
			icon: 'comment',
			count: findings.open,
			kind: findings.severity === 'critical' ? 'error' : findings.severity === 'warning' ? 'warning' : 'info',
			label: open,
			tooltip: parts.join(' · '),
			position: 'after',
			...(action ? { action: action } : {}),
		};
	}

	/** The mark's click: the diff, on the file's first open finding (or first of all, once closed). */
	private onOpenFileFindings = (e: CustomEvent<FileChangeListItemDetail>): void => {
		const target = this._fileFindings?.get(e.detail.path)?.target;
		this.handleOpenFile(e.detail.path, target?.start, target?.end);
	};

	private getFileContext = (file: ScopeFile): string | undefined => {
		const scope = this.scope;
		if (!scope || !this.repoPath) return undefined;

		let context: DetailsItemTypedContext | undefined;
		switch (scope.type) {
			case 'wip':
				if (file.anchor === 'committed' && file.anchorSha != null) {
					// Committed-range file reviewed under a wip scope: anchor to the range, not working tree
					context =
						file.anchorBaseSha != null
							? {
									webviewItem: 'gitlens:file:comparison',
									webviewItemValue: {
										type: 'file',
										path: file.path,
										repoPath: this.repoPath,
										sha: file.anchorSha,
										comparisonSha: file.anchorBaseSha,
										status: file.status,
										originalPath: file.originalPath,
									},
								}
							: {
									webviewItem: 'gitlens:file+committed',
									webviewItemValue: {
										type: 'file',
										path: file.path,
										repoPath: this.repoPath,
										sha: file.anchorSha,
										status: file.status,
									},
								};
					break;
				}

				context = {
					webviewItem: getWipFileWebviewItem(file),
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
						originalPath: file.originalPath,
					},
				};
				break;
		}

		return context ? serializeWebviewItemContext(context) : undefined;
	};

	private redispatch = redispatch.bind(this);

	private onFileChecked(e: CustomEvent<TreeItemCheckedDetail>): void {
		const [file] = (e.detail.context ?? []) as unknown as ScopeFile[];
		if (file == null) return;

		this.dispatchFilesViewed([file], e.detail.checked);
	}

	private onToggleCheckAll(e: CustomEvent<{ checked: boolean; paths: readonly string[] }>): void {
		const paths = new Set(e.detail.paths);
		const files = (this.files ?? []).filter(f => paths.has(f.path) && !this.session?.excluded.has(f.path));
		this.dispatchFilesViewed(files, e.detail.checked);
	}

	private dispatchFilesViewed(files: readonly ScopeFile[], viewed: boolean): void {
		if (!files.length) return;

		this.dispatchEvent(
			new CustomEvent<ReviewFilesViewedDetail>('review-files-viewed', {
				detail: { files: files.map(f => ({ path: f.path, contentId: f.contentId })), viewed: viewed },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private dispatchFileExcluded(path: string, excluded: boolean): void {
		this.dispatchEvent(
			new CustomEvent<ReviewFileExcludedDetail>('review-file-excluded', {
				detail: { path: path, excluded: excluded },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private invalidateForward(): void {
		if (this.forwardAvailable) {
			this.dispatchEvent(new CustomEvent('review-forward-invalidate', { bubbles: true, composed: true }));
		}
	}

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

	private _scopeSplitSnap = ({ pos, size }: { pos: number; size: number }): number => {
		return scopeSplitSnap(this.renderRoot.querySelector<GlCommitsScopePane>('gl-commits-scope-pane'), pos, size);
	};

	private scopeSelectionIds(): readonly string[] | undefined {
		return wipScopeSelectionIds(this.scope);
	}

	/** One-click scopes over the picker: the uncommitted changes, those with the commits not pushed yet, and
	 *  the whole branch since it split off from its merge target. A preset that would pick what another does
	 *  is left out — without an upstream nothing is pushed, so Unpushed is the branch — and so is Branch when
	 *  no merge base was found, as the list is then only the latest commits. */
	private renderScopePresets() {
		const items = this.scopeItems ?? [];
		const ids = (rows: readonly ScopeItem[]) => rows.map(i => i.id);
		const uncommitted = ids(items.filter(i => i.state === 'uncommitted'));
		const firstPushed = items.findIndex(i => i.state !== 'uncommitted' && i.state !== 'unpushed');
		const unpushed = ids(
			(firstPushed < 0 ? items : items.slice(0, firstPushed)).filter(i => i.state !== 'load-more'),
		);
		const end = items.findIndex(i => i.state === 'load-more' || i.state === 'merge-base');
		const branch = items.some(i => i.state === 'merge-base') ? ids(items.slice(0, end)) : [];

		const same = (a: readonly string[], b: readonly string[]) =>
			a.length === b.length && a.every((id, i) => id === b[i]);
		const presets: { label: string; tooltip: string; ids: string[] }[] = [];
		if (uncommitted.length > 0) {
			presets.push({
				label: l10n.t('Uncommitted'),
				tooltip: l10n.t('Review the uncommitted changes'),
				ids: uncommitted,
			});
		}
		if (unpushed.length > 0 && !same(unpushed, uncommitted) && !same(unpushed, branch)) {
			presets.push({
				label: l10n.t('Unpushed'),
				tooltip: l10n.t('Review the uncommitted changes and the commits not pushed yet'),
				ids: unpushed,
			});
		}
		if (branch.length > 0 && !same(branch, uncommitted)) {
			presets.push({
				label: l10n.t('Branch'),
				tooltip: l10n.t(
					'Review the whole branch: every commit since it split off from its merge target, and the uncommitted changes',
				),
				ids: branch,
			});
		}
		if (presets.length < 2) return nothing;

		const selected = this.scopeSelectionIds() ?? [];
		return html`<div class="scope-presets" role="group" aria-label=${l10n.t('Review scope')}>
			${presets.map(
				preset => html`<gl-tooltip content=${preset.tooltip}>
					<button
						type="button"
						class="scope-preset"
						aria-pressed=${same(preset.ids, selected) ? 'true' : 'false'}
						@click=${() => this.selectScopePreset(preset.ids)}
					>
						${preset.label}
					</button>
				</gl-tooltip>`,
			)}
		</div>`;
	}

	/** Takes a preset the way the picker's handles take a range — the details panel builds the scope from it. */
	private selectScopePreset(selectedIds: string[]): void {
		this.dispatchEvent(
			new CustomEvent<{ selectedIds: string[] }>('scope-change', {
				detail: { selectedIds: selectedIds },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderOverview() {
		if (!this.result?.overview) return nothing;

		return html`<div class="review-overview">
			<div class="review-overview__text">${this.result.overview}</div>
			${
				this.result.mode === 'two-pass'
					? html`<span class="review-overview__hint"
							>${l10n.t('Select a focus area below to get detailed findings.')}</span
						>`
					: nothing
			}
		</div>`;
	}

	private renderFocusAreas() {
		if (!this.result?.focusAreas.length) {
			return html`<div class="review-clean">
				<code-icon icon="pass"></code-icon>
				<span>${l10n.t('No issues found. The changes look good!')}</span>
			</div>`;
		}

		const areas = this.result.focusAreas;
		const allExpanded = areas.every(a => this._expandedAreas.has(a.id));
		const noneExpanded = areas.every(a => !this._expandedAreas.has(a.id));

		return html`<div class="review-areas">
			<div class="review-areas__header-row">
				<div class="review-areas__header">${l10n.t('Focus Areas')}</div>
				<div class="review-areas__actions">
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip=${l10n.t('Expand All')}
						aria-label=${l10n.t('Expand All')}
						?disabled=${allExpanded}
						@click=${this.handleExpandAllAreas}
					>
						<code-icon icon="expand-all"></code-icon>
					</gl-button>
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip=${l10n.t('Collapse All')}
						aria-label=${l10n.t('Collapse All')}
						?disabled=${noneExpanded}
						@click=${this.handleCollapseAllAreas}
					>
						<code-icon icon="collapse-all"></code-icon>
					</gl-button>
				</div>
			</div>
			${areas.map(area => this.renderFocusArea(area))}
		</div>`;
	}

	private handleExpandAllAreas = (): void => {
		const areas = this.result?.focusAreas;
		if (!areas?.length) return;

		this._expandedAreas = new Set(areas.map(a => a.id));
	};

	private handleCollapseAllAreas = (): void => {
		this._expandedAreas = new Set();
	};

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
					${
						area.id === userFocusAreaId
							? html`<span class="review-area__severity"><code-icon icon="comment"></code-icon></span>`
							: this.renderAreaSeverity(area)
					}
					<span class="review-area__label">${getReviewFocusAreaLabel(area)}</span>
					${this.renderAreaStale(area)}
					<span class="review-area__file-count"
						>${
							area.id === userFocusAreaId
								? formatPlural(
										l10n.t('{count, plural, one{{count} comment} other{{count} comments}}'),
										{
											count: (area.findings?.length ?? 0) + this.replies.length,
										},
									)
								: formatPlural(l10n.t('{count, plural, one{{count} file} other{{count} files}}'), {
										count: this.getAreaFiles(area).length,
									})
						}</span
					>
				</button>
				${this.renderFocusAreaActions(area, { isAnalyzed: isAnalyzed })}
			</div>
			${
				isExpanded && area.id === userFocusAreaId
					? this.renderReaderAreaBody(area)
					: isExpanded
						? html`<div class="review-area__body">
								<div class="review-area__rationale">${area.rationale}</div>
								<div class="review-area__files">
									${this.getAreaFiles(area).map(f => {
										// Split off a trailing `:line` or `:start-end` so the line range gets a
										// muted color (it's a locator, not part of the path).
										const match = f.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
										const path = match?.[1] ?? f;
										let start = match?.[2] != null ? Number(match[2]) : undefined;
										let end = match?.[3] != null ? Number(match[3]) : start;
										// Without a locator of its own, the link lands on the area's first finding in
										// the file — the thread is there, not at the top
										if (start == null) {
											const first = area.findings
												?.flatMap(fi => getReviewFindingLocations(fi))
												.find(l => l.filePath === path && l.lineRange != null);
											start = first?.lineRange?.start;
											end = first?.lineRange?.end ?? start;
										}
										const lineRange =
											start == null ? '' : end !== start ? `:${start}-${end}` : `:${start}`;
										return html`<button
											class="review-area__file-link"
											@click=${() => this.handleOpenFile(path, start, end)}
										>
											<code-icon
												class="review-area__file-link-icon"
												icon="go-to-file"
											></code-icon>
											<span class="review-area__file-link-text">${path}</span>
											${
												lineRange
													? html`<span class="review-area__file-link-lines"
															>${lineRange}</span
														>`
													: nothing
											}
										</button>`;
									})}
								</div>
								${
									needsAnalyze
										? html`<button
												class="review-area__analyze-btn"
												@click=${() => this.handleAnalyzeArea(area)}
											>
												<code-icon icon="search"></code-icon>
												${l10n.t('Review Files')}
											</button>`
										: nothing
								}
								${
									isLoading
										? html`<div class="review-area__loading" aria-live="polite">
												<code-icon icon="loading" modifier="spin"></code-icon>
												${l10n.t('Reviewing files...')}
											</div>`
										: nothing
								}
								${
									hasError
										? html`<div class="review-area__error" role="alert">
												<code-icon icon="error"></code-icon>
												${l10n.t('Failed to review files.')}
												<button
													class="review-area__retry-btn"
													@click=${() => this.handleAnalyzeArea(area)}
												>
													${l10n.t('Retry')}
												</button>
											</div>`
										: nothing
								}
								${
									hasFindings
										? this.renderFindings(area.findings, area)
										: isAnalyzed && !isLoading && !hasError
											? html`<div class="review-area__clean" aria-live="polite">
													<code-icon icon="pass"></code-icon>
													${l10n.t('No issues found in these files.')}
												</div>`
											: nothing
								}
							</div>`
						: nothing
			}
		</div>`;
	}

	/** How many of the area's findings point at a file that changed since — their cards say so too. */
	private renderAreaStale(area: AIReviewFocusArea) {
		const stale = this._staleFindings;
		const count = stale != null ? (area.findings?.filter(f => stale.has(f.id)).length ?? 0) : 0;
		if (count === 0) return nothing;

		return html`<span
			class="review-area__stale"
			title=${formatPlural(
				l10n.t(
					'{count, plural, one{{count} finding points at a file that changed after it was made} other{{count} findings point at files that changed after they were made}}',
				),
				{ count: count },
			)}
			>${l10n.t('changed since review')}</span
		>`;
	}

	/** The reader's replies on the other findings' threads — they show in their findings too; here they sit
	 *  with the reader's own comments, so everything the reader said is in one place. */
	private get replies(): ReviewReply[] {
		return getReviewReplies(this.result, this.session);
	}

	private renderReaderAreaBody(area: AIReviewFocusArea) {
		const replies = this.replies;
		return html`<div class="review-area__body">
			<div class="review-area__rationale">${area.rationale}</div>
			${area.findings?.length ? this.renderFindings(area.findings, area) : nothing}
			${
				replies.length
					? html`<div class="review-findings">${replies.map(reply => this.renderReply(reply))}</div>`
					: nothing
			}
		</div>`;
	}

	private renderReply({ finding, note }: ReviewReply) {
		const location = getReviewFindingLocations(finding)[0];
		const closed = this.session?.findingStates.get(finding.id) != null;
		return html`<div
			class="review-finding review-finding--reader review-finding--reply ${closed ? 'review-finding--closed' : ''}"
			data-severity="comment"
		>
			<div class="review-finding__header">
				<span class="review-finding__title review-finding__title--reader"
					>${l10n.t('You, on “{title}”', { title: getReviewFindingTitle(finding) })}</span
				>
				<span class="review-finding__actions">
					${
						note.id != null
							? html`<gl-button
									appearance="toolbar"
									density="compact"
									tooltip=${l10n.t('Delete Comment')}
									aria-label=${l10n.t('Delete Comment')}
									@click=${() => this.handleDeleteNote(finding.id, note.id!)}
								>
									<code-icon icon="trash"></code-icon>
								</gl-button>`
							: nothing
					}
				</span>
			</div>
			<div class="review-finding__description">${note.text}</div>
			${
				location != null
					? html`<button
							class="review-finding__location"
							@click=${() =>
								this.handleOpenFile(
									location.filePath,
									location.lineRange?.start,
									location.lineRange?.end,
								)}
						>
							<code-icon class="review-finding__location-icon" icon="go-to-file"></code-icon>
							<span class="review-finding__location-text">${location.filePath}</span>
							${
								location.lineRange
									? html`<span class="review-finding__location-lines"
											>:${location.lineRange.start}${
												location.lineRange.end !== location.lineRange.start
													? `-${location.lineRange.end}`
													: ''
											}</span
										>`
									: nothing
							}
						</button>`
					: nothing
			}
		</div>`;
	}

	private renderAreaSeverity(area: AIReviewFocusArea) {
		return html`<gl-tooltip
			content=${
				area.severity === 'critical'
					? l10n.t('Critical Issue')
					: area.severity === 'warning'
						? l10n.t('Warning (Non-Critical)')
						: l10n.t('Suggestion')
			}
			placement="bottom-start"
		>
			<span class="review-area__severity review-area__severity--${area.severity}">
				<code-icon
					icon=${area.severity === 'critical' ? 'error' : area.severity === 'warning' ? 'warning' : 'info'}
				></code-icon>
			</span>
		</gl-tooltip>`;
	}

	private renderFocusAreaActions(area: AIReviewFocusArea, state: { isAnalyzed: boolean }) {
		const areaMarkdown = state.isAnalyzed ? formatFocusAreaAsMarkdown(area, getClosedFindingIds(this.session)) : '';
		const disabled = !state.isAnalyzed;

		// The inner `?disabled` on the buttons applies `pointer-events: none`, which suppresses
		// their own tooltips on hover — so wrap the group in an outer `gl-tooltip` that explains
		// what's needed. Outer is gated to disabled-only; inner labels are cleared while disabled
		// so they don't double-up if the outer doesn't catch focus.
		return html`<gl-tooltip content=${l10n.t("Run 'Review Files' first")} ?disabled=${!disabled} placement="bottom">
			<span class="review-area__actions" @click=${(e: Event) => e.stopPropagation()}>
				<gl-copy-container
					appearance="toolbar"
					.content=${areaMarkdown}
					copyLabel=${disabled ? '' : l10n.t('Copy Focus Area Findings')}
					aria-label=${l10n.t('Copy Focus Area Findings')}
					copiedLabel=${l10n.t('Copied!')}
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
					tooltip=${disabled ? '' : l10n.t('Address Focus Area with Agent')}
					aria-label=${l10n.t('Address Focus Area with Agent')}
					?disabled=${disabled}
					@click=${() => !disabled && this.handleSendToChat('focusArea', { area: area })}
				>
					<code-icon icon="comment-discussion-sparkle"></code-icon>
				</gl-button>
			</span>
		</gl-tooltip>`;
	}

	private renderFindings(findings: readonly AIReviewFinding[], area?: AIReviewFocusArea) {
		const states = this.session?.findingStates;
		const open = findings.filter(f => states?.get(f.id) == null);
		const closed = findings.filter(f => states?.get(f.id) != null);
		const closedLabel = formatPlural(
			l10n.t('{count, plural, one{{count} dismissed finding} other{{count} dismissed findings}}'),
			{ count: closed.length },
		);

		return html`<div class="review-findings">
			${open.map(f => this.renderFinding(f, area))}
			${
				closed.length > 0
					? html`<button
								class="review-findings__dismissed"
								aria-expanded=${this._showClosedFindings ? 'true' : 'false'}
								@click=${this.handleToggleClosedFindings}
							>
								${closedLabel}
								<code-icon icon=${this._showClosedFindings ? 'chevron-up' : 'chevron-down'}></code-icon>
							</button>
							${this._showClosedFindings ? closed.map(f => this.renderFinding(f, area)) : nothing}`
					: nothing
			}
		</div>`;
	}

	private renderFinding(finding: AIReviewFinding, area?: AIReviewFocusArea) {
		const findingMarkdown = formatFindingAsMarkdown(
			finding,
			area ? { label: area.label, labelIsFallback: area.labelIsFallback, rationale: area.rationale } : undefined,
		);
		const severityLabel =
			finding.severity === 'critical'
				? l10n.t('CRITICAL')
				: finding.severity === 'warning'
					? l10n.t('WARNING')
					: l10n.t('SUGGESTION');

		const state = this.session?.findingStates.get(finding.id);
		// The reader's own comment: no severity, no title — their words are the card
		const isReader = finding.source === 'user';

		return html`<div
			class="review-finding ${state != null ? 'review-finding--closed' : ''} ${isReader ? 'review-finding--reader' : ''}"
			data-severity=${isReader ? 'comment' : finding.severity}
		>
			<div class="review-finding__header">
				${
					isReader
						? html`<span class="review-finding__title review-finding__title--reader"
								>${(finding as ReviewComment).author === 'agent' ? l10n.t('Agent') : l10n.t('You')}</span
							>`
						: html`<span class="review-finding__severity review-finding__severity--${finding.severity}">
									${severityLabel}
								</span>
								<span class="review-finding__title">${getReviewFindingTitle(finding)}</span>`
				}
				${
					finding.source === 'agent'
						? html`<span class="review-finding__source" title=${l10n.t('Reported by your agent')}
								>${l10n.t('Agent')}</span
							>`
						: nothing
				}
				${state != null ? html`<span class="review-finding__state">${l10n.t('Dismissed')}</span>` : nothing}
				${
					this._staleFindings?.has(finding.id)
						? html`<span
								class="review-finding__stale"
								title=${l10n.t('A file this finding points at changed after it was made — it may no longer apply')}
								>${l10n.t('changed since review')}</span
							>`
						: nothing
				}
				<span class="review-finding__actions">
					<gl-copy-container
						appearance="toolbar"
						.content=${findingMarkdown}
						copyLabel=${l10n.t('Copy Finding')}
						copiedLabel=${l10n.t('Copied!')}
						placement="bottom"
						timeout=${2500}
						@click=${() => this.dispatchCopied('finding')}
					>
						<code-icon icon="copy"></code-icon>
					</gl-copy-container>
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip=${l10n.t('Address with Agent')}
						aria-label=${l10n.t('Address with Agent')}
						@click=${() => this.handleSendToChat('finding', { area: area, finding: finding })}
					>
						<code-icon icon="comment-discussion-sparkle"></code-icon>
					</gl-button>
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip=${l10n.t('Leave a Comment')}
						aria-label=${l10n.t('Leave a Comment')}
						aria-expanded=${this._replyingTo === finding.id ? 'true' : 'false'}
						@click=${() => this.toggleReply(finding.id)}
					>
						<code-icon icon="reply"></code-icon>
					</gl-button>
					${
						state == null
							? html`<gl-button
									appearance="toolbar"
									density="compact"
									tooltip=${isReader ? l10n.t('Dismiss Comment') : l10n.t('Dismiss Finding')}
									aria-label=${isReader ? l10n.t('Dismiss Comment') : l10n.t('Dismiss Finding')}
									@click=${() => this.handleFindingState(finding.id, 'dismissed')}
								>
									<code-icon icon="check"></code-icon>
								</gl-button>`
							: html`<gl-button
									appearance="toolbar"
									density="compact"
									tooltip=${l10n.t('Reopen')}
									aria-label=${l10n.t('Reopen')}
									@click=${() => this.handleFindingState(finding.id, undefined)}
								>
									<code-icon icon="issue-reopened"></code-icon>
								</gl-button>`
					}
					<gl-button
						appearance="toolbar"
						density="compact"
						tooltip=${isReader ? l10n.t('Delete Comment') : l10n.t('Delete Finding')}
						aria-label=${isReader ? l10n.t('Delete Comment') : l10n.t('Delete Finding')}
						@click=${() => this.handleDeleteFinding(finding.id)}
					>
						<code-icon icon="trash"></code-icon>
					</gl-button>
				</span>
			</div>
			<div class="review-finding__description">${finding.description}</div>
			${this.renderFindingNotes(finding.id)}
			${getReviewFindingLocations(finding).map(
				location => html`<button
					class="review-finding__location"
					@click=${() =>
						this.handleOpenFile(location.filePath, location.lineRange?.start, location.lineRange?.end)}
				>
					<code-icon class="review-finding__location-icon" icon="go-to-file"></code-icon>
					<span class="review-finding__location-text">${location.filePath}</span>
					${
						location.lineRange
							? html`<span class="review-finding__location-lines"
									>:${location.lineRange.start}${
										location.lineRange.end !== location.lineRange.start
											? `-${location.lineRange.end}`
											: ''
									}</span
								>`
							: nothing
					}
				</button>`,
			)}
		</div>`;
	}

	/** The area's files as shown: once its findings are in, the files they point at — a file no finding
	 *  concerns has nothing to show for being listed — in the area's own order, extras after. Before the
	 *  findings arrive (a two-pass overview), the area's list is what there is. */
	private getAreaFiles(area: AIReviewFocusArea): readonly string[] {
		if (area.findings == null) return area.files;

		const pointed = new Set(area.findings.flatMap(f => getReviewFindingLocations(f).map(l => l.filePath)));
		const listed = area.files.map(f => f.match(/^(.+?)(?::\d+(?:-\d+)?)?$/)?.[1] ?? f);
		const files = area.files.filter((_, i) => pointed.has(listed[i]));
		for (const path of pointed) {
			if (!listed.includes(path)) {
				files.push(path);
			}
		}
		return files;
	}

	updateFocusAreaFindings(focusAreaId: string, result: AIReviewDetailResult): void {
		if (!this.result) return;

		// Two-pass delta: enrich just this area's `findings`. The willUpdate area-id-equality
		// check treats this as a same-run delta and preserves `_loadingAreas` for OTHER areas
		// still mid-analysis. The orchestrator also mutates the resource in parallel, which
		// produces a sibling identity change; that change also passes the same-run check.
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

	private handleOpenFile(filePath: string, line?: number, lineEnd?: number): void {
		this.dispatchEvent(
			new CustomEvent<ReviewOpenFileDetail>('review-open-file', {
				detail: { filePath: filePath, line: line, lineEnd: lineEnd },
				bubbles: true,
				composed: true,
			}),
		);
	}

	/** The finding whose reply box is open, if any. */
	@state() private _replyingTo?: string;

	private async toggleReply(findingId: string): Promise<void> {
		this._replyingTo = this._replyingTo === findingId ? undefined : findingId;
		if (this._replyingTo == null) return;

		await this.updateComplete;
		this.renderRoot.querySelector<HTMLInputElement>('.review-finding__reply-input')?.focus();
	}

	private submitReply(findingId: string, input: HTMLInputElement): void {
		const text = input.value.trim();
		if (!text) return;

		this.dispatchEvent(
			new CustomEvent<ReviewFindingNoteDetail>('review-finding-note', {
				detail: { findingId: findingId, text: text },
				bubbles: true,
				composed: true,
			}),
		);
		input.value = '';
		this._replyingTo = undefined;
	}

	/** What was said about the finding after the fact, and the reply box when it is open. */
	private renderFindingNotes(findingId: string) {
		const notes = this.session?.notes.get(findingId);
		const replying = this._replyingTo === findingId;
		if (!notes?.length && !replying) return nothing;

		return html`<div class="review-finding__notes">
			${(notes ?? []).map(
				note => html`<div class="review-finding__note review-finding__note--${note.author}">
					<span class="review-finding__note-author"
						>${note.author === 'agent' ? l10n.t('Agent') : l10n.t('You')}</span
					>
					<span class="review-finding__note-text">${note.text}</span>
					${
						note.id != null
							? html`<gl-button
									class="review-finding__note-delete"
									appearance="toolbar"
									density="compact"
									tooltip=${l10n.t('Delete Comment')}
									aria-label=${l10n.t('Delete Comment')}
									@click=${() => this.handleDeleteNote(findingId, note.id!)}
								>
									<code-icon icon="trash"></code-icon>
								</gl-button>`
							: nothing
					}
				</div>`,
			)}
			${
				replying
					? html`<div class="review-finding__reply">
							<input
								class="review-finding__reply-input"
								type="text"
								placeholder=${l10n.t('A note for the fix and the later review — why it was closed, a question, a correction…')}
								@keydown=${(e: KeyboardEvent) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										this.submitReply(findingId, e.currentTarget as HTMLInputElement);
									} else if (e.key === 'Escape') {
										this._replyingTo = undefined;
									}
								}}
							/>
							<gl-button
								appearance="secondary"
								density="compact"
								@click=${(e: Event) =>
									this.submitReply(
										findingId,
										(e.currentTarget as HTMLElement).parentElement!.querySelector<HTMLInputElement>(
											'.review-finding__reply-input',
										)!,
									)}
								>${l10n.t('Comment')}</gl-button
							>
						</div>`
					: nothing
			}
		</div>`;
	}

	private handleDeleteFinding(findingId: string): void {
		this.dispatchEvent(
			new CustomEvent<ReviewFindingDeleteDetail>('review-finding-delete', {
				detail: { findingId: findingId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleDeleteNote(findingId: string, noteId: string): void {
		this.dispatchEvent(
			new CustomEvent<ReviewFindingNoteDeleteDetail>('review-finding-note-delete', {
				detail: { findingId: findingId, noteId: noteId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleFindingState(findingId: string, state: ReviewFindingState | undefined): void {
		this.dispatchEvent(
			new CustomEvent<ReviewFindingStateDetail>('review-finding-state', {
				detail: { findingId: findingId, state: state },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleToggleClosedFindings = (): void => {
		this._showClosedFindings = !this._showClosedFindings;
	};
}
