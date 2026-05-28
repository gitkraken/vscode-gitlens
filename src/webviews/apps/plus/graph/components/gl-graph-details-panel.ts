import type { Remote } from '@eamodio/supertalk';
import { consume, provide } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getAltKeySymbol } from '@env/platform.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { StashApplyCommandArgs } from '../../../../../commands/stashApply.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { StoredGraphWipDraft } from '../../../../../constants.storage.js';
import type { GraphDetailsMode } from '../../../../../constants.telemetry.js';
import type { CommitDetails } from '../../../../commitDetails/protocol.js';
import type { Wip } from '../../../../plus/graph/detailsProtocol.js';
import type { GraphServices, VirtualRefShape } from '../../../../plus/graph/graphService.js';
import {
	getSecondaryWipPath,
	isSecondaryWipSha,
	isWipSha,
	UpdateWipDraftCommand,
} from '../../../../plus/graph/protocol.js';
import type { FileChangeListItemDetail } from '../../../commitDetails/components/gl-details-base.js';
import type { OpenMultipleChangesArgs } from '../../../shared/actions/file.js';
import type { AgentSessionCategory } from '../../../shared/agentUtils.js';
import { agentPhaseToCategory, matchAgentSessionsForWorktree } from '../../../shared/agentUtils.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import { ModifierKeysController } from '../../../shared/controllers/modifier-keys.js';
import { graphServicesContext, graphStateContext } from '../context.js';
import type { GraphCrossPaneState } from '../graphCrossPaneState.js';
import { graphCrossPaneContext } from '../graphCrossPaneState.js';
import { anchorKey } from './anchorKey.js';
import type { DetailsActions } from './detailsActions.js';
import { getReviewDiffEndpoints, scopeSelectionEqual } from './detailsActions.js';
import { detailsActionsContext, detailsStateContext, detailsWorkflowContext } from './detailsContext.js';
import { resolveDetailsActions } from './detailsResolver.js';
import type { DetailsContext, DetailsState, RunningOperation, RunningOperationExecState } from './detailsState.js';
import { createDetailsState } from './detailsState.js';
import type { DetailsSelection } from './detailsWorkflowController.js';
import { DetailsWorkflowController } from './detailsWorkflowController.js';
import type { ExpandState, GlDetailsAgentStatus } from './gl-details-agent-status.js';
import { expandVisibleCategories } from './gl-details-agent-status.js';
import type { FileCompareBetweenDetail } from './gl-details-compare-mode-panel.js';
import type {
	ReviewAnalyzeAreaDetail,
	ReviewCopiedDetail,
	ReviewOpenFileDetail,
	ReviewSendToChatDetail,
} from './gl-details-review-mode-panel.js';
import '../../../commitDetails/components/gl-details-commit-panel.js';
import '../../../commitDetails/components/gl-details-wip-panel.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/split-panel/split-panel.js';
import './gl-details-multicommit-panel.js';
import './gl-details-compose-mode-panel.js';
import './gl-details-review-mode-panel.js';
import './gl-commit-box.js';
import './gl-details-compare-mode-panel.js';
import './gl-details-wip-empty-pane.js';
import './gl-details-wip-header.js';

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

declare global {
	interface GlobalEventHandlersEventMap {
		'gl-graph-details-mode-changed': CustomEvent<{
			previous: GraphDetailsMode;
			current: GraphDetailsMode;
		}>;
	}
}

@customElement('gl-graph-details-panel')
export class GlGraphDetailsPanel extends SignalWatcher(LitElement) {
	@consume({ context: graphServicesContext, subscribe: true })
	@state()
	private _remoteServices?: Remote<GraphServices>;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: typeof graphStateContext.__context__;

	@consume({ context: ipcContext })
	private _ipc?: typeof ipcContext.__context__;

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
		if (mode !== 'review' && mode !== 'compose') return undefined;

