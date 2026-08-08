import type { Remote } from '@eamodio/supertalk';
import { SignalWatcher } from '@lit-labs/signals';
import { consume, provide } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { OverlayEntry } from '@gitlens/utils/keys/keybinding.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { AgentSessionState, PastAgentSessionsResult } from '../../../../../agents/models/agentSessionState.js';
import type { StashApplyCommandArgs } from '../../../../../commands/stashApply.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { StoredGraphWipDraft } from '../../../../../constants.storage.js';
import type { GraphDetailsMode, GraphWipAction } from '../../../../../constants.telemetry.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type { Wip } from '../../../../plus/graph/detailsProtocol.js';
import type {
	AutoRebaseSummary,
	ConflictSide,
	GraphServices,
	UndoAutoRebaseResult,
	VirtualRefShape,
} from '../../../../plus/graph/graphService.js';
import type {
	GetWipLineStatsResponse,
	GraphActionTarget,
	GraphComposeScopeSeed,
	GraphShowAction,
	GraphSidebarPullRequest,
	State,
} from '../../../../plus/graph/protocol.js';
import {
	GetWipLineStatsRequest,
	getWipRowWorktreePath,
	isWipSelectionSha,
	UpdateWipDraftCommand,
} from '../../../../plus/graph/protocol.js';
import type { AiModelInfo, ConflictDetails } from '../../../../rpc/services/types.js';
import type { FileChangeListItemDetail } from '../../../commitDetails/components/gl-details-base.js';
import type {
	CopyCommitPatchEventDetail,
	CopyWipPatchEventDetail,
	OpenMultipleChangesArgs,
} from '../../../shared/actions/file.js';
import type { AgentSessionCategory, PastAgentSessionsResolver } from '../../../shared/agentUtils.js';
import {
	agentPhaseToCategory,
	createPastAgentSessionsResolver,
	matchAgentSessionsForWorktree,
} from '../../../shared/agentUtils.js';
import { renderDetailsMaximizeChip } from '../../../shared/components/details-header/details-maximize-chip.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import type { WebviewContext } from '../../../shared/contexts/webview.js';
import { webviewContext } from '../../../shared/contexts/webview.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import type { NavigationState } from '../../../shared/controllers/navigationStack.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import type { GraphCrossPaneState } from '../graphCrossPaneState.js';
import { graphCrossPaneContext } from '../graphCrossPaneState.js';
import type { GraphLaunchpadState } from '../graphLaunchpadState.js';
import { graphLaunchpadContext } from '../graphLaunchpadState.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import type { AnchorKey } from './anchorKey.js';
import { anchorKey } from './anchorKey.js';
import {
	branchSheetContextRef,
	findRefTipSha,
	parseBranchSheetContext,
	resolveBranchSheetScope,
} from './branchSheet.utils.js';
import type { DetailsActions } from './detailsActions.js';
import { countReviewFindingSeverities, getReviewDiffEndpoints, scopeSelectionEqual } from './detailsActions.js';
import { detailsActionsContext, detailsStateContext, detailsWorkflowContext } from './detailsContext.js';
import { resolveDetailsActions } from './detailsResolver.js';
import type { DetailsContext, DetailsState, RunningOperation, RunningOperationExecState } from './detailsState.js';
import { createDetailsState, getActiveTaskAction } from './detailsState.js';
import type { DetailsSelection } from './detailsWorkflowController.js';
import { DetailsWorkflowController } from './detailsWorkflowController.js';
import type { ExpandState, GlDetailsAgentStatus } from './gl-details-agent-status.js';
import { expandVisibleCategories } from './gl-details-agent-status.js';
import type { FileCompareBetweenDetail } from './gl-details-compare-mode-panel.js';
import { hasOnlyWip } from './gl-details-compare-mode-panel.js';
import type { GlDetailsComposeModePanel } from './gl-details-compose-mode-panel.js';
import type { GlDetailsResolveModePanel } from './gl-details-resolve-mode-panel.js';
import type {
	ReviewAnalyzeAreaDetail,
	ReviewCopiedDetail,
	ReviewOpenFileDetail,
	ReviewSendToChatDetail,
} from './gl-details-review-mode-panel.js';
import type { BranchSheetRef } from './gl-graph-branch-sheet-pane.js';
import type { RebaseSummaryViewDiffDetail } from './gl-rebase-summary-sheet.js';
import type { ConflictSheetCommitEventDetail, ConflictSheetSideEventDetail } from './gl-wip-conflict-sheet.js';
import type { SheetDescriptor, SheetKind, SheetOverlayCoordinator } from './sheetStack.js';
import {
	popSheet as popSheetFromStack,
	projectCompareSignal,
	pushSheet,
	reduceOnSelectionChange,
	removeKind,
	replaceStack,
	sheetKey,
} from './sheetStack.js';
import { sheetWrapperSelector } from './sheetWrapper.js';
import '../../../commitDetails/components/gl-details-commit-panel.js';
import '../../../commitDetails/components/gl-details-wip-panel.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/split-panel/split-panel.js';
import './gl-graph-branch-sheet.js';
import './gl-graph-compare-pinned.js';
import './gl-graph-compare-sheet.js';
import './gl-rebase-summary-sheet.js';
import './gl-graph-pr-sheet.js';
import './gl-wip-conflict-sheet.js';
import './gl-details-multicommit-panel.js';
import './gl-details-compose-mode-panel.js';
import './gl-details-review-mode-panel.js';
import './gl-details-resolve-mode-panel.js';
import './gl-commit-box.js';
import './gl-details-wip-empty-pane.js';
import './gl-details-wip-header.js';
import './gl-graph-coachmark.js';

interface ResolvedContent {
	content: ReturnType<typeof html> | typeof nothing;
	ariaLabel: string;
	context: DetailsContext;
}

/** Default size (as a % of the details panel) for the agents pane when entering `expanded` mode
 *  without a prior user drag. Leaves a usable majority for the WIP / mode content below. */
const agentStatusDefaultPct = 40;

/** Absolute ceiling (as a % of the details panel) the agents pane is allowed to occupy: caps the
 *  drag snap envelope in expanded mode AND the CSS `fit-content` ceiling in collapsed/partial.
 *  Kept in sync with the `fit-content(80%)` literal in `agent-status-split--auto-size` CSS. */
const agentStatusMaxPct = 80;

/** Wraps a possibly-undefined sha string into the `{ ref, stash? }` shape expected by file
 *  actions. Used for multi-commit (range) refs whose source returns a bare string. */
function asRefObj(ref: string | undefined): { ref: string } | undefined {
	return ref != null ? { ref: ref } : undefined;
}

/** Order-sensitive equality for the sheet stack's kind composition — used to report `updated`'s
 *  stack-change event only on an actual composition change. */
function sheetKindsEqual(a: readonly SheetKind[], b: readonly SheetKind[]): boolean {
	return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Renders a mode-status counts snippet with leading icons — "🟢 1 commit · 📄 2 files".
 *  When `onResume` is provided, the whole snippet becomes a clickable "Resume" affordance
 *  prefixed with the verb and trailed with an arrow — replaces the old in-panel resume bar. */
function formatModeCounts(primary: number, files: number, primaryLabel: 'commits' | 'findings', onResume?: () => void) {
	const singular = primaryLabel === 'commits' ? 'commit' : 'finding';
	const primaryText = `${primary} ${primary === 1 ? singular : primaryLabel}`;
	const fileText = `${files} ${files === 1 ? 'file' : 'files'}`;
	const primaryIcon = primaryLabel === 'commits' ? 'git-commit' : 'search';
	const counts = html`<span class="mode-status__group"
			><code-icon icon=${primaryIcon}></code-icon>${primaryText}</span
		>
		<span class="mode-status__group"><code-icon icon="files"></code-icon>${fileText}</span>`;

	if (onResume == null) return counts;

	const resumeLabel = primaryLabel === 'commits' ? 'Resume Plan' : 'Resume Review';
	return html`<button class="mode-status__resume" type="button" aria-label=${resumeLabel} @click=${onResume}>
		<span class="mode-status__resume-verb">${resumeLabel}</span>
		${counts}
		<code-icon class="mode-status__resume-arrow" icon="arrow-right"></code-icon>
	</button>`;
}

/** "<verb> with <model>..." generating snippet for the mode-status row. The model name carries the
 *  full "provider · model" in a gl-tooltip; falls back to the bare verb when no model is known. */
function formatGeneratingStatus(verb: 'Composing' | 'Reviewing' | 'Resolving', model: AiModelInfo | undefined) {
	if (model == null) return `${verb}...`;

	const full = `${model.provider.name} · ${model.name}`;
	// Wrap in a single element so the `.mode-status` flex `gap` doesn't insert space around the
	// model name — inside, the verb/name/ellipsis flow as plain inline text.
	return html`<span class="mode-status__generating"
		>${verb} with <gl-tooltip content=${full}><span class="mode-status__model">${model.name}</span></gl-tooltip
		>...</span
	>`;
}

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-graph-details-mode-changed': CustomEvent<{
			previous: GraphDetailsMode;
			current: GraphDetailsMode;
		}>;
		/** The sheet stack's kind composition changed — e.g. the app sizes the details pane for a
		 *  rebase summary sheet opening or closing. */
		'gl-graph-sheet-stack-change': CustomEvent<{ kinds: SheetKind[]; prevKinds: SheetKind[] }>;
	}
}

type PanelOrientation = 'horizontal' | 'vertical';
const narrowPanelThreshold = 600;

@customElement('gl-graph-details-panel')
export class GlGraphDetailsPanel extends SignalWatcher(LitElement) {
	@consume({ context: graphServicesContext, subscribe: true })
	@state()
	private _remoteServices?: Remote<GraphServices>;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: typeof graphStateContext.__context__;

	// Shared Launchpad summary, owned/fetched by `gl-graph-app`. Read here only to feed the WIP
	// empty pane — this panel no longer fetches it. `hasIntegrationsConnected` stays in
	// `detailsState` (its other consumers — compare/multi-commit panels — still need it).
	@consume({ context: graphLaunchpadContext, subscribe: true })
	private _launchpadState?: GraphLaunchpadState;

	@consume({ context: ipcContext })
	private _ipc?: typeof ipcContext.__context__;

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	/** Provider lives on `gl-graph-app`. The workflow controller writes the running-modes
	 *  registry through this; other panes (graph row component) read it for adornments. */
	@consume({ context: graphCrossPaneContext })
	private _crossPaneState!: GraphCrossPaneState;

	/** Exposed for {@link DetailsWorkflowController} so it can write running-mode entries
	 *  through the shared signal owned by `gl-graph-app`. */
	get crossPaneState(): GraphCrossPaneState {
		return this._crossPaneState;
	}

	/** True when the currently-active compose/review session is anchored to a commit (or
	 *  multi-commit) selection AND has a running entry in the registry. In that case the
	 *  details panel stays locked to the entry-time anchor even when the graph's selection
	 *  moves elsewhere — the user explicitly closes the session to leave it. WIP-anchored
	 *  running sessions don't participate in the lock (they follow the selection and rely on
	 *  the registry's preserve/restore handshake instead). */
	private get isLockedCommitRunningOperation(): boolean {
		const mode = this._state.activeMode.get();
		if (mode !== 'review' && mode !== 'compose') return false;

		const ctx = this._state.activeModeContext.get();
		if (ctx !== 'commit' && ctx !== 'multicommit') return false;

		const lockedKey = anchorKey({
			sha: this._state.activeModeSha.get(),
			shas: this._state.activeModeShas.get(),
			repoPath: this._state.activeModeRepoPath.get(),
		});
		const bucket = this._crossPaneState?.runningOperations.get().get(lockedKey);
		return bucket?.[mode] != null;
	}

	/** The engaged anchor's running operation for the currently-active mode, if any. Used by
	 *  {@link renderReviewMode}/{@link renderComposeMode} to drive the panel's `mappedStatus`
	 *  from the entry's `execState` (the single `Resource` is a *projection*, not the source of
	 *  truth for generation state). Engaged anchor = the locked anchor for commit/multicommit
	 *  contexts, else the current selection. */
	private get engagedRunningOperation(): RunningOperation | undefined {
		const mode = this._state.activeMode.get();
		if (mode !== 'review' && mode !== 'compose' && mode !== 'resolve') return undefined;

		return this._crossPaneState?.runningOperations.get().get(this.engagedAnchorKey)?.[mode];
	}

	/** Anchor key the engaged mode's registry entry is looked up under — the locked anchor for
	 *  commit/multicommit contexts, else the current selection. */
	private get engagedAnchorKey(): AnchorKey {
		const ctx = this._state.activeModeContext.get();
		const isLockedCommit = ctx === 'commit' || ctx === 'multicommit';
		return isLockedCommit
			? anchorKey({
					sha: this._state.activeModeSha.get(),
					shas: this._state.activeModeShas.get(),
					repoPath: this._state.activeModeRepoPath.get(),
				})
			: anchorKey({ sha: this.sha, shas: this.shas, repoPath: this.repoPath });
	}

	/** The live task the user is engaged in — see {@link getActiveTaskAction}. Read by the
	 *  account-gate's task-specific sign-in messaging (#5534) when a sign-out interrupts it. */
	get activeTaskAction(): { action: GraphShowAction; target?: GraphActionTarget } | undefined {
		return getActiveTaskAction(this._state);
	}

	/** Per-mode exec state + has-result of the engaged anchor's entry — drives the suffix-icon
	 *  status overlay on the compose/review header toggle chips (parallel to the WIP-row
	 *  adornment). `hasResult` separates a `'backed'` entry with a viewable result (Restart from
	 *  success) from a `'backed'`-no-result placeholder (cancelled / first-error Go Back) so the
	 *  chip doesn't falsely claim a result exists. For a toggled-out mode with a still-running
	 *  entry, this reads from the current selection's anchor so the chip overlay continues to
	 *  reflect the registry. */
	private get engagedModeStatus():
		| Partial<
				Record<'review' | 'compose' | 'resolve', { execState: RunningOperationExecState; hasResult: boolean }>
		  >
		| undefined {
		const bucket = this._crossPaneState?.runningOperations.get().get(this.engagedAnchorKey);
		if (bucket == null) return undefined;

		const out: Partial<
			Record<'review' | 'compose' | 'resolve', { execState: RunningOperationExecState; hasResult: boolean }>
		> = {};
		if (bucket.review != null) {
			out.review = { execState: bucket.review.execState, hasResult: bucket.review.result != null };
		}
		if (bucket.compose != null) {
			out.compose = { execState: bucket.compose.execState, hasResult: bucket.compose.result != null };
		}
		if (bucket.resolve != null) {
			out.resolve = { execState: bucket.resolve.execState, hasResult: bucket.resolve.result != null };
		}
		return out.review != null || out.compose != null || out.resolve != null ? out : undefined;
	}

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
	private _pendingCompare?: {
		params: Parameters<GlGraphDetailsPanel['openCompareMode']>[0];
		onReady?: () => void;
	};
	/** Set by {@link openCompareOverSheet} and consumed by the compare projection in `willUpdate` — the
	 *  open itself round-trips through the compare signal, so the intent can't ride the call. */
	private _comparePushRequested = false;

	/** A mode request that arrived before the workflow controller finished its async init (e.g. an
	 *  Inspect-delegated Review/Compose on a cold graph open). Applied once `_workflow` exists.
	 *  Mirrors {@link _pendingCompare}. */
	private _pendingMode?: {
		mode: 'compose' | 'review' | 'resolve';
		repoPath: string;
		sha: string;
		focusedFilePaths?: readonly string[];
		composeInstructions?: string;
		composeScope?: GraphComposeScopeSeed;
	};

	/** Seed value for the compose panel's idle AI-instructions input, delivered by an external
	 *  entry point (e.g. the MCP compose tool's instructions) — parity with the retired standalone
	 *  composer's `autoComposeInstructions`. Seed only; never triggers generation. Scoped to the
	 *  anchor it was delivered for and cleared when compose deactivates (plus cancel/discard), so
	 *  it can't resurface on a later manual entry; the engaged entry's `basePrompt` always wins
	 *  when a session exists. */
	@state()
	private _composeSeedInstructions?: { anchorKey: AnchorKey; instructions: string };

	private _lastPushedWip?: unknown;
	private _lastBranchState?: unknown;

	/** User's chosen splitter position (1-99 %) for the agents/WIP split in `expanded` mode.
	 *  Set by pointer drag OR keyboard resize (see {@link _onAgentStatusSplitChange} /
	 *  {@link _onAgentStatusSplitDragEnd}). Container resizes never write here because `gl-split-panel`
	 *  no longer emits `gl-split-panel-change` on resize — it holds the primary panel's pixel width
	 *  silently — so a resize can't latch the user-size mode. Cleared by the sash dbl-click reset;
	 *  preserved across collapse cycles so re-expanding (chevron, WIP indicator, sidebar/kanban
	 *  select) restores the user's last chosen size. `undefined` means "use the default expanded
	 *  position" — see {@link agentStatusDefaultPct}. */
	@state()
	private _agentStatusSplitPosition?: number;

	/** Per-file working-tree line stats (keyed by normalized path) for the WIP file rows. Fetched
	 *  lazily via {@link GetWipLineStatsRequest} — only while the WIP file list is shown — since the
	 *  every-tick `wip` push carries file status only, never line counts. */
	@state()
	private _wipFileStats?: GetWipLineStatsResponse;
	/** The `wip` snapshot the current {@link _wipFileStats} were requested for. Reference-compared so
	 *  each fresh working-tree push (a new `wip` object) triggers exactly one refetch, and re-selecting
	 *  the same snapshot doesn't. */
	private _wipFileStatsFetchedFor?: Wip;

	/** Worktree path the past-agent-sessions resource was last fetched for — dedupes
	 *  {@link updateWipPastSessions} so re-rendering the same WIP row doesn't refetch. */
	private _lastPastSessionsPath?: string;

	/** User's explicit choice for the agents-pane mode — collapsed (bar only) or expanded
	 *  (all cards). Flipped by chevron clicks via {@link _onAgentStatusExpandRequest}. The
	 *  third surface state — `partial`, only needs-input cards — is derived (not stored here):
	 *  set transiently by {@link _agentStatusAutoPartial} when an incoming session event signals
	 *  a new (or changed) needs-input while the user is collapsed. */
	@state()
	private _agentUserMode: 'collapsed' | 'expanded' = 'collapsed';

	/** Transient pseudo-expand flag — true when an agent event triggered an auto-surface and
	 *  the user hasn't dismissed it yet. Only meaningful while `_agentUserMode === 'collapsed'`
	 *  (a manual expand subsumes it). Cleared when the last needs-input resolves OR when the
	 *  user clicks the chevron to collapse. */
	@state()
	private _agentStatusAutoPartial = false;

	/** Per-session snapshot of category + pending-permission identity from the last update.
	 *  Drives the auto-partial trigger in {@link applyAgentAutoSurface}: a session that newly
	 *  enters `needs-input`, or whose pending permission key changes while it stays in
	 *  needs-input, flips `_agentStatusAutoPartial` true. Cleared on every selection change in
	 *  {@link willUpdate} so re-entering a WIP row re-treats current sessions as freshly seen —
	 *  any pending needs-input session re-surfaces partial mode automatically. */
	private _prevAgentSnapshot: Map<string, { category: AgentSessionCategory; permKey: string }> = new Map();

	/** Worktree-matched agent sessions captured once per update cycle in {@link willUpdate}.
	 *  Both `applyAgentAutoSurface` (the auto-partial trigger) AND `renderWip` (the source for
	 *  `<gl-details-agent-status>.sessions`) read from this snapshot so the projected mode and
	 *  the visible cards always agree. Without a cycle-stable snapshot, a mid-update mutation
	 *  of `_graphState.agentSessions` could leave partial-mode flipped on with no needs-input
	 *  cards to render — a chevron rotated to 45deg above an empty section. */
	private _cycleAgentSessions: AgentSessionState[] | undefined;

	/** Cycle-stable past sessions, resolved alongside {@link _cycleAgentSessions} so the visibility
	 *  gate and the rendered rows can't disagree — see {@link createPastAgentSessionsResolver}. */
	private _cyclePastSessions: PastAgentSessionsResult | undefined;
	private readonly _pastSessionsResolver: PastAgentSessionsResolver = createPastAgentSessionsResolver();

	/** Clamps drag to the [10%, {@link agentStatusMaxPct}%] envelope. The visual "shrink to
	 *  content when too small" behavior is handled by CSS `fit-content(<max>%)` — the snap
	 *  function only enforces the absolute floor/ceiling on the user's intended size. */
	private readonly _agentStatusSplitSnap = ({ pos }: { pos: number }) =>
		Math.max(10, Math.min(pos, agentStatusMaxPct));

	private readonly _onAgentStatusExpandRequest = () => {
		// Chevron click: collapsed → expanded; partial or expanded → collapsed. Branch on the
		// DERIVED state (not `_agentUserMode`) so a click from `partial` — where user mode is
		// still 'collapsed' under the hood — collapses instead of expanding. Always clears the
		// auto-partial flag so a manual collapse genuinely silences the section until the next
		// qualifying agent event. Drag-adjusted size (`_agentStatusSplitPosition`) is
		// intentionally preserved across collapse cycles so re-expanding restores the user's
		// last chosen size; double-click on the sash resets it.
		const wasCollapsed = this.agentStatusExpand === 'collapsed';
		this._agentStatusAutoPartial = false;
		this._agentUserMode = wasCollapsed ? 'expanded' : 'collapsed';
		// User collapsed the section via chevron — the prior highlight intent is gone. Without
		// clearing, the next manual expand would re-paint card--selected on the stale id and
		// falsely suggest the card was just re-selected. Only fires on the collapse direction;
		// expanding from collapsed preserves any sidebar-selected session for highlight.
		if (!wasCollapsed) {
			this._selectedAgentSessionId = undefined;
		}
	};

	private readonly _onAgentStatusSplitChange = (e: CustomEvent<{ position: number }>) => {
		// Only persist while in `expanded` — collapsed/partial render via fit-content, not the
		// position attribute, so writes there would silently overwrite the expanded-mode position
		// with a value that never even drove a render. Drag and keyboard resizes both persist here;
		// container resizes don't reach this handler (split-panel holds the primary pixel width
		// silently, with no emit on resize), so no `dragging` gate is needed.
		if (this.agentStatusExpand !== 'expanded') return;

		this._agentStatusSplitPosition = e.detail.position;
	};

	private readonly _onAgentStatusSplitDragEnd = (e: CustomEvent<{ position: number }>) => {
		if (this.agentStatusExpand !== 'expanded') return;

		this._agentStatusSplitPosition = e.detail.position;
	};