		const ctx = this._state.activeModeContext.get();
		const isLockedCommit = ctx === 'commit' || ctx === 'multicommit';
		const key = isLockedCommit
			? anchorKey({
					sha: this._state.activeModeSha.get(),
					shas: this._state.activeModeShas.get(),
					repoPath: this._state.activeModeRepoPath.get(),
				})
			: anchorKey({ sha: this.sha, shas: this.shas, repoPath: this.repoPath });
		return this._crossPaneState?.runningOperations.get().get(key)?.[mode];
	}

	/** Per-mode exec state + has-result of the engaged anchor's entry — drives the suffix-icon
	 *  status overlay on the compose/review header toggle chips (parallel to the WIP-row
	 *  adornment). `hasResult` separates a `'backed'` entry with a viewable result (Restart from
	 *  success) from a `'backed'`-no-result placeholder (cancelled / first-error Go Back) so the
	 *  chip doesn't falsely claim a result exists. For a toggled-out mode with a still-running
	 *  entry, this reads from the current selection's anchor so the chip overlay continues to
	 *  reflect the registry. */
	private get engagedModeStatus():
		| Partial<Record<'review' | 'compose', { execState: RunningOperationExecState; hasResult: boolean }>>
		| undefined {
		const ctx = this._state.activeModeContext.get();
		const isLockedCommit = ctx === 'commit' || ctx === 'multicommit';
		const key = isLockedCommit
			? anchorKey({
					sha: this._state.activeModeSha.get(),
					shas: this._state.activeModeShas.get(),
					repoPath: this._state.activeModeRepoPath.get(),
				})
			: anchorKey({ sha: this.sha, shas: this.shas, repoPath: this.repoPath });
		const bucket = this._crossPaneState?.runningOperations.get().get(key);
		if (bucket == null) return undefined;

		const out: Partial<Record<'review' | 'compose', { execState: RunningOperationExecState; hasResult: boolean }>> =
			{};
		if (bucket.review != null) {
			out.review = { execState: bucket.review.execState, hasResult: bucket.review.result != null };
		}
		if (bucket.compose != null) {
			out.compose = { execState: bucket.compose.execState, hasResult: bucket.compose.result != null };
		}
		return out.review != null || out.compose != null ? out : undefined;
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

	private _lastPushedWip?: unknown;
	private _lastBranchState?: unknown;

	/** User's dragged splitter position (1-99 %) for the agents/WIP split in `expanded` mode.
	 *  Set only by pointer drag (see {@link _onAgentStatusSplitChange} / {@link _onAgentStatusSplitDragEnd});
	 *  ResizeObserver / keyboard-driven `gl-split-panel-change` events deliberately don't write
	 *  here so a container resize never silently latches the user-size mode. Cleared by the sash
	 *  dbl-click reset; preserved across collapse cycles so re-expanding (chevron, WIP indicator,
	 *  sidebar/kanban select) restores the user's last chosen size. `undefined` means "use the
	 *  default expanded position" — see {@link agentStatusDefaultPct}. */
	@state()
	private _agentStatusSplitPosition?: number;

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
		// Only persist user drag while in `expanded` — collapsed/partial render via fit-content,
		// not the position attribute, so writes there would silently overwrite the expanded-mode
		// position with a value that never even drove a render.
		if (this.agentStatusExpand !== 'expanded') return;

		// Gate on `dragging` — this event also fires from split-panel's internal ResizeObserver
		// (container resize) and keyboard nudges; recording those would clobber the user's
		// intended size with whatever the layout engine just computed. The `dragging` attribute
		// is the host's source of truth for "pointer is down on the divider". `drag-end` is the
		// fallback for the final value when the change event misses it.
		const splitPanel = e.currentTarget;
		if (!(splitPanel instanceof HTMLElement) || !splitPanel.hasAttribute('dragging')) return;

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

	private get isMultiCommit(): boolean {
		return this.shas != null && this.shas.length >= 2;
	}

	private get isWip(): boolean {
		return isWipSha(this.sha);
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

	/** Returns the effective context, respecting mode lock when active. */
	private get effectiveContext(): DetailsContext {
		return (
			this._state.activeModeContext.get() ?? (this.isMultiCommit ? 'multicommit' : this.isWip ? 'wip' : 'commit')
		);
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
		const repoId = this._graphState?.selectedRepository;
		const repos = this._graphState?.repositories;
		if (repoId != null) {
			const found = repos?.find(r => r.id === repoId)?.path;
			if (found != null) return found;
		}
		return repos?.[0]?.path;
	}

	/** Shared `@toggle-mode` handler — every sub-panel's toggle-mode wires to this. Compose/review
	 *  toggle the panel mode; compare opens the sheet (it's no longer a mode). */
	private handleToggleMode = (e: CustomEvent<{ mode: 'review' | 'compose' | 'compare' }>): void => {
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
		if (mode !== 'review' && mode !== 'compose') return;

		this.suppressContentOverflow();
		this._workflow.cancelOperation(mode);
	};

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

	/** Maps a graph-row sha to the worktree fsPath it represents. For the primary WIP
	 *  (sha === `uncommitted`) the worktree path is the active repo path; for secondary
	 *  worktree WIPs the path is embedded in the synthetic sha by `createSecondaryWipSha`. */
	private computeWorktreePathFromSha(sha: string | undefined): string | undefined {
		if (sha == null) return undefined;
		if (sha === uncommitted) return this.effectiveRepoPath;
		if (isSecondaryWipSha(sha)) return getSecondaryWipPath(sha);
		return undefined;
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
		this._state.generating.set(false);

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

		// Optimistically mirror the flush into local `wipDrafts` state so the next loadWipDraft
		// (e.g., when the user swaps off this WIP row and back within the same session) sees the
		// just-written draft without waiting for a host state push. Routes through `setWipDraft`
		// so the provider's internal `_state.wipDrafts` snapshot stays in sync alongside the
		// signal accessor; the host's storage write below is the source of truth for
		// cross-session restore.
		this._graphState?.setWipDraft(pending.worktreePath, pending.draft);

		this._ipc?.sendCommand(UpdateWipDraftCommand, {
			worktreePath: pending.worktreePath,
			draft: pending.draft,
		});
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
	enterModeForWip(mode: 'compose' | 'review', repoPath: string, sha: string): void {
		if (this._workflow == null) return;

		this.suppressContentOverflow();
		const selection: DetailsSelection = {
			...this.currentSelection(),
			sha: sha,
			shas: undefined,
			repoPath: repoPath,
		};
		// Compare by full anchor key so primary↔secondary WIP re-clicks (which differ only in
		// `repoPath` after both collapse to a `wip|...` key) stay distinct.
		const engaged = anchorKey({
			sha: this._state.activeModeSha.get(),
			shas: this._state.activeModeShas.get(),
			repoPath: this._state.activeModeRepoPath.get(),
		});
		if (this._state.activeMode.get() === mode && engaged === anchorKey(selection)) return;

		this._workflow.toggleMode(mode, selection);
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
		// Switch-model is shared by both the review-mode and compose-mode chips in this panel
		// — derive the scope from the active mode so each surface writes to its own scoped
		// Memento key. Falls back to the global default when no mode is active (e.g., when
		// the chip is shown elsewhere).
		const mode = this._state.activeMode.get();
		const scope = mode === 'compose' || mode === 'review' ? mode : undefined;
		this._actions?.switchAIModel(scope);
	};

	private readonly _contextMenuProxy = new ContextMenuProxyController(this);
	private readonly _modifiers = new ModifierKeysController(this);
	/** Timers stored so `disconnectedCallback` can cancel them — otherwise a fast open/close
	 *  cycle leaves the callback firing on a detached element with `style.overflow = ''` (no
	 *  crash, but leaks DOM references for the timer's lifetime and stacks under rapid toggling). */
	private _suppressContentOverflowTimer?: ReturnType<typeof setTimeout>;
	private _suppressModePanelOverflowTimer?: ReturnType<typeof setTimeout>;
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

	/** Clamps the mode panel host's `overflow` to `hidden` for ~250ms so the transient
	 *  scrollbar that appears during an in-mode anchor switch (new scope picker / loading
	 *  placeholders briefly overflow before settling) can't reflow content width and read as
	 *  a panel "jump". `.suppressContentOverflow()` above clamps `.details-content` in the
	 *  *light DOM*; the mode panel's own `:host` scrollbar (its shadow root) doesn't honor
	 *  that, so it gets its own inline-style clamp here. Pierces shadow DOM because the mode
	 *  panel can render directly in light DOM (WIP anchor) or nested inside the commit panel's
	 *  shadow root (commit/multicommit anchor's `subPanelContent`). */
	private suppressModePanelOverflow(): void {
		const panel = this.findModePanelDeep(this);
		if (panel == null) return;

		panel.style.overflow = 'hidden';
		clearTimeout(this._suppressModePanelOverflowTimer);
		this._suppressModePanelOverflowTimer = setTimeout(() => {
			this._suppressModePanelOverflowTimer = undefined;
			if (this.isConnected) {
				panel.style.overflow = '';
			}
		}, 250);
	}

	private findModePanelDeep(root: ParentNode | ShadowRoot, depth = 0): HTMLElement | null {
		if (depth > 6) return null;

		const here = root.querySelector<HTMLElement>('gl-details-review-mode-panel, gl-details-compose-mode-panel');
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
		clearTimeout(this._suppressContentOverflowTimer);
		this._suppressContentOverflowTimer = undefined;
		clearTimeout(this._suppressModePanelOverflowTimer);
		this._suppressModePanelOverflowTimer = undefined;
		// Flush rather than cancel — closing the webview within the debounce window after a
		// commit (which sets message='' + amend=false) would otherwise drop the `draft: null`
		// IPC, leaving the just-committed message stale in the memento.
		this.flushPendingWipDraftNow();
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
			if (activeMode === 'review' || activeMode === 'compose') {
				this.suppressModePanelOverflow();
				this._workflow.switchAnchorWithinMode(this.currentSelection());
			} else if (activeMode == null && this.isWip) {
				// Auto-restore is gated to WIP rows: WIP has a stable identity (the branch's
				// working changes) so resuming compose/review there is meaningful. Commit rows
				// are point-in-time snapshots — re-clicking a commit shouldn't ambient-enter
				// review just because the user reviewed it earlier in the session.
				const remembered = this._workflow.getRememberedMode(this.currentSelection());
				if (remembered != null) {
					this.suppressModePanelOverflow();
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
				this._workflow.review.invalidateErrorRecovery();
				this._workflow.compose.invalidateErrorRecovery();

				// `changedProperties.get(k)` returns the previous value only when `k` actually
				// changed; otherwise fall back to the current value (the prior selection had
				// the same value, by definition).
				const prevSha = changedProperties.has('sha')
					? (changedProperties.get('sha') as string | undefined)
					: this.sha;
				const prevWasWip = isWipSha(prevSha);
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

			// Land caret in the AI input when the user enters compose/review. Defer one frame so
			// the mode panel has rendered. Only fires on a fresh transition INTO the mode (not on
			// re-renders within the mode), so it doesn't fight the user's own focus moves.
			if (currentMode === 'compose' || currentMode === 'review') {
				this.focusModeAiInput();
			}
		}

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
	 *  - generating: "Generating…" / "Reviewing…"
	 *  - error:      "Error"
	 *  - backed:     reuses the back-preview snapshot's counts
	 *  - complete:   counts from the resolved resource value
	 *  - idle:       scope file count ("N files")
	 */
	private computeModeStatusText(): string | ReturnType<typeof html> | undefined {
		const mode = this._state.activeMode.get();
		if (mode !== 'compose' && mode !== 'review') return undefined;

		const status = this.engagedModeStatus?.[mode]?.execState;
		if (status === 'generating') {
			return mode === 'compose' ? 'Generating…' : 'Reviewing…';
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
		// Instantiating the controller auto-attaches it via `host.addController(this)`; Lit
		// fires `hostConnected` immediately (since we're already connected), which sets up
		// the repo-change subscription without an extra call here.
		this._workflow = new DetailsWorkflowController(this, this._actions);

		if (this._pendingCompare != null) {
			const { params, onReady } = this._pendingCompare;
			this._pendingCompare = undefined;
			this.openCompareMode(params, onReady);
		}

		void this._actions.fetchCapabilities();
		// Fetched eagerly (not gated on isWip) because resolveServices runs once on
		// connect — if the initial selection is a commit, a isWip guard would skip
		// the fetch and it never re-runs when the user later selects a WIP row.
		void this.fetchLaunchpadSummary(services);
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
		const compareSheetOpen = this._state.compareSheetOpen.get();
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
			class=${stale ? 'details-content details-stale' : 'details-content'}
			?inert=${compareSheetOpen}
		>
			${resolved != null
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
					</div>`}
		</div>`;

		const compareSheet = compareSheetOpen
			? (() => {
					// Sheet → pinned panel: default click always moves to beside (horizontal),
					// Alt-click moves to below (vertical). Icon + tooltip preview the live action
					// based on the alt-key state so the affordance reads correctly mid-press.
					const labelFor = (o: 'horizontal' | 'vertical') =>
						o === 'horizontal' ? 'Move Beside' : 'Move Below';
					const iconFor = (o: 'horizontal' | 'vertical') =>
						o === 'horizontal' ? 'layout-sidebar-right' : 'layout-panel';
					const effective: 'horizontal' | 'vertical' = this._modifiers.altKey ? 'vertical' : 'horizontal';
					const actionLabel = labelFor(effective);
					const actionIcon = iconFor(effective);
					const tooltipContent = this._modifiers.altKey
						? actionLabel
						: `${actionLabel}\n[${getAltKeySymbol()}] ${labelFor('vertical')}`;
					return html`<gl-detail-sheet
						aria-label="Compare"
						sheet-title="Comparing References"
						close-label="Close"
						@gl-detail-sheet-close=${this.handleCloseCompareSheet}
					>
						<gl-action-chip
							slot="actions"
							icon=${actionIcon}
							label=${tooltipContent}
							overlay="tooltip"
							@click=${this.handleOpenCompareAsPanel}
						></gl-action-chip>
						${this.renderCompareMode()}
					</gl-detail-sheet>`;
				})()
			: nothing;

		if (!compareAsPanel) {
			return html`<div class="details-host">${detailsContent}${compareSheet}</div>`;
		}

		// Pinned compare: nested split panel inside the details host. Details on the start side,
		// compare on the end side. Position/orientation are user-adjustable and persisted via
		// the shared signals, so unpin → re-pin restores the user's last layout.
		const orientation = this._state.compareSplitOrientation.get();
		const position = this._state.compareSplitPosition.get();
		return html`<gl-split-panel
			class="compare-pinned-split"
			orientation=${orientation}
			.position=${position}
			@gl-split-panel-change=${this.handleCompareSplitChange}
		>
			<div slot="start" class="compare-pinned-split__start">${detailsContent}</div>
			<div slot="end" class="compare-pinned-split__end">
				<div class="compare-pinned-host">
					<header class="compare-pinned-host__header">
						<span class="compare-pinned-host__title">Comparing References</span>
						<div class="compare-pinned-host__actions">
							<gl-action-chip
								icon=${orientation === 'horizontal' ? 'layout-panel' : 'layout-sidebar-right'}
								label=${orientation === 'horizontal' ? 'Move Below' : 'Move Beside'}
								overlay="tooltip"
								@click=${this.handleFlipCompareOrientation}
							></gl-action-chip>
							<gl-action-chip
								icon="close"
								label="Close"
								overlay="tooltip"
								@click=${this.handleCloseCompareSheet}
							></gl-action-chip>
						</div>
					</header>
					<div class="compare-pinned-host__body">${this.renderCompareMode()}</div>
				</div>
			</div>
		</gl-split-panel>`;
	}

	private handleCloseCompareSheet = (): void => {
		this._workflow.closeCompare();
	};

	private handleOpenCompareAsPanel = (e: MouseEvent): void => {
		// Sheet → pinned panel: default click always moves to beside (horizontal); Alt-click
		// moves to below (vertical). The orientation preview in the sheet header tooltip mirrors
		// this so the affordance reads correctly mid-press.
		// Tell the sheet to skip its focus-restoration step on disconnect — the user is
		// transitioning INTO the new pinned panel, not dismissing the sheet, so returning focus
		// to whatever row was focused before the sheet opened is the wrong direction.
		const sheet = this.querySelector('gl-detail-sheet');
		if (sheet != null) {
			(sheet as { skipFocusRestore: boolean }).skipFocusRestore = true;
		}
		const target: 'horizontal' | 'vertical' = e.altKey ? 'vertical' : 'horizontal';
		this._workflow.openCompareAsPanel(target);
	};

	private handleFlipCompareOrientation = (): void => {
		const current = this._state.compareSplitOrientation.get();
		this._state.compareSplitOrientation.set(current === 'horizontal' ? 'vertical' : 'horizontal');
	};

	private handleCompareSplitChange = (e: CustomEvent<{ position: number }>): void => {
		this._state.compareSplitPosition.set(e.detail.position);
	};

	private renderWip() {
		const wip = this._state.wip.get();
		if (!wip) return nothing;

		const branchName = wip.branch?.name ?? 'unknown';
		const activeMode = this._state.activeMode.get();
		const hasChanges = (wip.changes?.files?.length ?? 0) > 0;
		const aiCreatePrEnabled =
			(this._state.preferences.get()?.aiEnabled ?? false) &&
			(this._state.orgSettings.get()?.ai ?? false) &&
			(wip.repo?.provider?.supportedFeatures?.createPullRequestWithDetails ?? false);
		// Read the worktree-matched sessions from the cycle snapshot captured in `willUpdate` so
		// the auto-partial trigger and the rendered card list agree on the same data within a
		// single update. See `_cycleAgentSessions` for why this matters.
		const worktreeAgentSessions = this._cycleAgentSessions;
		const hasPausedOp = wip.changes?.pausedOpStatus != null;
		const showAgentStatus = worktreeAgentSessions != null && activeMode == null;
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
		// it: the split-panel's default grid template (`min(--_start-size, …)`) reflects the
		// splitter position directly.
		const useAutoSize = !agentStatusIsExpanded;
		// Cards visible under the current expand state, derived right here from the truth
		// (`worktreeAgentSessions` + `agentStatusExpand`) — no event-driven mirror needed.
		const agentStatusHasVisibleCards = worktreeAgentSessions?.some(s =>
			expandVisibleCategories[agentStatusExpand].has(agentPhaseToCategory[s.phase]),
		);

		const restContent =
			activeMode === 'review'
				? this.renderReviewMode()
				: activeMode === 'compose'
					? this.renderComposeMode()
					: hasChanges || hasPausedOp
						? html`
								<div class="commit-panel__files">
									<gl-details-wip-panel
										variant="embedded"
										file-icons
										checkbox-mode
										?bulk-conflict-actions=${wip.changes?.pausedOpStatus?.type === 'rebase'}
										?show-search-box=${this.showSearchBox}
										?search-box-filter=${this.searchBoxFilter}
										.wip=${wip}
										.files=${wip.changes?.files}
										.agentSessions=${worktreeAgentSessions}
										.preferences=${this._state.preferences.get()}
										.orgSettings=${this._state.orgSettings.get()}
										.isUncommitted=${true}
										.filesCollapsable=${false}
										empty-text=${hasPausedOp && !hasChanges
											? 'No conflicting or changed files'
											: 'No working changes'}
										@file-open=${this.handleFileOpen}
										@file-compare-working=${this.handleFileCompareWorking}
										@file-compare-previous=${this.handleFileComparePrevious}
										@file-compare-wip=${this.handleFileCompareWipChanges}
										@file-open-current=${this.handleFileOpenConflictCurrent}
										@file-open-incoming=${this.handleFileOpenConflictIncoming}
										@file-more-actions=${this.handleFileMoreActions}
										@file-stage=${this.handleFileStage}
										@file-unstage=${this.handleFileUnstage}
										@file-discard=${this.handleFileDiscard}
										@discard-unstaged=${this.handleDiscardUnstaged}
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
									.committing=${this._state.committing.get()}
									.branchName=${branchName}
									.canCommit=${this._actions.canCommit()}
									.disabledReason=${this._actions.canCommitReason()}
									.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
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
									.aiCreatePrEnabled=${aiCreatePrEnabled}
									.pullRequest=${this._state.wipPullRequest.get()}
									.pullRequestLoading=${this._state.wipPullRequestLoading.get()}
									.hasIntegrationsConnected=${this._state.hasIntegrationsConnected.get()}
									.launchpadSummary=${this._state.launchpadSummary.get()}
									.launchpadSummaryLoading=${this._state.launchpadSummaryLoading.get()}
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
				.activeMode=${activeMode}
				.modeStatus=${this.engagedModeStatus}
				.aiEnabled=${this._state.preferences.get()?.aiEnabled ?? false}
				.loading=${this.isLoading}
				.autolinks=${this._state.wipAutolinks.get()}
				.issues=${this._state.wipIssues.get()}
				.mergeTargetStatus=${this._state.wipMergeTarget.get()}
				.mergeTargetStatusLoading=${this._state.wipMergeTargetLoading.get()}
				.pullRequest=${this._state.wipPullRequest.get()}
				.pullRequestLoading=${this._state.wipPullRequestLoading.get()}
				.dateFormat=${this._state.preferences.get()?.dateFormat}
				.dateStyle=${this._state.preferences.get()?.dateStyle}
				.modeStatusText=${this.computeModeStatusText()}
				.inResultsView=${this.inModeResultsView}
				@toggle-mode=${this.handleToggleMode}
				@mode-back=${this.handleModeBack}
				@mode-refresh=${this.handleModeRefresh}
				@refresh-wip=${this.handleRefreshWip}
				@switch-branch=${this.handleSwitchBranch}
				@create-branch=${this.handleCreateBranch}
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
			${showAgentStatus
				? html`<gl-split-panel
						class="agent-status-split ${useAutoSize
							? 'agent-status-split--auto-size'
							: ''} ${agentStatusHasVisibleCards ? '' : 'agent-status-split--no-cards'}"
						orientation="vertical"
						primary="start"
						position="${agentStatusPosition}"
						?disabled=${!agentStatusIsExpanded}
						.snap=${this._agentStatusSplitSnap}
						@gl-split-panel-change=${this._onAgentStatusSplitChange}
						@gl-split-panel-drag-end=${this._onAgentStatusSplitDragEnd}
						@gl-split-panel-dblclick=${this._onAgentStatusSplitDblClick}
					>
						<div slot="start" class="agent-status-split__top scrollable">
							<gl-details-agent-status
								.sessions=${worktreeAgentSessions}
								.expand=${agentStatusExpand}
								.selectedSessionId=${this._selectedAgentSessionId}
								@gl-agent-status-expand-request=${this._onAgentStatusExpandRequest}
							></gl-details-agent-status>
						</div>
						<div slot="end" class="agent-status-split__bottom scrollable">${restContent}</div>
					</gl-split-panel>`
				: restContent}
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

			const panel = this.querySelector<import('./gl-details-compose-mode-panel.js').GlDetailsComposeModePanel>(
				'gl-details-compose-mode-panel',
			);
			const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
			const aiExcludedFiles = this._state.aiExcludedFiles.get();
			this._workflow.runCompose(
				this.effectiveRepoPath,
				e.detail?.prompt,
				excludedFiles,
				aiExcludedFiles,
				panel?.selectedIds,
				scopeItems ?? undefined,
			);
		};

		// Generation/back state lives on the registry entry now; the single `Resource` is a
		// *projection* of the engaged anchor's result. Read execState from the entry first;
		// fall back to the resource for the resolved payload + idle case.
		const composeEntry =
			this.engagedRunningOperation?.kind === 'compose' ? this.engagedRunningOperation : undefined;
		const composeResource = this._actions.resources.compose;
		const composeValue = composeEntry?.result ?? composeResource.value.get();
		const composeResult = composeValue && 'result' in composeValue ? composeValue.result : undefined;
		const composeError =
			(composeValue && 'error' in composeValue ? composeValue.error.message : undefined) ??
			composeResource.error.get();
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
			.progressMessage=${this._state.composeProgressMessage.get()}
			?applying=${this._state.composeApplying.get()}
			?forward-available=${this._state.composeForwardAvailable.get()}
			.backPreview=${this._state.composeBackPreview.get()}
			@compose-generate=${handleCompose}
			@compose-refine=${handleCompose}
			@compose-forward=${() => this._workflow.compose.forward()}
			@compose-forward-invalidate=${() => this._workflow.compose.invalidateSnapshot()}
			@compose-error-back=${() => this._workflow.compose.backFromError()}
			@compose-error-retry=${() => {
				const panel = this.querySelector<
					import('./gl-details-compose-mode-panel.js').GlDetailsComposeModePanel
				>('gl-details-compose-mode-panel');
				const excludedFiles = panel?.excludedFiles.size ? [...panel.excludedFiles] : undefined;
				const aiExcludedFiles = this._state.aiExcludedFiles.get();
				this._workflow.compose.retryFromError(
					this.effectiveRepoPath,
					this.sha,
					this.graphReachability,
					excludedFiles,
					aiExcludedFiles,
					panel?.selectedIds,
					scopeItems ?? undefined,
				);
			}}
			@compose-cancel=${this.handleCancelMode}
			@compose-commit-all=${(e: CustomEvent<{ includedCommitIds?: readonly string[] }>) =>
				void this._workflow.compose.applyPlan(this.sha, this.graphReachability, e.detail?.includedCommitIds)}
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
		const fallback = activeTab === 'behind' ? leftRef : rightRef;
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
		const subPanelContent = activeMode === 'review' ? this.renderReviewMode() : nothing;

		return html`<gl-details-commit-panel
			variant="embedded"
			file-icons
			compare-enabled
			show-jump-to-nearest-wip
			?show-search-box=${this.showSearchBox}
			?search-box-filter=${this.searchBoxFilter}
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
			@gl-stash-apply=${(e: CustomEvent<StashApplyCommandArgs>) =>
				void this._actions.services.commands.execute('gitlens.stashesApply', e.detail)}
			@change-files-layout=${this.handleChangeFilesLayout}
			@toggle-mode=${this.handleToggleMode}
			@mode-back=${this.handleModeBack}
			@mode-refresh=${this.handleModeRefresh}
			@open-multiple-changes=${this.handleOpenMultipleChanges}
			@gl-issue-pull-request-details=${this.handleOpenPullRequestDetails}
			@gl-jump-to-nearest-wip=${this.handleJumpToNearestWip}
		></gl-details-commit-panel>`;
	}

	private handleJumpToNearestWip = (e: CustomEvent<{ fromSha: string }>): void => {
		document.dispatchEvent(new CustomEvent('gl-jump-to-nearest-wip', { detail: e.detail }));
	};

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
			?show-search-box=${this.showSearchBox}
			?search-box-filter=${this.searchBoxFilter}
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
					panel?.selectedIds,
					scopeItems ?? undefined,
				);
			}}
			@review-send-to-chat=${(e: CustomEvent<ReviewSendToChatDetail>) => this.handleReviewSendToChat(e)}
			@review-copied=${(e: CustomEvent<ReviewCopiedDetail>) =>
				void this._actions.services.graphInspect.trackReviewAction({
					action: 'copy',
					granularity: e.detail.granularity,
				})}
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
		const panel = this.findReviewModePanel();
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
				this._workflow.review.enrichFocusAreaFindings(focusAreaId, result.result);
				panel?.updateFocusAreaFindings(focusAreaId, result.result);
			}
		} catch {
			panel?.setFocusAreaError(focusAreaId);
		}
	}

	private async handleReviewSendToChat(e: CustomEvent<ReviewSendToChatDetail>): Promise<void> {
		const repoPath = this.effectiveRepoPath;
		if (!repoPath) return;

		const { granularity, scopeLabel, reviewMarkdown } = e.detail;
		if (!reviewMarkdown) return;

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
		// both the panel's file list AND the header/row `workingTreeStats`. The old path
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

	private handleSwitchBranch = () => this._actions.switchBranch(this.effectiveRepoPath);

	private handleCreateBranch = () => this._actions.createBranch(this.effectiveRepoPath);

	private handlePublishBranch = () => void this._actions.services.repository.publishBranch(this.effectiveRepoPath!);

	private handlePull = () => void this._actions.services.repository.pull(this.effectiveRepoPath!);

	private handlePush = () => void this._actions.services.repository.push(this.effectiveRepoPath!);

	private handleForcePush = () => void this._actions.services.repository.push(this.effectiveRepoPath!, true);

	private handleFetch = () => void this._actions.services.repository.fetch(this.effectiveRepoPath!);

	private handleCreatePullRequest = () => this._actions.createPullRequest(this.effectiveRepoPath);

	private handleCreatePullRequestWithAI = () =>
		this._actions.createPullRequest(this.effectiveRepoPath, { describeWithAI: true });

	private handleShareWipAsCloudPatch = () =>
		void this._actions.services.commands.executeScoped('gitlens.shareWipAsCloudPatch:graph', {
			repoPath: this.effectiveRepoPath,
		});

	private handleRebaseOntoMergeTarget = () => this._actions.rebaseOntoMergeTarget();

	private handleMergeMergeTargetIntoCurrent = () => this._actions.mergeMergeTargetIntoCurrent();

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

	private handleOpenPullRequestDetails = (e: CustomEvent<{ id: string; providerId: string | undefined }>) =>
		this._actions.openPullRequestDetails(e.detail.id || undefined, e.detail.providerId);

	private handleStashSave = () => this._actions.stashSave(this.effectiveRepoPath);

	private handleStartWork = (e: CustomEvent<{ showOpenInAgent?: 'ask' | 'manual' | 'agent' } | undefined>) =>
		this._actions.startWork(e.detail?.showOpenInAgent);

	private handleStartReview = (e: CustomEvent<{ showOpenInAgent?: 'ask' | 'manual' | 'agent' } | undefined>) =>
		this._actions.startPRReview(e.detail?.showOpenInAgent);

	private handleCreatePr = () => this._actions.createPullRequest(this.effectiveRepoPath);

	private handleApplyStash = () => this._actions.applyStash(this.effectiveRepoPath);

	private handleNewWorktree = () => this._actions.createWorktree();

	private async fetchLaunchpadSummary(services: Remote<GraphServices>): Promise<void> {
		if (this._state.launchpadSummaryLoading.get()) return;

		this._state.launchpadSummaryLoading.set(true);
		try {
			const launchpad = await services.launchpad;
			const summary = await launchpad.getSummary();
			this._state.launchpadSummary.set(summary);
		} catch (ex) {
			this._state.launchpadSummary.set({ error: ex instanceof Error ? ex : new Error(String(ex)) });
		} finally {
			this._state.launchpadSummaryLoading.set(false);
		}
	}

	private handleRefreshLaunchpad = (): void => {
		if (this._remoteServices == null) return;

		void this.fetchLaunchpadSummary(this._remoteServices);
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

	/** Single-commit selection's ref + stash hint — `commitLite` carries `stashNumber` from the graph row. */
	private get currentRef(): { ref: string; stash?: boolean } | undefined {
		if (this.sha == null) return undefined;
		return { ref: this.sha, stash: this.commitLite?.stashNumber != null };
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

	private handleFileStage = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.stageFile(e.detail);
	};

	private handleFileUnstage = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.unstageFile(e.detail);
	};

	private handleFileDiscard = (e: CustomEvent<FileChangeListItemDetail>) => {
		this._actions.discardFile(e.detail);
	};

	private handleDiscardUnstaged = () => {
		this._actions.discardUnstagedFiles(this.effectiveRepoPath);
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