	/** Derived render mode for `<gl-details-agent-status>`. Expanded wins over auto-partial
	 *  (a manual expand already shows everything); auto-partial only surfaces while collapsed. */
	private get agentStatusExpand(): ExpandState {
		if (this._agentUserMode === 'expanded') return 'expanded';
		return this._agentStatusAutoPartial ? 'partial' : 'collapsed';
	}

	/** Diff incoming worktree-matched sessions against the prior snapshot and flip
	 *  `_agentStatusAutoPartial` according to the rules:
	 *   - Any session that wasn't `needs-input` before and is now → surface (true).
	 *   - Any session that stayed `needs-input` but with a different pending payload → surface.
	 *   - No needs-input remaining → clear (auto-collapse out of partial).
	 *  Called from {@link willUpdate} only when the panel is rendering a WIP row with resolved
	 *  wip data — so the snapshot reflects the current worktree's session set. Off-WIP cycles
	 *  skip this entirely; the snapshot is wiped on every selection change in {@link willUpdate}
	 *  so re-entering a WIP row replays the diff against an empty `_prevAgentSnapshot` and any
	 *  pending needs-input session re-triggers partial mode. */
	private applyAgentAutoSurface(sessions: AgentSessionState[] | undefined): void {
		const next = new Map<string, { category: AgentSessionCategory; permKey: string }>();
		let anyNeedsInput = false;
		let triggered = false;

		for (const s of sessions ?? []) {
			const category = agentPhaseToCategory[s.phase];
			// JSON-stringify the full pending permission so every meaningful field participates
			// in the diff: suggestions, toolInputDescription, questionCount, etc. A pipe-joined
			// subset misses these and also collides when free-form text contains the delimiter.
			const permKey = s.pendingPermission != null ? JSON.stringify(s.pendingPermission) : '';
			next.set(s.id, { category: category, permKey: permKey });

			if (category !== 'needs-input') continue;

			anyNeedsInput = true;

			const prev = this._prevAgentSnapshot.get(s.id);
			if (prev?.category !== 'needs-input' || prev.permKey !== permKey) {
				triggered = true;
			}
		}

		this._prevAgentSnapshot = next;

		if (triggered) {
			this._agentStatusAutoPartial = true;
		} else if (!anyNeedsInput && this._agentStatusAutoPartial) {
			// Last needs-input cleared → drop the auto-surface so the section snaps back to bar-only.
			this._agentStatusAutoPartial = false;
		}
	}

	private readonly _onAgentStatusSplitDblClick = () => {
		this._agentStatusSplitPosition = undefined;
	};

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

	/**
	 * Persisted preference: whether the file-tree search box (typed-text filter) is visible.
	 * Threaded through to each detail-panel mode's `gl-file-tree-pane`.
	 */
	@property({ type: Boolean, attribute: 'show-search-box' })
	showSearchBox = true;

	/**
	 * Persisted preference: how the file-tree search box presents non-matches —
	 * `true` hides them (filter), `false` dims them (highlight).
	 */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter = true;

	/** Back/forward history state from the graph host, forwarded to the commit panel's header. */
	@property({ attribute: false })
	navigation?: NavigationState;

	/** Registers a transient surface on the host's keymap Esc overlay stack; supplied by `gl-graph-app`.
	 *  Wired to the top-of-stack sheet only — see {@link _sheetCoordinator}. */
	@property({ attribute: false })
	pushOverlay?: (entry: OverlayEntry) => Disposable;

	/** True when the details panel is docked bottom — gates the maximize/restore chip in every mode's
	 *  toolbar. Forwarded to each mode sub-panel. */
	@property({ type: Boolean, attribute: 'show-maximize' })
	showMaximize = false;

	/** Whether the panel is currently maximized — drives the maximize chip's icon/label. */
	@property({ type: Boolean })
	maximized = false;

	/** Whether the top sheet is currently sheet-maximized (transient, derived) — drives the branch/
	 *  compare sheet's own maximize chip and the sheet stack's `maximized` binding. Distinct from
	 *  {@link maximized}, which is the panel's own state. */
	@property({ type: Boolean, attribute: 'sheet-maximized' })
	sheetMaximized = false;

	/** Drives only the "first open of Graph" coach-mark trigger; `graph-app` owns the underlying state. */
	@property({ type: Boolean, attribute: 'graph-ready' })
	graphReady = false;

	/** The compare sheet's title span — the coachmark anchors here so its tip pops under the title,
	 *  matching the WIP header's compose/review marks (`queryHeaderTitle`). The span lives in the
	 *  wrapper's shadow root; fall back outward when it hasn't rendered yet. */
	private readonly queryCompareSheetTitle = (): HTMLElement | undefined => {
		const wrapper = this.renderRoot.querySelector('gl-graph-compare-sheet');
		return wrapper?.shadowRoot?.querySelector<HTMLElement>('.title') ?? wrapper ?? undefined;
	};

	private get isMultiCommit(): boolean {
		return this.shas != null && this.shas.length >= 2;
	}

	private get isWip(): boolean {
		return isWipSelectionSha(this.sha);
	}

	/** Lazily fetch the per-file WIP line stats when the WIP file list is shown, deduped per `wip`
	 *  snapshot. Called from {@link updated} so it re-runs whenever the selection/mode/wip signals
	 *  change.
	 *
	 *  TODO(revisit): refetch is driven by `wip`-reference changes, and the host dedups WIP pushes by
	 *  `git status` content — which has no line info. So a pure line edit within an already-modified
	 *  file (same status) won't refresh the `+N −M` until a file-set/status change, WIP re-select, or
	 *  manual refresh. Making it update per-save means running the diff on every FS tick while the
	 *  panel is open (host-driven); revisit if the staleness-during-editing proves annoying. */
	private updateWipFileStats(): void {
		// Only when the plain WIP file list is on screen (not review/compose/resolve modes) and there
		// are files to diff — a clean tree has nothing to show and shouldn't cost a `git diff`.
		const wip = this._state.activeMode.get() == null && this.isWip ? this._state.wip.get() : undefined;
		const repoPath = wip?.repo?.path;
		if (wip == null || !repoPath || (wip.changes?.files?.length ?? 0) === 0) {
			// Left the WIP view (or nothing to show) — drop stale stats so re-entry refetches fresh.
			if (this._wipFileStatsFetchedFor != null) {
				this._wipFileStatsFetchedFor = undefined;
				this._wipFileStats = undefined;
			}
			return;
		}

		if (this._wipFileStatsFetchedFor === wip) return;

		// On a repo/worktree switch, drop the prior repo's numbers immediately so we never show them
		// against the new tree; same-repo working-tree ticks update in place (no row flicker).
		if (this._wipFileStatsFetchedFor?.repo?.path !== repoPath) {
			this._wipFileStats = undefined;
		}
		this._wipFileStatsFetchedFor = wip;

		void this._ipc?.sendRequest(GetWipLineStatsRequest, { repoPath: repoPath }).then(stats => {
			// Ignore a response a newer snapshot (or a view change) has already superseded.
			if (this._wipFileStatsFetchedFor === wip) {
				this._wipFileStats = stats ?? undefined;
			}
		});
	}

	/** Lazily fetch the worktree's past (resumable) agent sessions while a WIP row is selected,
	 *  mirroring {@link updateWipFileStats}. Dedupes on {@link _lastPastSessionsPath} so re-rendering
	 *  the same worktree doesn't refetch; the `Resource` itself (a `SignalWatcher` dependency) drives
	 *  the re-render once the fetch resolves. */
	private updateWipPastSessions(): void {
		if (!this.isWip) return;

		const worktreePath = this._state.wip.get()?.repo?.path;
		if (worktreePath == null || worktreePath === this._lastPastSessionsPath) return;

		this._lastPastSessionsPath = worktreePath;
		void this._actions?.resources.pastAgentSessions.fetch(worktreePath);
	}

	/** Attach the lazily-fetched per-file line stats to the WIP file rows so `gl-file-tree-pane`
	 *  renders `+N −M` decorations. Returns the raw files unchanged until the stats arrive. */
	private buildWipFiles(wip: Wip): Wip['changes'] {
		const files = wip.changes?.files;
		const stats = this._wipFileStats;
		if (wip.changes == null || files == null || stats == null) return wip.changes;

		return {
			...wip.changes,
			files: files.map(f => {
				const s = stats[normalizePath(f.path)];
				return s != null
					? {
							...f,
							stats: {
								additions: s.additions,
								deletions: s.deletions,
								changes: s.additions + s.deletions,
							},
						}
					: f;
			}),
		};
	}

	/** Active mode used for telemetry — combines `activeMode` (review/compose), compare-sheet
	 *  visibility, and the effective selection context (commit/wip/multicommit). Returns `'none'`
	 *  when no selection. Compare wins over the underlying selection context when its sheet is
	 *  open since it's the topmost surface. */
	get currentMode(): GraphDetailsMode {
		if (this._state.compareSheetOpen.get()) return 'compare';

		const active = this._state.activeMode.get();
		if (active != null) return active;
		if (this.sha == null && (this.shas == null || this.shas.length === 0)) return 'none';
		return this.isMultiCommit ? 'multicommit' : this.isWip ? 'wip' : 'commit';
	}

	/** Last value reported via `gl-graph-details-mode-changed` — guards the dispatch in `updated()`
	 *  so the event fires only on real transitions, not on re-renders that don't change the mode. */
	private _lastNotifiedMode: GraphDetailsMode = 'none';

	/** One-shot: set before a programmatic (ambient) mode entry so `updated()` skips the AI-input
	 *  focus — keeps focus-on-entry for deliberate toggles only. Consumed every `updated()`. */
	private _suppressModeFocusOnce = false;

	/** Returns the effective context, respecting mode lock when active. */
	private get effectiveContext(): DetailsContext {
		return (
			this._state.activeModeContext.get() ?? (this.isMultiCommit ? 'multicommit' : this.isWip ? 'wip' : 'commit')
		);
	}

	/** Total files in the current scope (post AI-filter, pre user-exclusion). Used by mode
	 *  telemetry to report scope size without exposing paths. Mirrors the file-list resolution
	 *  used by `renderComposeMode` / `renderReviewMode`. */
	private getCurrentScopeFilesCount(): number {
		const scoped = this._actions.resources.scopeFiles.value.get();
		if (scoped != null) return scoped.length;

		const ctx = this.effectiveContext;
		if (ctx === 'wip') return this._state.wip.get()?.changes?.files?.length ?? 0;
		if (ctx === 'multicommit') return this._state.compareFiles.get()?.length ?? 0;
		return this._state.commit.get()?.files?.length ?? 0;
	}

	private get effectiveRepoPath(): string | undefined {
		// Precedence: mode anchor > attribute (set by parent on selection) > last-known wip repo.
		// The attribute is set synchronously on row click and is correct per-row (primary worktree
		// for primary-WIP, secondary worktree for secondary-WIP). `_state.wip.get()?.repo?.path`
		// is updated lazily and can briefly hold the prior selection's wip — preferring it over the
		// attribute caused file/diff/stage operations on secondary-WIP rows to target the primary
		// repo during that window. Falling back to it only when the attribute hasn't bound yet
		// preserves the cold-bootstrap behavior.
		return this._state.activeModeRepoPath.get() ?? this.repoPath ?? this._state.wip.get()?.repo?.path;
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
		return getSelectedRepoPath(this._graphState ?? {});
	}

	/** Paused-op banner "Resolve Conflicts" text + the file-tree toolbar button — enters resolve mode
	 *  for all conflicts on the shown WIP. Uses `enterModeForWip` (not `toggleMode`) so a click while
	 *  resolve mode is already engaged re-focuses instead of exiting. */
	private handleAiResolveConflicts = (): void => {
		const repoPath = this._state.wip.get()?.repo.path ?? this.effectiveRepoPath;
		if (!repoPath) return;

		this.enterModeForWip('resolve', repoPath, uncommitted);
	};

	/** Shared `@toggle-mode` handler — every sub-panel's toggle-mode wires to this. Compose/review
	 *  toggle the panel mode; compare opens the sheet (it's no longer a mode). */
	private handleToggleMode = (e: CustomEvent<{ mode: 'review' | 'compose' | 'resolve' | 'compare' }>): void => {
		if (e.detail.mode === 'compare') {
			this._workflow.openCompare(this.currentSelection());
			return;
		}

		this.suppressContentOverflow();
		this._workflow.toggleMode(e.detail.mode, this.currentSelection());
	};

	/** Shared handler for `compose-cancel` / `review-cancel` — aborts the in-flight generation
	 *  for the engaged anchor and removes its registry entry. Panel stays in ENABLED-idle so
	 *  the user can re-run if they want. (Only ever fired by the mode panel's in-flight Cancel
	 *  button, which is only rendered while `status === 'loading'`.) */
	private handleCancelMode = (): void => {
		const mode = this._state.activeMode.get();
		if (mode !== 'review' && mode !== 'compose' && mode !== 'resolve') return;

		this.suppressContentOverflow();
		this._composeSeedInstructions = undefined;
		// Telemetry for the cancelled outcome is emitted from the workflow controller's settled
		// path so we don't double-emit when the host's abort propagates through onRunSettled.
		this._workflow.cancelOperation(mode);
	};

	/** Handler for `compose-discard` — fired by the Discard button on a ready compose plan.
	 *  Tears down the engaged compose operation and exits compose mode, returning to plain WIP
	 *  details. The user's working-tree changes are untouched; only the proposed plan is discarded. */
	private handleDiscardMode = (): void => {
		if (this._state.activeMode.get() !== 'compose') return;

		this.suppressContentOverflow();
		this._composeSeedInstructions = undefined;
		this._actions.sendTelemetryEvent('graphDetails/compose/closed');
		this._workflow.compose.discard();
	};

	/** Toggle a commit's exclusion from the AI recompose. Excluded commits are forwarded to
	 *  `refinePlan` as `lockedCommits` so the AI preserves them verbatim across refinements. */
	private handleComposeRefineExcludeToggle(commitId: string, excluded: boolean): void {
		const current = this._state.composeRefineExcludedCommitIds.get();
		const next = new Set(current);
		if (excluded) {
			next.add(commitId);
		} else {
			next.delete(commitId);
		}
		this._state.composeRefineExcludedCommitIds.set(next);
	}

	/** External entry point — invoked when the extension requests entering compare mode with
	 *  explicit left/right refs (e.g. from a sidebar tree compare action). The current graph
	 *  selection is left untouched; both sides of the comparison are driven by the supplied
	 *  overrides. */
	openCompareMode(
		params: {
			repoPath: string;
			leftRef?: string;
			leftRefType?: 'branch' | 'tag' | 'commit';
			rightRef: string;
			rightRefType?: 'branch' | 'tag' | 'commit';
			includeWorkingTree?: boolean;
		},
		onReady?: () => void,
	): boolean {
		if (this._workflow == null) {
			this._pendingCompare = { params: params, onReady: onReady };
			return false;
		}

		if (onReady != null) {
			onReady();
		}
		const selection: DetailsSelection = {
			...this.currentSelection(),
			repoPath: params.repoPath,
		};
		this._workflow.openCompare(selection, {
			leftRef: params.leftRef,
			leftRefType: params.leftRefType,
			rightRef: params.rightRef,
			rightRefType: params.rightRefType,
			includeWorkingTree: params.includeWorkingTree,
		});
		return true;
	}

	/** Opens compare mode ON TOP of whatever sheet is currently showing — e.g. the pull request sheet's
	 *  Compare Changes button — instead of replacing the stack, so closing the compare sheet
	 *  returns to what was open. */
	openCompareOverSheet(params: Parameters<GlGraphDetailsPanel['openCompareMode']>[0], onReady?: () => void): boolean {
		this._comparePushRequested = true;
		return this.openCompareMode(params, onReady);
	}

	/** The pull request sheet's Review Changes. Modes render in the details content BENEATH the sheet
	 *  stack, so this dismisses the sheets and enters the AI review mode scoped merge-base → head: the
	 *  changes the pull request actually introduces. The base falls back to the ref itself when no
	 *  merge base resolves (e.g. a remote-only base branch) — the review's scope pane then shows the
	 *  empty range rather than involving any other surface. */
	async openReviewForComparison(params: Parameters<GlGraphDetailsPanel['openCompareMode']>[0]): Promise<void> {
		const { leftRef, rightRef } = params;
		if (leftRef == null || rightRef == null) return;

		await this._actionsReady;

		const { branchCompareSummary } = this._actions.resources;
		await branchCompareSummary.fetch(params.repoPath, leftRef, rightRef, {
			includeWorkingTree: false,
		});

		// Toggling an already-active review mode would turn it OFF (`toggleMode`'s toggle-out path) —
		// guard so a second Review Changes click can't undo the mode it just turned on.
		if (this._state.activeMode.get() === 'review') return;

		this.clearSheets();
		this.suppressContentOverflow();
		this._workflow.toggleMode('review', this.currentSelection(), {
			type: 'compare',
			fromSha: branchCompareSummary.value.get()?.mergeBase ?? leftRef,
			toSha: rightRef,
		});
	}

	/** The `_graphState.rows` reference last seen by {@link willUpdate} — compared by identity to
	 *  detect a host row push (repo/branch data changed) and bump {@link _branchSheetChangeStamp}. */
	private _lastGraphRows?: State['rows'];
	/** Monotonic stamp threaded down to `gl-graph-branch-sheet-pane` so an open sheet can refresh
	 *  its enrichment in place when the graph's row/branch data changes underneath it. */
	private _branchSheetChangeStamp = 0;

	/** Public entry the graph app calls to open the branch/tag sheet for `ref` (the graph owns the
	 *  pinned/focus state + decides when to open vs close). Resolves `repoPath` once, here, and
	 *  pushes it onto the sheet stack. */
	openBranchSheet(ref: BranchSheetRef): void {
		// The sheet describes a BRANCH, so its repo must not follow the selection — `effectiveRepoPath`
		// does: focusing moves the selection to the branch's worktree WIP row, which flips it to that
		// worktree's path. The pane keys its identity on `repoPath`, so that flip makes it abort and
		// refetch — the body blanks and repopulates under the user. Prefer the ref's own repo, which is
		// fixed for the life of the sheet, then the graph's repo; `effectiveRepoPath` is the last resort.
		const repoPath =
			branchSheetContextRef(parseBranchSheetContext(ref.context))?.repoPath ??
			getSelectedRepoPath(this._graphState ?? {}) ??
			this.effectiveRepoPath;

		this.openSheet({ kind: 'branch', ref: ref, repoPath: repoPath });
	}

	/** Closes the branch sheet — and anything stacked above it, which is scoped to it. No-op when the
	 *  stack's root isn't a branch sheet (a selection-decoupled sheet isn't the graph's to close). */
	closeBranchSheet(): void {
		if (this._sheetStack[0]?.kind !== 'branch') return;

		this.clearSheets();
	}

	/** Opens the pull request sheet — a details view carrying the row's own payload, so it costs no
	 *  fetch. `layers` is the stack's members (top layer first) when the pull request is stacked.
	 *  `push` stacks it over the current sheet (an in-sheet opener, e.g. the branch sheet's PR chip);
	 *  otherwise it replaces the stack like any other external opener. */
	openPrSheet(
		pr: GraphSidebarPullRequest,
		layers?: GraphSidebarPullRequest[],
		options?: { push?: boolean; stackRoot?: boolean },
	): void {
		this.openSheet({ kind: 'pullRequest', pr: pr, layers: layers, stackRoot: options?.stackRoot }, options);
	}

	/** Close the pull request sheet, wherever it sits in the stack. */
	closePrSheet(): void {
		this.removeSheetKind('pullRequest');
	}

	/** Reflects a completed merge on every open pull request sheet the merge affects — the sheet stays
	 *  up, it just stops claiming the pull request is open. Optimistic by design: the host's pull request
	 *  cache still holds the pre-merge object, so a refetch would read back the stale state; a merge of
	 *  layer N lands every layer at or below N, so every open sheet of that stack reflects it, not just
	 *  the merged number's own sheet. */
	markPullRequestMerged(number: string, stack?: { number: number; position: number }): void {
		let changed = false;

		const next = this._sheetStack.map((d): SheetDescriptor => {
			if (d.kind !== 'pullRequest') return d;

			const affected =
				stack == null ? d.pr.number === number : d.pr.number === number || d.pr.stack?.number === stack.number;
			if (!affected) return d;

			changed = true;
			const position = stack?.position ?? d.pr.stack?.position;
			const layers = d.layers?.map((l): GraphSidebarPullRequest =>
				position != null && l.stack != null && l.stack.position <= position ? { ...l, state: 'merged' } : l,
			);
			const prMerged =
				d.pr.number === number ||
				(stack != null && d.pr.stack != null && d.pr.stack.position <= stack.position);

			return {
				kind: 'pullRequest',
				pr: prMerged ? { ...d.pr, state: 'merged' } : d.pr,
				layers: layers,
				stackRoot: d.stackRoot,
			};
		});

		if (changed) {
			this._sheetStack = next;
		}
	}

	private handleClosePrSheet = (): void => {
		this.popSheet();
	};

	/**
	 * Whether the new selection still belongs to the open sheet's ref, so the selection auto-close
	 * should leave the sheet alone.
	 *
	 * True for the sheet's own tip, and for a working-tree row while the graph is focused on the
	 * sheet's ref: focusing from the sheet deliberately moves the selection to that branch's WIP row,
	 * which is what the sheet is about rather than a navigation away from it. Without this the sheet
	 * would be retired by a rule whose premise — "the user moved to a different ref" — it never
	 * actually violated.
	 */
	private selectionBelongsToBranchSheet(ref: BranchSheetRef): boolean {
		// The tip is resolved LIVE when the ref's row is loaded — `ref.sha` froze at open, so a
		// branch that advanced under the open sheet (commit/pull) would otherwise fail its own-tip
		// exemption and auto-close on selecting the new tip.
		const tipSha = findRefTipSha(ref, this._graphState?.rows) ?? ref.sha;
		if (tipSha != null && this.sha === tipSha) return true;
		if (!isWipSelectionSha(this.sha)) return false;

		return this.isBranchSheetScoped(ref);
	}

	/** Whether the graph's live scope IS the open sheet's ref. */
	private isBranchSheetScoped(ref: BranchSheetRef): boolean {
		const graphState = this._graphState;
		const scope = graphState?.scope;
		if (graphState == null || scope == null) return false;

		const target = resolveBranchSheetScope(ref, graphState.rows);
		if (target == null) return false;

		const repoPath = getSelectedRepoPath(graphState);
		return repoPath != null && scope.branchRef === getBranchId(repoPath, target.remote ?? false, target.branchName);
	}

	private handleCloseBranchSheet = (): void => {
		this.popSheet();
	};

	/** Renders whatever's on top of {@link _sheetStack}. */
	private renderTopSheet() {
		const top = this._sheetStack.at(-1);
		if (top == null) return nothing;

		switch (top.kind) {
			case 'branch':
				return html`<gl-graph-branch-sheet
					.ref=${top.ref}
					.repoPath=${top.repoPath}
					.services=${this._servicesResolved && this._actions != null ? this._actions.services : undefined}
					.dateFormat=${this._state.preferences.get()?.dateFormat}
					.dateStyle=${this._state.preferences.get()?.dateStyle}
					.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
					.aiModel=${this._state.aiModel.get()}
					.orgSettings=${this._state.orgSettings.get()}
					.changeStamp=${this._branchSheetChangeStamp}
					?show-maximize=${this.showMaximize}
					?maximized=${this.sheetMaximized}
					@gl-detail-sheet-close=${this.handleCloseBranchSheet}
					@gl-issue-pull-request-details=${this.handleOpenPullRequestDetails}
				></gl-graph-branch-sheet>`;
			case 'conflict':
				return html`<gl-wip-conflict-sheet
					.detail=${top.detail}
					.getDetails=${this.getConflictDetails}
					file-name=${top.fileName}
					.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
					.preferences=${this._state.preferences.get()}
					@gl-detail-sheet-close=${this.handleCloseConflictDetails}
					@conflict-open-changes=${this.handleConflictOpenChanges}
					@conflict-stage=${this.handleConflictStage}
					@conflict-open-commit=${this.handleConflictOpenCommit}
					@conflict-open-file=${this.handleConflictOpenFile}
					@conflict-resolve-ai=${this.handleConflictResolveAi}
				></gl-wip-conflict-sheet>`;
			case 'rebaseSummary':
				return html`<gl-rebase-summary-sheet
					.repoPath=${top.repoPath}
					.getSummary=${this.getRebaseSummary}
					.undoRebase=${this.undoRebaseSummary}
					@gl-detail-sheet-close=${this.handleCloseRebaseSummary}
					@rebase-summary-view-diff=${this.handleRebaseSummaryViewDiff}
				></gl-rebase-summary-sheet>`;
			case 'pullRequest':
				return html`<gl-graph-pr-sheet
					.pullRequest=${top.pr}
					.layers=${top.layers}
					.dateFormat=${this._state.preferences.get()?.dateFormat}
					.stackRoot=${top.stackRoot ?? false}
					?ai-enabled=${this._state.preferences.get()?.aiEnabled ?? false}
					@gl-detail-sheet-close=${this.handleClosePrSheet}
				></gl-graph-pr-sheet>`;
			case 'compare':
				return html`<gl-graph-compare-sheet
					.preferredOrientation=${this._preferredCompareOrientation}
					@gl-detail-sheet-close=${this.handleCloseCompareSheet}
					@gl-graph-compare-promote=${this.handleComparePromote}
					>${this.renderCompareMode()}${
						this.showMaximize ? renderDetailsMaximizeChip(this.sheetMaximized, true, true) : nothing
					}<gl-action-chip
						slot="actions"
						icon="refresh"
						label="Refresh Comparison"
						overlay="tooltip"
						@click=${() => this._actions.refreshBranchCompare(this.effectiveRepoPath)}
					></gl-action-chip
					><gl-graph-coachmark
						slot="title-hint"
						mark="compare"
						placement="bottom"
						.anchor=${this.queryCompareSheetTitle}
						?auto-show=${this.graphReady}
					></gl-graph-coachmark
				></gl-graph-compare-sheet>`;
			default: {
				// Exhaustive: a new SheetDescriptor kind without a render case would leave the details
				// content inert (`stack.length > 0`) with no sheet mounted to close — fail at build time.
				const exhaustive: never = top;
				return exhaustive;
			}
		}
	}

	/** Wraps the same service call the panel always used to fetch conflict details — injected into
	 *  the sheet component so IT owns the fetch lifecycle instead of the panel. */
	private readonly getConflictDetails = (detail: FileChangeListItemDetail): Promise<ConflictDetails | undefined> =>
		this._actions.getConflictDetails(detail.repoPath, detail.path, detail.status ?? '');

	/** Entry point for the WIP-row agent indicator. Expands the agents section.
	 *
	 *  Sets the user mode to `expanded` explicitly and clears any transient auto-partial so the
	 *  render derives a stable `expanded` state. Element remounts can't reset it (no internal
	 *  state to lose); user chevron clicks flow back through the request event. Mirrors the
	 *  workflow-store pattern used by compose/review. */
	expandAgentsForWip(): void {
		this._agentStatusAutoPartial = false;
		this._agentUserMode = 'expanded';
	}

	/** Entry point for external callers (e.g., sidebar agent leaf click) that want to surface a
	 *  specific session in the agents section. Force-expands so the session is renderable
	 *  regardless of the user's current collapse preference, stores the id for the next render so
	 *  the card picks up its `card--selected` modifier, and scrolls the card into the visible
	 *  portion of the agents pane after Lit lands the new attribute. */
	highlightAgentSession(sessionId: string): void {
		// Bail when the agents section can't render. `showAgentStatus` gates on `activeMode == null`
		// AND `worktreeAgentSessions != null` (see `renderWip`). Writing state we know won't take
		// visible effect would leave a stale auto-expand + highlighted card waiting to pop up the
		// next time the user exits review/compose — clearly not what they asked for.
		if (this._state.activeMode.get() != null) return;
		if (this._state.wip.get() == null) return;

		// Preserve any user-dragged splitter size — sidebar/kanban-driven expand mirrors the
		// chevron-driven expand. `scrollAgentCardIntoView` keeps the highlighted card visible
		// at whatever size the user prefers; the sash dbl-click is their explicit reset path.
		this._agentStatusAutoPartial = false;
		this._agentUserMode = 'expanded';
		this._selectedAgentSessionId = sessionId;
		void this.scrollAgentCardIntoView(sessionId);
	}

	/** Selected-session id for `<gl-details-agent-status>`. Driven by `highlightAgentSession`.
	 *  Cleared on: chevron-driven collapse ({@link _onAgentStatusExpandRequest}), selection move
	 *  ({@link updated} on sha/shas/repoPath change), and panel disconnect — so the next view of
	 *  this list doesn't re-paint a stale ring on a card the user has clearly moved on from. */
	@state()
	private _selectedAgentSessionId?: string;

	private async scrollAgentCardIntoView(sessionId: string): Promise<void> {
		// One updateComplete on this panel so the new selectedSessionId/expand props at least
		// make it past Lit's render cycle to the inner element. We deliberately do NOT await the
		// inner gl-details-agent-status's updateComplete — when the host is pushing rapid agent-
		// session deltas (status / lastPrompt / phase changes), that promise can keep deferring
		// to the next update and never resolve, hanging this entire function.
		await this.updateComplete;

		// Fast path: if the agents section + card + scroller are already in the DOM and laid out,
		// scroll immediately. Skips the 250ms slow-path budget for the common case of clicking an
		// already-visible session card. Falls through to the wait+retry loop otherwise.
		if (this.tryScrollAgentCardOnce(sessionId)) return;

		// Slow path. Initial wait covers gl-split-panel transitions and the WIP details host fetch.
		// Outer split (graph ↔ details) AND inner split (agent-status ↔ wip) animate via CSS
		// transitions over ~150-200ms. Sidebar-tree agent clicks ALSO trigger a scope-to-branch
		// first, which kicks off a WIP refetch — until that lands, `worktreeAgentSessions` is
		// undefined and the agents section doesn't render at all.
		await new Promise<void>(resolve => setTimeout(resolve, 250));

		// Retry until the agents section, the target card, AND the scroller all exist + have laid
		// out OR we hit the budget. The scroller is in the loop too — a card-only retry can win
		// the race but leave the scroller transiently null/zero-height, producing a silent no-op.
		const maxAttempts = 8;
		const stepMs = 100;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			// Bail out if a newer highlight has displaced this one — `_selectedAgentSessionId` is
			// the source of truth and a fresh click may have overwritten it during the wait.
			if (this._selectedAgentSessionId !== sessionId) return;

			if (this.tryScrollAgentCardOnce(sessionId)) return;

			await new Promise<void>(resolve => setTimeout(resolve, stepMs));
		}
	}

	/** One attempt at locating the agent card + scroller and scrolling the card into view.
	 *  Returns `true` when the scroll math ran (card + scroller present and the scroller has
	 *  laid out); `false` when caller should retry. Pure: no waits, no state writes. */
	private tryScrollAgentCardOnce(sessionId: string): boolean {
		const agentStatus = this.renderRoot.querySelector<GlDetailsAgentStatus>('gl-details-agent-status');
		const card = agentStatus?.getSessionCard(sessionId);
		if (card == null) return false;

		const scroller = this.renderRoot.querySelector<HTMLElement>('.agent-status-split__top.scrollable');
		if (scroller == null) return false;

		const scrollerRect = scroller.getBoundingClientRect();
		// Scroller hasn't laid out yet (mid-transition or briefly 0-height) — reading scrollTop
		// math against this would produce a nonsense scroll.
		if (scrollerRect.height === 0) return false;

		const cardRect = card.getBoundingClientRect();
		const padding = 12;

		// Tall card OR card above viewport — align top edge with `padding` from the scroller's
		// top. For tall cards this prioritizes the header (session name + phase) staying in view
		// at the expected trade-off of clipping the bottom.
		const cardTooTall = cardRect.height + padding * 2 > scrollerRect.height;
		if (cardTooTall || cardRect.top < scrollerRect.top + padding) {
			scroller.scrollTop -= scrollerRect.top + padding - cardRect.top;
		} else if (cardRect.bottom > scrollerRect.bottom - padding) {
			scroller.scrollTop += cardRect.bottom - (scrollerRect.bottom - padding);
		}
		return true;
	}

	/** Maps a WIP selection sha to the worktree fsPath it represents. The `uncommitted` revision means
	 *  "this panel's repo"; a synthetic WIP row id carries its worktree path (see `createWipRowId`). */
	private computeWorktreePathFromSha(sha: string | undefined): string | undefined {
		if (sha == null) return undefined;
		if (sha === uncommitted) return this.effectiveRepoPath;
		return getWipRowWorktreePath(sha);
	}

	/** Restore the commit-form signals for `worktreePath` from the persisted draft (if any), or
	 *  reset to a fresh state. Also re-seeds the flush fingerprint so the immediate following
	 *  `updated()` pass doesn't echo the same data back to the host as a redundant IPC. */
	private loadWipDraft(worktreePath: string): void {
		// Flush any pending payload BEFORE swapping — the pending belongs to the OUTGOING WIP
		// and would be silently dropped by the cancel below, losing typing within the debounce
		// window when the user navigates rows quickly.
		this.flushPendingWipDraftNow();

		const draft = this._graphState?.wipDrafts?.[worktreePath];

		this._state.commitError.set(undefined);
		// Keep the spinner lit if a generation for this worktree is still running.
		this.refreshGeneratingForCurrentSelection();

		if (draft != null) {
			this._state.commitMessage.set(draft.message);
			this._state.commitMessageDirty.set(draft.messageDirty);
			this._state.amend.set(draft.amend != null);
			this._state.amendBaseSha.set(draft.amend?.baseSha);
		} else {
			this._state.commitMessage.set('');
			this._state.commitMessageDirty.set(false);
			this._state.amend.set(false);
			this._state.amendBaseSha.set(undefined);
		}

		this._lastFlushedWipDraftKey = this.computeWipDraftKey(
			worktreePath,
			this._state.commitMessage.get(),
			this._state.commitMessageDirty.get(),
			this._state.amend.get(),
			this._state.amendBaseSha.get(),
		);
		this._lastLoadedWipTarget = worktreePath;
		this._lastLoadedDraftRef = draft;
	}

	private computeWipDraftKey(
		worktreePath: string,
		message: string,
		messageDirty: boolean,
		amend: boolean,
		amendBaseSha: string | undefined,
	): string {
		// `\x1f` (unit separator) keeps the fingerprint cheap and unambiguous without JSON overhead.
		return `${worktreePath}\x1f${message}\x1f${messageDirty ? '1' : '0'}\x1f${
			amend && amendBaseSha != null ? amendBaseSha : ''
		}`;
	}

	/** Send the pending payload (if any) now. Clears the timer and the pending slot. Idempotent. */
	private flushPendingWipDraftNow(): void {
		const pending = this._pendingWipDraft;
		this._pendingWipDraft = undefined;
		if (this._flushWipDraftTimer != null) {
			clearTimeout(this._flushWipDraftTimer);
			this._flushWipDraftTimer = undefined;
		}
		if (pending == null) return;

		this._lastFlushedWipDraftKey = pending.key;
		this.persistWipDraft(pending.worktreePath, pending.draft);
	}

	/** Write one worktree's draft slot: optimistically mirror into local `wipDrafts` state so the
	 *  next `loadWipDraft` (e.g., swapping off this WIP row and back within the same session) sees
	 *  it without waiting for a host push — routing through `setWipDraft` keeps the provider's
	 *  internal `_state.wipDrafts` snapshot in sync with the signal accessor — then persist to the
	 *  host, the source of truth for cross-session restore. Pass `draft: null` to clear the slot. */
	private persistWipDraft(worktreePath: string, draft: StoredGraphWipDraft | null): void {
		this._graphState?.setWipDraft(worktreePath, draft);
		this._ipc?.sendCommand(UpdateWipDraftCommand, { worktreePath: worktreePath, draft: draft });
	}

	/** Snapshot the commit-form signals and schedule a debounced flush to the host. Re-runs on
	 *  every `updated()` (SignalWatcher re-runs `updated()` when the signals it reads change),
	 *  so a single guard fingerprint suffices to avoid redundant IPC. */
	private maybeScheduleWipDraftFlush(): void {
		if (!this.isWip) {
			// Leaving WIP entirely (e.g., user clicked a commit row). The pending payload belongs
			// to the just-left WIP — flush rather than cancel so typing within the debounce
			// window isn't lost.
			this.flushPendingWipDraftNow();
			return;
		}

		const worktreePath = this.computeWorktreePathFromSha(this.sha);
		if (worktreePath == null) return;

		const message = this._state.commitMessage.get();
		const messageDirty = this._state.commitMessageDirty.get();
		const amend = this._state.amend.get();
		const amendBaseSha = this._state.amendBaseSha.get();

		const key = this.computeWipDraftKey(worktreePath, message, messageDirty, amend, amendBaseSha);
		if (key === this._lastFlushedWipDraftKey) return;
		// Skip when the pending payload already reflects this exact content — otherwise every
		// signal-driven re-render (graph data refresh, concurrent webview echo, etc.) within
		// the 250ms window would reset the debounce timer and indefinitely postpone the flush
		// of typing the user already finished.
		if (this._pendingWipDraft?.key === key) return;

		const isEmpty = message === '' && !amend;

		// Bootstrap guard: on the first render where `loadWipDraft` hasn't yet seeded our key
		// (typically because the panel anchored on WIP before the WIP-target-change branch ran,
		// or because the wip data hadn't loaded), the form's empty state would otherwise emit
		// `draft: null` and clobber a persisted draft in storage we haven't read yet. Seed the
		// key so subsequent diffs are honest, but don't send the IPC.
		if (this._lastFlushedWipDraftKey === undefined && isEmpty) {
			this._lastFlushedWipDraftKey = key;
			return;
		}

		const draft: StoredGraphWipDraft | null = isEmpty
			? null
			: {
					message: message,
					messageDirty: messageDirty,
					amend: amend && amendBaseSha != null ? { baseSha: amendBaseSha } : undefined,
				};

		this._pendingWipDraft = { worktreePath: worktreePath, draft: draft, key: key };
		if (this._flushWipDraftTimer != null) {
			clearTimeout(this._flushWipDraftTimer);
		}
		this._flushWipDraftTimer = setTimeout(() => this.flushPendingWipDraftNow(), 250);
	}

	/** Seed the WIP commit input with a caller-supplied message. Used after Undo Commit to
	 *  restore the undone commit's message into the box where the user will redo it. Marks
	 *  the message as user-authored (`commitMessageDirty`) so the wipDraft flush picks it up
	 *  and persists, and the amend HEAD-move auto-clear path won't drop it.
	 *  Skipped while a workflow mode (compose/review) is active — the mode owns commit-form
	 *  state, and the seed is already in `wipDrafts` storage; the deferred-load fallback in
	 *  `updated()` will rehydrate `commitMessage` from it on mode exit.
	 *  Also skipped if the panel isn't currently anchored to `repoPath` — defensive against
	 *  the panel having moved on to a different repo's WIP between the IPC dispatch and consumption. */
	setCommitMessage(repoPath: string, message: string): void {
		if (this._state.activeMode.get() != null) return;
		if (this.effectiveRepoPath !== repoPath) return;

		this._state.commitMessage.set(message);
		this._state.commitMessageDirty.set(true);
	}

	/** Entry point for the WIP-row Compose/Review buttons. Re-clicking while already engaged
	 *  on the same anchor is a no-op (re-focus); otherwise toggleMode handles enter/replace. */
	enterModeForWip(
		mode: 'compose' | 'review' | 'resolve',
		repoPath: string,
		sha: string,
		focusedFilePaths?: readonly string[],
		composeInstructions?: string,
		composeScope?: GraphComposeScopeSeed,
	): void {
		// A mode panel renders inside `.details-content`, which an open sheet both covers and marks
		// `?inert`. Mode entry is a deliberate request for that surface — the automatic rebase
		// escalation handoff arrives here — so a summary sheet from a finished run (this repo's or
		// another's) must never be left sitting on top of it, unreachable.
		this.removeSheetKind('rebaseSummary');

		if (this._workflow == null) {
			// Element mounted but async init (resolveDetailsActions → controller) hasn't finished —
			// defer and apply once `_workflow` exists. Mirrors the `_pendingCompare` path.
			this._pendingMode = {
				mode: mode,
				repoPath: repoPath,
				sha: sha,
				focusedFilePaths: focusedFilePaths,
				composeInstructions: composeInstructions,
				composeScope: composeScope,
			};
			return;
		}

		// Resolve scopes a run to specific conflicted files (or all conflicts when undefined). Set
		// before `toggleMode` so the panel's idle/run picks up the focus. Other modes ignore it.
		if (mode === 'resolve') {
			this._state.resolveFocusedFilePaths.set(focusedFilePaths);
		}

		this.suppressContentOverflow();
		const selection: DetailsSelection = {
			...this.currentSelection(),
			sha: sha,
			shas: undefined,
			repoPath: repoPath,
		};

		if (mode === 'compose') {
			this._composeSeedInstructions =
				composeInstructions != null
					? { anchorKey: anchorKey(selection), instructions: composeInstructions }
					: undefined;
		}
		// Compare by full anchor key so primary↔secondary WIP re-clicks (which differ only in
		// `repoPath` after both collapse to a `wip|...` key) stay distinct.
		const engaged = anchorKey({
			sha: this._state.activeModeSha.get(),
			shas: this._state.activeModeShas.get(),
			repoPath: this._state.activeModeRepoPath.get(),
		});
		// Recompose: a resolved commit-range seed always (re)applies the scope, so it must run
		// before the re-click no-op guard below. enterComposeWithScope switches the scope in place
		// when compose is still idle on this anchor, or preserves an already-started plan.
		if (mode === 'compose' && composeScope != null) {
			this._workflow.enterComposeWithScope(selection, composeScope.shas, composeScope.includeWip);
			return;
		}

		// Re-clicking the same mode on the same anchor is a no-op (re-focus) — except that a resolve
		// re-entry is how an automatic rebase's escalation hands its resolutions over: the run already
		// opened this panel, so the mode really is unchanged and only the seeding still needs to run.
		if (this._state.activeMode.get() === mode && engaged === anchorKey(selection)) {
			if (mode === 'resolve') {
				this._workflow.resolve.seedFromEscalation(selection.repoPath);
			}
			return;
		}

		this._workflow.toggleMode(mode, selection);
	}

	/** Opens the Automatic Rebase summary sheet for `repoPath`'s session — selection-decoupled,
	 *  like the compare sheet. The sheet fetches its own data via {@link getRebaseSummary}, which
	 *  awaits service readiness itself, so a cold-open `show-rebase-summary` (arriving before async
	 *  init finishes) needs no local deferral. */
	openRebaseSummary(repoPath: string): void {
		// A completed run's final `git status` push can land AFTER the summary opens, so the slot can
		// still hold the run's own paused-op payload. Snapshot it as already-seen — see the
		// paused-op invalidation in `willUpdate`.
		this._rebaseSummaryWipAtOpen = this._graphState?.wip;
		this.openSheet({ kind: 'rebaseSummary', repoPath: repoPath });
	}

	/** Injected into the rebase-summary sheet so IT owns the fetch lifecycle — mirrors
	 *  {@link getConflictDetails}. Awaits {@link _actionsReady} itself: `show-rebase-summary` can
	 *  arrive on a cold graph open before `resolveServices` has finished. Throws (rather than
	 *  resolving `undefined`) on a service-reported failure so the sheet can show the specific
	 *  message instead of a generic one. */
	private readonly getRebaseSummary = async (repoPath: string): Promise<AutoRebaseSummary | undefined> => {
		await this._actionsReady;
		const result = await this._actions.fetchAutoRebaseSummary(repoPath);
		if (result == null) throw new Error('No automatic rebase summary is available.');
		if ('error' in result) throw new Error(result.error.message);

		return result.summary;
	};

	/** Injected undo — mirrors {@link getRebaseSummary}'s readiness wait. Preserves
	 *  `undoAutoRebase`'s success/error contract; the sheet decides how to react. */
	private readonly undoRebaseSummary = async (repoPath: string, sessionId: string): Promise<UndoAutoRebaseResult> => {
		await this._actionsReady;
		return this._actions.undoAutoRebase(repoPath, sessionId);
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

	private _resizeObserver?: ResizeObserver;
	@state() private _preferredCompareOrientation: PanelOrientation = 'vertical';

	/** Stack of currently-open detail sheets — every sheet kind renders from here, top-only, via
	 *  {@link renderTopSheet}. Compare's openness is projected in from `compareSheetOpen`. */
	@state() private _sheetStack: SheetDescriptor[] = [];

	/** Parallel to {@link _sheetStack} — the element to restore focus to when the sheet at that
	 *  index closes. Captured from `document.activeElement` at the moment each sheet was opened. */
	private _sheetFocusMemos: (HTMLElement | undefined)[] = [];

	/** Tracks the previous top-of-stack identity so {@link updated} can report open/close
	 *  transitions exactly once per change, not once per render. */
	private _prevSheetTopKey?: string;

	/** Tracks the previous stack's kind composition so {@link updated} can report a
	 *  `gl-graph-sheet-stack-change` exactly once per composition change, not once per render. */
	private _prevSheetKinds: SheetKind[] = [];

	/** Disposes the currently-registered overlay entry for the top-of-stack sheet — see
	 *  {@link _sheetCoordinator}. */
	private _sheetOverlayDisposable: Disposable | undefined;

	/** Mirrors the sheet stack's top-of-stack transitions onto the graph keymap's Esc overlay stack:
	 *  `opened` pushes an entry that pops the sheet on Esc, `closed` disposes it. Esc ordering across
	 *  sheets/hover/ref-find/drag is decided by the registry's LIFO, not by this coordinator. */
	private readonly _sheetCoordinator: SheetOverlayCoordinator = {
		opened: key => {
			this._sheetOverlayDisposable?.dispose();
			this._sheetOverlayDisposable = this.pushOverlay?.({
				id: `sheet|${key}`,
				onClose: () => {
					if (this._sheetStack.length === 0) return false;

					this.popSheet();
					return true;
				},
			});
		},
		closed: _key => {
			// If Esc popped via closeTopOverlay, the dispatcher already spliced this entry out of its
			// stack — this dispose() finds index -1 and no-ops. Depth>1 stacks pop one level per Esc:
			// after popSheet() the next opened() call (for the newly revealed sheet) pushes a fresh entry.
			this._sheetOverlayDisposable?.dispose();
			this._sheetOverlayDisposable = undefined;
		},
	};

	/** The pushed-wip payload observed when the rebase-summary sheet on {@link _sheetStack} was
	 *  opened. Identity-compared only (never read), so the open-time payload can't trip the
	 *  paused-op invalidation in {@link willUpdate}. Cleared whenever the sheet leaves the stack. */
	private _rebaseSummaryWipAtOpen?: unknown;

	/** Resolves once {@link _actions} is assigned — lets a caller that fired before async init
	 *  finished (e.g. a cold-open `show-rebase-summary`) await readiness itself instead of the
	 *  panel deferring the request. */
	private _resolveActionsReady!: () => void;
	private readonly _actionsReady: Promise<void> = new Promise(resolve => {
		this._resolveActionsReady = resolve;
	});

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('switch-model', this.handleSwitchModel);
		// Tracks panel width → preferred orientation for promoting the compare sheet to a pinned
		// panel; the observer's initial callback seeds it, so no synchronous width read is needed.
		this._resizeObserver = new ResizeObserver(entries => {
			this._preferredCompareOrientation =
				(entries[0]?.contentRect.width ?? this.clientWidth) >= narrowPanelThreshold ? 'horizontal' : 'vertical';
		});
		this._resizeObserver.observe(this);
	}

	private handleSwitchModel = (): void => {
		// Switch-model is shared by the review-mode, compose-mode, and resolve-mode chips in this
		// panel — derive the scope from the active mode so each surface writes to its own scoped
		// Memento key. Falls back to the global default when no mode is active (e.g., when
		// the chip is shown elsewhere).
		const mode = this._state.activeMode.get();
		const scope = mode === 'compose' || mode === 'review' || mode === 'resolve' ? mode : undefined;
		this._actions?.switchAIModel(scope);
	};

	private readonly _contextMenuProxy = new ContextMenuProxyController(this);
	/** Timer stored so `disconnectedCallback` can cancel it — otherwise a fast open/close
	 *  cycle leaves the callback firing on a detached element with `style.overflow = ''` (no
	 *  crash, but leaks DOM references for the timer's lifetime and stacks under rapid toggling). */
	private _suppressContentOverflowTimer?: ReturnType<typeof setTimeout>;
	/** Debounced WIP-draft flush. Cleared on row swap (the new selection schedules its own). */
	private _flushWipDraftTimer?: ReturnType<typeof setTimeout>;
	/** Payload that will be sent when {@link _flushWipDraftTimer} fires — kept on the instance
	 *  (not captured in the timer closure) so {@link disconnectedCallback} can flush it
	 *  synchronously instead of dropping it on a fast close-after-commit. */
	private _pendingWipDraft?: {
		worktreePath: string;
		draft: StoredGraphWipDraft | null;
		key: string;
	};
	/** Fingerprint of the last (worktreePath, message, dirty, amendBase) tuple we flushed.
	 *  Skipping when unchanged avoids redundant IPC on every re-render. */
	private _lastFlushedWipDraftKey?: string;
	/** The `worktreePath` we last loaded a draft for. Decoupled from the `changedProperties`
	 *  gate so a deferred load (e.g., the WIP target was set on the first render but
	 *  `effectiveRepoPath` only became valid after wip data arrived in a later signal-driven
	 *  re-render) still fires. */
	private _lastLoadedWipTarget?: string;
	/** Reference to the draft object that {@link loadWipDraft} last consumed from `wipDrafts`
	 *  state. Used to detect content changes for the *current* target (e.g., a concurrent
	 *  webview's flush or a host-initiated undo write) so we can reload — while preserving
	 *  the user's in-flight typing by comparing local `commitMessage` against the last loaded
	 *  draft's message before reloading. */
	private _lastLoadedDraftRef?: StoredGraphWipDraft;

	private suppressContentOverflow(): void {
		const el = this.querySelector<HTMLElement>('.details-content');
		if (el) {
			el.style.overflow = 'hidden';
			// Match the sub-panel-enter animation duration (0.2s)
			clearTimeout(this._suppressContentOverflowTimer);
			this._suppressContentOverflowTimer = setTimeout(() => {
				this._suppressContentOverflowTimer = undefined;
				if (this.isConnected) {
					el.style.overflow = '';
				}
			}, 250);
		}
	}

	private findModePanelDeep(root: ParentNode | ShadowRoot, depth = 0): HTMLElement | null {
		if (depth > 6) return null;

		const here = root.querySelector<HTMLElement>(
			'gl-details-review-mode-panel, gl-details-compose-mode-panel, gl-details-resolve-mode-panel',
		);
		if (here != null) return here;

		for (const el of root.querySelectorAll<HTMLElement>('*')) {
			if (el.shadowRoot != null) {
				const found = this.findModePanelDeep(el.shadowRoot, depth + 1);
				if (found != null) return found;
			}
		}
		return null;
	}

	/** Same shadow-DOM pierce as {@link findModePanelDeep} but typed to the review panel. The
	 *  panel renders directly in this host's light DOM on the WIP anchor, but is nested inside
	 *  the commit/multicommit panel's shadow root via `subPanelContent` on locked-commit anchors
	 *  — a plain `this.querySelector` returns null in that case. */
	private findReviewModePanel(
		root: ParentNode | ShadowRoot = this,
		depth = 0,
	): import('./gl-details-review-mode-panel.js').GlDetailsReviewModePanel | null {
		if (depth > 6) return null;

		const here =
			root.querySelector<import('./gl-details-review-mode-panel.js').GlDetailsReviewModePanel>(
				'gl-details-review-mode-panel',
			);
		if (here != null) return here;

		for (const el of root.querySelectorAll<HTMLElement>('*')) {
			if (el.shadowRoot != null) {
				const found = this.findReviewModePanel(el.shadowRoot, depth + 1);
				if (found != null) return found;
			}
		}
		return null;
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.removeEventListener('switch-model', this.handleSwitchModel);
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		clearTimeout(this._suppressContentOverflowTimer);
		this._suppressContentOverflowTimer = undefined;
		// Flush rather than cancel — closing the webview within the debounce window after a
		// commit (which sets message='' + amend=false) would otherwise drop the `draft: null`
		// IPC, leaving the just-committed message stale in the memento.
		this.flushPendingWipDraftNow();
		// Repo-change subscription teardown is handled by DetailsWorkflowController via its
		// `hostDisconnected` hook — no manual cleanup needed here.
		this._state.resetAll();
		this._actions?.dispose();
		this._sheetOverlayDisposable?.dispose();
		this._sheetOverlayDisposable = undefined;
	}

	/** Exposed for {@link DetailsWorkflowController}'s subscription filter. */
	isWipSelection(): boolean {
		return this.isWip;
	}

	/** Bumps the open sheet's stamp so it refetches — see {@link DetailsWorkflowController}.
	 *  `_branchSheetChangeStamp` isn't reactive, so this needs an explicit `requestUpdate`. */
	refreshBranchSheet(): void {
		if (!this._sheetStack.some(d => d.kind === 'branch')) return;

		this._branchSheetChangeStamp++;
		this.requestUpdate();
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		// `_graphState` is a plain `@consume`d context value (no `@state()`), so its own changes
		// don't show up in `changedProperties` — piggyback on whatever else triggered this cycle and
		// reference-compare `rows` directly. Bumping ahead of `render()` (rather than in `updated()`)
		// means the branch sheet pane sees the fresh stamp in the SAME cycle the rows changed.
		if (this._graphState?.rows !== this._lastGraphRows) {
			this._lastGraphRows = this._graphState?.rows;
			this._branchSheetChangeStamp++;
		}

		// The externally-delivered compose seed is one-shot: once compose deactivates (toggle-off,
		// mode/selection/repo switch, apply), drop it so a later manual entry starts empty. The
		// seed is set just before the mode activates in the same update cycle, so an active
		// compose never observes this clear.
		if (this._composeSeedInstructions != null && this._state.activeMode.get() !== 'compose') {
			this._composeSeedInstructions = undefined;
		}

		const selectionChanged =
			changedProperties.has('sha') || changedProperties.has('shas') || changedProperties.has('repoPath');

		// On any selection change, drop the per-session snapshot that `applyAgentAutoSurface`
		// diffs against. Entering a WIP row (from another WIP row, a commit, or anywhere else)
		// then re-treats every current session as "newly seen", so a still-pending needs-input
		// session re-surfaces partial mode automatically — matching the user expectation that
		// leaving and returning to a WIP row re-opens the auto-surface peek. Has no effect on
		// non-WIP selections: `applyAgentAutoSurface` only runs when worktree-matched sessions
		// are non-empty (gated in willUpdate below), so a wiped snapshot is harmless there and
		// gets repopulated the next time we land on a WIP row with sessions.
		if (selectionChanged && this._prevAgentSnapshot.size > 0) {
			this._prevAgentSnapshot = new Map();
		}

		// A selection change moves the panel to a different commit; a stale sheet from the PRIOR ref
		// would overlay and `?inert`-block the new content, so close it. Not every move is a navigation
		// away, though — the pill click that opens the sheet selects the pill's own tip in the same
		// cycle, and the sheet's Focus chip moves the selection to the branch's WIP row. Both still
		// belong to the sheet's ref, so ask that rather than testing the tip sha alone.
		if (selectionChanged && this._sheetStack.length > 0) {
			const next = reduceOnSelectionChange(this._sheetStack, ref => this.selectionBelongsToBranchSheet(ref));
			if (next !== this._sheetStack) {
				if (this._sheetStack.some(d => d.kind === 'rebaseSummary')) {
					this._rebaseSummaryWipAtOpen = undefined;
				}
				this._sheetStack = next;
				this._sheetFocusMemos = [];
			}
		}

		// Projects the compare-signal's open/closed state onto the sheet stack — compare's own
		// open/close lifecycle stays owned by `compareSheetOpen` (driven by the workflow controller),
		// this just keeps the stack in sync with it every cycle. Selection-decoupled: reads only the
		// signal, never selection, so it can't be affected by (or interfere with) the selection-close
		// block above.
		{
			const compareOpen = this._state.compareSheetOpen.get();
			const mode: 'replace' | 'push' = this._comparePushRequested ? 'push' : 'replace';
			const projected = projectCompareSignal(this._sheetStack, compareOpen, mode);
			if (projected !== this._sheetStack) {
				this._comparePushRequested = false;
				if (compareOpen) {
					this.openSheet({ kind: 'compare' }, { push: mode === 'push' });
				} else {
					// removeSheetKind, NOT popSheet/clearSheets: those call `closeCompare()`, which
					// would stomp `compareAsPanel` back to false and break the promote-to-pinned
					// transition this projection is reacting to.
					this.removeSheetKind('compare');
				}
			}
		}

		// Locked-panel case: a commit/multi-commit running session keeps the details panel
		// anchored to its entry-time selection even when the graph's selection moves elsewhere.
		// Skip both the controller-side anchor-switch AND the selection-driven fetch so the
		// panel keeps rendering the locked anchor's commit data and the registry-restored
		// snapshot. WIP-anchored running sessions don't lock — they follow the selection and
		// rely on the registry preserve/restore handshake.
		const isLockedCommitRunningOperation = this.isLockedCommitRunningOperation;

		// While a compose/review mode is active, selection-change events drive a controlled
		// anchor-switch in the workflow controller (which preserves the prior anchor's session
		// into the registry and restores the new anchor's session if one exists). Compare mode
		// is sticky and ignores selection changes here — the workflow controller handles it
		// elsewhere. When no mode is active but the arriving anchor has a remembered mode (e.g.
		// the user was previously in Compose on this WIP row), restore it. The branches below:
		// mode-active routes to switchAnchorWithinMode; no-mode-but-remembered re-enters that
		// mode; otherwise the normal fetch path handles the selection.
		if (
			this._servicesResolved &&
			this._actions != null &&
			this._workflow != null &&
			selectionChanged &&
			!isLockedCommitRunningOperation
		) {
			const activeMode = this._state.activeMode.get();
			if (activeMode === 'review' || activeMode === 'compose' || activeMode === 'resolve') {
				// Ambient anchor-switch (not a deliberate toggle) - don't let a restored mode steal focus.
				this._suppressModeFocusOnce = true;
				this._workflow.switchAnchorWithinMode(this.currentSelection());
			} else if (activeMode == null && this.isWip) {
				// Auto-restore is gated to WIP rows: WIP has a stable identity (the branch's
				// working changes) so resuming compose/review there is meaningful. Commit rows
				// are point-in-time snapshots — re-clicking a commit shouldn't ambient-enter
				// review just because the user reviewed it earlier in the session.
				const remembered = this._workflow.getRememberedMode(this.currentSelection());
				if (remembered != null) {
					// Ambient restore (WIP reselect), not a deliberate toggle - suppress the focus steal.
					this._suppressModeFocusOnce = true;
					this._workflow.toggleMode(remembered, this.currentSelection());
				}
			}
		}

		// Start selection-driven fetches BEFORE render so the resource's `loading` signal is
		// already true by the time `render()` evaluates `isLoading`. Without this, the render
		// right after `sha` changes sees loading=false, commit=null, and would fall through
		// to the "return nothing" branch — a blank frame between the prop change and the
		// signal-driven re-render. Locked commit-anchored running modes stay on their
		// entry-time commit's data. Compare's sheet floats over the panel and owns its own
		// refs — selection changes underneath should still drive normal panel fetches so the
		// underlying view (visible behind the inert sheet) stays current.
		if (this._servicesResolved && this._actions != null && selectionChanged && !isLockedCommitRunningOperation) {
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
			const modeActive = this._state.activeMode.get() != null;
			// `effectiveRepoPath` resolves to the mode's anchor when active (via
			// `activeModeRepoPath`), so live updates still propagate when the user has
			// navigated to a commit row while a compose/review runs in the background.
			const repoPath = this.effectiveRepoPath;

			// WIP updates flow through the host's push channel: every working-tree change runs a
			// single `git status` on the host and packs the result into `graphState.wip`. Apply
			// it directly here — no `refetchWipQuiet` round-trip — so the panel stays in sync
			// with the host's view without a second `git status`.
			// Repo-path guard: `graphState.wip` is a polymorphic broadcast slot — the host pushes
			// for whichever worktree's working tree changed (primary or any visible secondary).
			// Every panel filters the slot against its own `effectiveRepoPath` and applies only
			// the matching push; non-matching pushes are silently dropped here.
			const pushedWip = this._graphState.wip;
			if (
				pushedWip != null &&
				pushedWip !== this._lastPushedWip &&
				(this.isWip || modeActive) &&
				pushedWip.repo?.path === repoPath &&
				this._actions != null
			) {
				this._lastPushedWip = pushedWip;
				this._actions.applyPushedWip(pushedWip);
			}

			// The summary sheet describes a FINISHED run, so a paused operation appearing in its repo
			// means the repo has moved on — most importantly a NEW automatic rebase escalating, whose
			// Resolve panel the sheet would cover and `?inert`. Rides the same pushed-wip signal the
			// panel already consumes (no repo/selection gate: the sheet is selection-decoupled).
			const rebaseSummaryTop = this._sheetStack.find(d => d.kind === 'rebaseSummary');
			if (
				rebaseSummaryTop != null &&
				pushedWip != null &&
				pushedWip !== this._rebaseSummaryWipAtOpen &&
				pushedWip.repo?.path === rebaseSummaryTop.repoPath &&
				pushedWip.changes?.pausedOpStatus != null
			) {
				this.removeSheetKind('rebaseSummary');
			}

			// Branch-state changes (ahead/behind shifts from fetch/pull/push) still need to
			// refresh the mode's commit picker and scope-files — those are independent of the
			// WIP push channel.
			const bs = this._graphState.branchState;
			const bsChanged =
				bs !== this._lastBranchState &&
				!branchStateEqual(bs, this._lastBranchState as BranchStateLike | undefined);
			if (bsChanged) {
				this._lastBranchState = bs;
				if (modeActive && repoPath != null) {
					void this._actions?.fetchBranchCommits(repoPath);
					const scope = this._state.scope.get();
					if (scope?.type === 'wip') {
						void this._actions?.resources.scopeFiles.fetch(repoPath, scope);
					}
				}
			}
		}

		// Diff worktree-matched agent sessions and flip the auto-partial flag accordingly.
		// Must run BEFORE `resolveContent()` below: `resolveContent` calls `renderWip` which
		// reads both `agentStatusExpand` (derived from `_agentStatusAutoPartial`, flipped here)
		// AND `_cycleAgentSessions` (the rendered-cards source, cached here). Running them in
		// the same step guarantees the projected mode and the visible cards agree on a single
		// snapshot — without this, an interleaving mutation of `_graphState.agentSessions`
		// between the trigger and the render could leave partial mode flipped ON while the
		// rendered card filter sees an older snapshot with no needs-input session (the
		// symptom: chevron at 45deg over an empty section, only resolved by the next unrelated
		// update).
		// `_cycleAgentSessions` is REFRESHED every cycle (set to whatever the match returns,
		// including `undefined` or `[]`). `_prevAgentSnapshot` is preserved across "no useful
		// data" cycles WITHIN a selection: we skip the call when the match returns undefined or
		// an empty array so a transient empty-match window doesn't wipe the snapshot and
		// re-trigger a stale acknowledge moments later. Across SELECTIONS the snapshot is wiped
		// at the top of willUpdate so re-entering a WIP row re-evaluates current sessions fresh.
		const wip = this.isWip ? this._state.wip.get() : undefined;
		const sessions = wip != null ? this.getWorktreeAgentSessions(wip) : undefined;
		this._cycleAgentSessions = sessions;
		if (sessions != null && sessions.length > 0) {
			this.applyAgentAutoSurface(sessions);
		}

		// Resolve past sessions in the same step, for the same reason: `renderWip` gates the agents
		// section (and its split sizing) on the past count, and `gl-details-agent-status` renders the
		// rows — both must see one list, or an archive can leave a section that renders empty.
		// Past sessions are keyed by worktree path (see `updateWipPastSessions`), so only trust the
		// resource's value when it was fetched for THIS wip's worktree; otherwise a fetch for a
		// just-left worktree is still in flight and its stale value must not paint here.
		const pastForPath =
			wip?.repo?.path != null && this._lastPastSessionsPath === wip.repo.path
				? this._actions?.resources.pastAgentSessions.value.get()
				: undefined;
		this._cyclePastSessions = this._pastSessionsResolver.resolve(pastForPath, this._graphState?.agentSessions);

		// Derive the generate-message spinner; the registry read inside keeps it in sync on start/settle
		// and selection change (see the method).
		this.refreshGeneratingForCurrentSelection();

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
		// Reads `wip`/`activeMode`/`sha` signals (also read in render), so this re-runs on every
		// working-tree push and selection change — the lazy fetch is gated + deduped inside.
		this.updateWipFileStats();
		this.updateWipPastSessions();

		// Every stack mutation replaces the `_sheetStack` array (the reducers never mutate in place),
		// so Lit's change tracking is a sound gate — skips the key/kinds re-derivation on the many
		// updates this signal-heavy panel runs that don't touch the stack.
		if (changedProperties.has('_sheetStack')) {
			const top = this._sheetStack.at(-1);
			const topKey = top != null ? sheetKey(top) : undefined;
			if (topKey !== this._prevSheetTopKey) {
				if (this._prevSheetTopKey != null) {
					this._sheetCoordinator.closed(this._prevSheetTopKey);
				}
				if (topKey != null) {
					this._sheetCoordinator.opened(topKey);
				}
				this._prevSheetTopKey = topKey;
			}

			// Some kind transitions have their own consumer-visible effect — e.g. the rebase summary
			// sheet is `position: absolute` inside the details pane, so at the default split it opens
			// into ~100px of a ~300px scroll, and the app resizes the pane for it. Reported from here
			// (not the individual open/close call sites) so every clear path (close, successful undo,
			// staleness invalidation) is covered by one signal.
			const kinds = this._sheetStack.map(d => d.kind);
			const prevKinds = this._prevSheetKinds;
			if (!sheetKindsEqual(kinds, prevKinds)) {
				this._prevSheetKinds = kinds;
				this.dispatchEvent(
					new CustomEvent('gl-graph-sheet-stack-change', {
						detail: { kinds: kinds, prevKinds: prevKinds },
						bubbles: true,
						composed: true,
					}),
				);
			}
		}

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
				this._workflow.review.invalidateErrorRecovery();
				this._workflow.compose.invalidateErrorRecovery();

				// `changedProperties.get(k)` returns the previous value only when `k` actually
				// changed; otherwise fall back to the current value (the prior selection had
				// the same value, by definition).
				const prevSha = changedProperties.has('sha')
					? (changedProperties.get('sha') as string | undefined)
					: this.sha;
				const prevWasWip = isWipSelectionSha(prevSha);
				const repoChanged =
					changedProperties.has('repoPath') && changedProperties.get('repoPath') !== this.repoPath;

				const nowOnWip = this.isWip;
				const currentWorktreePath = nowOnWip ? this.computeWorktreePathFromSha(this.sha) : undefined;
				const prevWorktreePath = prevWasWip ? this.computeWorktreePathFromSha(prevSha) : undefined;
				// True when the active WIP target (worktree) is different from the prior selection's
				// WIP target — covers repo switches, primary↔secondary WIP swaps within the same
				// repo, and entering WIP from a non-WIP commit selection.
				const wipTargetChanged =
					nowOnWip && (repoChanged || !prevWasWip || prevWorktreePath !== currentWorktreePath);

				if (wipTargetChanged && currentWorktreePath != null) {
					// Entering (or swapping into) a WIP row. Restore the draft if one is persisted
					// for this worktree; otherwise start fresh. Per-attempt transient state
					// (`commitError`, `generating`) always resets — it doesn't belong to the draft.
					this.loadWipDraft(currentWorktreePath);
				} else if (repoChanged) {
					// Repo identity changed AND we're not landing on a WIP row (commit selection in
					// a different repo, repo dropdown switch with no WIP target, etc.). Wipe form
					// state — it was authored against the prior repo's HEAD and would be wrong
					// for the new repo. The form isn't visible during this transition, so the
					// clearing is invisible to the user.
					this._state.amend.set(false);
					this._state.amendBaseSha.set(undefined);
					this._state.commitMessage.set('');
					this._state.commitMessageDirty.set(false);
					this._state.commitError.set(undefined);
					this.refreshGeneratingForCurrentSelection();
				} else if (prevWasWip && !this.isWip) {
					// Leaving WIP within the same repo (clicking a commit to inspect): clear
					// only per-attempt status. amend stays put — the HEAD-move check below
					// validates it on return. commitMessage stays put — preserve the user's
					// typing across brief round-trips.
					this._state.commitError.set(undefined);
					this.refreshGeneratingForCurrentSelection();
				}
			}

			// Data fetches for sha/shas/repoPath changes happen in willUpdate so loading=true
			// is observable during render (avoids a blank frame between prop change and the
			// signal-driven re-render). Repo-change subscription re-wires via the controller's
			// hostUpdate hook.
		}

		// Deferred-load fallback: the wipTargetChanged branch above only fires when sha/shas/
		// repoPath are in `changedProperties` AND `effectiveRepoPath`/`worktreePath` are valid
		// at that exact render. On bootstrap, the WIP target is set before `effectiveRepoPath`
		// resolves (wip data arrives in a later signal-driven re-render), so loadWipDraft is
		// skipped and the persisted draft never lands. Re-check every render: if we're on a
		// WIP target we haven't loaded for yet AND conditions are now valid, load.
		// Mirrors the gate on the wipTargetChanged branch above: in compose/review mode the
		// workflow owns commit-form state, so swapping it out from under the mode would break
		// the user's in-flight session. The seed still lands in `wipDrafts` via the host write;
		// on mode exit the panel reverts and the next render rehydrates `commitMessage` from it.
		if (this.isWip && this._state.activeMode.get() == null) {
			const worktreePath = this.computeWorktreePathFromSha(this.sha);
			if (worktreePath != null) {
				const currentDraft = this._graphState?.wipDrafts?.[worktreePath];
				if (worktreePath !== this._lastLoadedWipTarget) {
					// New WIP target — load fresh (covers initial bootstrap + WIP-target swaps where
					// the wipTargetChanged branch above couldn't fire because `effectiveRepoPath`
					// wasn't valid yet).
					this.loadWipDraft(worktreePath);
				} else if (currentDraft !== this._lastLoadedDraftRef) {
					// Same target but the stored draft changed (concurrent webview's flush, host
					// undo write, etc.). Reload IFF the user hasn't typed since the last load —
					// otherwise their in-flight edit wins locally and we just mark the new draft
					// as seen so we don't re-evaluate every render.
					const lastLoadedMessage = this._lastLoadedDraftRef?.message ?? '';
					if (this._state.commitMessage.get() === lastLoadedMessage) {
						this.loadWipDraft(worktreePath);
					} else {
						// User diverged from the loaded draft — preserve their typing and let
						// the trailing `maybeScheduleWipDraftFlush` at the end of `updated()`
						// persist it, overwriting the incoming concurrent draft. Update the
						// loaded-ref so we don't re-enter this branch, but DO NOT reseed
						// `_lastFlushedWipDraftKey` to the local state — that would mark the
						// in-memory text as already-persisted and the user could close the
						// panel believing it was saved, while storage still holds the other
						// instance's draft. Leaving the key at the prior loaded draft's value
						// lets the next flush schedule trigger correctly.
						this._lastLoadedDraftRef = currentDraft;
					}
				}
			}
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

		// Detect mode transitions and bubble a custom event up to graph-app so it can emit telemetry.
		// Lives here because SignalWatcher on this component tracks `activeMode`; graph-app doesn't
		// access that signal during its own render and so wouldn't re-run `updated()` on mode toggles
		// (compose ⇄ review ⇄ swap-to-close) — making it the wrong place to detect the transition.
		const currentMode = this.currentMode;
		if (currentMode !== this._lastNotifiedMode) {
			const previous = this._lastNotifiedMode;
			this._lastNotifiedMode = currentMode;
			this.dispatchEvent(
				new CustomEvent('gl-graph-details-mode-changed', {
					detail: { previous: previous, current: currentMode },
					bubbles: true,
					composed: true,
				}),
			);

			// Land caret in the AI input only on a DELIBERATE entry (a mode toggle). Programmatic entries
			// — remembered-mode auto-restore on WIP reselect, anchor-switch — set the suppress flag so
			// merely showing the panel never steals keyboard focus. Deferred one frame in focusModeAiInput.
			if (
				!this._suppressModeFocusOnce &&
				(currentMode === 'compose' || currentMode === 'review' || currentMode === 'resolve')
			) {
				this.focusModeAiInput();
			}
		}
		// One-shot: consume the suppression each cycle (switchAnchorWithinMode can net to the same mode
		// with no transition) so it never leaks into a later deliberate entry.
		this._suppressModeFocusOnce = false;

		// Reflect `activeMode` to `data-mode` so descendants can pick up the per-mode accent
		// color token (compose → purple, review → green) from `mode.css.ts`. The attribute is
		// removed when no mode is active so the styling chain falls back to `--vscode-focusBorder`.
		const activeMode = this._state.activeMode.get();
		if (activeMode != null) {
			this.setAttribute('data-mode', activeMode);
		} else {
			this.removeAttribute('data-mode');
		}

		// Snapshot the commit-form signals and persist any change to the host's per-worktree
		// memento. Reads the same signals the auto-clear logic above just mutated, so this
		// captures HEAD-move clears, manual amend toggles, AI generations, and user typing
		// through a single debounced exit point.
		this.maybeScheduleWipDraftFlush();
	}

	/** Computes the right-side identity-row snippet shown while in compose/review. Pre-formats
	 *  the visible string the WIP header (and commit / multi-commit panels) render — they
	 *  shouldn't know mode semantics. Returns `undefined` outside a mode so the header skips
	 *  the snippet entirely. Reads from existing signals only; no new IPC.
	 *
	 *  Priority order — generating > error > backed > complete > scope-idle:
	 *  - generating: "Composing..." / "Reviewing..." / "Resolving..."
	 *  - error:      "Error"
	 *  - backed:     reuses the back-preview snapshot's counts
	 *  - complete:   counts from the resolved resource value
	 *  - idle:       scope file count ("N files")
	 */
	private computeModeStatusText(): string | ReturnType<typeof html> | undefined {
		const mode = this._state.activeMode.get();
		if (mode === 'resolve') {
			const status =
				this.engagedRunningOperation?.kind === 'resolve' ? this.engagedRunningOperation.execState : undefined;
			if (status === 'generating') return formatGeneratingStatus('Resolving', this._state.aiModel.get());
			if (status === 'error') return 'Error';

			// Complete: show a resolved-files count in the identity row, mirroring compose/review's
			// snippet (resolve has no Resume, so this is the plain non-clickable count only).
			const value = this._actions?.resources?.resolve.value.get();
			if (value != null && 'result' in value && value.result?.resolutions) {
				const count = value.result.resolutions.filter(r => r.strategy !== 'skipped').length;
				if (count > 0) {
					return html`<span class="mode-status__group"
						><code-icon icon="gl-merge"></code-icon>${count} ${count === 1 ? 'file' : 'files'}
						resolved</span
					>`;
				}
			}
			return undefined;
		}
		if (mode !== 'compose' && mode !== 'review') return undefined;

		const status = this.engagedModeStatus?.[mode]?.execState;
		if (status === 'generating') {
			return formatGeneratingStatus(mode === 'compose' ? 'Composing' : 'Reviewing', this._state.aiModel.get());
		}
		if (status === 'error') return 'Error';

		// Complete / backed — pull counts from the back-preview snapshot or the resolved value.
		// When a back-preview is set (forward-available state), render the snippet as a clickable
		// Resume affordance — replaces the dedicated in-panel resume bar.
		if (mode === 'compose') {
			const preview = this._state.composeBackPreview.get();
			if (preview != null) {
				return formatModeCounts(preview.commitCount, preview.fileCount, 'commits', () =>
					this._workflow.compose.forward(),
				);
			}

			const value = this._actions?.resources?.compose.value.get();
			if (value != null && 'result' in value && value.result?.commits) {
				const commits = value.result.commits;
				const files = commits.reduce((sum, c) => sum + (c.files?.length ?? 0), 0);
				return formatModeCounts(commits.length, files, 'commits');
			}
		} else {
			const preview = this._state.reviewBackPreview.get();
			if (preview != null) {
				return formatModeCounts(preview.findingCount, preview.fileCount, 'findings', () =>
					this._workflow.review.forward(),
				);
			}

			const value = this._actions?.resources?.review.value.get();
			if (value != null && 'result' in value && value.result?.focusAreas) {
				const areas = value.result.focusAreas;
				const findingCount = areas.reduce((sum, a) => sum + (a.findings?.length ?? 0), 0);
				const fileSet = new Set<string>();
				for (const a of areas) {
					for (const f of a.files ?? []) {
						fileSet.add(f);
					}
				}
				return formatModeCounts(findingCount, fileSet.size, 'findings');
			}
		}

		// Idle / pre-run: no snippet. The file tree below already shows the scope file count;
		// a duplicate "N files" in the header was noise.
		return undefined;
	}

	/** True when the active mode has reached its "results" sub-state — review showing
	 *  findings or compose showing a plan. In that state the main header's close button is
	 *  rendered as a back arrow so the user can pop back to the scope picker (the old
	 *  sub-headers in the mode panels are gone; the main header carries this affordance). */
	private get inModeResultsView(): boolean {
		const mode = this._state.activeMode.get();
		if (mode !== 'compose' && mode !== 'review') return false;
		// Only `'complete'` renders the results body. `'backed'` reverts to the scope picker
		// with a Resume bar on top — same chrome as idle (Refresh + Close), not results
		// chrome (Restart + Close), so Restart correctly disappears after the user clicks it.
		return this.engagedModeStatus?.[mode]?.execState === 'complete';
	}

	private handleModeBack = (e: CustomEvent<{ mode: 'compose' | 'review' }>): void => {
		e.stopPropagation();
		const mode = e.detail.mode;
		this._actions.sendTelemetryEvent(
			mode === 'compose' ? 'graphDetails/compose/restarted' : 'graphDetails/review/restarted',
		);
		if (mode === 'compose') {
			this._workflow.compose.back();
		} else if (mode === 'review') {
			this._workflow.review.back();
		}
	};

	private handleModeRefresh = (_e: CustomEvent<{ mode: 'compose' | 'review' }>): void => {
		_e.stopPropagation();
		if (this._actions == null) return;

		const repoPath = this.effectiveRepoPath;
		if (repoPath == null) return;

		// Bypass fetchDetails dedup so a same-selection click always re-queries the host.
		// `force` bypasses the host's `_wipStatusCache` for a genuinely fresh `git status`.
		if (this.isWip) {
			void this._actions.refetchWipQuiet(repoPath, true);
			void this._actions.fetchBranchCommits(repoPath);
		} else if (this.isMultiCommit) {
			void this._actions.fetchCompareDetails(this.shas, repoPath, this.commitLites);
		} else if (this.sha != null) {
			void this._actions.fetchDetails(this.sha, repoPath, this.graphReachability, {
				commitLite: this.commitLite,
			});
		}

		// Re-fetch the current scope's file list — the WIP/commit refetches above don't carry
		// the user's scope selections, so scopeFiles needs its own kick to pick up new files
		// for an already-selected commit / staged-area set.
		const scope = this._state.scope.get();
		if (scope != null) {
			void this._actions.resources.scopeFiles.fetch(repoPath, scope);
		}
	};

	private focusModeAiInput(): void {
		requestAnimationFrame(() => {
			// Disconnect can happen within a frame (repo switch + hideMode on the same tick).
			// `querySelector` returns null on detached hosts, so the focus is silently lost — but
			// the bigger win is that we don't retain `this` for an extra frame after disconnect.
			if (!this.isConnected) return;

			// The mode panel can render in this host's light DOM (WIP anchor) or nested in the
			// commit/multicommit panel's shadow root (locked-commit anchors), so pierce shadow
			// boundaries to find it, then pierce its own shadow root for the input.
			const panel = this.findModePanelDeep(this);
			const aiInput = panel?.shadowRoot?.querySelector<HTMLElement>('gl-ai-input');
			aiInput?.focus({ preventScroll: true });
		});
	}

	private async resolveServices(services: Remote<GraphServices>): Promise<void> {
		// Service resolution + resource wiring lives in `detailsResolver.ts` — this element
		// stays focused on lifecycle and render routing.
		this._actions = await resolveDetailsActions(services, this._state);
		this._actions.graphState = this._graphState;
		this._resolveActionsReady();
		// Instantiating the controller auto-attaches it via `host.addController(this)`; Lit
		// fires `hostConnected` immediately (since we're already connected), which sets up
		// the repo-change subscription without an extra call here.
		this._workflow = new DetailsWorkflowController(this, this._actions);

		if (this._pendingCompare != null) {
			const { params, onReady } = this._pendingCompare;
			this._pendingCompare = undefined;
			this.openCompareMode(params, onReady);
		}

		if (this._pendingMode != null) {
			const { mode, repoPath, sha, focusedFilePaths, composeInstructions, composeScope } = this._pendingMode;
			this._pendingMode = undefined;
			this.enterModeForWip(mode, repoPath, sha, focusedFilePaths, composeInstructions, composeScope);
		}

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

		// No content to show this cycle: the selection swapped (commit → uncommitted) and the cache above
		// deliberately won't serve the OUTGOING context, so `resolved` is null in the window before the
		// next fetch flips `isLoading`. Render the host with empty content rather than bailing out —
		// returning `nothing` (or any second `html` template) swaps the whole template, which unmounts an
		// open branch sheet and replays its entry animation on the rebuild, so the sheet visibly
		// re-slides. Falling through to the single `.details-host` template keeps Lit's template instance,
		// and with it the sheet's DOM.
		const noContent = resolved == null && !this.isLoading;
		if (noContent && this._sheetStack.length === 0) return nothing;

		// "Stale" covers both: cached content shown while loading, and current content shown while
		// a background refresh is running.
		const stale = resolved != null && (this.isLoading || current == null);
		// Interaction guard: block pointer input ONLY while the shown content belongs to the
		// *outgoing* selection (a different one is loading) — a click then would act on the wrong
		// commit/worktree. When the current selection is merely refreshing (its own files/enrichment
		// still streaming in), the content is correct, so it stays interactive. Implies `stale`.
		const blockPointer = resolved != null && current == null;
		const compareAsPanel = this._state.compareAsPanel.get();

		// `.details-content` is the SCROLLING container — its content overflows and the user
		// scrolls inside it. If we rendered the sheet as a child of `.details-content`, the
		// sheet's `position: absolute` would resolve relative to the scroll content, not the
		// container's viewport, so scrolling the underlying details would push the sheet's top
		// (header included) above the visible area. Render the sheet as a SIBLING of
		// `.details-content`, inside a non-scrolling `.details-host` wrapper, so the sheet's
		// containing block is anchored to the visible viewport regardless of scroll position.
		const detailsContent = html`<div
			role="region"
			aria-label=${resolved?.ariaLabel ?? 'Commit details'}
			aria-busy=${resolved == null || stale}
			aria-live="polite"
			class=${`details-content${stale ? ' details-stale' : ''}${blockPointer ? ' details-replacing' : ''}`}
			?inert=${this._sheetStack.length > 0}
		>
			${
				resolved != null
					? resolved.content
					: html`<div class="details-skeleton">
							<div class="details-skeleton__header">
								<div class="details-skeleton__avatar"></div>
								<div class="details-skeleton__lines">
									<div class="details-skeleton__line"></div>
									<div class="details-skeleton__line details-skeleton__line--short"></div>
								</div>
							</div>
							<div class="details-skeleton__bar"></div>
							<div class="details-skeleton__body">
								<div class="details-skeleton__line"></div>
								<div class="details-skeleton__line"></div>
								<div class="details-skeleton__line details-skeleton__line--short"></div>
							</div>
						</div>`
			}
		</div>`;

		if (!compareAsPanel) {
			return html`<div class="details-host">${detailsContent}${this.renderTopSheet()}</div>`;
		}

		// Pinned compare: nested split panel inside the details host. Details on the start side,
		// compare on the end side. Orientation follows the panel's shape (via
		// `_preferredCompareOrientation`) until the user explicitly picks one; position and an
		// explicit orientation persist via the shared signals, so unpin → re-pin restores the
		// user's last layout.
		const orientation = this._state.compareSplitOrientation.get() ?? this._preferredCompareOrientation;
		const position = this._state.compareSplitPosition.get();
		return html`<gl-split-panel
			class="compare-pinned-split"
			orientation=${orientation}
			.position=${position}
			@gl-split-panel-change=${this.handleCompareSplitChange}
			@gl-split-panel-dblclick=${this.handleCompareSplitDblClick}
		>
			<div slot="start" class="compare-pinned-split__start">${detailsContent}${this.renderTopSheet()}</div>
			<div slot="end" class="compare-pinned-split__end">
				<gl-graph-compare-pinned
					orientation=${orientation}
					@gl-graph-compare-flip=${this.handleFlipCompareOrientation}
					@gl-graph-compare-close=${this.handleClosePinnedCompare}
					>${this.renderCompareMode()}${this.showMaximize ? renderDetailsMaximizeChip(this.maximized) : nothing}<gl-action-chip
						slot="actions"
						icon="refresh"
						label="Refresh Comparison"
						overlay="tooltip"
						@click=${() => this._actions.refreshBranchCompare(this.effectiveRepoPath)}
					></gl-action-chip
				></gl-graph-compare-pinned>
			</div>
		</gl-split-panel>`;
	}

	private handleCloseCompareSheet = (): void => {
		this.popSheet();
	};

	private handleComparePromote = (e: CustomEvent<{ orientation: PanelOrientation | undefined }>): void => {
		// `undefined` keeps the split in auto (shape-following) mode; only an Alt-click promotes with
		// an explicit orientation that sticks.
		this._workflow.openCompareAsPanel(e.detail.orientation);
	};

	private handleClosePinnedCompare = (): void => {
		this._workflow.closeCompare();
	};

	// Sheet stack router

	get sheetDepth(): number {
		return this._sheetStack.length;
	}

	/** Opens (or replaces the top of) the sheet stack. `push: true` stacks on top of whatever's
	 *  open; omitted/false discards the current stack and starts fresh — the policy external
	 *  openers (e.g. a WIP conflict row) use, since they're not "drilling down" from another sheet. */
	openSheet(descriptor: SheetDescriptor, options?: { push?: boolean }): void {
		const focusEl = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

		// The currently-mounted sheet is about to unmount (or get replaced) as a side effect of a
		// stack change we're driving here, not the user dismissing it — the router owns focus
		// restoration for this transition, not the sheet's own disconnect handler.
		// A converted sheet owns its `gl-detail-sheet` inside its shadow root, which this query can't
		// reach — its host mirrors the flag through (see `SheetWrapper`). A new sheet kind must add
		// its tag to `sheetWrapperTags` in sheetWrapper.ts.
		const mounted = this.querySelector<HTMLElement & { skipFocusRestore: boolean }>(sheetWrapperSelector);
		if (mounted != null) {
			mounted.skipFocusRestore = true;
		}

		const hadCompare = this._sheetStack.some(d => d.kind === 'compare');

		if (options?.push) {
			const before = this._sheetStack;
			this._sheetStack = pushSheet(before, descriptor);
			// pushSheet collapses a re-push of the current top in place (same length) — keep the
			// memo stack's shape matching the sheet stack's shape in both cases.
			this._sheetFocusMemos =
				this._sheetStack.length === before.length
					? [...this._sheetFocusMemos.slice(0, -1), focusEl]
					: [...this._sheetFocusMemos, focusEl];
		} else {
			this._sheetStack = replaceStack(this._sheetStack, descriptor);
			this._sheetFocusMemos = [focusEl];
		}

		// Opening a non-compare sheet can discard 'compare' off the stack (replaceStack) or leave it
		// buried under a push — either way, once it's no longer present, the signal must follow so the
		// projection in willUpdate doesn't clobber this sheet back to compare on the next render.
		if (hadCompare && descriptor.kind !== 'compare' && !this._sheetStack.some(d => d.kind === 'compare')) {
			this._workflow.closeCompare();
		}
	}

	/** Releases sheet-local state and the host-side virtual diff sessions when the rebase-summary
	 *  sheet leaves the stack — call from every pop/clear/remove path, not per-path. */
	private releaseRebaseSummarySheet(): void {
		this._rebaseSummaryWipAtOpen = undefined;
		// `_actionsReady`: the sheet can leave the stack before resolveServices finishes on a cold
		// open — same reason the fetch accessors await it.
		void this._actionsReady.then(() => this._actions.endAutoRebaseSummarySession());
	}

	/** Pops the top sheet. Restores focus to the ORIGINAL trigger (memo[0]) once the stack fully
	 *  empties — intermediate pops leave focus to the newly-exposed sheet's own auto-focus. */
	popSheet(): void {
		const { stack, popped } = popSheetFromStack(this._sheetStack);
		if (popped == null) return;

		if (popped.kind === 'rebaseSummary') {
			this.releaseRebaseSummarySheet();
		}

		if (popped.kind === 'compare') {
			this._workflow.closeCompare();
		}

		const rootMemo = this._sheetFocusMemos[0];
		this._sheetStack = stack;
		this._sheetFocusMemos = this._sheetFocusMemos.slice(0, -1);

		if (this._sheetStack.length === 0 && rootMemo?.isConnected) {
			rootMemo.focus({ preventScroll: true });
		}
	}

	/** Discards the whole stack at once (vs. popping one at a time) — e.g. a selection change that
	 *  invalidates everything currently open. */
	clearSheets(): void {
		if (this._sheetStack.some(d => d.kind === 'rebaseSummary')) {
			this.releaseRebaseSummarySheet();
		}

		if (this._sheetStack.some(d => d.kind === 'compare')) {
			this._workflow.closeCompare();
		}

		const rootMemo = this._sheetFocusMemos[0];
		this._sheetStack = [];
		this._sheetFocusMemos = [];

		if (rootMemo?.isConnected) {
			rootMemo.focus({ preventScroll: true });
		}
	}

	/** Drops every sheet of `kind` from the stack, wherever it sits, keeping the focus-memo stack's
	 *  shape in sync. Owns the kind-scoped bookkeeping (the rebase wip-stamp) so callers can't forget
	 *  it; deliberately does NOT run user-close hooks (resolve-mode exit) — removal is invalidation,
	 *  not dismissal. */
	private removeSheetKind(kind: SheetKind): void {
		const keep = this._sheetStack.map(d => d.kind !== kind);
		this._sheetStack = removeKind(this._sheetStack, kind);
		this._sheetFocusMemos = this._sheetFocusMemos.filter((_, i) => keep[i]);

		if (kind === 'rebaseSummary') {
			this.releaseRebaseSummarySheet();
		}
	}

	private flipOrientation(o: PanelOrientation): PanelOrientation {
		return o === 'horizontal' ? 'vertical' : 'horizontal';
	}

	private handleFlipCompareOrientation = (): void => {
		const effective = this._state.compareSplitOrientation.get() ?? this._preferredCompareOrientation;
		this._state.compareSplitOrientation.set(this.flipOrientation(effective));
	};

	private handleCompareSplitChange = (e: CustomEvent<{ position: number }>): void => {
		this._state.compareSplitPosition.set(e.detail.position);
	};

	private handleCompareSplitDblClick = (e: Event): void => {
		// Splits nested inside the details content emit the same composed event — only reset
		// when the double-click came from this splitter's own divider.
		if (e.target !== e.currentTarget) return;

		this._state.compareSplitPosition.set(50);
	};

	/** Loading placeholder shown until `preferences` (the file layout) loads, so the tree never
	 *  paints the wrong layout and flips. */
	private renderFilesLoading() {
		return html`<div class="commit-panel__files-loading" aria-busy="true">
			<code-icon icon="loading" modifier="spin"></code-icon>
			<span>Loading...</span>
		</div>`;
	}

	private renderWip() {
		const wip = this._state.wip.get();
		if (!wip) return nothing;

		const branchName = wip.branch?.name ?? 'unknown';
		const activeMode = this._state.activeMode.get();
		const preferences = this._state.preferences.get();
		const hasChanges = (wip.changes?.files?.length ?? 0) > 0;
		const aiCreatePrEnabled =
			(preferences?.aiEnabled ?? false) &&
			(this._state.orgSettings.get()?.ai ?? false) &&
			(wip.repo?.provider?.supportedFeatures?.createPullRequestWithDetails ?? false);
		// Read the worktree-matched sessions from the cycle snapshot captured in `willUpdate` so
		// the auto-partial trigger and the rendered card list agree on the same data within a
		// single update. See `_cycleAgentSessions` for why this matters.
		const worktreeAgentSessions = this._cycleAgentSessions;
		// Likewise resolved in `willUpdate` (path-guarded + reconciled against the live set there),
		// so this gate counts exactly the rows `gl-details-agent-status` will render.
		const pastAgentSessions = this._cyclePastSessions;
		const hasPastSessions = (pastAgentSessions?.sessions.length ?? 0) > 0;
		const wipWorktreePath = wip.repo?.path;
		const hasPausedOp = wip.changes?.pausedOpStatus != null;
		const showAgentStatus = (worktreeAgentSessions != null || hasPastSessions) && activeMode == null;
		// Tri-state of the agents pane drives both splitter availability and sizing:
		//  - `collapsed` / `partial`: pane is content-sized via CSS `fit-content(<MAX>%)` (see
		//                              `--auto-size` rule). Splitter inert. The `position`
		//                              attribute we pass here is irrelevant in these modes —
		//                              CSS uses a fixed `fit-content` cap regardless.
		//  - `expanded`:              splitter position is authoritative — opens at
		//                              {@link AGENT_STATUS_DEFAULT_PCT}% until the user drags,
		//                              then the persisted user position. Snap clamps drag to
		//                              [10, {@link AGENT_STATUS_MAX_PCT}]. One exception: when
		//                              the worktree match returns an empty array (sessions
		//                              present in the source but none for this worktree), the
		//                              `--no-cards` class forces `max-content` so the heading
		//                              collapses instead of floating in empty space — same as
		//                              the collapsed/partial no-cards behavior.
		const agentStatusExpand = this.agentStatusExpand;
		const agentStatusIsExpanded = agentStatusExpand === 'expanded';
		const agentStatusPosition = this._agentStatusSplitPosition ?? agentStatusDefaultPct;
		// `--auto-size` (fit-content fallback) applies only in collapsed/partial states — the
		// section is non-draggable there and the intent is "snug to content". Expanded never uses
		// it: the split-panel's default grid template (`min(--_start-size, ...)`) reflects the
		// splitter position directly.
		const useAutoSize = !agentStatusIsExpanded;
		// Cards visible under the current expand state, derived right here from the truth
		// (`worktreeAgentSessions` + `agentStatusExpand`) — no event-driven mirror needed. Past rows
		// only ever render when expanded (see `gl-details-agent-status`), so they only count there.
		const agentStatusHasVisibleCards =
			(worktreeAgentSessions?.some(s =>
				expandVisibleCategories[agentStatusExpand].has(agentPhaseToCategory[s.phase]),
			) ??
				false) ||
			(agentStatusExpand === 'expanded' && hasPastSessions);

		const restContent =
			activeMode === 'review'
				? this.renderReviewMode()
				: activeMode === 'compose'
					? this.renderComposeMode()
					: activeMode === 'resolve'
						? this.renderResolveMode()
						: hasChanges || hasPausedOp
							? html`
									<div class="commit-panel__files">
										${
											preferences != null
												? html`<gl-details-wip-panel
														variant="embedded"
														file-icons
														checkbox-mode
														?bulk-conflict-actions=${
															wip.changes?.pausedOpStatus?.type === 'rebase'
														}
														?resolve-enabled=${preferences?.aiEnabled ?? false}
														conflict-details
														?show-search-box=${this.showSearchBox}
														?search-box-filter=${this.searchBoxFilter}
														.wip=${wip}
														.files=${this.buildWipFiles(wip)?.files}
														.agentSessions=${worktreeAgentSessions}
														.preferences=${preferences}
														.orgSettings=${this._state.orgSettings.get()}
														.isUncommitted=${true}
														.filesCollapsable=${false}
														empty-text=${
															hasPausedOp && !hasChanges
																? 'No conflicting or changed files'
																: 'No working changes'
														}
														@file-open=${this.handleFileOpen}
														@file-compare-working=${this.handleFileCompareWorking}
														@file-compare-previous=${this.handleFileComparePrevious}
														@file-compare-wip=${this.handleFileCompareWipChanges}
														@file-open-current=${this.handleFileOpenConflictCurrent}
														@file-open-incoming=${this.handleFileOpenConflictIncoming}
														@file-conflict-details=${this.handleOpenConflictDetails}
														@file-resolve-conflict=${this.handleFileResolveConflict}
														@file-more-actions=${this.handleFileMoreActions}
														@file-stage=${this.handleFileStage}
														@file-unstage=${this.handleFileUnstage}
														@file-discard=${this.handleFileDiscard}
														@file-stash=${this.handleFileStash}
														@discard-unstaged=${this.handleDiscardUnstaged}
														@discard-staged=${this.handleDiscardStaged}
														@stage-all=${this.handleStageAll}
														@unstage-all=${this.handleUnstageAll}
														@stash-save=${this.handleStashSave}
														@resolve-conflicts=${this.handleAiResolveConflicts}
														@resolve-all-current=${this.handleResolveAllCurrent}
														@resolve-all-incoming=${this.handleResolveAllIncoming}
														@change-files-layout=${this.handleChangeFilesLayout}
														@open-multiple-changes=${this.handleOpenMultipleChanges}
														@copy-wip-patch=${this.handleCopyWipPatch}
													></gl-details-wip-panel>`
												: this.renderFilesLoading()
										}
									</div>
									<gl-commit-box
										.message=${this._state.commitMessage.get()}
										.amend=${this._state.amend.get()}
										.generating=${this._state.generating.get()}
										.committing=${this._state.committing.get()}
										.branchName=${branchName}
										.canCommit=${this._actions.canCommit()}
										.disabledReason=${this._actions.canCommitReason()}
										.aiEnabled=${preferences?.aiEnabled ?? false}
										.commitError=${this._state.commitError.get()}
										.signing=${wip.signing}
										.aiModel=${this._state.aiModel.get()}
										@message-change=${this.handleCommitMessageChange}
										@amend-change=${this.handleAmendChange}
										@commit=${this.handleCommit}
										@generate-message=${this.handleGenerateMessage}
										@add-coauthors=${this.handleAddCoauthors}
										@compose=${this.handleCompose}
									></gl-commit-box>
								`
							: html`
									<gl-details-wip-empty-pane
										.wip=${wip}
										.aiEnabled=${false}
										.aiCreatePrEnabled=${aiCreatePrEnabled}
										.pullRequest=${this._state.wipPullRequest.get()}
										.pullRequestLoading=${this._state.wipPullRequestLoading.get()}
										.hasIntegrationsConnected=${this._state.hasIntegrationsConnected.get()}
										.launchpadSummary=${this._launchpadState?.summary.get()}
										.launchpadSummaryLoading=${this._launchpadState?.loading.get() ?? false}
										.mergeTargetStatus=${this._state.wipMergeTarget.get()}
										show-launchpad
										@switch-branch=${this.handleSwitchBranch}
										@create-branch=${this.handleCreateBranch}
										@create-pr=${this.handleCreatePullRequest}
										@create-pr-ai=${this.handleCreatePullRequestWithAI}
										@start-work=${this.handleStartWork}
										@start-review=${this.handleStartReview}
										@apply-stash=${this.handleApplyStash}
										@new-worktree=${this.handleNewWorktree}
										@publish-branch=${this.handlePublishBranch}
										@pull=${this.handlePull}
										@push=${this.handlePush}
										@rebase-onto-merge-target=${this.handleRebaseOntoMergeTarget}
										@merge-merge-target-into-current=${this.handleMergeMergeTargetIntoCurrent}
										@review-branch-changes=${this.handleReviewBranchChanges}
										@recompose-branch-changes=${this.handleRecomposeBranchChanges}
										@refresh-launchpad=${this.handleRefreshLaunchpad}
									></gl-details-wip-empty-pane>
								`;

		return html`
			<gl-details-wip-header
				.wip=${wip}
				.currentRepoPath=${this.graphRepoPath()}
				?sheets-open=${this._sheetStack.length > 0}
				?graph-ready=${this.graphReady}
				?show-maximize=${this.showMaximize}
				?maximized=${this.maximized}
				.navigation=${this.navigation}
				.activeMode=${activeMode}
				.modeStatus=${this.engagedModeStatus}
				.aiEnabled=${preferences?.aiEnabled ?? false}
				.loading=${this.isLoading}
				.autolinks=${this._state.wipAutolinks.get()}
				.issues=${this._state.wipIssues.get()}
				.mergeTargetStatus=${this._state.wipMergeTarget.get()}
				.mergeTargetStatusLoading=${this._state.wipMergeTargetLoading.get()}
				.pullRequest=${this._state.wipPullRequest.get()}
				.pullRequestLoading=${this._state.wipPullRequestLoading.get()}
				.dateFormat=${preferences?.dateFormat}
				.dateStyle=${preferences?.dateStyle}
				.modeStatusText=${this.computeModeStatusText()}
				.inResultsView=${this.inModeResultsView}
				@toggle-mode=${this.handleToggleMode}
				@ai-resolve-conflicts=${this.handleAiResolveConflicts}
				@mode-back=${this.handleModeBack}
				@mode-refresh=${this.handleModeRefresh}
				@refresh-wip=${this.handleRefreshWip}
				@switch-branch=${this.handleSwitchBranch}
				@compare-with-merge-target=${this.handleCompareWithMergeTarget}
				@publish-branch=${this.handlePublishBranch}
				@pull=${this.handlePull}
				@push=${this.handlePush}
				@force-push=${this.handleForcePush}
				@fetch=${this.handleFetch}
				@share-as-cloud-patch=${this.handleShareWipAsCloudPatch}
				@remove-associated-issue=${this.handleRemoveAssociatedIssue}
				@gl-issue-pull-request-details=${this.handleOpenPullRequestDetails}
			></gl-details-wip-header>
			${
				showAgentStatus
					? html`<gl-split-panel
							class="agent-status-split ${
								useAutoSize ? 'agent-status-split--auto-size' : ''
							} ${agentStatusHasVisibleCards ? '' : 'agent-status-split--no-cards'}"
							orientation="vertical"
							primary="start"
							.position=${agentStatusPosition}
							?disabled=${!agentStatusIsExpanded}
							.snap=${this._agentStatusSplitSnap}
							@gl-split-panel-change=${this._onAgentStatusSplitChange}
							@gl-split-panel-drag-end=${this._onAgentStatusSplitDragEnd}
							@gl-split-panel-dblclick=${this._onAgentStatusSplitDblClick}
						>
							<div slot="start" class="agent-status-split__top scrollable">
								<gl-details-agent-status
									.sessions=${worktreeAgentSessions}
									.pastSessions=${pastAgentSessions}
									.worktreePath=${wipWorktreePath}
									.expand=${agentStatusExpand}
									.selectedSessionId=${this._selectedAgentSessionId}
									@gl-agent-status-expand-request=${this._onAgentStatusExpandRequest}
								></gl-details-agent-status>
							</div>
							<div slot="end" class="agent-status-split__bottom scrollable">${restContent}</div>
						</gl-split-panel>`
					: restContent
			}
		`;
	}

	private renderComposeMode() {
		const scopeItems = this._actions.buildWipScopeItems();
		const handleCompose = (e: CustomEvent<{ prompt?: string }>) => {
			// Gate the AI call behind a configured model: if the user hasn't picked one,
			// open the picker first so the click never produces a silent no-op. The user
			// re-clicks Compose after selecting — keeps the dispatch path single-shot.
			if (this._state.aiModel.get() == null) {
				this._actions.switchAIModel('compose');
				return;
			}

			const panel = this.querySelector<GlDetailsComposeModePanel>('gl-details-compose-mode-panel');
			const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
			const aiExcludedFiles = this._state.aiExcludedFiles.get();
			this._workflow.runCompose(
				this.effectiveRepoPath,
				e.detail?.prompt,
				excludedFiles,
				aiExcludedFiles,
				this.getCurrentScopeFilesCount(),
				panel?.selectedIds,
				scopeItems ?? undefined,
			);
		};

		// Generation/back state lives on the registry entry now; the single `Resource` is a
		// *projection* of the engaged anchor's result. Read execState from the entry first;
		// fall back to the resource for the resolved payload + idle case.
		const composeEntry =
			this.engagedRunningOperation?.kind === 'compose' ? this.engagedRunningOperation : undefined;
		// The externally-delivered seed only prefills the anchor it was delivered for.
		const seedInstructions =
			this._composeSeedInstructions?.anchorKey === this.engagedAnchorKey
				? this._composeSeedInstructions?.instructions
				: undefined;
		const composeResource = this._actions.resources.compose;
		const composeValue = composeEntry?.result ?? composeResource.value.get();
		const composeResult = composeValue && 'result' in composeValue ? composeValue.result : undefined;
		const composeError =
			(composeValue && 'error' in composeValue ? composeValue.error.message : undefined) ??
			composeResource.error.get();
		const composeErrorKind = composeValue && 'error' in composeValue ? composeValue.error.kind : undefined;
		const mappedComposeStatus: 'idle' | 'loading' | 'ready' | 'error' =
			composeEntry?.execState === 'generating'
				? 'loading'
				: composeEntry?.execState === 'backed'
					? 'idle'
					: composeResult != null
						? 'ready'
						: composeError != null
							? 'error'
							: 'idle';

		const scopeFilesValue = this._actions.resources.scopeFiles.value.get();
		const fallbackFiles = this._state.wip.get()?.changes?.files;
		const composeFiles = scopeFilesValue ?? fallbackFiles;

		return html`<gl-details-compose-mode-panel
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			.status=${mappedComposeStatus}
			.commits=${composeResult?.commits}
			.baseCommit=${composeResult?.baseCommit}
			.errorMessage=${composeError}
			.errorKind=${composeErrorKind}
			.repoPath=${this.effectiveRepoPath}
			.stale=${this._state.wipStale.get()}
			.scope=${this._state.scope.get()}
			.scopeItems=${scopeItems}
			.scopeLoading=${this._state.branchCommitsFetching.get()}
			.files=${composeFiles}
			.aiExcludedFiles=${this._state.aiExcludedFiles.get()}
			.fileLayout=${this._state.preferences.get()?.files?.layout ?? 'auto'}
			.aiModel=${this._state.aiModel.get()}
			.lastPrompt=${composeEntry?.prompt}
			.basePrompt=${composeEntry?.basePrompt ?? seedInstructions}
			.refineMode=${composeEntry?.refineMode ?? false}
			.refineDraft=${composeEntry?.refineDraft}
			.progressMessage=${this._state.composeProgressMessage.get()}
			?applying=${this._state.composeApplying.get()}
			?forward-available=${this._state.composeForwardAvailable.get()}
			.backPreview=${this._state.composeBackPreview.get()}
			.excludedCommitIds=${this._state.composeRefineExcludedCommitIds.get()}
			.regeneratingCommitId=${this._state.composeRegeneratingCommitId.get()}
			@compose-generate=${handleCompose}
			@compose-refine=${handleCompose}
			@compose-regen-message=${(e: CustomEvent<{ commitId: string }>) =>
				void this._workflow.compose.regenerateCommitMessage(e.detail.commitId)}
			@compose-reorder=${(e: CustomEvent<{ orderedCommitIds: string[] }>) =>
				void this._workflow.compose.reorderCommits(e.detail.orderedCommitIds)}
			@compose-move-file=${(e: CustomEvent<{ paths: string[]; fromCommitId: string; toCommitId: string }>) =>
				void this._workflow.compose.moveFile(e.detail.fromCommitId, e.detail.toCommitId, e.detail.paths)}
			@compose-forward=${() => this._workflow.compose.forward()}
			@compose-forward-invalidate=${() => this._workflow.compose.invalidateSnapshot()}
			@compose-error-back=${() => this._workflow.compose.backFromError()}
			@compose-error-retry=${() => {
				const panel = this.querySelector<GlDetailsComposeModePanel>('gl-details-compose-mode-panel');
				const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
				const aiExcludedFiles = this._state.aiExcludedFiles.get();
				this._workflow.compose.retryFromError(
					this.effectiveRepoPath,
					this.sha,
					this.graphReachability,
					excludedFiles,
					aiExcludedFiles,
					this.getCurrentScopeFilesCount(),
					panel?.selectedIds,
					scopeItems ?? undefined,
				);
			}}
			@compose-cancel=${this.handleCancelMode}
			@compose-discard=${this.handleDiscardMode}
			@compose-commit-all=${(e: CustomEvent<{ includedCommitIds?: readonly string[] }>) =>
				void this._workflow.compose.applyPlan(this.sha, this.graphReachability, e.detail?.includedCommitIds)}
			@compose-refine-exclude-toggle=${(e: CustomEvent<{ commitId: string; excluded: boolean }>) =>
				this.handleComposeRefineExcludeToggle(e.detail.commitId, e.detail.excluded)}
			@compose-open-multi-diff=${this.handleComposeOpenMultiDiff}
			@scope-open-multi-diff=${this.handleScopeOpenMultiDiff}
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
		// The right ref (Compare side) has a worktree when the host resolved a path during the last
		// summary fetch — covers the current branch AND any other branch checked out in a workspace
		// peer or off-workspace worktree.
		const rightRefWorktreePath = this._state.branchCompareRightRefWorktreePath.get();
		const hasWorktree = rightRefWorktreePath != null;
		const mergeBase = this._state.branchCompareMergeBase.get();
		const activeTab = this._state.branchCompareActiveTab.get();
		const allFiles = this._state.branchCompareAllFiles.get() ?? [];
		const leftRef = this._state.branchCompareLeftRef.get();
		const rightRef = this._state.branchCompareRightRef.get();

		const autolinksByScope = this._state.branchCompareAutolinksByScope.get();
		const enrichedByScope = this._state.branchCompareEnrichedAutolinksByScope.get();
		const contributorsByScope = this._state.branchCompareContributorsByScope.get();
		const activeView = this._state.branchCompareActiveView.get();

		return html`<gl-details-compare-mode-panel
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			.branchName=${branch?.name}
			.repoPath=${repoPath}
			.preferences=${this._state.preferences.get()}
			.orgSettings=${this._state.orgSettings.get()}
			.aiModel=${this._state.aiModel.get()}
			.explainBusy=${this._state.compareExplainBusy.get()}
			.generateChangelogBusy=${this._state.compareGenerateChangelogBusy.get()}
			.leftRef=${leftRef}
			.leftRefType=${this._state.branchCompareLeftRefType.get()}
			.rightRef=${rightRef}
			.rightRefType=${this._state.branchCompareRightRefType.get()}
			.includeWorkingTree=${this._state.branchCompareIncludeWorkingTree.get()}
			.stale=${this._state.branchCompareStale.get()}
			.hasWorktree=${hasWorktree}
			.rightRefWorktreePath=${rightRefWorktreePath}
			.mergeBase=${mergeBase}
			.aheadCount=${this._state.branchCompareAheadCount.get()}
			.behindCount=${this._state.branchCompareBehindCount.get()}
			.allFilesCount=${this._state.branchCompareAllFilesCount.get()}
			.aheadCommits=${this._state.branchCompareAheadCommits.get()}
			.behindCommits=${this._state.branchCompareBehindCommits.get()}
			.aheadFiles=${this._state.branchCompareAheadFiles.get()}
			.behindFiles=${this._state.branchCompareBehindFiles.get()}
			.aheadLoaded=${this._state.branchCompareAheadLoaded.get()}
			.behindLoaded=${this._state.branchCompareBehindLoaded.get()}
			.aheadHasMore=${this._state.branchCompareAheadHasMore.get()}
			.behindHasMore=${this._state.branchCompareBehindHasMore.get()}
			.aheadLoadingMore=${this._state.branchCompareAheadLoadingMore.get()}
			.behindLoadingMore=${this._state.branchCompareBehindLoadingMore.get()}
			.allFiles=${allFiles}
			.loading=${
				this._actions.resources.branchCompareSummary.loading.get() ||
				this._actions.resources.branchCompareSide.loading.get()
			}
			.errorMessage=${
				this._actions.resources.branchCompareSummary.error.get() ??
				this._actions.resources.branchCompareSide.error.get()
			}
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
				this._actions.openFile(e.detail, this.compareFileRef(activeTab, leftRef, rightRef))}
			@file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileComparePrevious(e.detail, this.compareFileRef(activeTab, leftRef, rightRef))}
			@file-compare-between=${(e: CustomEvent<FileCompareBetweenDetail>) =>
				this._actions.openFileCompareBetween(e.detail, e.detail.lhsRef, e.detail.rhsRef)}
			@file-compare-working=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.openFileCompareWorking(e.detail, this.compareFileRef(activeTab, leftRef, rightRef))}
			@file-more-actions=${(e: CustomEvent<FileChangeListItemDetail>) =>
				this._actions.executeFileAction(e.detail, this.compareFileRef(activeTab, leftRef, rightRef))}
			@change-files-layout=${this.handleChangeFilesLayout}
			@change-ref=${(e: CustomEvent<{ side: 'left' | 'right' }>) =>
				void this._actions.changeCompareRef(e.detail.side, repoPath)}
			@swap-refs=${() => this._actions.swapCompareRefs(repoPath)}
			@open-in-search-and-compare=${() => this._actions.openCompareInSearchAndCompare(repoPath)}
			@toggle-working-tree=${() => this._actions.toggleCompareWorkingTree(repoPath)}
			@refresh-compare=${() => this._actions.refreshBranchCompare(repoPath)}
			@load-more-compare-commits=${(e: CustomEvent<{ side: 'ahead' | 'behind' }>) =>
				void this._actions.loadMoreCompareCommits(e.detail.side, repoPath)}
			@switch-tab=${(e: CustomEvent<{ tab: 'all' | 'ahead' | 'behind' }>) =>
				this._actions.switchCompareTab(e.detail.tab, repoPath)}
			@scope-to-commit=${(e: CustomEvent<{ sha: string | undefined }>) =>
				this._actions.selectCompareCommit(e.detail.sha, repoPath)}
			@switch-view=${(e: CustomEvent<{ view: 'files' | 'contributors' }>) =>
				this._actions.setBranchCompareActiveView(e.detail.view, repoPath)}
			@request-enrichment=${() => this._actions.requestBranchCompareEnrichment(repoPath)}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
			@copy-commit-patch=${this.handleCopyCommitPatch}
			@gl-explain=${(e: CustomEvent<{ prompt?: string }>) =>
				this._actions.branchCompareExplain(repoPath, e.detail?.prompt)}
			@gl-generate-changelog=${() => this._actions.branchCompareGenerateChangelog(repoPath)}
			@gl-issue-pull-request-details=${this.handleOpenPullRequestDetails}
		></gl-details-compare-mode-panel>`;
	}

	/** When the user has scoped the compare file list to a single commit, file actions should
	 *  resolve against THAT commit (so "previous" means commit~1, not the comparison's other side).
	 *  Otherwise fall through to the tab's "owning" ref:
	 *    - Ahead / All Files → rightRef (Compare side; the file's latest state lives there)
	 *    - Behind → leftRef (Base side; the file's "owner" is Base for Behind rows)
	 *  Matches the per-tab diff direction set in `gl-details-compare-mode-panel.getFileContext` so
	 *  "Open File" lands on the same ref the right-click commands assume. The returned ref isn't
	 *  tagged as a stash — compare-mode refs are branches/tags/commits, and the safety net in
	 *  `getCommitAndFileByPath` handles the rare stash-in-compare case. */
	private compareFileRef(
		activeTab: 'all' | 'ahead' | 'behind',
		leftRef: string | undefined,
		rightRef: string | undefined,
	): { ref: string } | undefined {
		// When the Ahead side shows only working files (no commits), unscoped inline row actions
		// (Open File, Open Changes with Working File) must target the working tree — matching the
		// single-click and right-click paths — not the committed rightRef.
		let fallback: string | undefined;
		if (activeTab === 'behind') {
			fallback = leftRef;
		} else if (activeTab === 'ahead' && hasOnlyWip(this._state.branchCompareAheadCommits.get())) {
			fallback = uncommitted;
		} else {
			fallback = rightRef;
		}
		const ref = this._state.branchCompareSelectedCommitSha.get() ?? fallback;
		return ref != null ? { ref: ref } : undefined;
	}

	/**
	 * Resolves the WIP's worktree to the agent sessions running in it. The matcher
	 * ({@link matchAgentSessionsForWorktree}) compares strictly on `worktreePath`; `repoPath` is
	 * carried through for default-worktree producers that leave `worktreePath` undefined and
	 * collapse to the repo path. Passes `graphRepoPath()` (the graph's selected repo) as the
	 * repoPath and `wip.repo.path` (the worktree being inspected) as the worktreePath.
	 */
	private getWorktreeAgentSessions(wip: Wip): AgentSessionState[] | undefined {
		const primaryRepoPath = this.graphRepoPath() ?? wip.repo?.path;
		if (primaryRepoPath == null) return undefined;

		return matchAgentSessionsForWorktree(this._graphState?.agentSessions, {
			repoPath: primaryRepoPath,
			worktreePath: wip.repo?.path,
		});
	}

	private renderCommit() {
		const commit = this._state.commit.get();
		if (!commit) return nothing;

		const activeMode = this._state.activeMode.get();
		const subPanelContent = activeMode === 'review' ? this.renderReviewMode() : nothing;

		return html`<gl-details-commit-panel
			variant="embedded"
			file-icons
			?multi-selectable=${true}
			compare-enabled
			show-jump-to-nearest-wip
			?show-maximize=${this.showMaximize}
			?maximized=${this.maximized}
			details-on-click
			?show-search-box=${this.showSearchBox}
			?search-box-filter=${this.searchBoxFilter}
			.navigation=${this.navigation}
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
			.branchName=${commit.stashOnRef}
			.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
			.aiModel=${this._state.aiModel.get()}
			.activeMode=${activeMode}
			.modeStatus=${this.engagedModeStatus}
			.modeStatusText=${this.computeModeStatusText()}
			.inResultsView=${this.inModeResultsView}
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
			@refresh-commit=${this.handleRefreshCommit}
			@gl-stash-apply=${(e: CustomEvent<StashApplyCommandArgs>) =>
				void this._actions.services.commands.execute('gitlens.stashesApply', e.detail)}
			@change-files-layout=${this.handleChangeFilesLayout}
			@toggle-mode=${this.handleToggleMode}
			@mode-back=${this.handleModeBack}
			@mode-refresh=${this.handleModeRefresh}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
			@copy-commit-patch=${this.handleCopyCommitPatch}
			@gl-issue-pull-request-details=${this.handleOpenPullRequestDetails}
		></gl-details-commit-panel>`;
	}

	private renderMultiCommit() {
		const activeMode = this._state.activeMode.get();
		const subPanelContent = activeMode === 'review' ? this.renderReviewMode() : nothing;
		const swapped = this._state.swapped.get();
		const shas = this.effectiveShas;
		const repoPath = this.effectiveRepoPath;
		const rawBetweenCount = this._state.compareBetweenCount.get();
		const betweenCount = Math.max(0, rawBetweenCount != null ? rawBetweenCount - 1 : (shas?.length ?? 0) - 2);

		return html`<gl-details-multicommit-panel
			variant="embedded"
			file-icons
			?show-maximize=${this.showMaximize}
			?maximized=${this.maximized}
			?show-search-box=${this.showSearchBox}
			?search-box-filter=${this.searchBoxFilter}
			.commitFrom=${this._state.commitFrom.get()}
			.commitTo=${this._state.commitTo.get()}
			.files=${this._state.compareFiles.get()}
			.stats=${this._state.compareStats.get()}
			.preferences=${this._state.preferences.get()}
			.orgSettings=${this._state.orgSettings.get()}
			.aiModel=${this._state.aiModel.get()}
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
			.generateChangelogBusy=${this._state.compareGenerateChangelogBusy.get()}
			.filesCollapsable=${false}
			.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
			.activeMode=${this._state.activeMode.get()}
			.modeStatus=${this.engagedModeStatus}
			.modeStatusText=${this.computeModeStatusText()}
			.inResultsView=${this.inModeResultsView}
			.subPanelContent=${subPanelContent}
			@file-open=${(e: CustomEvent<FileChangeListItemDetail>) => {
				// Sub-panels (review / compare) own their file actions when active — their events
				// bubble through the host element and would otherwise re-route to the multicommit
				// default, replacing the editor the sub-panel just opened.
				if (this._state.activeMode.get() != null) return;

				this._actions.openFile(e.detail, asRefObj(this._actions.toSha(shas, swapped)));
			}}
			@file-compare-between=${(e: CustomEvent<FileChangeListItemDetail>) => {
				if (this._state.activeMode.get() != null) return;

				this._actions.openFileCompareBetween(
					e.detail,
					this._actions.fromSha(shas, swapped),
					this._actions.toSha(shas, swapped),
				);
			}}
			@file-compare-working=${(e: CustomEvent<FileChangeListItemDetail>) => {
				if (this._state.activeMode.get() != null) return;

				this._actions.openFileCompareWorking(e.detail, asRefObj(this._actions.toSha(shas, swapped)));
			}}
			@file-compare-previous=${(e: CustomEvent<FileChangeListItemDetail>) => {
				if (this._state.activeMode.get() != null) return;

				this._actions.openFileComparePrevious(e.detail, asRefObj(this._actions.fromSha(shas, swapped)));
			}}
			@file-more-actions=${(e: CustomEvent<FileChangeListItemDetail>) => {
				if (this._state.activeMode.get() != null) return;

				this._actions.executeFileAction(e.detail, asRefObj(this._actions.toSha(shas, swapped)));
			}}
			@swap-selection=${() => this._actions.swap(shas)}
			@gl-explain=${(e: CustomEvent<{ prompt?: string }>) =>
				this._actions.compareExplain(shas, repoPath, e.detail?.prompt)}
			@gl-generate-changelog=${() => this._actions.compareGenerateChangelog(shas, repoPath)}
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
			@mode-back=${this.handleModeBack}
			@mode-refresh=${this.handleModeRefresh}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
			@copy-commit-patch=${this.handleCopyCommitPatch}
			@gl-issue-pull-request-details=${this.handleOpenPullRequestDetails}
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

		// Repo/branch identity for the review's scope label — sourced from WIP state which is
		// always loaded for the active repo regardless of which scope (commit/compare/wip) the
		// user is reviewing. Provides the agent prompt with concrete identifiers (worktree name,
		// branch, SHAs) so it knows where the findings come from.
		const wipForScope = this._state.wip.get();
		const reviewRepoName = wipForScope?.repo.name;
		const reviewIsLinkedWorktree = wipForScope?.repo.isWorktree === true;
		const reviewBranchName = wipForScope?.branch?.name;

		// See `renderComposeMode` — the registry entry is the source of truth for execState;
		// the resource is a projection of the engaged anchor's result.
		const reviewEntry = this.engagedRunningOperation?.kind === 'review' ? this.engagedRunningOperation : undefined;
		const reviewResource = this._actions.resources.review;
		const reviewValue = reviewEntry?.result ?? reviewResource.value.get();
		const reviewResult = reviewValue && 'result' in reviewValue ? reviewValue.result : undefined;
		const reviewError =
			(reviewValue && 'error' in reviewValue ? reviewValue.error.message : undefined) ??
			reviewResource.error.get();
		const mappedReviewStatus: 'idle' | 'loading' | 'ready' | 'error' =
			reviewEntry?.execState === 'generating'
				? 'loading'
				: reviewEntry?.execState === 'backed'
					? 'idle'
					: reviewResult != null
						? 'ready'
						: reviewError != null
							? 'error'
							: 'idle';

		return html`<gl-details-review-mode-panel
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			.scope=${this._state.scope.get()}
			.result=${reviewResult}
			.status=${mappedReviewStatus}
			.errorMessage=${reviewError}
			.stale=${this._state.wipStale.get()}
			.scopeItems=${scopeItems}
			.scopeLoading=${this._state.branchCommitsFetching.get()}
			.files=${reviewFiles}
			.aiExcludedFiles=${this._state.aiExcludedFiles.get()}
			.fileLayout=${this._state.preferences.get()?.files?.layout ?? 'auto'}
			.repoPath=${this.effectiveRepoPath}
			.repoName=${reviewRepoName}
			?isLinkedWorktree=${reviewIsLinkedWorktree}
			.branchName=${reviewBranchName}
			.aiModel=${this._state.aiModel.get()}
			.lastPrompt=${reviewEntry?.prompt}
			?forward-available=${this._state.reviewForwardAvailable.get()}
			.backPreview=${this._state.reviewBackPreview.get()}
			@review-run=${(e: CustomEvent<{ prompt?: string }>) => {
				// Same model gate as compose — open the picker first when no model is set.
				if (this._state.aiModel.get() == null) {
					this._actions.switchAIModel('review');
					return;
				}

				const panel = this.findReviewModePanel();
				const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
				this._workflow.runReview(
					this.effectiveRepoPath,
					e.detail?.prompt,
					excludedFiles,
					this.getCurrentScopeFilesCount(),
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
			@review-forward=${() => this._workflow.review.forward()}
			@review-forward-invalidate=${() => this._workflow.review.invalidateSnapshot()}
			@review-error-back=${() => this._workflow.review.backFromError()}
			@review-error-retry=${() => {
				const panel = this.findReviewModePanel();
				const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
				this._workflow.review.retryFromError(
					this.effectiveRepoPath,
					excludedFiles,
					this.getCurrentScopeFilesCount(),
					panel?.selectedIds,
					scopeItems ?? undefined,
				);
			}}
			@review-send-to-chat=${(e: CustomEvent<ReviewSendToChatDetail>) => this.handleReviewSendToChat(e)}
			@review-copied=${(e: CustomEvent<ReviewCopiedDetail>) => {
				this._actions.sendTelemetryEvent('graphDetails/review/copied', {
					granularity: e.detail.granularity,
				});
				void this._actions.services.graphInspect.trackReviewAction({
					action: 'copy',
					granularity: e.detail.granularity,
				});
			}}
			@review-cancel=${this.handleCancelMode}
			@review-discard=${() => {
				// Clamp content overflow during the results→plain-view swap so the panel doesn't jump.
				this.suppressContentOverflow();
				this._workflow.review.discard();
			}}
			@review-refine=${(e: CustomEvent<{ prompt?: string }>) => {
				// Same model gate as the initial run. A follow-up continues the conversation that
				// produced the current findings against the same scope — in the ready state the
				// scope picker isn't mounted, so `panel.selectedIds` is undefined and `runReview`
				// falls back to the stored scope.
				if (this._state.aiModel.get() == null) {
					this._actions.switchAIModel('review');
					return;
				}

				const panel = this.findReviewModePanel();
				const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
				this._workflow.runReview(
					this.effectiveRepoPath,
					e.detail?.prompt,
					excludedFiles,
					this.getCurrentScopeFilesCount(),
					panel?.selectedIds,
					scopeItems ?? undefined,
					{ mode: 'refine' },
				);
			}}
			@scope-change=${(e: CustomEvent<{ selectedIds: string[] }>) =>
				this.handleScopeChange(scopeItems, new Set(e.detail.selectedIds))}
			@load-more=${() => void this._actions.loadMoreBranchCommits(this.effectiveRepoPath)}
			@file-open=${this.handleReviewFileOpen}
			@scope-open-multi-diff=${this.handleScopeOpenMultiDiff}
			@file-stage=${this.handleFileStage}
			@file-unstage=${this.handleFileUnstage}
			@file-compare-working=${this.handleFileCompareWorking}
			@file-open-on-remote=${this.handleFileOpenOnRemote}
			@change-files-layout=${this.handleChangeFilesLayout}
		></gl-details-review-mode-panel>`;
	}

	private renderResolveMode() {
		const wip = this._state.wip.get();
		// Conflicted files carry a marker count in the WIP detail (`CommitFileChange.conflictMarkers`).
		const conflictedFiles = wip?.changes?.files?.filter(f => f.conflictMarkers != null);

		// Registry entry is the source of truth for execState; the resource is a projection of the
		// engaged anchor's result (mirrors renderReviewMode/renderComposeMode).
		const resolveEntry =
			this.engagedRunningOperation?.kind === 'resolve' ? this.engagedRunningOperation : undefined;
		const resolveResource = this._actions.resources.resolve;
		const resolveValue = resolveEntry?.result ?? resolveResource.value.get();
		const resolveData = resolveValue && 'result' in resolveValue ? resolveValue.result : undefined;
		const resolveError =
			(resolveValue && 'error' in resolveValue ? resolveValue.error.message : undefined) ??
			resolveResource.error.get();
		// The run feed is host-wide (one session per repo, any repo) — scope it to the anchor this panel is
		// showing so another repo's rebase can't take over this panel.
		const run = this._state.autoRebaseRun.get();
		const autoRebaseRun = run != null && run.repoPath === this.effectiveRepoPath ? run : undefined;

		const mappedStatus: 'idle' | 'loading' | 'ready' | 'error' | 'applying' = this._state.resolveApplying.get()
			? 'applying'
			: resolveEntry?.execState === 'generating'
				? 'loading'
				: resolveData != null
					? 'ready'
					: resolveError != null
						? 'error'
						: 'idle';

		return html`<gl-details-resolve-mode-panel
			.status=${mappedStatus}
			.errorMessage=${resolveError}
			.resolutions=${resolveData?.resolutions}
			.errors=${resolveData?.errors}
			.skipped=${resolveData?.skipped}
			.conflictedFiles=${conflictedFiles}
			.focusedPaths=${resolveEntry?.focusedFilePaths ?? this._state.resolveFocusedFilePaths.get()}
			.repoPath=${this.effectiveRepoPath}
			.fileLayout=${this._state.preferences.get()?.files?.layout ?? 'auto'}
			.progressMessage=${this._state.resolveProgressMessage.get()}
			.aiModel=${this._state.aiModel.get()}
			.retryingFiles=${this._state.resolveRetryingFiles.get()}
			.stagingFiles=${this._state.resolveStagingFiles.get()}
			.lastPrompt=${resolveEntry?.prompt}
			.refineMode=${resolveEntry?.refineMode ?? false}
			.refineDraft=${resolveEntry?.refineDraft}
			.canResumeAutoRebase=${resolveData?.autoRebase != null}
			.autoRebaseRun=${autoRebaseRun}
			@auto-rebase-cancel=${() => {
				// The run's own repo, not the panel anchor — cancelling has to hit the session that is
				// actually running even if the anchor drifted while it ran.
				if (autoRebaseRun == null) return;

				void this._actions.cancelAutoRebase(autoRebaseRun.repoPath);
			}}
			@auto-rebase-exit=${() => {
				// The abort restored the branch, so there's nothing left to review — leave resolve mode
				// entirely rather than sit on an outcome panel. The service's own toast reports the result.
				this._workflow.exitMode(this.currentSelection());
			}}
			@resolve-run=${(e: CustomEvent<{ prompt?: string }>) => {
				// Same model gate as compose/review — open the picker first when no model is set.
				if (this._state.aiModel.get() == null) {
					this._actions.switchAIModel('resolve');
					return;
				}

				// Scope the run to the idle tree's checked set (undefined = all conflicts). `null` means
				// bail — panel missing or nothing checked (the idle input is also disabled at zero checked,
				// so this is defense-in-depth for the curated-set invariant). The optional pre-run guidance
				// is mapped to the resolver's `userGuidance`, same as the whole-run Refine feedback.
				const run = this.getResolveRunScope();
				if (run == null) return;

				this._workflow.runResolve(this.effectiveRepoPath, run.scope, e.detail?.prompt);
			}}
			@resolve-view-diff=${(e: CustomEvent<{ filePath: string }>) =>
				this.handleResolveViewDiff(e.detail.filePath)}
			@resolve-open-file=${(e: CustomEvent<{ filePath: string }>) =>
				this.handleResolveOpenFile(e.detail.filePath)}
			@resolve-apply-all=${() => void this._workflow.resolve.applyResolutions()}
			@resolve-apply-and-resume=${() => void this.handleResolveApplyAndResume()}
			@resolve-discard=${() => {
				// Clamp the content height during the results→plain-WIP swap so it doesn't jump,
				// matching compose/review discard.
				this.suppressContentOverflow();
				this._workflow.resolve.discard();
			}}
			@resolve-cancel=${this.handleCancelMode}
			@resolve-error-back=${() => this._workflow.resolve.backFromError()}
			@resolve-error-retry=${() => this._workflow.resolve.retryFromError()}
			@resolve-refine=${(e: CustomEvent<{ prompt?: string }>) => {
				// Whole-run refine: re-resolve the same scope that produced the current plan (stored in
				// `resolveFocusedFilePaths` by the run), with the feedback as global guidance — so refine
				// doesn't silently widen back to all conflicts after the user resolved a subset.
				if (this._state.aiModel.get() == null) {
					this._actions.switchAIModel('resolve');
					return;
				}

				this._workflow.runResolve(
					this.effectiveRepoPath,
					resolveEntry?.focusedFilePaths ?? this._state.resolveFocusedFilePaths.get(),
					e.detail?.prompt,
				);
			}}
			@resolve-retry-file=${(e: CustomEvent<{ filePath: string; prompt: string }>) =>
				void this._workflow.resolve.retryFile(e.detail.filePath, e.detail.prompt)}
			@resolve-take-side=${(e: CustomEvent<{ filePath: string; side: ConflictSide }>) =>
				void this._workflow.resolve.takeSide(e.detail.filePath, e.detail.side)}
			@change-files-layout=${this.handleChangeFilesLayout}
		></gl-details-resolve-mode-panel>`;
	}

	/** The resolve run scope from the idle tree's checked set, or `null` to bail (panel missing /
	 *  nothing checked). Mirrors compose's `this.querySelector` panel lookup — resolve renders directly
	 *  in the panel template. When EVERY conflict is checked the scope is `undefined` ("resolve all")
	 *  rather than a frozen full list — that preserves the host's `resolveAll` telemetry detail and lets
	 *  a later Refine pick up conflicts that appear after the run; a strict subset returns its paths. */
	private getResolveRunScope(): { scope: readonly string[] | undefined } | null {
		const panel = this.querySelector<GlDetailsResolveModePanel>('gl-details-resolve-mode-panel');
		if (panel == null) return null;

		const checked = panel.includedFiles;
		if (checked.size === 0) return null;

		const total = panel.conflictedFiles?.length ?? 0;
		return { scope: checked.size === total ? undefined : [...checked] };
	}

	/** Apply the escalation-seeded resolutions, then hand the rest of the rebase back to AI (takeover).
	 *  Sequenced — apply stages the resolved step first so the resumed automation continues it. */
	private async handleResolveApplyAndResume(): Promise<void> {
		// Capture before applying — apply forgets resolve mode, which can change `effectiveRepoPath`.
		const repoPath = this.effectiveRepoPath;
		await this._workflow.resolve.applyResolutions();
		if (repoPath == null) return;

		void this._actions.resumeAutoRebase(repoPath);
	}

	/** Open a resolved file's AI-resolved-vs-conflicted diff (virtual FS, no disk write). */
	private handleResolveViewDiff(filePath: string): void {
		const value =
			(this.engagedRunningOperation?.kind === 'resolve' ? this.engagedRunningOperation.result : undefined) ??
			this._actions.resources.resolve.value.get();
		const resolution =
			value && 'result' in value ? value.result.resolutions.find(r => r.filePath === filePath) : undefined;
		if (resolution?.virtualRef == null) return;

		const file = this._state.wip.get()?.changes?.files?.find(f => f.path === filePath);
		if (file == null) return;

		this._actions.openResolutionDiff(file, resolution.virtualRef);
	}

	/** Open a conflicted file from the resolve panel's idle list — working tree, so the user can
	 *  inspect the conflict markers before running an AI resolution. The explicit uncommitted ref
	 *  routes the host through its WIP fast path (`makeWipRef`), which stays reliable for
	 *  secondary worktrees where `getCommit(uncommitted)` may not be hydrated. */
	private handleResolveOpenFile(filePath: string): void {
		const file = this._state.wip.get()?.changes?.files?.find(f => f.path === filePath);
		if (file == null) return;

		this._actions.openFile(file, { ref: uncommitted });
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

	/** Opens the idle curation tree's files as a multi-diff in the scope's reference frame. */
	private handleScopeOpenMultiDiff = (e: CustomEvent<{ files: readonly GitFileChangeShape[] }>) => {
		const endpoints = getReviewDiffEndpoints(this._state.scope.get());
		const repoPath = this.effectiveRepoPath;
		if (!endpoints || !repoPath || !e.detail.files.length) return;

		// The multi-diff action resolves the working tree from `rhs === ''` (the per-file
		// diffWith path accepts `uncommitted`, this one doesn't).
		this._actions.openMultipleChanges({
			files: e.detail.files,
			repoPath: repoPath,
			lhs: endpoints.lhs,
			rhs: endpoints.rhs === uncommitted ? '' : endpoints.rhs,
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
		const panel = this.findReviewModePanel();
		panel?.setFocusAreaLoading(focusAreaId);

		const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;

		const startedAt = performance.now();
		const aiContext = this._actions.buildAIModelTelemetryContext();

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

			const duration = performance.now() - startedAt;
			if ('error' in result && result.error) {
				panel?.setFocusAreaError(focusAreaId);
				this._actions.sendTelemetryEvent('graphDetails/review/generateFocusArea/failed', {
					...aiContext,
					duration: duration,
				});
			} else if ('result' in result && result.result) {
				this._workflow.review.enrichFocusAreaFindings(focusAreaId, result.result);
				panel?.updateFocusAreaFindings(focusAreaId, result.result);
				const counts = countReviewFindingSeverities(result.result.findings);
				this._actions.sendTelemetryEvent('graphDetails/review/generateFocusArea/completed', {
					...aiContext,
					duration: duration,
					'findings.count': result.result.findings.length,
					'findings.severity.critical.count': counts.critical,
					'findings.severity.warning.count': counts.warning,
					'findings.severity.suggestion.count': counts.suggestion,
				});
			}
		} catch {
			panel?.setFocusAreaError(focusAreaId);
			this._actions.sendTelemetryEvent('graphDetails/review/generateFocusArea/failed', {
				...aiContext,
				duration: performance.now() - startedAt,
			});
		}
	}

	private async handleReviewSendToChat(e: CustomEvent<ReviewSendToChatDetail>): Promise<void> {
		const repoPath = this.effectiveRepoPath;
		if (!repoPath) return;

		const { granularity, scopeLabel, reviewMarkdown } = e.detail;
		if (!reviewMarkdown) return;

		this._actions.sendTelemetryEvent('graphDetails/review/sentToAgent', { granularity: granularity });

		await this._actions.services.graphInspect.addressReviewFindingsInChat({
			repoPath: repoPath,
			scopeLabel: scopeLabel,
			reviewMarkdown: reviewMarkdown,
			granularity: granularity,
		});
	}

	private handleSelectCommit(sha: string) {
		this.dispatchEvent(new CustomEvent('select-commit', { detail: { sha: sha }, bubbles: true, composed: true }));
	}

	private handleRefreshWip = () => {
		// The WIP refresh button must run a genuinely fresh `git status` — route through
		// `refetchWipQuiet(force=true)` which bypasses the host's `_wipStatusCache` and reseeds
		// both the panel's file list AND the header/row WIP status. The old path
		// (`refreshWip()` + `fetchDetails()`) hit the cache-hit branch and re-applied a possibly
		// stale cached value — the button appeared to do nothing.
		const repoPath = this.effectiveRepoPath;
		if (this.isWip && repoPath != null) {
			void this._actions.refetchWipQuiet(repoPath, true);
		} else {
			this._actions.refreshWip();
			void this._actions.fetchDetails(this.sha, this.repoPath, this.graphReachability);
		}
	};

	private handleRefreshCommit = () => {
		// Mirror of the WIP refresh button for a single commit — `refetchCommitQuiet` resets the
		// `fetchDetails` dedup key so a same-selection click always re-queries the host.
		const repoPath = this.effectiveRepoPath;
		if (repoPath == null || this.sha == null) return;

		void this._actions.refetchCommitQuiet(this.sha, repoPath, this.graphReachability, this.commitLite);
	};

	private trackWipAction(action: GraphWipAction): void {
		this._actions.sendTelemetryEvent('graph/wip/action', { action: action });
	}

	private handleSwitchBranch = () => {
		this.trackWipAction('switchBranch');
		this._actions.switchBranch(this.effectiveRepoPath);
	};

	private handleCreateBranch = () => {
		this.trackWipAction('createBranch');
		this._actions.createBranch(this.effectiveRepoPath);
	};

	private handlePublishBranch = () => {
		this.trackWipAction('publishBranch');
		void this._actions.services.repository.publishBranch(this.effectiveRepoPath!);
	};

	private handlePull = () => {
		this.trackWipAction('pull');
		void this._actions.services.repository.pull(this.effectiveRepoPath!);
	};

	private handlePush = () => {
		this.trackWipAction('push');
		void this._actions.services.repository.push(this.effectiveRepoPath!);
	};

	private handleForcePush = () => {
		this.trackWipAction('forcePush');
		void this._actions.services.repository.push(this.effectiveRepoPath!, true);
	};

	private handleFetch = () => {
		this.trackWipAction('fetch');
		void this._actions.services.repository.fetch(this.effectiveRepoPath!);
	};

	private handleCreatePullRequest = () => {
		this.trackWipAction('createPullRequest');
		this._actions.createPullRequest(this.effectiveRepoPath);
	};

	private handleCreatePullRequestWithAI = () => {
		this.trackWipAction('createPullRequestWithAI');
		this._actions.createPullRequest(this.effectiveRepoPath, { describeWithAI: true });
	};

	private handleShareWipAsCloudPatch = () => {
		this.trackWipAction('shareAsCloudPatch');
		void this._actions.services.commands.executeScoped('gitlens.shareWipAsCloudPatch:graph', {
			repoPath: this.effectiveRepoPath,
		});
	};

	private handleRebaseOntoMergeTarget = () => {
		this.trackWipAction('rebaseOntoMergeTarget');
		this._actions.rebaseOntoMergeTarget();
	};

	private handleMergeMergeTargetIntoCurrent = () => {
		this.trackWipAction('mergeMergeTarget');
		this._actions.mergeMergeTargetIntoCurrent();
	};

	private handleReviewBranchChanges = () => this.enterBranchWorkMode('review');

	private handleRecomposeBranchChanges = () => this.enterBranchWorkMode('compose');

	/** Shared entry for the empty-WIP "Review Changes" / "Recompose Branch" next-steps and the
	 *  idle-state "Review Branch" / "Recompose Branch" buttons. Opens the mode against the
	 *  current WIP selection — the workflow's `buildDefaultScope` produces the initial commit
	 *  selection; the user can refine it from the picker. */
	private enterBranchWorkMode(mode: 'review' | 'compose'): void {
		this.suppressContentOverflow();
		this._workflow.toggleMode(mode, this.currentSelection());
	}

	private handleRemoveAssociatedIssue = (e: CustomEvent<{ entityId: string }>) =>
		void this._actions.removeAssociatedIssue(e.detail.entityId);

	/** In the graph, a pull request chip opens the graph's own sheet rather than the host's pull request
	 *  view — the sheet is right here, and leaving the graph to read a pull request costs the user their
	 *  place. Without an id there's nothing to resolve, so those fall back to the host action.
	 *
	 *  `push` rides along when a sheet is already open: with a sheet mounted the details content is
	 *  covered, so the chip can only have been clicked INSIDE that sheet — a drill-down, which stacks
	 *  rather than replaces, and whose close returns to the sheet it came from. */
	private handleOpenPullRequestDetails = (e: CustomEvent<{ id: string; providerId: string | undefined }>) => {
		if (!e.detail.id) {
			this._actions.openPullRequestDetails(undefined, e.detail.providerId);
			return;
		}

		this.dispatchEvent(
			new CustomEvent('gl-graph-show-pr-sheet', {
				detail: { number: e.detail.id, push: this._sheetStack.length > 0 },
				bubbles: true,
				composed: true,
			}),
		);
	};

	private handleStashSave = (e: CustomEvent<{ onlyStaged?: boolean; files?: FileChangeListItemDetail['files'] }>) => {
		// Toolbar Stash with a multi-selection carries the selected files (same path as the inline
		// `file-stash` batch action); otherwise it's the scope action (`onlyStaged` staged-vs-all).
		if (e.detail?.files?.length) {
			this.trackWipAction('stashSaveFiles');
			this._actions.stashFiles([...e.detail.files]);
		} else {
			this.trackWipAction(e.detail?.onlyStaged ? 'stashSaveStaged' : 'stashSave');
			this._actions.stashSave(this.effectiveRepoPath, e.detail?.onlyStaged);
		}
	};

	private handleStartWork = (e: CustomEvent<{ showOpenInAgent?: 'ask' | 'manual' | 'agent' } | undefined>) => {
		this.trackWipAction('startWork');
		this._actions.startWork(e.detail?.showOpenInAgent);
	};

	private handleStartReview = (e: CustomEvent<{ showOpenInAgent?: 'ask' | 'manual' | 'agent' } | undefined>) => {
		this.trackWipAction('startReview');
		this._actions.startPRReview(e.detail?.showOpenInAgent);
	};

	private handleApplyStash = () => {
		this.trackWipAction('applyStash');
		this._actions.applyStash(this.effectiveRepoPath);
	};

	private handleNewWorktree = () => {
		this.trackWipAction('createWorktree');
		this._actions.createWorktree();
	};

	private handleRefreshLaunchpad = (): void => {
		this._launchpadState?.refresh();
	};

	private handleCompareWithMergeTarget = (e: CustomEvent<{ leftRef: string; leftRefType: 'branch' | 'commit' }>) => {
		e.preventDefault();
		// The merge target is the Base of the comparison — forward it as `leftRef` so the
		// selection-derived `rightRef` (the user's current branch / WIP / commit) survives.
		// Previously this dispatched as `rightRef`, which clobbered the WIP-seeded right side
		// and let `initCompareDefaults` fill `leftRef` from the same merge target — producing a
		// degenerate `mergeTarget ↔ mergeTarget` self-comparison.
		this._workflow.openCompare(this.currentSelection(), {
			leftRef: e.detail.leftRef,
			leftRefType: e.detail.leftRefType,
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
		this._actions.sendTelemetryEvent('graph/wip/commit/amendToggled', {
			enabled: e.detail.checked,
			hasMessage: this._state.commitMessage.get().length > 0,
		});
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

	private handleGenerateMessage = () => this._workflow.runGenerateMessage(this.effectiveRepoPath);

	/** {@link DetailsWorkflowHost.applyGeneratedCommitMessage} — land a settled generation. If the
	 *  originating WIP is still selected with no mode owning the form, write the live input; otherwise
	 *  (navigated away, or a mode owns it) write the worktree's draft slot so `loadWipDraft` / mode-exit
	 *  restores it without clobbering the current selection. Mirrors `setCommitMessage`'s guards. */
	applyGeneratedCommitMessage(repoPath: string, message: string): void {
		if (this.isWip && this._state.activeMode.get() == null && this.effectiveRepoPath === repoPath) {
			// AI output is the user's intentional generation — mark dirty so HEAD-move auto-clear keeps it.
			this._state.commitMessage.set(message);
			this._state.commitMessageDirty.set(true);
			return;
		}

		const existing = this._graphState?.wipDrafts?.[repoPath];
		this.persistWipDraft(repoPath, { message: message, messageDirty: true, amend: existing?.amend });
	}

	/** {@link DetailsWorkflowHost.readEngagedRefineState} — read the live compose/resolve panel's
	 *  ready-state Refine posture + unsubmitted draft, so the controller can persist them onto the
	 *  engaged entry on mode-leave. Returns undefined when no refine-capable panel is mounted. */
	readEngagedRefineState(): { refineMode: boolean; refineDraft: string } | undefined {
		const mode = this._state.activeMode.get();
		if (mode === 'compose') {
			const panel = this.querySelector<GlDetailsComposeModePanel>('gl-details-compose-mode-panel');
			return panel != null ? { refineMode: panel.refineModeLive, refineDraft: panel.refineDraftLive } : undefined;
		}
		if (mode === 'resolve') {
			const panel = this.querySelector<GlDetailsResolveModePanel>('gl-details-resolve-mode-panel');
			return panel != null ? { refineMode: panel.refineModeLive, refineDraft: panel.refineDraftLive } : undefined;
		}
		return undefined;
	}

	/** Derive the `generating` spinner from the registry for the current WIP. Reading `runningOperations`
	 *  registers a SignalWatcher dependency, so (driven from `willUpdate`) it re-derives on start/settle
	 *  and on selection change. */
	private refreshGeneratingForCurrentSelection(): void {
		const worktree = this.isWip ? this.effectiveRepoPath : undefined;
		const entry =
			worktree != null
				? this._crossPaneState?.runningOperations.get().get(anchorKey({ repoPath: worktree, sha: uncommitted }))
						?.generateMessage
				: undefined;
		this._state.generating.set(entry?.execState === 'generating');
	}

	private handleAddCoauthors = () => void this._actions.addCoauthors(this.effectiveRepoPath);

	private handleCompose = () => this._workflow.toggleMode('compose', this.currentSelection());

	/**
	 * Single-commit selection's ref + stash hint — `commitLite` carries `stashNumber` from the graph row.
	 *
	 * A WIP selection crosses into the git-revision domain here, so it must be the `uncommitted` REVISION,
	 * never a `wip::<path>` row id. Downstream file actions match the working tree by exact equality
	 * against `uncommitted`; a row id misses that and falls through to resolving it as a commit, which
	 * quietly finds nothing — the action then does nothing at all, with no error.
	 */
	private get currentRef(): { ref: string; stash?: boolean } | undefined {
		if (this.sha == null) return undefined;

		return {
			ref: isWipSelectionSha(this.sha) ? uncommitted : this.sha,
			stash: this.commitLite?.stashNumber != null,
		};
	}

	private handleFileOpen = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFile(e.detail, this.currentRef);
	};

	private handleFileOpenOnRemote = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileOnRemote(e.detail, this.currentRef);
	};

	private handleFileCompareWorking = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileCompareWorking(e.detail, this.currentRef);
	};

	private handleFileComparePrevious = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileComparePrevious(e.detail, this.currentRef);
	};

	private handleFileCompareWipChanges = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openFileCompareWipChanges(e.detail);
	};

	private handleFileMoreActions = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.executeFileAction(e.detail, this.currentRef);
	};

	private handleFileOpenConflictCurrent = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openConflictChanges(e.detail, 'current');
	};

	private handleFileOpenConflictIncoming = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.openConflictChanges(e.detail, 'incoming');
	};

	private handleOpenConflictDetails = (e: CustomEvent<FileChangeListItemDetail>) => {
		const detail = e.detail;
		const fileName = detail.path.split('/').pop() || detail.path;
		this.openSheet({ kind: 'conflict', detail: detail, fileName: fileName });
	};

	private handleCloseConflictDetails = () => {
		this.popSheet();
	};

	private handleCloseRebaseSummary = () => {
		this.popSheet();

		// The run opened Resolve mode as its progress surface, and this sheet is only reachable from that
		// run completing — so closing it means the review is done and the mode has nothing left to show
		// but a restatement of the summary. Leave it for the plain graph details.
		if (this._workflow != null && this._state.activeMode.get() === 'resolve') {
			this._workflow.exitMode(this.currentSelection());
		}
	};

	private handleRebaseSummaryViewDiff = (e: CustomEvent<RebaseSummaryViewDiffDetail>) => {
		const top = this._sheetStack.at(-1);
		if (top?.kind !== 'rebaseSummary') return;

		// The sheet owns the fetched summary now — query it directly rather than duplicating it here.
		const summary = this.querySelector('gl-rebase-summary-sheet')?.summary;
		const step = summary?.steps.find(s => s.step === e.detail.step);
		const file = step?.files.find(f => f.filePath === e.detail.filePath);
		if (file?.virtualRef == null) return;

		// The rebase is over, so the file has no WIP entry — a minimal shape suffices for the
		// virtual compare (it only reads repoPath + path).
		this._actions.openResolutionDiff({ repoPath: top.repoPath, path: file.filePath, status: 'M' }, file.virtualRef);
	};

	private handleConflictOpenChanges = (e: CustomEvent<ConflictSheetSideEventDetail>) => {
		const top = this._sheetStack.at(-1);
		if (top?.kind !== 'conflict') return;

		this._actions.openConflictChanges(top.detail, e.detail.side);
	};

	private handleConflictStage = (e: CustomEvent<ConflictSheetSideEventDetail>) => {
		const top = this._sheetStack.at(-1);
		if (top?.kind !== 'conflict') return;

		this._actions.stageConflictSide(top.detail.repoPath, top.detail.path, top.detail.status ?? '', e.detail.side);
	};

	private handleConflictOpenCommit = (e: CustomEvent<ConflictSheetCommitEventDetail>) => {
		const top = this._sheetStack.at(-1);
		if (top?.kind !== 'conflict') return;

		this._actions.openConflictCommit(top.detail.repoPath, top.detail.path, e.detail.sha);
	};

	private handleConflictOpenFile = () => {
		const top = this._sheetStack.at(-1);
		if (top?.kind !== 'conflict') return;

		this._actions.openFile(top.detail);
	};

	/** Header "Resolve Conflicts" — closes the sheet and enters resolve mode focused on this
	 *  one file (mirrors the paused-op banner's resolve, but scoped to the sheet's file). */
	private handleConflictResolveAi = () => {
		const top = this._sheetStack.at(-1);
		if (top?.kind !== 'conflict') return;

		const repoPath = top.detail.repoPath;
		const filePath = top.detail.path;

		// Drop the conflict entry wherever it sits (not just a plain pop) — removeKind can remove a
		// non-top entry in later phases.
		this.removeSheetKind('conflict');

		this.enterModeForWip('resolve', repoPath, uncommitted, [filePath]);
	};

	/** Per-row resolve action on a conflicted file — enters resolve mode focused on just that file (mirrors
	 *  {@link handleConflictResolveAi}, but sourced from the inline tree action's event detail). */
	private handleFileResolveConflict = (e: CustomEvent<FileChangeListItemDetail>) => {
		const { path, repoPath } = e.detail;
		if (!repoPath || !path) return;

		this.enterModeForWip('resolve', repoPath, uncommitted, [path]);
	};

	private handleFileStage = (e: CustomEvent<FileChangeListItemDetail>) => {
		// Batch fan-out (multi-selection) carries the full set; one atomic `git add` avoids index-lock
		// contention from N concurrent single-file stages.
		if (e.detail.files?.length) {
			this._actions.stageFiles([...e.detail.files]);
		} else {
			this._actions.stageFile(e.detail);
		}
	};

	private handleFileUnstage = (e: CustomEvent<FileChangeListItemDetail>) => {
		if (e.detail.files?.length) {
			this._actions.unstageFiles([...e.detail.files]);
		} else {
			this._actions.unstageFile(e.detail);
		}
	};

	private handleFileDiscard = (e: CustomEvent<FileChangeListItemDetail>) => {
		// Batch inline discard (multi-selection) carries the full set; one combined confirm + discard.
		if (e.detail.files?.length) {
			this._actions.discardFiles([...e.detail.files]);
		} else {
			this._actions.discardFile(e.detail);
		}
	};

	private handleFileStash = (e: CustomEvent<FileChangeListItemDetail>) => {
		if (e.detail.files?.length) {
			this._actions.stashFiles([...e.detail.files]);
		} else {
			this._actions.stashFile(e.detail);
		}
	};

	private handleDiscardUnstaged = () => {
		this._actions.discardUnstagedFiles(this.effectiveRepoPath);
	};

	private handleDiscardStaged = () => {
		this._actions.discardStagedFiles(this.effectiveRepoPath);
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

	private handleCopyWipPatch = (e: CustomEvent<CopyWipPatchEventDetail>) => {
		this.trackWipAction('copyPatch');
		this._actions.copyWipPatchToClipboard(e.detail.repoPath, e.detail.scope, e.detail.uris);
	};

	private handleCopyCommitPatch = (e: CustomEvent<CopyCommitPatchEventDetail>) => {
		this._actions.copyCommitPatchToClipboard(e.detail.repoPath, e.detail.to, e.detail.from);
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
