import { SignalWatcher } from '@lit-labs/signals';
import { consume, ContextProvider, provide } from '@lit/context';
import { html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import { isMac } from '@env/platform.js';
import type { GitGraphRow, GitGraphRowKind } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { OverlayEntry } from '@gitlens/utils/keys/keybinding.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { GlExtensionCommands } from '../../../../constants.commands.js';
import type { GraphDetailsMode, TrackedUsageKeys } from '../../../../constants.telemetry.js';
import { mergeWebviewItems } from '../../../../system/webview.js';
import type { CommitDetails } from '../../../commitDetails/protocol.js';
import type {
	DidGetRowHoverParams,
	DidGetSidebarDataParams,
	DidRequestOpenCompareModeParams,
	DidRequestOpenTimelineScopeParams,
	DidRequestSearchParams,
	GraphCoachMarkType,
	GraphComponentConfig,
	GraphComposeScopeSeed,
	GraphDisplayMode,
	GraphItemContext,
	GraphMinimapMarkerTypes,
	GraphScopeBranch,
	GraphScopeOrigin,
	GraphScopeSource,
	GraphShowAction,
	GraphSidebarPanel,
	GraphSidebarPullRequest,
	OverviewRecentThreshold,
	VisualizationMode,
} from '../../../plus/graph/protocol.js';
import {
	createWipRowId,
	getWipRowWorktreePath,
	isPrimaryWipRowId,
	isWipSelectionSha,
} from '../../../plus/graph/protocol.js';
import { ExecuteCommand } from '../../../protocol.js';
import { fireAndForget, notifyService } from '../../shared/actions/rpc.js';
import type { CustomEventType } from '../../shared/components/element.js';
import type { GlSplitPanelSnapSource } from '../../shared/components/split-panel/split-panel.js';
import { aiContext, createAIState } from '../../shared/contexts/ai.js';
import { createIntegrationsState, integrationsContext } from '../../shared/contexts/integrations.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import { createOnboardingState, onboardingContext } from '../../shared/contexts/onboarding.js';
import type { OnboardingDismissals } from '../../shared/contexts/onboardingDismissals.js';
import { onboardingDismissalsContext } from '../../shared/contexts/onboardingDismissals.js';
import { createDefaultSubscriptionContextState, subscriptionContext } from '../../shared/contexts/subscription.js';
import type { TelemetryContext } from '../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../shared/contexts/telemetry.js';
import type { NavigationState } from '../../shared/controllers/navigationStack.js';
import { NavigationStack } from '../../shared/controllers/navigationStack.js';
import '../shared/components/account-bar.js';
import type { KeymapDispatcher } from '../../shared/keymap/keymapDispatcher.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import { AccountLaunchpadController } from './accountLaunchpadController.js';
import { graphCoachMarks } from './components/coachMarks.js';
import type { CapturedComparison } from './components/detailsState.js';
import { shouldRestoreCapturedComparison } from './components/detailsState.js';
import type { BranchSheetRef } from './components/gl-graph-branch-sheet-pane.js';
import type { GlGraphDetailsPanel } from './components/gl-graph-details-panel.js';
import type { GlGraphKeyboardShortcuts } from './components/gl-graph-keyboard-shortcuts.js';
import type {
	GlGraphTimelineCommitSelectDetail,
	GlGraphTimelineConfigChangeDetail,
} from './components/gl-graph-timeline.js';
import type { GraphTreemapModeChangeDetail } from './components/gl-graph-treemap.js';
import type { GraphVisualizationModeChangeDetail } from './components/gl-graph-visualizations.js';
import type { SheetKind } from './components/sheetStack.js';
import { getEffectiveVisualizationKey } from './components/visualizations.utils.js';
import type { AppState } from './context.js';
import { graphServicesContext, graphStateContext } from './context.js';
import { getEffectiveDisplayMode } from './displayMode.js';
import { DragShiftHintController } from './dragShiftHintController.js';
import type { GlGraphHeader } from './graph-header.js';
import type { GlGraphWrapper, GraphNavigationOptions, GraphNavigationResult } from './graph-wrapper/graph-wrapper.js';
import type { GraphCrossPaneState } from './graphCrossPaneState.js';
import { abortRunningOperations, createGraphCrossPaneState, graphCrossPaneContext } from './graphCrossPaneState.js';
import type { GraphLaunchpadState } from './graphLaunchpadState.js';
import { createGraphLaunchpadState, graphLaunchpadContext } from './graphLaunchpadState.js';
import type { GlGraphHover } from './hover/graphHover.js';
import { JumpToastController } from './jumpToastController.js';
import type { GraphKeymapScope } from './keymap/graphKeymap.js';
import { createGraphKeymapDispatcher } from './keymap/graphKeymap.js';
import { registerGraphKeymap } from './keymap/registerKeymap.js';
import type { GlGraphMinimapContainer, GraphMinimapConfigChangeEventDetail } from './minimap/minimap-container.js';
import type {
	GraphMinimapDaySelectedEventDetail,
	GraphMinimapWheelEvent,
	GraphMinimapZoomChangeEvent,
} from './minimap/minimap.js';
import { OverviewBarController } from './overviewBarController.js';
import { groupPullRequestsByStack } from './sidebar/pullRequestStacks.utils.js';
import type { GlGraphSidebarPanel, GraphSidebarPanelSelectEventDetail } from './sidebar/sidebar-panel.js';
import type {
	GlGraphSideBar,
	GraphSidebarDisplayModeChangeEventDetail,
	GraphSidebarToggleEventDetail,
} from './sidebar/sidebar.js';
import { sidebarActionsContext } from './sidebar/sidebarContext.js';
import type { SidebarActions } from './sidebar/sidebarState.js';
import { SidebarOverlayController } from './sidebarOverlayController.js';
import type { SelectionBranch } from './utils/branchSelection.utils.js';
import { getOverviewBranchSelectionSha } from './utils/branchSelection.utils.js';
import { resolveMinimapShown } from './utils/minimap.utils.js';
import { getSelectedRepoPath } from './utils/repository.utils.js';
import { getCommitDateFromRow } from './utils/row.utils.js';
import { resolveScopeToBranchTarget, shouldDrainParkedScopeToBranch } from './utils/scopeToBranch.utils.js';
import { hasDirtyCounts, isScopeFocalHead, shouldShowPrimaryWipRow } from './utils/wip.utils.js';
import { isGraphWalkthroughBannerHighlighted } from './walkthroughBanner.js';
import './empty-state.js';
import './access-account.js';
import './gate.js';
import './graph-header.js';
import './graph-wrapper/graph-wrapper.js';
import './hover/graphHover.js';
import './minimap/minimap-container.js';
import '../../shared/components/split-panel/split-panel.js';
import './sidebar/sidebar.js';
import './sidebar/sidebar-panel.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/drag-shift-overlay.js';
import './components/gl-graph-details-panel.js';
import './components/gl-graph-health-banner.js';
import './components/gl-graph-jump-toast.js';
import './components/gl-graph-kanban.js';
import './components/gl-graph-keyboard-shortcuts.js';
import './components/gl-graph-overview-bar.js';
import './components/gl-graph-timeline.js';
import './components/gl-graph-visualizations.js';

const sidebarDefaultPct = 20;
const sidebarMinPct = 15;
const sidebarMaxPct = 80;

const detailsDefaultPct = 50;
const detailsMinPct = 20;
const detailsMaxPct = 80;

// The `auto` details location flips to the bottom when width is scarce relative to height — the
// panel docks on whichever axis has surplus. The width threshold scales with height (a short pane
// can't spare vertical room; a tall one can), clamped so tiny panes still prefer the bottom's
// full-width file list and huge panes eventually go side-by-side. Exit sits 10% above enter as a
// dead-band against flicker while dragging across the boundary.
const detailsAutoBottomAspect = 1.6;
const detailsAutoBottomMinPx = 900;
const detailsAutoBottomMaxPx = 1600;

const minimapDefaultPx = 40;
const minimapMaxPct = 40;

/** A typical OS double-click interval — how long sidebar interactions wait to see whether a second
 *  click lands. */
const sidebarDblClickGraceMs = 300;

type GraphSelectedCommit = {
	sha: string;
	repoPath: string;
	reachability?: GitCommitReachability;
	/** Eagerly-built commit shell (no files/stats) so the details panel can paint synchronously. */
	commitLite?: CommitDetails;
};

type GraphSelectedCommits = {
	shas: string[];
	repoPath: string;
	/** Per-sha commit shells for the multi-commit endpoints — skips the from/to getCommit IPCs. */
	commitLites?: Record<string, CommitDetails>;
};

/** What asked the details panel to become visible — feeds telemetry and `withDetailsPanel`. */
type DetailsVisibleTrigger =
	| 'toggle'
	| 'placement'
	| 'request-compare'
	| 'request-mode'
	| 'request-agents'
	| 'request-graph-wip-bar'
	| 'auto-restore';

@customElement('gl-graph-app')
export class GraphApp extends SignalWatcher(LitElement) {
	private _hoverTrackingCounter = getScopedCounter();
	/** Aborts a superseded hover fetch — a newer row's hover always supersedes an outstanding one. */
	private _hoverAbort?: AbortController;
	private _selectionTrackingCounter = getScopedCounter();
	private _lastSearchRequest: SearchQuery | undefined;
	private _wasDetailsVisible = false;
	private _wasSidebarVisible = false;
	private _wasSidebarActivePanel: string | null | undefined;
	private _wasDisplayMode: GraphDisplayMode | undefined;
	/** Tracks the last observed `selectedRepository` so a repo switch mid-scope can invalidate
	 *  the captured `_modeBeforeScope` — otherwise repo B's scope-applied (or another path that
	 *  triggers restore) could restore a mode that was meant for repo A. */
	private _wasSelectedRepository: string | undefined;

	/** Set by the popover's fallback path when it couldn't find the focal branch tip locally
	 *  (branch's tip wasn't in `graphState.rows`). Drained in `updated` once the async scope-anchor
	 *  resolver lands `focalBranchTipSha` on `graphState.scope`. branchRef-keyed so a fast re-scope
	 *  doesn't end up selecting the wrong branch's tip. */
	private _pendingFocalTipBranchRef: string | undefined;

	private _sidebarSnap = ({ pos, source }: { pos: number; source: GlSplitPanelSnapSource }) => {
		if (pos < sidebarMinPct / 2) return 0;
		if (pos < sidebarMinPct) return sidebarMinPct;
		if (pos > sidebarMaxPct) return sidebarMaxPct;
		// Keyboard steps by 1%, smaller than this magnet's ±1.5% window, so the magnet would
		// capture every step and the position could never leave 20% — skip it for keyboard.
		if (source !== 'keyboard' && Math.abs(pos - sidebarDefaultPct) <= 1.5) return sidebarDefaultPct;
		return pos;
	};

	private _detailsSnap = ({ pos }: { pos: number }) => {
		const endPct = 100 - pos;
		if (endPct < detailsMinPct / 2) return 100;
		if (endPct < detailsMinPct) return 100 - detailsMinPct;
		if (endPct > detailsMaxPct) return 100 - detailsMaxPct;
		if (Math.abs(endPct - detailsDefaultPct) <= 1.5) return 100 - detailsDefaultPct;
		return pos;
	};

	private _minimapSnap = ({ pos, size, source }: { pos: number; size: number; source: GlSplitPanelSnapSource }) => {
		if (size <= 0) return pos;

		// A hidden minimap sits at 0 deliberately, so layout-driven snaps must never open it — without
		// this the split panel's first-measurement re-snap would open a minimap that the policy says
		// stays hidden (`applySnap` runs against the seeded position before any stored one exists).
		// Gestures are exempt: pointer/keyboard drags are how the user opens it again.
		if (!this.minimapShown && source === 'layout') return 0;

		const defaultPct = (minimapDefaultPx / size) * 100;
		// First render without a stored position: snap to the exact pixel default
		// regardless of the container's current size.
		if (this.graphState.minimap?.position == null) {
			return defaultPct;
		}

		const px = (pos / 100) * size;
		if (px < minimapDefaultPx / 2) return 0;
		if (px < minimapDefaultPx) return defaultPct;
		if (pos > minimapMaxPct) return minimapMaxPct;
		if (Math.abs(px - minimapDefaultPx) <= 2) return defaultPct;
		return pos;
	};

	/**
	 * Search session the user dismissed the auto-shown minimap in, or `undefined` if they haven't.
	 * Stored as the session rather than a boolean that something has to remember to clear: the
	 * dismissal simply stops matching once a new search bumps the session, so there's no ordering
	 * dependency between "record the new session" and "dismiss" (a boolean cleared from `willUpdate`
	 * lost dismissals issued before the update that noticed the session had moved).
	 */
	private _minimapDismissedSession: number | undefined;

	private get minimapSearchDismissed(): boolean {
		return this._minimapDismissedSession === this.graphState.searchSession;
	}

	private dismissMinimapForSearch(): void {
		this._minimapDismissedSession = this.graphState.searchSession;
		this.requestUpdate();
	}

	/**
	 * Whether a search is active — the trigger for the `onSearch` minimap policy. Deliberately spans from
	 * submit until the search is *cleared*, not until it finishes: keying off results alone would flash
	 * the minimap open and shut on a zero-match search, and drop it the moment a search completes.
	 * `searchQuery` is what survives a finished search; the reducer nulls it only on cancel/clear.
	 */
	private get minimapSearchActive(): boolean {
		const gs = this.graphState;
		return gs.searching || gs.searchQuery != null || (gs.searchResults?.count ?? 0) > 0;
	}

	private get minimapShown(): boolean {
		const gs = this.graphState;
		if (!this.minimapMountable) return false;

		return resolveMinimapShown(
			gs.config?.minimapDefaultVisibility ?? 'onSearch',
			gs.minimap?.visible,
			this.minimapSearchActive,
			this.minimapSearchDismissed,
		);
	}

	/**
	 * Whether the minimap is available at all — the `gitlens.graph.minimap.enabled` gate. Deliberately
	 * NOT derived from the search or the visibility policy: `renderGraphMain` gates the split panel on
	 * this, and a gate that flipped per-search (or on a `hidden` policy's first show) would unmount and
	 * remount the entire graph. A collapsed panel costs nothing — `gl-graph-minimap-container` defers
	 * all aggregation while collapsed.
	 */
	private get minimapMountable(): boolean {
		return this.graphState.config?.minimap ?? true;
	}

	/** Shared back/forward history of visited single commits, mirrored into {@link _navState} for
	 *  the details header. Re-driving selection via {@link navigateTo} is guarded by
	 *  {@link _navExpectedSha} so the resulting (async) selection echo isn't recorded as new. */
	private readonly _nav = new NavigationStack<{ sha: string; repoPath: string; commitLite?: CommitDetails }>(
		10,
		undefined,
		s => (this._navState = s),
	);

	/** Document-level key dispatcher for the graph webview's shortcuts. Scopes/bindings are registered
	 *  in {@link connectedCallback}; {@link disconnectedCallback} tears everything down in one call. */
	readonly keymap: KeymapDispatcher<GraphKeymapScope> = createGraphKeymapDispatcher(isMac);

	/** The jump feedback toast (see {@link JumpToastController}) — owns the toast slots, their timers,
	 *  and the jump-failure remedies; wired here with closures over this element's own state. */
	private readonly jumpToast = new JumpToastController(this, {
		graph: () => this.graph,
		graphState: () => this.graphState,
		updateGraphConfig: changes => this.updateGraphConfig(changes),
		getFiltersService: () => this.getFiltersService(),
		graphHeader: () => this.graphHeader,
		waitForState: (predicate, timeoutMs) => this.waitForState(predicate, timeoutMs),
	});

	/** Routed from {@link GraphAppHost} for the host's `reveal/didFail` notification. */
	handleRevealFailed(id: string): void {
		this.jumpToast.revealFailed(id);
	}

	/** The overlay (unpinned) side bar's auto-collapse, Esc dismissal, and focus-handoff behaviors
	 *  (see {@link SidebarOverlayController}); wired here with closures over this element's own state. */
	private readonly sidebarOverlay = new SidebarOverlayController(
		this,
		{
			sidebarOpen: () => this.sidebarOpen,
			sidebarPinned: () => this.graphState.config?.sidebarPinned ?? false,
			hideSidebar: () => this.hideSidebar(),
			focusGraph: () => this.graph?.focus(),
			railEl: () => this.sidebarRailEl,
			panelEl: () => this.sidebarPanelEl,
			scopeBranchRef: () => this.graphState.scope?.branchRef,
		},
		sidebarDblClickGraceMs,
	);

	/** Native-drag "Hold Shift" boundary tracking for the app-level overlay
	 *  (see {@link DragShiftHintController}). */
	private readonly dragShiftHint = new DragShiftHintController(this);

	/** The overview/WIP bar: item building, pill select/focus/jump handlers, and lazy stats fetches
	 *  (see {@link OverviewBarController}); wired here with closures over this element's own state. */
	private readonly overviewBar = new OverviewBarController(this, {
		graph: () => this.graph,
		graphState: () => this.graphState,
		updateComplete: () => this.updateComplete,
		fallbackRepoPath: () => this.fallbackRepoPath,
		primaryWipRowId: () => this.primaryWipRowId,
		ensureGraphDisplayMode: () => this.ensureGraphDisplayMode(),
		getFiltersService: () => this.getFiltersService(),
		waitForState: (predicate, timeoutMs) => this.waitForState(predicate, timeoutMs),
		selectedCommitRepoPath: () => this._selectedCommit?.repoPath,
		selectWip: repoPath => {
			this._selectedCommit = { sha: uncommitted, repoPath: repoPath };
			this._selectedCommits = undefined;
		},
		openWipDetails: (repoPath, sha, target, trigger) => this.openWipDetails(repoPath, sha, target, trigger),
		emitDetailsVisibilityTelemetry: (visible, trigger) => this.emitDetailsVisibilityTelemetry(visible, trigger),
		scopeToBranchByName: (branchName, upstreamName, options) =>
			this.scopeToBranchByName(branchName, upstreamName, options),
		fetchSelectedWorktreeWipStats: sha => this.fetchSelectedWorktreeWipStats(sha),
	});

	/** Stable `pushOverlay` reference for surfaces that register themselves on the Esc stack through a
	 *  property (the hover card) — a fresh bind per render would dirty the property every update. */
	private readonly pushOverlay = (entry: OverlayEntry): Disposable => this.keymap.pushOverlay(entry);

	@state()
	private _navState: NavigationState = { count: 0, position: 0, canBack: false, canForward: false };

	/** Sha of an in-flight back/forward re-drive — sha-based (not boolean) because the
	 *  `navigateToCommit` re-drive re-emits the selection asynchronously through the graph. */
	private _navExpectedSha?: string;

	/** Graph-mode single selection. Don't read directly for what the details panel shows — go
	 *  through {@link activeSelection}, which picks the slot matching the active `displayMode`. */
	@state()
	private _selectedCommit?: GraphSelectedCommit;

	/** Graph-mode multi (compare) selection. Don't read directly — see {@link activeSelection}. */
	@state()
	private _selectedCommits?: GraphSelectedCommits;

	/** Alternate-mode (visualizations / kanban) selection. Separate slot so graph selection changes
	 *  — which keep arriving because the graph subtree stays mounted in non-graph modes — don't
	 *  clobber what the details panel shows while an alternate body is the visible pane. Both
	 *  alternate modes are single-select only; they're mutually exclusive so a shared slot is safe.
	 *  Don't read directly — see {@link activeSelection}. */
	@state()
	private _altModeSelectedCommit?: GraphSelectedCommit;

	/** Effective display mode after gating. Persisted `displayMode === 'kanban'` is downgraded
	 *  to `'graph'` when the experimental kanban flag is off — keeps `renderGraphPaneContent`,
	 *  `handleSelectCommit`, the mode-leave cleanup, and the host-sync IPC all making the same
	 *  decision about which body is actually visible. Reading raw `graphState.displayMode` in
	 *  any of those paths produces silent desync (graph rendered but kanban-branch logic runs).
	 *  Visualizations is never gated this way — its toggle is always available.
	 *
	 *  Delegates to the shared {@link getEffectiveDisplayMode} helper so the header (and any
	 *  future surface that mirrors the same decision) can compute the same value from the same
	 *  inputs without duplicating the gating rule. */
	private get effectiveDisplayMode(): GraphDisplayMode {
		return getEffectiveDisplayMode(this.graphState);
	}

	/** Everything the graph-level gate needs apart from the walkthrough banner. */
	private get coachMarksAllowed(): boolean {
		return (this.graphState.repositories?.length ?? 0) > 0 && (this.graphState.allowed ?? false);
	}

	/** Graph-level gate for the coach marks — there's no first-class "graph is open" signal, so this
	 *  composes the suppressors that would leave a mark with nothing visible to anchor to. */
	private get coachMarksEligible(): boolean {
		// Read here (not just in `updated`) so `SignalWatcher` re-renders us once the host answers.
		const deferredBefore = this._bannerDeferredBefore ?? this._dismissals?.get('graph:coachMarks:bannerDeferral');

		return (
			this.coachMarksAllowed &&
			// The banner auto-opens for the same audience and `closeOthers()` can't reach it, so a tip
			// would land on top. One session only: nothing expires the banner on its own.
			(deferredBefore === true ||
				!isGraphWalkthroughBannerHighlighted({
					bannerCollapsed: this._dismissals?.get('graph-walkthrough:banner'),
					graphWalkthroughProgress: this._onboardingState.graphWalkthroughProgress.get(),
					graphWalkthroughStarted: this.graphState.graphWalkthroughStarted,
				}))
		);
	}

	/** What the details-pane marks need on top of the graph-level gate; agents answers to that alone. */
	private get detailsCoachMarksEligible(): boolean {
		return (
			this.coachMarksEligible &&
			this.effectiveDisplayMode === 'graph' &&
			(this.graphState.details?.visible ?? false)
		);
	}

	/** Gates a binding to graph mode only — kanban/visualizations hide the graph subtree behind
	 *  `renderGraphPaneContent`'s short-circuit, so graph-only shortcuts (ref finder, overview-bar
	 *  digits, the Shift+letter toggles) must not fire there. NOTE: graph mode does NOT guarantee
	 *  `this.graph` exists — the gated / no-repo screens replace the whole graph subtree — so run
	 *  bodies must still null-guard it. */
	private readonly isGraphModeShortcut = (): boolean => this.effectiveDisplayMode === 'graph';

	/** The selection that drives the details panel, picked by the active `displayMode`. In
	 *  any non-graph mode the alternate-mode slot is honored; otherwise the graph slots. */
	private get activeSelection(): {
		single: GraphSelectedCommit | undefined;
		multi: GraphSelectedCommits | undefined;
	} {
		if (this.effectiveDisplayMode !== 'graph') {
			return { single: this._altModeSelectedCommit, multi: undefined };
		}
		return { single: this._selectedCommit, multi: this._selectedCommits };
	}

	/** The GRAPH-ROW sha(s) of the current inspection anchor, for the wrapper's derived highlight
	 *  (`highlight = anchorShas ∩ renderableRows`). `undefined` in alt modes (the graph is hidden, so
	 *  nothing to highlight) — the alt slot drives details independently. Multi-select carries real
	 *  commit shas (WIP rows are excluded from compare); the single anchor goes through
	 *  {@link toGraphRowSha}. */
	private get activeAnchorShas(): readonly string[] | undefined {
		if (this.effectiveDisplayMode !== 'graph') return undefined;
		if (this._selectedCommits != null) return this._selectedCommits.shas;

		const single = this._selectedCommit;
		if (single == null) return undefined;

		const rowSha = this.toGraphRowSha(single.sha, single.repoPath);
		return rowSha != null ? [rowSha] : undefined;
	}

	/** The GRAPH-ROW sha for an anchor `(sha, repoPath)`: a real sha is itself; `uncommitted` maps to the
	 *  WIP row of the worktree it belongs to — `repoPath` IS that worktree's path, so the reconstruction
	 *  is exact.
	 *
	 *  Prefers the anchor's own `repoPath`; during a repo-switch/reload tick it can be transiently empty,
	 *  so it falls back to the graph's selected repo — its own WIP row is the only one nameable then.
	 *  With neither there is no row id to anchor on, so this returns `undefined`. */
	private toGraphRowSha(sha: string, repoPath: string): string | undefined {
		if (sha !== uncommitted) return sha;

		const worktreePath = repoPath !== '' ? repoPath : this.fallbackRepoPath;
		return worktreePath != null ? createWipRowId(worktreePath) : undefined;
	}

	private get fallbackRepoPath(): string | undefined {
		return getSelectedRepoPath(this.graphState);
	}

	/** The graph's own worktree's WIP row id, or `undefined` before the repo path resolves. */
	private get primaryWipRowId(): string | undefined {
		const repoPath = this.fallbackRepoPath;
		return repoPath != null ? createWipRowId(repoPath) : undefined;
	}

	/** Graph's currently-selected repo "family" — `commonPath` when available, otherwise the
	 *  repo path itself. Mirrors {@link GraphRepository.commonPath} semantics in `sidebar-panel`'s
	 *  `resolveGraphAnchorContext`. Used to gate cross-repo session interactions: a kanban click
	 *  on a session whose `commonPath` doesn't match the graph's family cannot resolve a row in
	 *  the currently-rendered graph, so we don't drive `navigateToCommit` for it. */
	private get fallbackRepoFamily(): string | undefined {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		const repo = repoId != null ? repos?.find(r => r.id === repoId) : repos?.[0];
		return repo?.commonPath ?? repo?.path;
	}

	/** Family key for a repository path — mirrors {@link fallbackRepoFamily}'s `commonPath ?? path`.
	 *  Only called at RESTORE time, when the state carries a populated repository list. */
	private familyOfRepoPath(repoPath: string | undefined): string | undefined {
		if (!repoPath) return undefined;

		const repo = this.graphState.repositories?.find(r => r.path === repoPath);
		return repo?.commonPath ?? repo?.path ?? repoPath;
	}

	/** Whether the selected repository is virtual (GitHub/GitLab-hosted, no local git) — gates the
	 *  `worktrees`/`stashes` sidebar panels, same rule `gl-graph-sidebar` applies to its rail. */
	private get isVirtualRepo(): boolean {
		const gs = this.graphState;
		return gs.repositories?.find(r => r.id === gs.selectedRepository)?.virtual ?? false;
	}

	/** Whether the one-time layout-choice prompt should show. Bootstrap seeds the initial value (no
	 *  async fetch on first render — flash risk); a live dismissal of `graph:layoutPrompt` (e.g. from
	 *  another window) flips it false via the onboarding dismissals cache, which only ever transitions
	 *  true → false, never back. */
	private get layoutPromptNeeded(): boolean {
		return (this.graphState.layoutPromptNeeded ?? false) && this._dismissals?.get('graph:layoutPrompt') !== true;
	}

	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: graphStateContext, subscribe: false })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: onboardingDismissalsContext, subscribe: true })
	private _dismissals?: OnboardingDismissals;

	/** Whether an earlier session already deferred to the walkthrough banner. Latched, because banking
	 *  the flag below flips the live value and would lift the deferral in the session that set it. */
	@state()
	private _bannerDeferredBefore?: boolean;

	/** True once the follow-terminal controller's first passive reveal (`revealOnly`) has landed —
	 *  latched for the session; NEVER reset. The `followTerminal` coach mark's own dismissed/seen
	 *  guards handle showing it only once ever. */
	@state()
	private _followTerminalRevealed = false;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	/** Fire-and-forget usage tracking (drives walkthrough state + `usage/track` telemetry). */
	private trackUsage(key: TrackedUsageKeys): void {
		const services = this.services;
		if (services == null) return;

		notifyService(services.telemetry, 'track usage', svc => svc.trackUsage(key));
	}

	/** Persists a graph config change via RPC, resolving once the write lands (the new config
	 *  itself arrives separately over `configuration.onDidChange`, wired in `stateProvider.ts`). */
	private updateGraphConfig(changes: Partial<GraphComponentConfig>): Promise<void> {
		const services = this.services;
		if (services == null) return Promise.resolve();

		return (async () => (await services.configuration).update(changes))();
	}

	/** Resolves the filters RPC sub-service, or `undefined` before the handshake completes. Its writes
	 *  resolve once the host has written and fired; the resulting STATE arrives one transport hop later on
	 *  the filters push — see {@link waitForState}. */
	private async getFiltersService(): Promise<Awaited<NonNullable<typeof this.services>['filters']> | undefined> {
		return this.services?.filters;
	}

	private setDisplayMode(mode: GraphDisplayMode): Promise<void> {
		const services = this.services;
		if (services == null) return Promise.resolve();

		return (async () => (await services.configuration).setDisplayMode(mode))();
	}

	// Cross-pane shared signals: state owned by one pane (e.g. the details panel's
	// running-modes registry) but observed by another (e.g. row adornments in the graph
	// component). Provided here at the common-ancestor level so producer (details panel)
	// and consumers (graph row component, future agent-session pane, etc.) share a single
	// signal instance.
	@provide({ context: graphCrossPaneContext })
	private readonly _crossPaneState: GraphCrossPaneState = createGraphCrossPaneState();

	// Shared Launchpad summary — fetched once here (the common ancestor) and read by BOTH the
	// header's Launchpad indicator and the WIP details "empty pane", so there's a single fetch and
	// a single source of truth. See `graphLaunchpadState.ts`.
	@provide({ context: graphLaunchpadContext })
	private readonly _launchpadState: GraphLaunchpadState = createGraphLaunchpadState();

	/** One-shot guard: the Launchpad fetch + `onLaunchpadChanged` subscription start once `services`
	 *  first resolves (a `@consume`d context value, so it isn't in `updated`'s changedProperties). */
	private _launchpadInitialized = false;

	// Account/integrations bar state (issue #5411). The `<gl-account-bar>` chips consume these
	// shared contexts; provide them here (the common ancestor) and populate from the host once
	// `services` resolves. `promosContext` is provided globally by the app host. NOTE: this
	// mirrors the Home view's wiring — a follow-up should extract it into a reusable helper.
	private readonly _integrationsState = createIntegrationsState();
	private readonly _aiState = createAIState();
	private readonly _subscriptionCtx = new ContextProvider(this, {
		context: subscriptionContext,
		initialValue: createDefaultSubscriptionContextState(),
	});
	// `_integrationsCtx`/`_aiCtx` are intentionally kept as fields: `ContextProvider` self-registers
	// on construction, so they're never read again (Home provides these as bare `new ContextProvider`
	// statements instead — same effect). `_subscriptionCtx` above is a field because it's read later.
	private readonly _integrationsCtx = new ContextProvider(this, {
		context: integrationsContext,
		initialValue: this._integrationsState,
	});
	private readonly _aiCtx = new ContextProvider(this, {
		context: aiContext,
		initialValue: this._aiState,
	});
	// Walkthrough progress (issue #5522). Provided here so the header account/walkthrough pills and the
	// account modal can consume it; populated from the walkthrough RPC service in `initAccountContexts`.
	private readonly _onboardingState = createOnboardingState();
	private readonly _onboardingCtx = new ContextProvider(this, {
		context: onboardingContext,
		initialValue: this._onboardingState,
	});
	/** One-shot guard for the account-bar context wiring (see `updated()`). */
	private _accountContextsInitialized = false;

	/** Launchpad + account-bar context bootstrap and teardown (see {@link AccountLaunchpadController});
	 *  started from `updated()` once `services` resolves. */
	private readonly accountLaunchpad = new AccountLaunchpadController(this, {
		launchpadState: () => this._launchpadState,
		subscriptionCtx: () => this._subscriptionCtx,
		integrationsState: () => this._integrationsState,
		aiState: () => this._aiState,
		onboardingState: () => this._onboardingState,
		isConnected: () => this.isConnected,
		services: () => this.services,
	});

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _sidebarActions?: SidebarActions;

	@query('gl-graph-wrapper')
	graph!: GlGraphWrapper;

	@query('.graph')
	private readonly graphRootEl: HTMLElement | undefined;

	@query('gl-graph-header')
	private readonly graphHeader!: GlGraphHeader;

	@query('gl-graph-hover#commit-hover')
	private readonly graphHover!: GlGraphHover;

	@query('gl-graph-minimap-container')
	minimapEl: GlGraphMinimapContainer | undefined;

	@query('gl-graph-sidebar-panel')
	private readonly sidebarPanelEl: GlGraphSidebarPanel | undefined;

	@query('gl-graph-sidebar')
	private readonly sidebarRailEl: GlGraphSideBar | undefined;

	@query('gl-graph-details-panel')
	private readonly detailsPanelEl: GlGraphDetailsPanel | undefined;

	/** Bumped on every {@link withDetailsPanel} call — lets a stale in-flight reveal (e.g. rapid
	 *  clicks racing a repo switch) detect it's no longer the latest and skip its callback. */
	private _detailsRevealToken = 0;

	@query('gl-graph-keyboard-shortcuts')
	private readonly keyboardShortcutsEl: GlGraphKeyboardShortcuts | undefined;

	/** One-shot file/folder scope pushed into the embedded timeline (Visual History) by a graph
	 *  context-menu action. Cleared once `gl-graph-timeline` reports it applied. */
	@state()
	private _timelineScope?: { type: 'file' | 'folder'; relativePath: string };

	/** Captured visualization mode prior to a forced `'timeline'` flip in `openTimelineScope`,
	 *  so `handleTimelineScopeApplied` can restore the user's preferred mode (e.g. Treemap)
	 *  once the scope has been consumed. Without this, every scope-open silently overwrites
	 *  the persisted preference. */
	private _modeBeforeScope: VisualizationMode | undefined;

	private _detailsShownAt: number | undefined;
	private _detailsTelemetryFirstRender = true;

	/** Width-driven details location used when the configured location is `auto`. Tracked (with
	 *  hysteresis) by `_graphSizeObserver` and seeded by its initial callback, so no synchronous
	 *  width read is needed. See `effectiveDetailsLocation`. */
	@state()
	private _autoEffectiveLocation: 'right' | 'bottom' = 'right';

	/**
	 * Last observed non-zero size of the top-level `.graph` element, used to freeze it
	 * across editor-tab hide/show transitions. Without this freeze the graph's
	 * ResizeObservers (the row virtualizer's, and `gl-lit-graph`'s own lane-window ones) see
	 * the iframe's layout collapse to 0 (and then re-expand on restore), producing a visible
	 * re-layout cascade. VS Code applies
	 * `display: none` to the webview iframe even with `retainContextWhenHidden: true` —
	 * that flag preserves the iframe content but not its layout visibility.
	 */
	private _lastGraphSize: { width: number; height: number } | undefined;
	private _graphSizeObserver: ResizeObserver | undefined;
	private _releaseSuspensionRafId: number | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();

		registerGraphKeymap(this.keymap, {
			isGraphModeShortcut: () => this.isGraphModeShortcut(),
			graph: () => this.graph,
			graphHeader: () => this.graphHeader,
			sidebarPanelEl: () => this.sidebarPanelEl,
			shouldAutoCollapseOverlay: () => this.sidebarOverlay.shouldAutoCollapse(),
			overviewBarItems: () => this.overviewBar.items,
			selectOverviewBarItem: (detail, options) => this.overviewBar.selectItem(detail, options),
			isVirtualRepo: () => this.isVirtualRepo,
			activateSidebarPanel: panel => this.activateSidebarPanel(panel),
			sidebarEnabled: () => this.graphState.config?.sidebar ?? false,
			kanbanEnabled: () => this.graphState.config?.experimentalKanbanEnabled ?? false,
			toggleDisplayMode: mode => this.toggleDisplayMode(mode),
			toggleMinimap: () => this.handleToggleMinimap(),
			toggleSidebar: () => this.handleToggleSidebar(),
			toggleDetails: e => this.handleToggleDetails(e),
			showShortcuts: () => this.handleShowShortcuts(),
		});

		this._graphSizeObserver = new ResizeObserver(entries => {
			// Use `borderBoxSize` (not `contentRect`) so the snapshot matches what
			// `style.width/height` sets when applied with `box-sizing: border-box`. Using
			// contentRect would leave a 2× padding gap (.graph has `padding: 0.1rem`), which
			// cascades into a visible 2–10px row jump on restore.
			const box = entries[0]?.borderBoxSize?.[0];
			if (box == null) return;

			const width = Math.round(box.inlineSize);
			const height = Math.round(box.blockSize);
			// Only remember non-zero sizes — when the iframe is hidden the element collapses
			// to 0, and we want to keep the LAST good measurement for use across the
			// hide/show cycle.
			if (width > 0 && height > 0) {
				this._lastGraphSize = { width: width, height: height };
				// Drive the `auto` details location from the panes' shape: the width threshold is a
				// pure function of height (see `detailsAutoBottomAspect`), so no feedback loop is
				// possible — `.graph` is the layout root and its size doesn't depend on where the
				// panel docks. Hysteresis (exit 10% above enter) keeps it from flapping when
				// dragged across the boundary. Only consumed when the configured location is `auto`
				// (see `effectiveDetailsLocation`), but tracked unconditionally so switching back
				// to `auto` is immediately correct without waiting for the next resize.
				const enterPx = Math.min(
					Math.max(height * detailsAutoBottomAspect, detailsAutoBottomMinPx),
					detailsAutoBottomMaxPx,
				);
				if (this._autoEffectiveLocation === 'right' && width < enterPx) {
					this._autoEffectiveLocation = 'bottom';
				} else if (this._autoEffectiveLocation === 'bottom' && width > enterPx * 1.1) {
					this._autoEffectiveLocation = 'right';
					// Maximize is bottom-only — drop it on a flip to the side so it doesn't silently
					// re-apply when the panel later returns to the bottom.
					if (this.graphState.details?.maximized) {
						this.graphState.details = { maximized: false };
						this.persistState();
					}
				}
			}
		});
	}

	private _observedGraphRoot: HTMLElement | undefined;

	// Observe the outer `.graph` div once rendered — it contains the entire layout (header, panes,
	// sidebar, React mount), so freezing this one element freezes everything inside it. Identity-tracked
	// (not a one-shot latch) and driven from both `firstUpdated` and `updated`: the signed-out
	// account-access screen replaces the whole tree, so `.graph` is absent on the first render in that
	// state AND is a brand-new element after each sign-out/sign-in cycle — a latch would leave the new
	// element unobserved, freezing every height/width-driven behavior (inline header mode, `auto`
	// details location) until a webview reload.
	private ensureGraphObserved(): void {
		const el = this.graphRootEl;
		if (el === this._observedGraphRoot || this._graphSizeObserver == null) return;

		if (this._observedGraphRoot != null) {
			this._graphSizeObserver.unobserve(this._observedGraphRoot);
		}
		this._observedGraphRoot = el;
		if (el != null) {
			this._graphSizeObserver.observe(el);
		}
	}

	protected override firstUpdated(): void {
		this.ensureGraphObserved();

		// Manual refresh entry point (the WIP empty pane's refresh button, routed through the
		// details panel) — force an immediate refetch rather than waiting on `onLaunchpadChanged`.
		this._launchpadState.refresh = () => void this.accountLaunchpad.refreshLaunchpadSummary(true);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		// Abort in-flight AI runs — this element owns the registry, so teardown cancels them here.
		abortRunningOperations(this._crossPaneState);
		// Flush any pending debounced persist write so close-within-200ms-of-a-toggle doesn't
		// lose the last visualization choice. The debouncer is leading-trailing by default;
		// `flush()` runs the queued trailing call immediately, no-ops if nothing's queued.
		this._persistStateDebounced.flush();
		// Drops every registered scope/binding AND the whole overlay stack, so the surfaces' own disposables
		// (held for the reconnect case) become no-ops.
		this.keymap.dispose();
		this._minimapZoomOverlay = undefined;

		this._graphSizeObserver?.disconnect();
		this._graphSizeObserver = undefined;
		// Reset the identity tracking so a reconnect (which creates a fresh observer) re-observes the
		// root even when the DOM element survived the disconnect.
		this._observedGraphRoot = undefined;
		if (this._releaseSuspensionRafId != null) {
			cancelAnimationFrame(this._releaseSuspensionRafId);
			this._releaseSuspensionRafId = undefined;
		}
	}

	onWebviewVisibilityChanged(visible: boolean): void {
		// Freeze the layout across the hide/show cycle so the ResizeObserver cascade that
		// VS Code's iframe resize (down to ~300x150 then back) produces does NOT propagate
		// into the graph. The IPC `visible=false` arrives with ~1.5s of headroom
		// before the queued RO callbacks fire, so we can apply explicit pixel dimensions +
		// `contain: size layout` to `.graph` and the cascade sees zero delta. `document.
		// visibilitychange` doesn't fire for editor-tab transitions in VS Code webviews,
		// so IPC is the only reliable signal.
		const graph = this.graphRootEl;
		if (graph != null) {
			if (!visible) {
				// At this point `body` has typically already shrunk to 300x150, but
				// `_lastGraphSize` still holds the pre-shrink size because the RO callbacks
				// are throttled until visibility is restored.
				const size = this._lastGraphSize;
				if (size != null) {
					graph.style.width = `${size.width}px`;
					graph.style.height = `${size.height}px`;
					graph.style.contain = 'size layout';
				}
				if (this._releaseSuspensionRafId != null) {
					cancelAnimationFrame(this._releaseSuspensionRafId);
					this._releaseSuspensionRafId = undefined;
				}
			} else if (graph.style.contain !== '') {
				// Release on the next animation frame so the frozen box is still in effect
				// when the graph's ResizeObservers run their first post-restore callback
				// (same size → no-op), then drops back to natural sizing for live
				// drag-resizes.
				if (this._releaseSuspensionRafId != null) {
					cancelAnimationFrame(this._releaseSuspensionRafId);
				}
				this._releaseSuspensionRafId = requestAnimationFrame(() => {
					this._releaseSuspensionRafId = undefined;
					graph.style.width = '';
					graph.style.height = '';
					graph.style.contain = '';
				});
			}
		}

		if (!visible) return;

		this._hoverTrackingCounter.reset();
		this._selectionTrackingCounter.reset();

		// Auto-focus the graph rows for keyboard navigation
		this.graph?.focus();
	}

	/** Routed from {@link GraphAppHost} when the extension requests entering compare mode with
	 *  explicit refs (e.g. from a sidebar tree compare action). Ensures the details panel is
	 *  visible, then forwards to the details panel which owns the workflow controller. */
	openCompareMode(params: DidRequestOpenCompareModeParams): void {
		void this.withDetailsPanel(panel => panel.openCompareMode(params), 'request-compare');
	}

	/** Routed from {@link GraphAppHost} when the extension pushes a selection — a host-initiated reveal
	 *  (Show in Commit Graph, terminal links, deep links). The graph doesn't auto-scroll on a plain
	 *  selection, so bring the revealed row into view. A landing: the user acted somewhere else entirely,
	 *  so leaving an already-visible row where it sits would answer "which one?" with nothing. */
	ensureRowVisible(sha: string): void {
		void this.graph?.navigateToCommit(sha, { source: 'host', flash: true });
	}

	/** Routed from {@link GraphAppHost} when a graph context-menu action requests showing a
	 *  file/folder in the graph's embedded Visual History. Switches to timeline display mode and
	 *  pushes the scope down to `gl-graph-timeline` (which mounts on demand). */
	openTimelineScope(params: DidRequestOpenTimelineScopeParams): void {
		this.graphState.displayMode = 'visualizations';
		// Capture the user's prior choice (e.g. Treemap) so `handleTimelineScopeApplied` (or
		// `clearTimelineScope` on abandonment) can restore it after the one-shot scope is consumed.
		// Guard on `!== 'timeline'` so a second openTimelineScope arriving after the first has
		// flipped mode to `'timeline'` (but before scope-applied fires) preserves the ORIGINAL
		// captured prior mode rather than stranding it as `'timeline'` itself.
		if (this.graphState.visualizationMode !== 'timeline') {
			this._modeBeforeScope = this.graphState.visualizationMode;
		}
		// Force the timeline sub-view — treemap doesn't consume scope, so without this
		// the persisted treemapMode would silently swallow the scope request and leave
		// `_timelineScope` orphaned until the user manually flips back to timeline.
		// Intentionally do NOT call `persistState()` here: the `'timeline'` flip is a transient
		// side-effect of opening the scope. Committing it to the memento would destructively
		// overwrite the user's persisted preference (e.g. Treemap) if they escape before
		// scope-applied fires. The persist happens on the restoration path (in
		// `handleTimelineScopeApplied` or `clearTimelineScope`).
		this.graphState.visualizationMode = 'timeline';
		this._timelineScope = { type: params.type, relativePath: params.relativePath };
	}

	private clearTimelineScope(): void {
		this._timelineScope = undefined;
		// Treat an abandoned scope (escape, external search, repo switch) as a restoration path —
		// the temporary `'timeline'` flip was a side-effect of the now-abandoned op, so put the
		// user's prior mode back AND persist it (the in-memory flip was never persisted by
		// `openTimelineScope`, so without this restore we'd leave the in-memory state as
		// `'timeline'` even though the persisted memento still says e.g. `'treemap'`).
		if (this._modeBeforeScope != null) {
			this.graphState.visualizationMode = this._modeBeforeScope;
			this._modeBeforeScope = undefined;
			this.persistState();
		}
	}

	private handleTimelineScopeApplied = (): void => {
		this._timelineScope = undefined;
		// Restore the user's prior visualization mode (e.g. Treemap) if `openTimelineScope` had
		// temporarily forced `'timeline'` to consume the scope. The scope IS now applied
		// (timeline received it), so the user can navigate back to their preferred mode.
		if (this._modeBeforeScope != null) {
			this.graphState.visualizationMode = this._modeBeforeScope;
			this._modeBeforeScope = undefined;
			this.persistState();
		}
	};

	/** Routed from {@link GraphAppHost} when an external caller pushes a search query directly —
	 *  e.g. "Open File History" filtering the graph. Bypasses the heavy host-side state-refresh
	 *  pipeline that the prior `state.searchRequest` path went through. Mirrors the timeline-scope
	 *  pattern: switch out of timeline mode and clear any one-shot scope, then hand the query to
	 *  the header to dispatch.
	 *
	 *  `params.selectSha` is intentionally NOT forwarded to the header: the host-side
	 *  `hasSearchQuery` handler already calls `setSelectedRows` and (when needed) `onGetMoreRows`
	 *  synchronously before firing this notification. The selection update reaches the webview via
	 *  the separate `GraphSelectionService.onSelectionChanged` push, not via the search query.
	 *
	 *  Sets `_lastSearchRequest` so the cold-show path's `state.searchRequest` consumer (in
	 *  `updated()`) treats this request as already handled if the same query also lands in state. */
	applyExternalSearchRequest(params: DidRequestSearchParams): void {
		this._lastSearchRequest = params.search;
		// Keep `state.searchRequest` in sync with the just-applied query: the cold-show path
		// publishes the search via `state.searchRequest` and stamps `_lastSearchRequest` here in
		// the consumer (see `updated()` below). After a cold show, `state.searchRequest` retains
		// the cold query reference. Without this clear, a subsequent warm invocation would set
		// `_lastSearchRequest = params.search` (new ref), causing the `updated()` dedup check
		// `state.searchRequest !== _lastSearchRequest` to be TRUE — silently re-firing the stale
		// cold query through `setExternalSearchQuery`. Clearing the state signal here is the
		// one-shot complement.
		if (this.graphState.searchRequest != null) {
			this.graphState.searchRequest = undefined;
		}
		if (this.graphState.displayMode !== 'graph') {
			this.graphState.displayMode = 'graph';
		}
		// Route through `clearTimelineScope` so the captured `_modeBeforeScope` is restored
		// (and persisted) rather than leaked stale — otherwise the next openTimelineScope-and-apply
		// cycle would restore a mode that was meant for a long-abandoned scope.
		this.clearTimelineScope();
		void this.updateComplete.then(() => {
			this.graphHeader?.setExternalSearchQuery(params.search);
		});
	}

	/** A task action that arrived — or was interrupted by a sign-out or plan change — while an access
	 *  wall is up (#5534). While gated the graph is unreachable (the account screen replaces it, or the
	 *  plan gate covers it with an undismissable modal), so consuming an action would silently drop it —
	 *  or worse, drive the graph behind the modal. It's parked here instead, drives the screen's
	 *  task-specific messaging, and is consumed once access is granted. `@state` so a warm arrival
	 *  re-renders the already-shown screen with the task copy. */
	@state()
	private _gatedPendingAction?: NonNullable<AppState['pendingAction']> & {
		/** An interrupted comparison from the wall capture — never host-delivered, so its
		 *  presence marks the parked action as a capture and arms the restore guards */
		capturedComparison?: CapturedComparison;
	};
	private _wasAccessGated = false;

	/** Drives the welcome's live-sign-in copy variant: armed when the account wall clears live (a
	 *  sign-in completed while the account screen was showing) with no parked task to run — a task
	 *  arrival goes straight to the graph instead, both for intent and because
	 *  `consumePendingAction` drives the graph subtree, which doesn't mount while this screen is up.
	 *  Cleared when the user continues, a task action arrives, or the account wall re-raises. */
	@state()
	private _postSignInPending = false;
	private _wasAccountGated = false;

	/** Mirrors the host's `isAccountAccessRequired` — the predicate for the render swap to the
	 *  account screen, and one of the two walls `isAccessGated` parks behind. */
	private get isAccountGated(): boolean {
		const sub = this.graphState.subscription;
		return sub != null && (sub.account == null || sub.account.verified === false);
	}

	/** Any wall that blocks the graph — the account screen, or the plan gate (`!allowed`, the very
	 *  predicate that renders `gl-graph-gate`), so what's parked can't desync from what's displayed. */
	private get isAccessGated(): boolean {
		return this.isAccountGated || !this.graphState.allowed;
	}

	/** Shows the first-run welcome (the `graph:intro` onboarding surface). Full-viewport early-return
	 *  in `render`, so — unlike the old in-subtree dialog — it needs no `repositories > 0` guard and
	 *  shows even with no repo open. Held back while the Pro gate is up (the gate is the proper first
	 *  surface for an unentitled user; the welcome shows once they can use the graph) and while a
	 *  deep-linked task action is parked/incoming (the action's intent trumps onboarding). */
	private get shouldShowWelcome(): boolean {
		return (
			!this.isAccountGated &&
			(this.graphState.allowed ?? false) &&
			// Client-read onboarding flag: `undefined` until known (don't flash), `false` = not yet
			// dismissed, `true` = dismissed.
			this._dismissals?.get('graph:intro') === false &&
			this._gatedPendingAction == null &&
			this.graphState.pendingAction == null
		);
	}

	private async consumePendingAction(pending: {
		action: GraphShowAction;
		target?: { sha: string; worktreePath: string; filePaths?: string[] };
		commitMessage?: string;
		scopeBranch?: GraphScopeBranch;
		scopeOrigin?: GraphScopeOrigin;
		composeInstructions?: string;
		composeScope?: GraphComposeScopeSeed;
		capturedComparison?: CapturedComparison;
		agentSessionId?: string;
		revealOnly?: boolean;
		followed?: boolean;
		onlyIfWipSelected?: boolean;
	}): Promise<void> {
		const {
			action,
			target,
			commitMessage,
			scopeBranch,
			scopeOrigin,
			composeInstructions,
			composeScope,
			capturedComparison,
			agentSessionId,
			revealOnly,
			followed,
			onlyIfWipSelected,
		} = pending;

		// Passive follow to the graph's own WIP row only lands while the user is already WIP-hopping
		// (a WIP row selected) — otherwise it would yank a deliberately-taken position for a row
		// that's one `w` keypress away. Dropping here skips everything: selection, reveal, the
		// coach-mark latch, and the agent highlight.
		if (onlyIfWipSelected === true) {
			const { single, multi } = this.activeSelection;
			if (multi != null || single == null || !isWipSelectionSha(single.sha)) return;
		}

		if (action === 'scope-to-branch') {
			// A target branch (from a Focus on Branch/Worktree command) scopes to it; otherwise scope
			// to the current branch (the welcome-page / generic `scope-to-branch` entry point).
			if (scopeBranch != null) {
				await this.scopeToBranchByName(scopeBranch.branchName, scopeBranch.upstreamName, {
					remote: scopeBranch.remote,
					origin: scopeOrigin,
				});
			} else {
				await this.scopeToBranch();
			}
			return;
		}

		if (action === 'open-compare' && capturedComparison != null) {
			const capturedFamily = this.familyOfRepoPath(capturedComparison.graphRepoPath);
			const live = this.detailsPanelEl?.liveComparison;
			if (
				!shouldRestoreCapturedComparison(capturedComparison.refs, capturedFamily, this.fallbackRepoFamily, live)
			) {
				return;
			}
		}

		// When a target is supplied (e.g. context-menu invocation on a secondary WIP row), route
		// the action to that row's worktree; otherwise fall back to the primary repo + uncommitted.
		const repoPath = target?.worktreePath ?? this.fallbackRepoPath ?? '';
		const sha = target?.sha ?? uncommitted;
		if (!(action === 'open-compare' && capturedComparison?.refs != null)) {
			this._selectedCommit = { sha: sha, repoPath: repoPath };
			this._selectedCommits = undefined;
		}

		// Reliably select the target row in the graph itself, not just the details panel. The host's
		// selection notification is prop-driven and can drop the synthetic WIP row to a render race
		// (the row is injected by `getDecoratedRows` only after Lit+React catch up), which surfaces as
		// review/compose updating the details but leaving the row unselected. `navigateToCommit`
		// normalizes `uncommitted`→the WIP row and retries across frames until it's injected. Skip for
		// compare (it drives its own range selection) and the rebase summary (selection-decoupled sheet).
		if (action !== 'open-compare' && action !== 'show-rebase-summary') {
			// The ROW sha, not the raw target sha: a WIP target on another worktree is that worktree's own
			// WIP row, while `navigateToCommit` maps `uncommitted` only to the graph's own primary row — so
			// handing it the raw sha would select the wrong worktree's working changes. `undefined` means no
			// row id is nameable yet (transient repo-switch tick), so there is nothing to navigate to.
			const rowSha = this.toGraphRowSha(sha, repoPath);
			if (rowSha != null) {
				// Any WIP selection, not just the `uncommitted` revision — actions target `wip::<path>` row ids,
				// and gating on the revision alone would reveal into a scope that still hides the row.
				if (isWipSelectionSha(sha)) {
					this.overviewBar.unscopeToRevealWip(rowSha);
				}
				void this.graph?.navigateToCommit(rowSha, { source: 'selection-sync', reveal: 'if-changed' });
			}
		}

		const showDetails = () => {
			this.setDetailsVisible(true, 'request-mode');
			this.ensureDetailsPosition();
		};

		if (action === 'show-rebase-summary') {
			void this.withDetailsPanel(panel => panel.openRebaseSummary(repoPath), 'request-mode');
			return;
		}

		if (action === 'open-compare') {
			const compareParams =
				capturedComparison?.refs ??
				(target != null
					? {
							repoPath: repoPath,
							leftRef: this.graphState.branch?.name ?? 'HEAD',
							rightRef: sha,
							includeWorkingTree: true,
						}
					: {
							repoPath: repoPath,
							rightRef: this.graphState.branch?.name ?? 'HEAD',
							rightRefType: 'branch' as const,
							includeWorkingTree: true,
						});
			void this.withDetailsPanel(panel => panel.openCompareMode(compareParams), 'request-mode');
			return;
		}

		if (action === 'enter-review' || action === 'enter-compose' || action === 'enter-resolve') {
			const mode = action === 'enter-review' ? 'review' : action === 'enter-compose' ? 'compose' : 'resolve';
			// `filePaths` (resolve only) scopes the run to specific conflicted files; undefined = all conflicts.
			// `composeInstructions` (compose only) seeds the AI-instructions input; ignored by review/resolve.
			// `composeScope` (compose only) is the resolved recompose commit-range seed; absent = working-changes compose.
			void this.withDetailsPanel(
				panel =>
					panel.enterModeForWip(mode, repoPath, sha, target?.filePaths, composeInstructions, composeScope),
				'request-mode',
			);
			return;
		}

		// A host-resolved focus (Focus in Commit Graph on a terminal) scopes to the target worktree's
		// branch once the selection above has landed. CONSTRAINT: `scopeBranch` must cover the target
		// row — every producer resolves it from the target worktree's OWN current branch, so this
		// scope can't re-hide the row `unscopeToRevealWip` just revealed. A producer scoping to some
		// OTHER branch would break that.
		if (scopeBranch != null) {
			await this.scopeToBranchByName(scopeBranch.branchName, scopeBranch.upstreamName, {
				remote: scopeBranch.remote,
				origin: scopeOrigin,
			});
		}

		// `revealOnly` (passive follow deliveries) selects/reveals the row above without opening the
		// details panel.
		const detailsAlreadyVisible = this.graphState.details?.visible === true;
		if (revealOnly !== true) {
			showDetails();
		} else if (followed === true) {
			// Only the follow controller's passive deliveries set `followed` — a manual Focus also
			// sends `revealOnly` but must not trigger the follow coach mark.
			// Latch — never reset; see `_followTerminalRevealed`'s own doc comment.
			this._followTerminalRevealed = true;
		}

		await this.updateComplete;
		// Seed the WIP details commit input AFTER the panel has reconciled to the target row —
		// the panel clears `commitMessage` when its repo identity changes, so writing before
		// reconciliation can be wiped out. Used after Undo Commit so the user can immediately
		// edit and re-commit the message in the same box they'd normally type into.
		if (commitMessage != null && action === 'show-wip') {
			this.detailsPanelEl?.setCommitMessage(repoPath, commitMessage);
			// Also focuses for the existing undo-commit/add-author seeds, not just fixup.
			this.detailsPanelEl?.focusCommitMessage();
		}

		// Highlights an agent session's card in an already-open details panel. Sidebar-tree
		// highlighting has no equivalent API, so that stays out of scope here.
		// Passive deliveries only highlight into an ALREADY-open panel; a manual invocation that just
		// opened the panel (`revealOnly` unset) highlights into it too.
		if (action === 'show-wip' && agentSessionId != null && (detailsAlreadyVisible || revealOnly !== true)) {
			void this.dispatchAgentHighlight(agentSessionId);
		}
	}

	/** Resolve the details panel element, waiting across update cycles for it to mount. The panel
	 *  renders a few frames after `setDetailsVisible(true)` on a cold graph (initial data/layout),
	 *  so callers that act on it immediately after `showDetails()` would otherwise hit a null query.
	 *  Returns undefined if it never mounts within the cap (caller no-ops, same as before). */
	private async waitForDetailsPanel(timeoutMs = 8000): Promise<GlGraphDetailsPanel | undefined> {
		const start = performance.now();
		while (this.detailsPanelEl == null && performance.now() - start < timeoutMs) {
			await new Promise<void>(resolve => setTimeout(resolve, 30));
		}
		return this.detailsPanelEl;
	}

	/** What the LATEST {@link withDetailsPanel} reveal was for — lets the branch sheet's
	 *  `{open: false}` cancellation retire an in-flight BRANCH open without cross-cancelling an
	 *  unrelated reveal (compare/rebase/mode) that happens to be awaiting the panel: the graph fires
	 *  `{open: false}` on ANY click-outside-dismiss while a ref is pinned, sheet or no sheet. */
	private _detailsRevealFor: 'branch' | 'other' = 'other';

	/** Single open path for "make the details panel visible, wait for it to mount (a cold graph
	 *  open lags a few frames — see {@link waitForDetailsPanel}), then act on it". `token` guards
	 *  against a stale reveal (e.g. rapid clicks racing a repo switch) landing its callback after a
	 *  newer one already ran. */
	private async withDetailsPanel(
		fn: (panel: GlGraphDetailsPanel) => void,
		trigger: DetailsVisibleTrigger,
		revealFor: 'branch' | 'other' = 'other',
	): Promise<void> {
		const token = ++this._detailsRevealToken;
		this._detailsRevealFor = revealFor;
		this.setDetailsVisible(true, trigger);
		this.ensureDetailsPosition();
		const panel = await this.waitForDetailsPanel();
		if (token !== this._detailsRevealToken || panel == null) return;

		fn(panel);
	}

	private async scopeToBranch(): Promise<void> {
		const target = resolveScopeToBranchTarget(this.graphState.branch, this.fallbackRepoPath);
		if (target == null) {
			this.graphState.pendingScopeToBranch = true;
			return;
		}

		this.graphState.pendingScopeToBranch = false;
		const { branch, repoPath } = target;
		const branchRef = getBranchId(repoPath, false, branch.name);
		await this.setScope(
			{
				branchRef: branchRef,
				branchName: branch.name,
				upstreamRef: branch.upstream?.name ? getBranchId(repoPath, true, branch.upstream.name) : undefined,
			},
			'overview-card',
		);
	}

	/** Shared WIP selection + details-open flow. Used by both the inline graph WIP row
	 *  affordance and the WIP drawer above the graph. Sets the active selection, opens
	 *  the details panel, and optionally drives a mode-switch action. The graph component
	 *  fires its own selection-change for a row click in parallel; setting `_selectedCommit`
	 *  explicitly here ensures the details panel is on the right anchor before we drive the
	 *  target-specific action, regardless of dispatch ordering. */
	private async openWipDetails(
		repoPath: string,
		sha: string,
		target: 'compose' | 'review' | 'resolve' | 'agents' | undefined,
		trigger: 'request-mode' | 'request-agents' | 'request-graph-wip-bar',
	): Promise<void> {
		this._selectedCommit = { sha: sha, repoPath: repoPath };
		this._selectedCommits = undefined;
		this.setDetailsVisible(true, trigger);
		this.ensureDetailsPosition();
		// Wait for the details panel to render with the new selection before invoking the
		// target-specific action — otherwise both `toggleMode` (for compose/review) and the
		// agents-section query would see stale selection in their snapshots.
		await this.updateComplete;
		if (target === 'agents') {
			this.detailsPanelEl?.expandAgentsForWip();
		} else if (target != null) {
			this.detailsPanelEl?.enterModeForWip(target, repoPath, sha);
		}
	}

	/** Force the graph into `graph` display mode so a row can actually be revealed. Returns true when it
	 *  switched — the caller must then await a render before asking the (newly mounted) graph to reveal
	 *  anything. Shared by the overview bar's pill selection and its row-marker jumps. */
	private ensureGraphDisplayMode(): boolean {
		const gs = this.graphState;
		if (gs.displayMode === 'graph') return false;

		gs.displayMode = 'graph';
		this.persistState();
		return true;
	}

	private handleWipRowOpen = async (
		e: CustomEvent<{ target: 'compose' | 'review' | 'resolve' | 'agents'; row: GitGraphRow }>,
	): Promise<void> => {
		const { target, row } = e.detail;
		const fallbackRepoPath = this.fallbackRepoPath ?? '';
		// A WIP row's synthetic sha encodes its own worktree path; any other row type resolves to the
		// graph's (fallback) repo.
		const repoPath = getWipRowWorktreePath(row.sha) ?? fallbackRepoPath;
		const sha = row.kind === ('workdir' satisfies GitGraphRowKind) ? uncommitted : row.sha;
		await this.openWipDetails(repoPath, sha, target, target === 'agents' ? 'request-agents' : 'request-mode');
	};

	/** A coach mark's content-supplied action button — the mark's content declares which host command
	 *  it runs, so no per-mark dispatch lives here. The cast is needed because `gitlens.graph.`-prefixed
	 *  ids collide with the webview-scoped naming heuristic (`GlWebviewCommands<'graph'>`) even for
	 *  plain `registerCommand` commands. */
	private readonly handleCoachMarkAction = async (e: CustomEvent<{ mark: GraphCoachMarkType }>): Promise<void> => {
		const command = graphCoachMarks[e.detail.mark]?.action?.command;
		if (command == null) return;

		const commands = await this.services?.commands;
		void commands?.execute(command as GlExtensionCommands);
	};

	/** Resolves once `predicate` holds (or a safety timeout elapses). An RPC write resolves when the HOST
	 *  has written and fired — the resulting state push arrives a transport hop later, so a caller that must
	 *  re-read settled state after its own write still has to wait for it. Polls with `setTimeout` (not RAF)
	 *  so it still resolves while the webview is hidden. */
	private waitForState(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
		if (predicate()) return Promise.resolve();

		return new Promise<void>(resolve => {
			const start = Date.now();
			const check = (): void => {
				if (predicate() || Date.now() - start >= timeoutMs) {
					resolve();
					return;
				}

				setTimeout(check, 32);
			};
			setTimeout(check, 32);
		});
	}

	/** Waits for the scope's projection to actually apply to the rendered rows (or `timeoutMs`, for
	 *  scopes that resolve dim-only and never project) — positioning before the restructure lands
	 *  scrolls the old layout and then yanks to the new one. Poll cadence matches waitForState. */
	private waitForScopeProjection(timeoutMs = 800): Promise<void> {
		const applied = (): boolean => this.graph?.isScopeProjectionActive() === true;
		if (applied()) return Promise.resolve();

		return new Promise<void>(resolve => {
			const start = Date.now();
			const check = (): void => {
				if (applied() || Date.now() - start >= timeoutMs) {
					resolve();
					return;
				}

				setTimeout(check, 32);
			};
			setTimeout(check, 32);
		});
	}

	protected override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		super.willUpdate(changedProperties);

		// Post-sign-in welcome interstitial — arm on a live account-wall clear (sign-in completed
		// while the account screen was showing). Skipped when the plan gate would still block the
		// graph, or when a parked/incoming task action exists (see `_postSignInPending`).
		const accountGated = this.isAccountGated;
		if (accountGated) {
			this._postSignInPending = false;
		} else if (
			this._wasAccountGated &&
			(this.graphState.allowed ?? false) &&
			this._gatedPendingAction == null &&
			this.graphState.pendingAction == null
		) {
			this._postSignInPending = true;
		}
		this._wasAccountGated = accountGated;

		// A task action arriving while the interstitial is up trumps onboarding — yield in willUpdate
		// so the graph mounts in this same render and the action (consumed in `updated`) doesn't land
		// in an unmounted subtree.
		if (this._postSignInPending && this.graphState.pendingAction != null) {
			this._postSignInPending = false;
		}

		// Access-gate action parking (#5534) — see `_gatedPendingAction`. In `willUpdate` (not
		// `updated`) so the same render that raises the wall already has the task copy.
		const gated = this.isAccessGated;
		if (gated) {
			const pending = this.graphState.pendingAction;
			if (pending != null) {
				this.graphState.pendingAction = undefined;
				this._gatedPendingAction = pending;
			}

			// A sign-out or plan change interrupting a live task: capture it on the flip, before this
			// render tears the details panel down. An explicit parked action wins over the ambient mode.
			if (!this._wasAccessGated && this._gatedPendingAction == null) {
				const task = this.detailsPanelEl?.activeTaskAction;
				if (task != null) {
					this._gatedPendingAction =
						task.action === 'open-compare'
							? {
									action: task.action,
									capturedComparison: {
										refs: task.compare,
										graphRepoPath: task.compareGraphRepoPath,
									},
								}
							: task;
				}
			}
		} else if (this._wasAccessGated) {
			const parked = this._gatedPendingAction;
			this._gatedPendingAction = undefined;
			// Only the account wall's rebuild re-delivers a host-held action by itself (its `getState`
			// early-return sends `pendingAction` without clearing it) — there the parked copy would be
			// a duplicate. The plan gate goes through the full build, which does clear it, so the parked
			// copy is the only one left. Consuming only when the rebuild carried nothing covers both.
			if (parked != null && this.graphState.pendingAction == null) {
				void this.updateComplete.then(() => this.consumePendingAction(parked));
			}
		}
		this._wasAccessGated = gated;
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

		const deferral = this._dismissals?.get('graph:coachMarks:bannerDeferral');
		if (deferral != null) {
			this._bannerDeferredBefore ??= deferral;
			// Only when the banner is what's actually holding marks back: the header doesn't render
			// without a repo, so there may be no banner to defer to.
			if (
				!deferral &&
				this.coachMarksAllowed &&
				isGraphWalkthroughBannerHighlighted({
					bannerCollapsed: this._dismissals?.get('graph-walkthrough:banner'),
					graphWalkthroughProgress: this._onboardingState.graphWalkthroughProgress.get(),
					graphWalkthroughStarted: this.graphState.graphWalkthroughStarted,
				})
			) {
				this._dismissals?.dismiss('graph:coachMarks:bannerDeferral');
			}
		}

		// Kick the row-marker merge-target resolve for the current branch (self-deduping per branch id, so
		// this is a no-op once resolved / while in flight). `graphState` is a `@consume`d context, so a
		// branch change never lands in `changedProperties` — drive it every render and let the guard filter.
		this.graphState.ensureRowMarkerMergeTarget();

		// Attach the `.graph` size observer as soon as the graph tree exists — it isn't rendered on the
		// first update when the account-access screen replaces it (signed out), and `firstUpdated` won't
		// fire again after sign-in.
		this.ensureGraphObserved();

		// Arm/disarm the overlay side bar's Esc dismissal — every open/close/pin transition
		// re-renders, so reconciling here covers them all (rail toggles, auto-collapse, host
		// config changes).
		this.sidebarOverlay.ensureEscHandling();

		if (this.shouldShowWelcome && !this._introShownReported) {
			this._introShownReported = true;
			emitTelemetrySentEvent(this, {
				name: 'graph/intro/shown',
				data: { withLayoutOptions: this.layoutPromptNeeded },
			});
		}

		// Start the Launchpad pipeline once `services` first resolves. `services` is a `@consume`d
		// context value (not a reactive property), so it won't appear in `changedProperties` — guard
		// with a one-shot flag instead.
		if (!this._launchpadInitialized && this.services != null) {
			this._launchpadInitialized = true;
			void this.accountLaunchpad.initLaunchpad(this.services);
		}

		// Account-bar context wiring (same `services` one-shot pattern as the Launchpad pipeline above —
		// `services` is a `@consume`d context value, so it won't appear in `changedProperties`).
		if (!this._accountContextsInitialized && this.services != null) {
			this._accountContextsInitialized = true;
			void this.accountLaunchpad.initAccountContexts(this.services);
		}

		// Invalidate any captured scope-restore mode on repo switch: a captured `_modeBeforeScope`
		// always belongs to the repo that was active when `openTimelineScope` ran. If the user
		// switches repos before scope-applied fires, restoring that mode on the new repo would
		// apply a stale intent. Drop the one-shot scope alongside it for the same reason.
		const selectedRepository = this.graphState.selectedRepository;
		if (selectedRepository !== this._wasSelectedRepository) {
			const isRepoSwitch = this._wasSelectedRepository !== undefined;
			if (isRepoSwitch && this._modeBeforeScope != null) {
				this.clearTimelineScope();
			}
			// Back/forward history must not jump across repos — drop it on an actual switch.
			if (isRepoSwitch) {
				this._nav.reset();
				this._navExpectedSha = undefined;
			}
			// The minimap's brush/scope zoom window is timeline-relative, not repo-relative — carrying
			// it across a switch re-clamps the old repo's window against the new repo's bounds instead
			// of showing the full new timeline. `resetZoom()` no-ops when already unzoomed.
			if (isRepoSwitch) {
				this.minimapEl?.resetZoom();
			}
			this._wasSelectedRepository = selectedRepository;
		}

		// Drain a pending focal-tip selection once the scope-anchor resolver lands the tip on the
		// active scope. branchRef equality guards against a fast re-scope landing the wrong branch's
		// tip; `focalBranchTipSha != null` covers the resolver's "no answer" case (rare — branch.sha
		// missing host-side). The pending ref is cleared as soon as we either select or detect the
		// scope has moved on, so a later unrelated update doesn't re-trigger.
		if (this._pendingFocalTipBranchRef != null) {
			const scope = this.graphState.scope;
			if (scope?.branchRef !== this._pendingFocalTipBranchRef) {
				this._pendingFocalTipBranchRef = undefined;
			} else if (scope.focalBranchTipSha != null) {
				const sha = scope.focalBranchTipSha;
				this._pendingFocalTipBranchRef = undefined;
				void this.graph?.navigateToCommit(sha, { source: 'selection-sync', reveal: 'if-changed' });
			}
		}

		const detailsVisible = this.graphState.details?.visible ?? false;
		if (detailsVisible !== this._wasDetailsVisible) {
			this._wasDetailsVisible = detailsVisible;
			if (detailsVisible) {
				// First show with no saved details location: save 'auto' to end the first-time
				// (hidden details) experience. Single chokepoint for every show path, including
				// host-driven (pending action) shows.
				if (this.graphState.config?.detailsLocation == null) {
					fireAndForget(this.updateGraphConfig({ detailsLocation: 'auto' }), 'configuration/update');
				}
				const pane = this.querySelector<HTMLElement>('.graph__details-pane');
				if (pane) {
					const isBottom = this.effectiveDetailsLocation === 'bottom';
					pane.classList.remove('details-opening', '-vertical');
					void pane.offsetWidth;
					pane.classList.add('details-opening');
					if (isBottom) {
						pane.classList.add('-vertical');
					}
					pane.addEventListener('animationend', () => pane.classList.remove('details-opening', '-vertical'), {
						once: true,
					});
				}
			}
		}

		// Drop the alternate-mode selection whenever we leave a non-graph mode, so a stale (possibly
		// cross-repo) selection doesn't flash in the details panel on the next entry — the timeline
		// chart re-emits its first-paint auto-select on remount, and kanban re-resolves on the next
		// card click. Tracked here rather than in `handleDisplayModeChange` so it covers every
		// `displayMode` writer (sidebar toggle, `openTimelineScope`, the search-request path that
		// forces `'graph'`, kanban close button). Use the EFFECTIVE mode (post-gating) for both the
		// transition detection and the host notification. The raw persisted `displayMode === 'kanban'`
		// value can survive across the experimental flag being turned off, and we don't want to tell
		// the host we're in kanban (or fire kanban cleanup) when the body is actually rendering as graph.
		const displayMode = this.effectiveDisplayMode;
		if (displayMode !== this._wasDisplayMode) {
			if (this._wasDisplayMode != null && this._wasDisplayMode !== 'graph') {
				this._altModeSelectedCommit = undefined;
			}
			// `closed` lifecycle telemetry for the alternate display modes. Entry impressions are
			// emitted by the mounted components themselves (`graph/timeline|treemap|kanban/shown`);
			// only the exit is recorded here, since this transition check is the single place every
			// `displayMode` writer (sidebar rail, close buttons, search-request path) funnels through.
			if (this._wasDisplayMode === 'visualizations') {
				// Resolve through the shared gate (NOT raw `visualizationMode`) so the reported mode
				// matches what was actually shown: with the experimental flag off, the wrapper
				// force-routes to the timeline regardless of a persisted `treemap*` choice, so reading
				// the raw value here would emit `treemap-*` for a session where only the timeline was
				// shown — an inconsistent `timeline shown → treemap closed` funnel.
				emitTelemetrySentEvent(this, {
					name: 'graph/visualizations/closed',
					data: {
						mode: getEffectiveVisualizationKey(
							this.graphState.visualizationMode,
							this.graphState.treemapMode,
							this.graphState.config?.experimentalVisualizationsEnabled === true,
						),
					},
				});
			} else if (this._wasDisplayMode === 'kanban') {
				emitTelemetrySentEvent(this, { name: 'graph/kanban/closed', data: {} });
			}
			this._wasDisplayMode = displayMode;
			// Notify the host so it can fetch row stats when entering Visualizations mode (stats are
			// otherwise only loaded when the minimap or changes column is visible).
			fireAndForget(this.setDisplayMode(displayMode), 'configuration/setDisplayMode');
		}

		// First-render auto-restore telemetry: panel was visible from persisted state, no explicit
		// setDetailsVisible call. Fire once after first paint so `currentMode` is queryable.
		if (this._detailsTelemetryFirstRender && detailsVisible) {
			this._detailsTelemetryFirstRender = false;
			this.emitDetailsVisibilityTelemetry(true, 'auto-restore');
		} else if (this._detailsTelemetryFirstRender) {
			this._detailsTelemetryFirstRender = false;
		}

		// Re-trigger the sidebar-panel's enter animation on transitions to visible AND on
		// active-panel changes while visible, but with DIFFERENT animations: `opening` for
		// the show/hide reveal (slide in from -8px X), `switching` for swapping the active
		// panel content (slide in from 4px Y — matches the sub-panel-enter used by
		// review/compose/compare). The panel element is always mounted (always in the split-
		// panel's `start` slot) so an unconditional `:host` animation would fire at 0 width.
		// Keyed on the composite open state, not `visible` alone: `visible` with no panel chosen renders
		// nothing, and animating that would burn the `opening` reveal on a 0-width panel.
		const sidebarOpen = this.sidebarOpen;
		const sidebarActivePanel = this.graphState.sidebar?.activePanel ?? null;
		const becameVisible = sidebarOpen && !this._wasSidebarVisible;
		const activePanelChanged =
			sidebarOpen &&
			!becameVisible &&
			this._wasSidebarActivePanel !== undefined &&
			sidebarActivePanel !== this._wasSidebarActivePanel;
		this._wasSidebarVisible = sidebarOpen;
		this._wasSidebarActivePanel = sidebarActivePanel;
		if (becameVisible || activePanelChanged) {
			const sidebarPanel = this.sidebarPanelEl;
			if (sidebarPanel != null) {
				const attr = becameVisible ? 'opening' : 'switching';
				sidebarPanel.removeAttribute('opening');
				sidebarPanel.removeAttribute('switching');
				// Force a reflow so the animation restarts even if an attribute was
				// re-added within the same microtask.
				void (sidebarPanel as HTMLElement).offsetWidth;
				sidebarPanel.setAttribute(attr, '');
				// The sidebar-panel itself listens for animationend on its inner element and
				// clears the attribute (animationend doesn't cross shadow DOM, so no listener here).
			}
		}

		// Handle pending action from walkthrough CTA or external show request
		const pendingAction = this.graphState.pendingAction;
		if (pendingAction != null) {
			this.graphState.pendingAction = undefined;
			void this.updateComplete.then(() => this.consumePendingAction(pendingAction));
		}

		// Handle a cold-show compare request (e.g. a terminal-link range) — warm shows arrive via
		// `GraphNavigationService.onRequestOpenCompareMode` instead. Mirrors the pendingAction handling above.
		const pendingCompare = this.graphState.pendingCompare;
		if (pendingCompare != null) {
			this.graphState.pendingCompare = undefined;
			void this.updateComplete.then(() => this.openCompareMode(pendingCompare));
		}

		if (
			shouldDrainParkedScopeToBranch(
				this.graphState.pendingScopeToBranch,
				this.graphState.branch,
				this.fallbackRepoPath,
			)
		) {
			void this.updateComplete.then(() => {
				if (!this.graphState.pendingScopeToBranch) return;

				return this.scopeToBranch();
			});
		}

		// Check for external search request (from file history command, etc.)
		const searchRequest = this.graphState.searchRequest;
		if (searchRequest && searchRequest !== this._lastSearchRequest) {
			this._lastSearchRequest = searchRequest;
			// An external search targets the graph — leave any non-graph mode (Visualizations OR
			// kanban) so the filtered graph is actually visible. Mirrors `applyExternalSearchRequest`.
			// Also drop any pending one-shot timeline scope: the timeline unmounts before its
			// `updated()` would fire `scope-applied`, so without this clear a prior scope could be
			// re-applied the next time visualizations mode is entered.
			if ((this.graphState.displayMode ?? 'graph') !== 'graph') {
				this.graphState.displayMode = 'graph';
			}
			// Scope is abandoned (not applied) — drop the auto-restore alongside it so a future
			// scope-applied (re-entered via timeline mode later) doesn't restore a stale mode.
			this.clearTimelineScope();
			// Wait for next render cycle to ensure graphHeader is ready
			void this.updateComplete.then(() => {
				this.graphHeader?.setExternalSearchQuery(searchRequest);
			});
		}
	}

	resetHover() {
		// `graphHover` is null whenever the graph tree isn't rendered — the account-access screen (early
		// return in `render`) or the no-repository empty state. `onStateUpdate` (graph.ts) only calls this on
		// state pushes that include `rows` (even `rows: []`), so the optional chaining keeps it safe if one
		// arrives while either screen is shown.
		this.graphHover?.reset();
	}

	override render() {
		if (this.isAccountGated || this.shouldShowWelcome) {
			return html`<gl-graph-access-account
				.intentAction=${this._gatedPendingAction?.action}
				.welcome=${this.shouldShowWelcome}
				.liveSignIn=${this._postSignInPending}
				.showLayoutOptions=${this.layoutPromptNeeded}
				.upgradedFromPreV19=${this.graphState.upgradedFromPreV19 ?? false}
				@gl-continue=${this.onWelcomeContinue}
			></gl-graph-access-account>`;
		}

		if (!this.graphState.allowed) {
			return html`<gl-graph-gate .intentAction=${this._gatedPendingAction?.action}></gl-graph-gate>`;
		}

		const detailsVisible = this.graphState.details?.visible ?? false;
		const minimapVisible = this.minimapShown;
		const { single, multi } = this.activeSelection;
		// No repository open: render only the empty state — skip the header and the whole graph subtree
		// (graph + minimap + sidebar + details) rather than mounting them just to paint the
		// empty state over the top. `repositories` is `undefined` during the initial load window, so `=== 0`
		// stays false until an actual `[]` arrives and the graph still renders while loading. This
		// intentionally mounts/unmounts the graph subtree on the no-repo↔repo transition — acceptable here
		// because there is no prior graph state to preserve (contrast the always-render remount-avoidance in
		// `renderDetailsPanel`/`renderGraphPaneContent`, which guards mode switches, not this).
		const noRepos = this.graphState.repositories?.length === 0;
		return html`
			<div class="graph">
				${when(
					!noRepos,
					() => html`
						<gl-graph-header
							class="graph__header"
							.navigateToCommit=${this.navigateToCommit}
							.detailsVisible=${detailsVisible}
							.detailsEffectiveLocation=${this.effectiveDetailsLocation}
							.detailsLocation=${this.graphState.config?.detailsLocation ?? 'auto'}
							.detailsAutoLocation=${this._autoEffectiveLocation}
							.minimapVisible=${minimapVisible}
							.hasSelectedCommit=${single != null || multi != null}
							@toggle-sidebar=${this.handleToggleSidebar}
							@toggle-details=${this.handleToggleDetails}
							@select-details-location=${this.handleSelectDetailsLocation}
							@show-details=${this.handleShowDetails}
							@toggle-minimap=${this.handleToggleMinimap}
							@jump-to-wip=${this.handleJumpToWip}
							@gl-search-exit=${this.handleSearchExit}
							@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
							@gl-graph-show-pr-sheet=${this.handleShowPrSheet}
						></gl-graph-header>
					`,
				)}
				<div class="graph__workspace">
					${
						noRepos
							? html`<gl-graph-empty-state class="graph__empty-state"></gl-graph-empty-state>`
							: html`
									<gl-graph-hover
										id="commit-hover"
										.distance=${0}
										.skidding=${15}
										.pushOverlay=${this.pushOverlay}
										@gl-graph-hoverpeekclosed=${this.handleHoverPeekClosed}
									></gl-graph-hover>
									<gl-drag-shift-overlay label="to Resume Dragging"></gl-drag-shift-overlay>
									<main id="main" class="graph__panes">${this.renderDetailsPanel()}</main>
								`
					}
				</div>
			</div>
		`;
	}

	private renderDetailsPanel() {
		// Always render the split panel to avoid DOM re-parenting (which causes layout jumps).
		// graphState.details.visible controls the split position; effective content controls divider state.
		// When no commit/compare is selected, default to the current branch's WIP.
		const { single, multi } = this.activeSelection;
		const hasSelection = single != null || multi != null;
		const fallbackPath = !hasSelection ? this.fallbackRepoPath : undefined;
		const effectiveSha = single?.sha ?? (fallbackPath != null ? uncommitted : undefined);
		const effectiveRepoPath = (single ?? multi)?.repoPath ?? fallbackPath;
		const hasContent = effectiveSha != null || multi != null;
		// The branch sheet has no selected commit but still fills the pane, so it needs the divider
		// draggable and maximize live too.
		const hasPaneContent = hasContent || this._branchSheetOpen;
		const detailsVisible = this.graphState.details?.visible ?? false;
		const isBottom = this.effectiveDetailsLocation === 'bottom';
		const sameSide = isBottom ? this.graphState.details?.bottomPosition : this.graphState.details?.position;
		// Until a side has been sized, carry the OTHER orientation's proportion across an auto-flip
		// (an open value < 100) so a wide details panel stays wide-as-tall instead of snapping to the
		// default. Once the user drags a side, its own key wins (see `detailsPositionKeyForEvent`).
		const otherSide = isBottom ? this.graphState.details?.position : this.graphState.details?.bottomPosition;
		const carried = otherSide != null && otherSide < 100 ? otherSide : undefined;
		const persisted = sameSide ?? carried;
		const position = detailsVisible ? (persisted ?? 100 - detailsDefaultPct) : 100;
		// Maximize is bottom-only and a sticky split-panel STATE, not a position write — the pane
		// overlays the whole container while the graph behind it keeps its exact size, and
		// `position`/`bottomPosition` stay untouched underneath so restore is exact. The divider is
		// gated on `detailsVisible` so a stray
		// flag can't force a hidden panel open. Two independent sources feed it: `panelMaximized`
		// (persisted panel state) and `sheetMaximized` (transient, derived from the open sheet — never
		// persisted).
		const panelMaximized =
			isBottom && detailsVisible && hasPaneContent && (this.graphState.details?.maximized ?? false);
		const sheetMaximized = isBottom && detailsVisible && hasPaneContent && this._sheetOpen && this._sheetMaximized;
		const maximized = panelMaximized || sheetMaximized;
		return html`<gl-split-panel
			class=${classMap({ 'graph__details-split': true, '-vertical': isBottom })}
			orientation=${isBottom ? 'vertical' : 'horizontal'}
			primary="end"
			.position=${position}
			?maximized=${maximized}
			.snap=${hasPaneContent ? this._detailsSnap : undefined}
			.disabled=${!hasPaneContent || maximized}
			?animate=${this._animateDetailsSplit}
			@gl-split-panel-change=${this.handleDetailsSplitChange}
			@gl-split-panel-drag-end=${this.handleSplitDragEnd}
			@gl-split-panel-closed-change=${this.handleDetailsClosedChange}
			@gl-split-panel-dblclick=${this.handleDetailsSplitDblClick}
		>
			<div slot="start" class="graph__graph-pane">${this.renderGraphPaneContent()}</div>
			<div slot="end" class="graph__details-pane" ?inert=${!detailsVisible}>
				<gl-graph-details-panel
					sha=${effectiveSha ?? nothing}
					repo-path=${effectiveRepoPath ?? nothing}
					?show-maximize=${isBottom}
					?maximized=${panelMaximized}
					?sheet-maximized=${sheetMaximized}
					?graph-ready=${this.detailsCoachMarksEligible}
					.shas=${multi?.shas}
					.graphReachability=${single?.reachability}
					.commitLite=${single?.commitLite}
					.commitLites=${multi?.commitLites}
					.showSearchBox=${this.graphState.details?.showSearchBox ?? true}
					.searchBoxFilter=${this.graphState.details?.searchBoxFilter ?? true}
					.navigation=${this._navState}
					.pushOverlay=${this.pushOverlay}
					@select-commit=${this.handleSelectCommit}
					@gl-toggle-details-maximized=${this.handleToggleDetailsMaximized}
					@gl-graph-sheet-stack-change=${this.handleSheetStackChange}
					@gl-detail-sheet-closing=${this.handleDetailSheetClosing}
					@gl-nav-back=${this.handleNavBack}
					@gl-nav-forward=${this.handleNavForward}
					@gl-graph-details-mode-changed=${this.handleDetailsModeChanged}
					@gl-show-search-box-change=${this.handleDetailsShowSearchBoxChange}
					@gl-search-box-filter-change=${this.handleDetailsSearchBoxFilterChange}
					@next-steps-shown=${this.handleNextStepsShown}
					@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
					@gl-graph-show-pr-sheet=${this.handleShowPrSheet}
					@gl-graph-merge-pull-request=${this.handleMergePullRequest}
					@gl-graph-pr-compare=${this.handlePrCompare}
					@gl-graph-pr-review=${this.handlePrReview}
					@gl-graph-pr-review-changes=${this.handlePrReviewChanges}
				></gl-graph-details-panel>
			</div>
		</gl-split-panel>`;
	}

	private handleSelectCommit(e: CustomEvent<{ sha: string }>) {
		const displayMode = this.effectiveDisplayMode;
		// In alternate (non-graph) modes the graph is hidden and its selection isn't what the
		// details panel renders — drive the alt slot directly so details-panel-internal navigations
		// (parent SHA, autolinks) actually update the panel. Driving `selectCommits` on the hidden
		// graph would trigger an async `gl-graph-change-selection` that races with the alt slot
		// and clobbers it via `handleGraphSelectionChanged`.
		if (displayMode !== 'graph') {
			const repoPath = this._altModeSelectedCommit?.repoPath ?? this.fallbackRepoPath ?? '';
			this._altModeSelectedCommit = { sha: e.detail.sha, repoPath: repoPath };
			return;
		}

		// A parent-SHA or autolink click usually walks to a neighbor, which the reveal rule leaves in place —
		// the panel, not the graph, is what the user is reading. It still flashes: the click was theirs, and a
		// selection that moves without the viewport moving has nothing else marking it.
		void this.graph?.navigateToCommit(e.detail.sha, { source: 'details', flash: true });
	}

	private _nextStepsShownWhileHidden = false;

	private handleNextStepsShown() {
		if (!this.graphState.details?.visible) {
			this._nextStepsShownWhileHidden = true;
			return;
		}

		this.trackUsage('action:gitlens.graph.details.wipShown:happened');
	}

	private renderGraphPaneContent() {
		// Use the gated effective mode (see `effectiveDisplayMode`) so the body, the sidebar
		// toggle visibility, `handleSelectCommit` routing, and the mode-leave cleanup all agree
		// on what's actually visible — important when the user has disabled the kanban
		// experimental flag while persisted `displayMode === 'kanban'`.
		const displayMode = this.effectiveDisplayMode;
		const isGraphMode = displayMode === 'graph';
		// Always render the graph subtree to avoid the cascade of remounts (split-panels +
		// graph subtree) that produces a visible "smaller, then bigger"
		// resize when returning from Visual History. Mirrors the always-render pattern used
		// by `renderDetailsPanel`. Alternate-mode bodies still mount/unmount on demand.
		// `gl-graph-kanban-open-session` is listened for at the pane-body level (not on
		// `<gl-graph-kanban>` alone) so both the kanban view AND the Activity-mode treemap inside
		// `<gl-graph-visualizations>` can route a session-card / file click through the same
		// handler. These two subtrees are mutually exclusive sibling render branches — without
		// hoisting, a bubbled event from the treemap would never reach a listener.
		return html`
			<div
				class="graph__graph-pane-body"
				@gl-graph-kanban-open-session=${this.handleKanbanOpenSession}
				@gl-graph-open-branch=${this.handleOpenBranchSheet}
			>
				${when(
					this.graphState.config?.sidebar,
					() => html`<gl-graph-sidebar
						active-panel=${this.graphState.sidebar?.activePanel ?? nothing}
						.sidebarVisible=${this.graphState.sidebar?.visible ?? false}
						@gl-graph-sidebar-toggle=${this.handleSidebarToggle}
						@gl-graph-sidebar-display-mode-change=${this.handleDisplayModeChange}
						@gl-graph-sidebar-show-shortcuts=${this.handleShowShortcuts}
					></gl-graph-sidebar>`,
				)}
				<!-- Rendered unconditionally (not gated on graph.config.sidebar) — otherwise
				     keyboardShortcutsEl is undefined with the sidebar config off, and the ? shortcut silently no-ops. -->
				<gl-graph-keyboard-shortcuts
					.keymap=${this.keymap}
					@gl-graph-keyboard-shortcuts-closed=${() => this.graph?.focus()}
				></gl-graph-keyboard-shortcuts>
				${
					this.graphState.config?.sidebar
						? this.renderSidebarSplit(!isGraphMode)
						: html`<div class="graph__graph-content" ?hidden=${!isGraphMode}>
								${this.renderGraphMain()}
							</div>`
				}
				${
					displayMode === 'visualizations'
						? html`<div class="graph__graph-content">${this.renderVisualizationsMain()}</div>`
						: nothing
				}
				${
					displayMode === 'kanban'
						? html`<div class="graph__graph-content">${this.renderKanbanMain()}</div>`
						: nothing
				}
			</div>
		`;
	}

	private renderKanbanMain() {
		return html`<gl-graph-kanban
			?graph-ready=${this.coachMarksEligible}
			@gl-graph-kanban-close=${this.handleAlternateModeClose}
		></gl-graph-kanban>`;
	}

	private handleShowShortcuts = (): void => {
		this.keyboardShortcutsEl?.show();
	};

	/** Branch/tag pill focus → open/close the branch sheet in the details panel, mirroring the pill's
	 *  pinned state (`detail.open`). Opening ensures the pane is visible. */
	private handleOpenBranchSheet = (
		e: CustomEvent<{
			name?: string;
			refType?: string;
			remote?: string | null;
			sha?: string | null;
			context?: string;
			open?: boolean;
		}>,
	): void => {
		if (e.detail.open === false) {
			// Retires a BRANCH open still waiting on the panel to mount, as well as closing a mounted
			// one — a close arriving during that wait would otherwise be a no-op and the sheet would
			// appear after it. Scoped by `_detailsRevealFor`: this event fires on any click-outside
			// while a ref is pinned, and must not cancel an unrelated in-flight reveal.
			if (this._detailsRevealFor === 'branch') {
				this._detailsRevealToken++;
			}
			this._branchSheetOpen = false;
			this.detailsPanelEl?.closeBranchSheet();
			return;
		}
		if (e.detail.name == null) return;

		const ref: BranchSheetRef = {
			name: e.detail.name,
			refType: e.detail.refType ?? 'head',
			remote: e.detail.remote ?? null,
			sha: e.detail.sha ?? null,
			context: e.detail.context,
		};
		void this.withDetailsPanel(panel => panel.openBranchSheet(ref), 'request-mode', 'branch');
	};

	/** Whether the branch sheet is open — the details pane can hold content (and so be maximizable/
	 *  resizable) even with no selected commit. */
	@state()
	private _branchSheetOpen = false;

	/** Whether ANY sheet (branch, compare, conflict, rebase-summary) is currently open — the general
	 *  counterpart of {@link _branchSheetOpen}, gating the transient sheet-maximize. */
	@state()
	private _sheetOpen = false;

	/** Transient, derived sheet-maximize — never persisted. Seeded per-kind on open (rebase-summary
	 *  always, compare when `detailsMaximizeOnMode` is set), toggled by the sheet's own maximize chip,
	 *  and cleared whenever the sheet stack empties. See {@link releaseSheetMaximize}. */
	@state()
	private _sheetMaximized = false;

	/** True for the ~400ms glide after a sheet-maximize release — opts the details split into an
	 *  animated position change instead of its normal instant snap. Cleared by
	 *  {@link releaseSheetMaximize}'s timer. */
	@state()
	private _animateDetailsSplit = false;

	private _releaseSheetMaximizeTimer?: ReturnType<typeof setTimeout>;

	/** Ends a sheet-maximize engagement with an animated glide back to the panel's normal split.
	 *  No-op if not currently sheet-maximized. */
	private releaseSheetMaximize(): void {
		if (!this._sheetMaximized) return;

		if (this._releaseSheetMaximizeTimer != null) {
			clearTimeout(this._releaseSheetMaximizeTimer);
		}

		this._animateDetailsSplit = true;
		this._sheetMaximized = false;
		this._releaseSheetMaximizeTimer = setTimeout(() => {
			this._releaseSheetMaximizeTimer = undefined;
			this._animateDetailsSplit = false;
		}, 400);
	}

	/** A sheet started its animated exit (Esc/X/scrim) — restore early so the maximize glide runs
	 *  alongside the sheet's own close animation instead of snapping after it finishes. */
	private readonly handleDetailSheetClosing = (): void => {
		this.releaseSheetMaximize();
	};

	/** Monotonic stamp for PR-sheet opens — the payload resolution below can await network, so a
	 *  newer open (or any newer details reveal) must win over one still resolving. */
	private _prSheetResolveToken = 0;

	/** Polls the pull requests panel's own fetch to completion (triggering it if it hasn't started) so a
	 *  stack lookup has data to search — a 5s budget, matching what the panel's own cold load allows.
	 *  Returns `undefined` when a newer sheet-open superseded this one mid-poll (checked against
	 *  {@link token}), distinct from the panel legitimately returning no data. */
	private async ensurePullRequestsPanelData(
		data: DidGetSidebarDataParams | undefined,
		token: number,
	): Promise<DidGetSidebarDataParams | undefined | 'stale'> {
		if (data?.panel === 'pullRequests') return data;

		this._sidebarActions?.fetchPanel('pullRequests');

		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			await new Promise<void>(resolve => setTimeout(resolve, 50));
			if (token !== this._prSheetResolveToken) return 'stale';

			data = this._sidebarActions?.state.panels.pullRequests.value.get();
			if (data?.panel === 'pullRequests') break;
		}

		return data;
	}

	/** Resolves a pull request by number to its full payload (and, when it's part of a stack, that
	 *  stack's layers) before opening the sheet — so the sheet opens once with its final content instead
	 *  of opening blank and re-rendering when the panel data lands. The open itself rides
	 *  {@link withDetailsPanel}, the single reveal path every sheet shares. Returns whether a sheet was
	 *  actually opened, so a caller with a fallback (e.g. opening the pull request on the remote) knows
	 *  when resolution came up empty. */
	private async resolveAndOpenPrSheet(
		target: { number: string } | { stackNumber: number },
		push: boolean,
	): Promise<boolean> {
		const token = ++this._prSheetResolveToken;

		if ('stackNumber' in target) {
			return this.resolveAndOpenStackSheet(target.stackNumber, push, token);
		}

		const number = target.number;
		let data = this._sidebarActions?.state.panels.pullRequests.value.get();
		let pr = data?.panel === 'pullRequests' ? data.items.find(p => p.number === number) : undefined;

		if (pr == null) {
			pr = await this._sidebarActions?.findPullRequest(number);
			// Superseded by a newer resolve call — that call owns success/fallback, not this one.
			if (token !== this._prSheetResolveToken) return true;
		}

		if (pr == null) return false;

		let layers: GraphSidebarPullRequest[] | undefined;

		if (pr.stack != null) {
			const resolved = await this.ensurePullRequestsPanelData(data, token);
			// Superseded by a newer resolve call, not a failed one — that call owns whether a sheet (or
			// the url fallback) opens, so this one reports success to avoid a second, stale fallback.
			if (resolved === 'stale') return true;

			data = resolved;
			if (data?.panel === 'pullRequests') {
				// Built directly rather than through `groupPullRequestsByStack`: `pr` may have been
				// resolved via `findPullRequest` rather than found in the panel's own list (a searched
				// pull request, or one paged off the list), so the grouping's own member set can be
				// missing the very pull request the sheet is opening for.
				const stackNumber = pr.stack.number;
				const prNumber = pr.number;
				const members = data.items.filter(p => p.stack?.number === stackNumber);
				const index = members.findIndex(p => p.number === prNumber);
				if (index === -1) {
					members.push(pr);
				} else {
					members[index] = pr;
				}
				members.sort((a, b) => (b.stack?.position ?? 0) - (a.stack?.position ?? 0));

				layers = members.length >= 2 ? members : undefined;
			}
		}

		void this.withDetailsPanel(panel => panel.openPrSheet(pr, layers, { push: push }), 'request-mode');
		return true;
	}

	/** Opens the stack-root summary sheet for `stackNumber` — the top layer's own sheet with every
	 *  layer's data alongside it. Requires the full member set (no paged-off gaps): a partial load falls
	 *  back to the top loaded member's own (non-root) sheet rather than summarizing an incomplete stack. */
	private async resolveAndOpenStackSheet(stackNumber: number, push: boolean, token: number): Promise<boolean> {
		const data = await this.ensurePullRequestsPanelData(
			this._sidebarActions?.state.panels.pullRequests.value.get(),
			token,
		);
		// Superseded by a newer resolve call — that call owns success/fallback, not this one.
		if (data === 'stale') return true;

		const entry =
			data?.panel === 'pullRequests'
				? groupPullRequestsByStack(data.items).find(e => e.kind === 'stack' && e.number === stackNumber)
				: undefined;
		if (entry?.kind !== 'stack') return false;

		const members = entry.members;
		if (members.length === 0) return false;

		const top = members[0];
		if (members.length !== entry.size) {
			void this.withDetailsPanel(panel => panel.openPrSheet(top, members, { push: push }), 'request-mode');
			return true;
		}

		void this.withDetailsPanel(
			panel => panel.openPrSheet(top, members, { push: push, stackRoot: true }),
			'request-mode',
		);
		return true;
	}

	private handleShowPrSheet = (
		e: CustomEvent<{ number?: string; stackNumber?: number; push?: boolean; url?: string }>,
	): void => {
		const target =
			e.detail.stackNumber != null
				? { stackNumber: e.detail.stackNumber }
				: e.detail.number != null
					? { number: e.detail.number }
					: undefined;
		if (target == null) return;

		const url = e.detail.url;
		void this.resolveAndOpenPrSheet(target, e.detail.push === true).then(opened => {
			if (!opened && url != null) {
				// A synthetic anchor click rides the same webview link interception every PR chip's
				// own href uses — `window.open` is sandbox-dependent in webviews.
				const a = document.createElement('a');
				a.href = url;
				document.body.appendChild(a);
				a.click();
				a.remove();
			}
		});
	};

	/** The pull request sheet's Review with Agent — Launchpad's Start Review flow, agent route, with
	 *  the pull request pre-selected by url so no picker interrupts. */
	private handlePrReview = (e: CustomEvent<{ url: string }>): void => {
		this._ipc.sendCommand(ExecuteCommand, {
			command: 'gitlens.startReview',
			// The wizard only auto-selects the pull request when useDefaults rides along with prUrl
			args: [{ prUrl: e.detail.url, useDefaults: true, source: { source: 'graph' }, showOpenInAgent: 'agent' }],
		});
	};

	/** The pull request sheet's Compare Changes — pushed over the sheet so its back chevron returns there. */
	private handlePrCompare = (
		e: CustomEvent<{ leftRef: string; rightRef: string; rightRefType: 'branch' | 'commit' }>,
	): void => {
		const repoPath = this.fallbackRepoPath;
		if (repoPath == null) return;

		void this.withDetailsPanel(
			panel =>
				panel.openCompareOverSheet({
					repoPath: repoPath,
					leftRef: e.detail.leftRef,
					leftRefType: 'branch',
					rightRef: e.detail.rightRef,
					rightRefType: e.detail.rightRefType,
				}),
			'request-compare',
		);
	};

	/** The pull request sheet's Review Changes — enters the graph's AI review mode scoped to the
	 *  changes the pull request introduces (merge-base → head). */
	private handlePrReviewChanges = (
		e: CustomEvent<{ leftRef: string; rightRef: string; rightRefType: 'branch' | 'commit' }>,
	): void => {
		const repoPath = this.fallbackRepoPath;
		if (repoPath == null) return;

		void this.withDetailsPanel(
			panel =>
				panel.openReviewForComparison({
					repoPath: repoPath,
					leftRef: e.detail.leftRef,
					leftRefType: 'branch',
					rightRef: e.detail.rightRef,
					rightRefType: e.detail.rightRefType,
				}),
			'request-compare',
		);
	};

	private handleMergePullRequest = async (
		e: CustomEvent<{
			number: string;
			stack?: { number: number; position: number };
			mergeMethod?: 'merge' | 'squash' | 'rebase';
			confirmed?: boolean;
		}>,
	): Promise<void> => {
		const pullRequest = await this.services?.pullRequest;
		if (pullRequest == null) return;

		const response = await pullRequest.merge(e.detail.number, {
			mergeMethod: e.detail.mergeMethod,
			confirmed: e.detail.confirmed,
		});
		if (response?.merged === true) {
			this.detailsPanelEl?.markPullRequestMerged(e.detail.number, e.detail.stack);
		}
	};

	private handleAlternateModeClose = (): void => {
		const gs = this.graphState;
		if (gs.displayMode == null || gs.displayMode === 'graph') return;

		// `updated()` clears `_altModeSelectedCommit` on the mode transition; no explicit cleanup
		// of `_selectedCommit` / `_selectedCommits` needed here since alt modes don't write them.
		gs.displayMode = 'graph';
		this.persistState();
	};

	/** Kanban session-card click — open the details panel on that session's worktree WIP without
	 *  leaving kanban mode. The details panel lives in the outer split alongside the graph pane,
	 *  so the kanban body stays in the `start` slot while details slides in on the `end` slot.
	 *  Mirrors `handleWipRowOpen`'s selection + details-open flow minus the mode switch. */
	private handleKanbanOpenSession = (
		e: CustomEvent<{ worktreePath: string | undefined; commonPath: string | undefined; sessionId: string }>,
	): void => {
		void this.dispatchKanbanOpenSession(e.detail);
	};

	private async dispatchKanbanOpenSession(detail: {
		worktreePath: string | undefined;
		commonPath: string | undefined;
		sessionId: string;
	}): Promise<void> {
		try {
			const { worktreePath, commonPath, sessionId } = detail;

			// Gate on `session.commonPath === graph.family` — same rule the sidebar tree applies
			// for its agent-leaf clicks (sidebar-panel.ts `resolveAgentAnchor`). A kanban click on
			// a session whose owning repo differs from the graph's currently-selected family
			// would resolve a WIP sha against a repo the details panel can't reconcile with the
			// visible graph. Bail early so cross-repo cards stay no-op rather than producing
			// half-applied state. No fallback — `commonPath` is the authoritative repo identity,
			// and the cold-cache window before `resolveGitInfo` lands is narrow.
			const graphFamily = this.fallbackRepoFamily;
			if (commonPath == null || graphFamily == null || commonPath !== graphFamily) return;

			// Require the graph to have a resolved repo — the details panel can't reconcile a WIP anchor
			// against a graph that hasn't settled on one yet.
			if (this.fallbackRepoPath == null) return;

			// The row id keys off the SESSION's worktree, never `commonPath`: a session on the main
			// worktree has `worktreePath === commonPath`, and keying off the latter would point at
			// whichever worktree the graph is showing. Mirrors sidebar-panel.ts `resolveAgentAnchor`.
			const repoPath = worktreePath ?? commonPath;
			if (repoPath == null || repoPath === '') return;

			const sha = worktreePath != null ? createWipRowId(worktreePath) : uncommitted;

			// Write the alt-mode slot — kanban's `activeSelection` reads it directly. We deliberately
			// do NOT call `graph?.navigateToCommit(sha)` here: the graph is hidden in kanban
			// mode and its async `gl-graph-change-selection` would race the alt slot via
			// `handleGraphSelectionChanged`, snapping the details panel back to whatever row the
			// graph resolved (typically its primary WIP) instead of the clicked session's worktree.
			this._altModeSelectedCommit = { sha: sha, repoPath: repoPath };

			const wasAlreadyVisible = this.graphState.details?.visible === true;
			this.setDetailsVisible(true, 'request-agents');
			this.ensureDetailsPosition();
			// `setDetailsVisible` short-circuits when the panel is already visible, so the
			// `request-agents` trigger telemetry would otherwise be dropped for the common case
			// of clicking a kanban card while details is open. Emit explicitly to keep per-trigger
			// counts honest — mirrors `handleSidebarPanelSelect`'s compensation for the same race.
			if (wasAlreadyVisible) {
				this.emitDetailsVisibilityTelemetry(true, 'request-agents');
			}

			await this.updateComplete;
			this.detailsPanelEl?.highlightAgentSession(sessionId);
		} catch (ex) {
			Logger.error(ex, 'GraphApp.dispatchKanbanOpenSession');
		}
	}

	private renderVisualizationsMain() {
		const placement: 'editor' | 'view' = this.graphState.webviewId === 'gitlens.graph' ? 'editor' : 'view';
		return html`<gl-graph-visualizations
			placement=${placement}
			.scope=${this._timelineScope}
			?graph-ready=${this.coachMarksEligible}
			@gl-graph-visualization-mode-change=${this.handleVisualizationModeChange}
			@gl-graph-timeline-commit-select=${this.handleTimelineCommitSelect}
			@gl-graph-timeline-config-change=${this.handleTimelineConfigChange}
			@gl-graph-timeline-close=${this.handleTimelineClose}
			@gl-graph-timeline-scope-applied=${this.handleTimelineScopeApplied}
			@gl-graph-treemap-mode-change=${this.handleTreemapModeChange}
		></gl-graph-visualizations>`;
	}

	/** The side bar is open only when both hold — `visible` can be set with no panel chosen yet, and
	 *  that combination renders nothing. Every decision about open/closed reads this. */
	private get sidebarOpen(): boolean {
		return (this.graphState.sidebar?.visible ?? false) && this.graphState.sidebar?.activePanel != null;
	}

	private renderSidebarSplit(hidden = false) {
		const isOpen = this.sidebarOpen;
		const sidebarPosition = this.graphState.sidebar?.position ?? sidebarDefaultPct;
		const sidebarPinned = this.graphState.config?.sidebarPinned ?? false;
		return html`<gl-split-panel
			class="graph__sidebar-split"
			?hidden=${hidden}
			primary="start"
			mode=${sidebarPinned ? 'split' : 'overlay'}
			.position=${isOpen ? sidebarPosition : 0}
			.snap=${this._sidebarSnap}
			@gl-split-panel-change=${this.handleSidebarSplitChange}
			@gl-split-panel-drag-end=${this.handleSplitDragEnd}
			@gl-split-panel-closed-change=${this.handleSidebarClosedChange}
		>
			<gl-graph-sidebar-panel
				slot="start"
				?inert=${!isOpen}
				?open=${isOpen}
				active-panel=${this.graphState.sidebar?.activePanel ?? nothing}
				date-format=${this.graphState.config?.dateFormat ?? nothing}
				?graph-ready=${this.coachMarksEligible}
				@gl-graph-sidebar-panel-select=${this.handleSidebarPanelSelect}
				@gl-graph-show-pr-sheet=${this.handleShowPrSheet}
				@gl-graph-sidebar-toggle-pinned=${this.handleSidebarTogglePinned}
				@gl-graph-sidebar-search-box-filter-change=${this.handleSidebarSearchBoxFilterChange}
				@gl-graph-sidebar-show-past-agents-change=${this.handleSidebarShowPastAgentsChange}
				@gl-graph-overview-branch-selected=${this.handleOverviewBranchSelected}
				@gl-graph-overview-recent-threshold-change=${this.handleOverviewRecentThresholdChange}
				@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
			></gl-graph-sidebar-panel>
			<div slot="end" class="graph__graph-content">${this.renderGraphMain()}</div>
		</gl-split-panel>`;
	}

	private renderGraphMain() {
		if (!this.minimapMountable) {
			return this.renderGraphContent();
		}

		const minimapVisible = this.minimapShown;
		const minimapPosition = this.graphState.minimap?.position ?? 6;
		const position = minimapVisible ? minimapPosition : 0;
		return html`
			<gl-split-panel
				class="graph__minimap-split"
				orientation="vertical"
				primary="start"
				.anchoredPosition=${true}
				.position=${position}
				.snap=${this._minimapSnap}
				@gl-split-panel-change=${this.handleMinimapSplitChange}
				@gl-split-panel-drag-end=${this.handleSplitDragEnd}
				@gl-split-panel-closed-change=${this.handleMinimapClosedChange}
			>
				<gl-graph-minimap-container
					slot="start"
					.activeDay=${this.graphState.activeDay}
					?collapsed=${!minimapVisible}
					.rows=${this.graphState.rows ?? []}
					.rowsStats=${this.graphState.rowsStats}
					.rowsStatsLoading=${this.graphState.rowsStatsLoading}
					.dataType=${this.graphState.config?.minimapDataType ?? 'commits'}
					.markerTypes=${this.graphState.config?.minimapMarkerTypes ?? []}
					.reversed=${this.graphState.config?.minimapReversed ?? false}
					.refMetadata=${this.graphState.refsMetadata}
					.searchResults=${this.graphState.searchResults}
					.scopeWindow=${this.deriveScopeWindow()}
					.visibleDays=${
						this.graphState.visibleDays
							? { ...this.graphState.visibleDays } // Need to clone the object since it is a signal proxy
							: undefined
					}
					.wipRowsById=${this.graphState.wipRowsById}
					.primaryWipRowId=${this.primaryWipRowId}
					@gl-graph-minimap-selected=${this.handleMinimapDaySelected}
					@gl-graph-minimap-config-change=${this.handleMinimapConfigChange}
					@gl-graph-minimap-wheel=${this.handleMinimapWheel}
					@gl-graph-minimap-zoom-change=${this.handleMinimapZoomChange}
				></gl-graph-minimap-container>
				${this.renderGraphContent('end')}
			</gl-split-panel>
		`;
	}

	private renderGraphContent(slot?: 'end') {
		// Read once per render — the backing computed memoizes across renders, and the local var keeps
		// the binding identity-stable for the two reads below. Empty array is the bar's hide condition —
		// either there's no repo to anchor the primary pill to, or `overviewBar.visibility` hides it.
		const overviewItems = this.overviewBar.items;
		// `_selectedCommit.sha` is normalized to `uncommitted` for ALL WIP selections (the graph
		// collapses secondary WIP rows to `uncommitted` at selection time), so the selected worktree
		// is identified by `repoPath`, not `sha`. Resolve the selected pill by repoPath so selecting a
		// secondary WIP highlights its own pill instead of the primary's.
		const selectedCommit = this._selectedCommit;
		const selectedWipId =
			selectedCommit != null && isWipSelectionSha(selectedCommit.sha)
				? overviewItems.find(i => i.repoPath === selectedCommit.repoPath)?.id
				: undefined;
		return html`
			<div class="graph__graph-column" slot=${ifDefined(slot)}>
				${
					overviewItems.length > 0
						? html`
								<gl-graph-overview-bar
									.items=${overviewItems}
									.selectedId=${selectedWipId}
									.statsOnHover=${this.graphState.config?.showWorktreeWipStats !== false}
									?graph-ready=${this.coachMarksEligible}
									?follow-terminal-revealed=${this._followTerminalRevealed}
									@gl-graph-overview-bar-jump=${this.overviewBar.onJump}
									@gl-graph-overview-bar-select=${this.overviewBar.onSelect}
									@gl-graph-overview-bar-focus=${this.overviewBar.onFocus}
									@gl-graph-overview-bar-stats-needed=${this.overviewBar.onStatsNeeded}
									@gl-graph-show-pr-sheet=${this.handleShowPrSheet}
									@gl-coachmark-action=${this.handleCoachMarkAction}
								></gl-graph-overview-bar>
							`
						: nothing
				}
				<gl-graph-health-banner @gl-graph-show-git-health=${this.handleShowGitHealth}></gl-graph-health-banner>
				<gl-graph-wrapper
					.anchorShas=${this.activeAnchorShas}
					.keymap=${this.keymap}
					.rowMarkerMergeTarget=${this.graphState.rowMarkerMergeTarget}
					@gl-graph-change-column-mode=${this.handleGraphChangeColumnMode}
					@gl-graph-change-selection=${this.handleGraphSelectionChanged}
					@gl-graph-change-visible-days=${this.handleGraphVisibleDaysChanged}
					@gl-graph-copy-request=${this.handleGraphCopyRequest}
					@gl-graph-enable-changes-column=${this.handleGraphEnableChangesColumn}
					@gl-graph-filter-column=${this.handleGraphFilterColumn}
					@gl-graph-mouse-leave=${this.handleGraphMouseLeave}
					@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
					@gl-graph-navigation-failed=${this.jumpToast.onNavigationFailed}
					@gl-graph-navigation-loading=${this.jumpToast.onNavigationLoading}
					@gl-graph-edge-search=${this.jumpToast.onEdgeSearch}
					@gl-graph-row-context-menu=${this.handleGraphRowContextMenu}
					@gl-graph-row-double-click=${this.handleGraphRowDoubleClick}
					@gl-graph-row-hover=${this.handleGraphRowHover}
					@gl-graph-row-peek=${this.handleGraphRowPeek}
					@gl-graph-row-unhover=${this.handleGraphRowUnhover}
					@gl-graph-show-pr-sheet=${this.handleShowPrSheet}
					@gl-graph-merge-pull-request=${this.handleMergePullRequest}
					@gl-graph-pr-compare=${this.handlePrCompare}
					@gl-graph-pr-review=${this.handlePrReview}
					@gl-graph-pr-review-changes=${this.handlePrReviewChanges}
					@gl-graph-wip-row-open=${this.handleWipRowOpen}
					@rowhoverstart=${this.handleGraphRowHoverStart}
					@rowhovertrack=${this.handleGraphRowHoverTrack}
				></gl-graph-wrapper>
				${this.jumpToast.render()}
			</div>
		`;
	}

	private readonly _persistStateDebounced: Deferrable<() => void> = debounce(() => this.persistStateNow(), 200);

	private persistState(): void {
		this._persistStateDebounced();
	}

	private persistStateNow(): void {
		if (this.services == null) return;

		const gs = this.graphState;
		// `displayMode` is intentionally NOT persisted — every session starts in Graph mode.
		// Toggling to Visualizations is an in-memory affordance only; users opt back in per session.
		// `visualizationMode` and `treemapMode` ARE persisted so the user's last visualization choice
		// (and treemap sub-mode) carries forward across sessions when they re-enter Visualizations.
		// `maximized` is transient/derived (panel and sheet forms both) — never persisted.
		const { maximized: _maximized, ...persistedDetails } = gs.details ?? {};
		const state = {
			panels: {
				details: persistedDetails,
				sidebar: { ...gs.sidebar },
				minimap: { ...gs.minimap },
			},
			timeline: { ...gs.timeline },
			treemap: {
				mode: gs.treemapMode,
			},
			visualizationMode: gs.visualizationMode,
			overview: {
				recentThreshold: gs.overviewRecentThreshold,
			},
		};
		void (async () => {
			const storage = await this.services!.storage;
			await storage.updateWorkspace('graph:state', state);
		})();
	}

	private handleMinimapSplitChange(e: CustomEvent<{ position: number }>) {
		// Track position only while open — `handleMinimapClosedChange` owns the visibility flip.
		if (e.detail.position <= 0) return;

		const gs = this.graphState;
		// Spread the existing panel state — replacing it would drop `visible`, and a drag-open of a
		// hidden minimap would then be re-collapsed by the next render's visibility binding.
		const updates = { ...gs.minimap, position: e.detail.position };
		// A gesture that opens a not-currently-shown minimap is deliberate (unlike the programmatic
		// auto-show, which `minimapClosedStateAuthoritative` gates) — pin it so the visibility binding
		// keeps it open instead of snapping it shut on the next render.
		if (!this.minimapShown) {
			updates.visible = true;
		}
		gs.minimap = updates;
	}

	/**
	 * Whether the split panel's closed state is authoritative for the stored value. Under the `onSearch`
	 * policy with no pin, the divider position is derived from the search state — and `gl-split-panel`
	 * echoes `closed-change` for programmatic position updates too, so honoring those events would
	 * record our own auto-show as a user-chosen pin.
	 */
	private get minimapClosedStateAuthoritative(): boolean {
		const gs = this.graphState;
		return (gs.config?.minimapDefaultVisibility ?? 'onSearch') !== 'onSearch' || gs.minimap?.visible === true;
	}

	private handleMinimapClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		if (!this.minimapClosedStateAuthoritative) {
			// Drag-to-close of an auto-shown minimap dismisses the current search rather than
			// storing a value; a programmatic echo leaves everything alone.
			if (e.detail.closed && this.minimapSearchActive) {
				this.dismissMinimapForSearch();
			}
			return;
		}

		const gs = this.graphState;
		if (e.detail.closed) {
			if (gs.minimap?.visible !== false) {
				gs.minimap = { visible: false };
			}
		} else if (gs.minimap?.visible !== true) {
			gs.minimap = { visible: true, position: e.detail.position };
		}
	};

	private handleDetailsShowSearchBoxChange = (e: CustomEvent<boolean>): void => {
		const gs = this.graphState;
		if (gs.details?.showSearchBox !== e.detail) {
			gs.details = { showSearchBox: e.detail };
			this.persistState();
		}
	};

	private handleSidebarSearchBoxFilterChange = (_e: CustomEvent<boolean>): void => {
		// State has already been mutated by sidebar-panel; just trigger the debounced persist.
		this.persistState();
	};

	private handleSidebarShowPastAgentsChange = (_e: CustomEvent<boolean>): void => {
		// State has already been mutated by sidebar-panel; just trigger the debounced persist.
		this.persistState();
	};

	private handleDetailsSearchBoxFilterChange = (e: CustomEvent<boolean>): void => {
		const gs = this.graphState;
		if (gs.details?.searchBoxFilter !== e.detail) {
			gs.details = { searchBoxFilter: e.detail };
			this.persistState();
		}
	};

	private handleSidebarSplitChange(e: CustomEvent<{ position: number }>) {
		if (e.detail.position <= 0) return;

		const gs = this.graphState;
		if (gs.sidebar?.position !== e.detail.position) {
			gs.sidebar = { position: e.detail.position };
			// A pointer drag also persists on `handleSplitDragEnd`; a keyboard resize never fires
			// that event, so persist here too — the debounced wrapper coalesces the pointer case's
			// per-move calls into one.
			this.persistState();
		}
	}

	private handleSidebarClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		const gs = this.graphState;
		if (e.detail.closed) {
			if (gs.sidebar?.visible !== false) {
				gs.sidebar = { visible: false };
			}
			return;
		}

		let opened = false;
		const next: NonNullable<typeof gs.sidebar> = {};
		if (!gs.sidebar?.visible) {
			next.visible = true;
			opened = true;
		}
		if (gs.sidebar?.activePanel == null) {
			next.activePanel = 'overview';
			opened = true;
		}
		next.position = e.detail.position;
		gs.sidebar = next;
		if (opened) {
			this.focusSidebarFilterAfterRender();
		}
	};

	private handleSplitDragEnd = (): void => {
		this.persistState();
	};

	private setSidebarPanel(panel: GraphSidebarPanel, options?: { focusFilter?: boolean }): void {
		const gs = this.graphState;
		if (gs.sidebar?.activePanel === panel && gs.sidebar?.visible === true) return;

		gs.sidebar = { activePanel: panel, visible: true };
		this.persistState();
		if (options?.focusFilter !== false) {
			this.focusSidebarFilterAfterRender();
		}
	}

	private focusSidebarFilterAfterRender(): void {
		void this.updateComplete.then(() => this.sidebarPanelEl?.focusFilter());
	}

	/** Whether DOM focus is currently inside `root`, walking through shadow roots (an active element's own
	 *  shadow root can itself have a focused element, and so on). Containment is checked at EVERY level of
	 *  the descent: `contains` never crosses a shadow boundary, so testing only the deepest active element
	 *  would miss focus sitting inside a descendant host's shadow tree — the common case here. */
	private isFocusInside(root: Element | undefined | null): boolean {
		if (root == null) return false;

		let active: Element | null = document.activeElement;
		while (active != null) {
			if (root === active || root.contains(active)) return true;

			active = active.shadowRoot?.activeElement ?? null;
		}

		return false;
	}

	private hideSidebar(): void {
		const gs = this.graphState;
		if (!gs.sidebar?.visible) return;

		gs.sidebar = { visible: false };
		this.persistState();
	}

	/** The resolved details location: an explicit `right`/`bottom` config is a pin (ignores width);
	 *  `auto` (the default) resolves to the width-driven `_autoEffectiveLocation`. Single source of
	 *  truth for split orientation, the persisted-position key, the open animation, the WIP bar
	 *  placement, the header toggle, and telemetry. */
	get effectiveDetailsLocation(): 'right' | 'bottom' {
		const configured = this.graphState.config?.detailsLocation ?? 'auto';
		return configured === 'auto' ? this._autoEffectiveLocation : configured;
	}

	private get detailsPositionKey(): 'position' | 'bottomPosition' {
		return this.effectiveDetailsLocation === 'bottom' ? 'bottomPosition' : 'position';
	}

	/** Position key for a split-change/closed-change event, derived from the split-panel's OWN live
	 *  orientation rather than `effectiveDetailsLocation`. During an `auto` width flip,
	 *  `_autoEffectiveLocation` updates synchronously while the split's re-render — and the position
	 *  it emits — lags by one async render; reading the emitting panel's orientation keeps the
	 *  persisted value in the key that matches the position's orientation. */
	private detailsPositionKeyForEvent(e: Event): 'position' | 'bottomPosition' {
		return (e.currentTarget as HTMLElement | null)?.getAttribute('orientation') === 'vertical'
			? 'bottomPosition'
			: 'position';
	}

	private ensureDetailsPosition(): void {
		const gs = this.graphState;
		const key = this.detailsPositionKey;
		// Only reset a position that snapped to closed (exact 100) so reopening after a drag-to-close
		// shows a usable width. Leave an UNSET side unset — `renderDetailsPanel` falls back to the
		// default, and carries the other orientation's proportion across a flip; persisting a default
		// here would mark the side "sized" and suppress that carry.
		const stored = gs.details?.[key];
		if (stored == null || stored < 100) return;

		gs.details = { [key]: 100 - detailsDefaultPct };
		this.persistState();
	}

	private setDetailsVisible(visible: boolean, trigger?: DetailsVisibleTrigger): void {
		const gs = this.graphState;
		if (gs.details?.visible === visible) return;

		// Clear maximize on hide so reopening isn't stuck full-height.
		gs.details = visible ? { visible: visible } : { visible: visible, maximized: false };
		this.persistState();
		this.emitDetailsVisibilityTelemetry(visible, trigger ?? 'toggle');
	}

	/** Persists an explicit placement pick (from the split-toggle's chevron popover). Picking a
	 *  placement implies wanting to see it, so a hidden panel is shown as part of the pick. */
	private setDetailsLocation(location: 'auto' | 'right' | 'bottom'): void {
		const effectiveSide = location === 'auto' ? this._autoEffectiveLocation : location;
		// Maximize is bottom-only — drop it when the pick lands on the right.
		if (effectiveSide === 'right' && this.graphState.details?.maximized) {
			this.graphState.details = { maximized: false };
		}

		fireAndForget(this.updateGraphConfig({ detailsLocation: location }), 'configuration/update');

		if (!this.graphState.details?.visible) {
			this.setDetailsVisible(true, 'placement');
			this.ensureDetailsPosition();
		}
	}

	private handleToggleDetailsMaximized = (e: CustomEvent<{ sheet?: boolean } | undefined>): void => {
		if (e.detail?.sheet) {
			if (this._sheetMaximized) {
				this.releaseSheetMaximize();
			} else {
				// Engaging is an instant snap, same as the panel's own toggle — only the RELEASE glides.
				this._sheetMaximized = true;
			}
			return;
		}

		const gs = this.graphState;
		gs.details = { maximized: !(gs.details?.maximized ?? false) };
		this.persistState();
	};

	private handleSheetStackChange = (e: CustomEvent<{ kinds: SheetKind[]; prevKinds: SheetKind[] }>): void => {
		this.handleBranchSheetStackChange(e.detail.kinds, e.detail.prevKinds);

		const { kinds, prevKinds } = e.detail;
		this._sheetOpen = kinds.length > 0;

		// Seed per-kind auto-maximize on kind-add; a manual toggle persists across in-stack replaces.
		if (kinds.includes('rebaseSummary') && !prevKinds.includes('rebaseSummary')) {
			this._sheetMaximized = true;
		} else if (
			kinds.includes('compare') &&
			!prevKinds.includes('compare') &&
			(this.graphState.config?.detailsMaximizeOnMode ?? true)
		) {
			this._sheetMaximized = true;
		}

		if (kinds.length === 0 && prevKinds.length > 0) {
			this.releaseSheetMaximize();
		}
	};

	/** The branch sheet opening/closing. Close is an "any path" signal — Esc/X/scrim, the Focus
	 *  action, the pane's own close request, the selection auto-close, or a graph-initiated close
	 *  round-tripping through `closeBranchSheet`. Clear the graph's click-pinned ref focus so it
	 *  never outlives the sheet; `clearRefFocus` is idempotent, so a graph-initiated close looping
	 *  back here is a no-op. */
	private handleBranchSheetStackChange(kinds: SheetKind[], prevKinds: SheetKind[]): void {
		const wasOpen = prevKinds.includes('branch');
		const isOpen = kinds.includes('branch');
		if (wasOpen === isOpen) return;

		if (!isOpen) {
			this._branchSheetOpen = false;
			this.graph?.clearRefFocus();
			return;
		}

		this._branchSheetOpen = true;
	}

	private emitDetailsVisibilityTelemetry(visible: boolean, trigger: DetailsVisibleTrigger): void {
		if (visible) {
			// `??=`, not `=`: the WIP-bar re-anchors an already-open panel by calling this directly
			// (setDetailsVisible short-circuits when visibility is unchanged). Only start the dwell
			// clock on a genuine open — a re-anchor must not reset it, or `graphDetails/closed`
			// `duration` would measure from the last pill click instead of the original open.
			// `_detailsShownAt` is cleared to undefined on close, so genuine opens still set it.
			this._detailsShownAt ??= performance.now();
			const { single, multi } = this.activeSelection;
			const selectionCount = multi != null ? multi.shas.length : single != null ? 1 : 0;
			const selectedSha = single?.sha;
			const effectivelyUncommitted =
				isWipSelectionSha(selectedSha) || (single == null && multi == null && this.fallbackRepoPath != null);
			if (effectivelyUncommitted && this._nextStepsShownWhileHidden) {
				this._nextStepsShownWhileHidden = false;
				this.trackUsage('action:gitlens.graph.details.wipShown:happened');
			}
			const host = this.graphState.webviewId === 'gitlens.graph' ? 'editor' : 'view';
			const location = this.effectiveDetailsLocation;
			this._telemetry.sendEvent({
				name: 'graphDetails/shown',
				data: {
					trigger: trigger,
					host: host,
					mode: this.detailsPanelEl?.currentMode ?? 'none',
					'selection.count': selectionCount,
					'selection.uncommitted': effectivelyUncommitted,
					position: this.graphState.details?.[this.detailsPositionKey],
					location: location,
				},
			});
		} else {
			const duration = this._detailsShownAt != null ? performance.now() - this._detailsShownAt : 0;
			this._detailsShownAt = undefined;
			this._telemetry.sendEvent({
				name: 'graphDetails/closed',
				data: { duration: duration, mode: this.detailsPanelEl?.currentMode ?? 'none' },
			});
		}
	}

	private handleDetailsModeChanged = (e: CustomEvent<{ previous: GraphDetailsMode; current: GraphDetailsMode }>) => {
		// compose/review opened/closed track real activeMode transitions and fire regardless of
		// panel visibility (programmatic exits like compose/applyPlan clear activeMode without a
		// user-driven open/close).
		this.trackModeOpenedClosed('compose', e.detail.previous, e.detail.current);
		this.trackModeOpenedClosed('review', e.detail.previous, e.detail.current);
		this.trackModeOpenedClosed('resolve', e.detail.previous, e.detail.current);

		// `graph.details.maximizeOnMode`: auto-maximize the bottom-docked details panel when entering a
		// mode (compose/review/resolve/compare), and restore when leaving it. Mode→mode transitions leave
		// the state alone, so a manual toggle mid-mode is respected.
		if (this.graphState.config?.detailsMaximizeOnMode ?? true) {
			const wasMode = this.isMaximizeMode(e.detail.previous);
			const isMode = this.isMaximizeMode(e.detail.current);
			if (isMode && !wasMode) {
				if (this.effectiveDetailsLocation === 'bottom' && !(this.graphState.details?.maximized ?? false)) {
					this.graphState.details = { maximized: true };
					this.persistState();
				}
			} else if (wasMode && !isMode && this.graphState.details?.maximized) {
				this.graphState.details = { maximized: false };
				this.persistState();
			}
		}

		// `shown`/`closed` already capture mode at open/close — only emit transitions while the
		// panel stays visible (e.g. swap-to-close, mode chip toggles), so the event isolates
		// in-panel transitions from open/close noise.
		if (this.graphState.details?.visible !== true) return;

		switch (e.detail.current) {
			case 'review':
				this.trackUsage('action:gitlens.graph.details.reviewMode:happened');
				break;
			case 'compose':
				this.trackUsage('action:gitlens.graph.details.composeMode:happened');
				break;
			case 'resolve':
				this.trackUsage('action:gitlens.graph.details.resolveMode:happened');
				break;
			case 'compare':
				this.trackUsage('action:gitlens.graph.details.compareMode:happened');
				break;
		}

		this._telemetry.sendEvent({
			name: 'graphDetails/mode/changed',
			data: { 'mode.old': e.detail.previous, 'mode.new': e.detail.current },
		});
	};

	/** The panel modes that auto-maximize the bottom-docked panel on entry (gated by
	 *  `graph.details.maximizeOnMode`). Compare only ever reports as a sheet — see
	 *  {@link handleSheetStackChange}'s own auto-maximize seeding. */
	private isMaximizeMode(mode: GraphDetailsMode): boolean {
		return mode === 'compose' || mode === 'review' || mode === 'resolve';
	}

	private trackModeOpenedClosed(
		mode: 'compose' | 'review' | 'resolve',
		previous: GraphDetailsMode,
		current: GraphDetailsMode,
	): void {
		if (current === mode && previous !== mode) {
			this._telemetry.sendEvent({ name: `graphDetails/${mode}/opened`, data: {} });
		} else if (previous === mode && current !== mode) {
			this._telemetry.sendEvent({ name: `graphDetails/${mode}/closed`, data: {} });
		}
	}

	private handleDetailsSplitChange(e: CustomEvent<{ position: number }>) {
		// Skip the closed-edge position (snap lands at exact 100). `handleDetailsClosedChange`
		// owns visibility; recording position=100 here would clobber the last open width.
		if (e.detail.position >= 100) return;

		this.graphState.details = { [this.detailsPositionKeyForEvent(e)]: e.detail.position };
	}

	private handleDetailsSplitDblClick = (e: Event): void => {
		// The agent-status split inside the details panel emits the same composed event — only
		// reset when the double-click came from this splitter's own divider.
		if (e.target !== e.currentTarget) return;

		this.graphState.details = { [this.detailsPositionKeyForEvent(e)]: 100 - detailsDefaultPct };
		this.persistState();
	};

	private handleDetailsClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		const gs = this.graphState;
		if (e.detail.closed) {
			this.setDetailsVisible(false);
		} else if (gs.details?.visible !== true) {
			gs.details = { [this.detailsPositionKeyForEvent(e)]: e.detail.position };
			this.setDetailsVisible(true, 'toggle');
		}
	};

	private handleShowDetails = (): void => {
		if (!this.graphState.details?.visible) {
			this.setDetailsVisible(true, 'toggle');
			this.ensureDetailsPosition();
		}
	};

	private handleJumpToWip = (): void => {
		if (this.effectiveDisplayMode !== 'graph') return;

		const scope = this.graphState.scope;
		const { branchesVisibility, includeOnlyRefs, branch } = this.graphState;
		// Only clear the scope when the WIP row isn't actually rendered under it — and ask the very
		// predicate the wrapper renders by rather than re-deriving it. The old `scope.branchRef !==
		// branch?.id` re-derivation drifted the moment that predicate stopped treating an unknown branch
		// as a mismatch: it kept clearing the scope for a row that was already on screen. It also read
		// "match" for a detached HEAD scoped from the overview (a detached id is SHA-keyed, so both sides
		// agreed) and skipped the clear for a row the gate hides — foreclosed now that `setScope` rejects
		// detached scopes at creation, so that leg is defense-in-depth against relaxing THAT guard.
		// Same rows-derived signal the wrapper feeds the predicate — omitting it here answered a different
		// question from the one that decided what's on screen, so an unknown branch with a loaded
		// off-HEAD focal had the wrapper hiding the row while this believed it existed and tried to
		// select it.
		const scopeFocalIsHead = branch == null ? isScopeFocalHead(this.graphState.rows, scope) : undefined;
		if (
			scope != null &&
			!shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, branch, scope, scopeFocalIsHead)
		) {
			// Nothing to jump to if it wouldn't render unscoped either — leave the scope alone.
			if (!shouldShowPrimaryWipRow(branchesVisibility, includeOnlyRefs, branch, undefined)) return;

			this.graphState.clearScope();
		}

		void this.graph?.navigateToCommit(uncommitted, { source: 'wip', flash: true });
	};

	private handleToggleDetails(e: CustomEvent<{ altKey?: boolean } | void>) {
		if (e.detail?.altKey) {
			// Pin to the opposite of the current effective side — this disables `auto` (the value is
			// an explicit `right`/`bottom`) and gives immediate visual feedback. Reset to `auto` via
			// the placement popover to re-enable width-aware behavior.
			const next = this.effectiveDetailsLocation === 'bottom' ? 'right' : 'bottom';
			this.setDetailsLocation(next);
			return;
		}

		const gs = this.graphState;
		if (gs.details?.visible) {
			const focusWasInside = this.isFocusInside(this.detailsPanelEl);
			this.setDetailsVisible(false);
			void this.updateComplete.then(() => {
				if (focusWasInside) {
					this.graph?.focus();
				}
			});
		} else {
			this.setDetailsVisible(true, 'toggle');
			this.ensureDetailsPosition();
		}
	}

	private handleSelectDetailsLocation(e: CustomEvent<{ location: 'auto' | 'right' | 'bottom' }>) {
		this.setDetailsLocation(e.detail.location);
	}

	/**
	 * Toggles the minimap by writing the stored per-workspace value — never the
	 * `gitlens.graph.minimap.defaultVisibility` policy, so `onSearch` stays reachable
	 * (pin → unpin → on-search). The one exception is hiding a minimap that's only up because of a
	 * search: that dismisses the current search rather than storing anything, so the next search
	 * brings it back.
	 */
	private handleToggleMinimap() {
		const gs = this.graphState;
		if (this.minimapShown && !this.minimapClosedStateAuthoritative) {
			this.dismissMinimapForSearch();
			return;
		}

		gs.minimap = { visible: !this.minimapShown };
		this.persistState();
	}

	private handleToggleSidebar() {
		const gs = this.graphState;
		const stashed = this.sidebarOverlay.takeOpenAtAutoCollapse();
		const wasOpen = stashed ?? this.sidebarOpen;
		if (wasOpen) {
			const focusWasInside = this.isFocusInside(this.sidebarPanelEl);
			this.hideSidebar();
			if (focusWasInside) {
				this.graph?.focus();
			}
		} else {
			this.setSidebarPanel(gs.sidebar?.activePanel ?? 'overview');
		}
	}

	private onWelcomeContinue(e: CustomEvent<{ layoutChoice?: 'sidebar' | 'panel' | 'dismissed' }>): void {
		this._postSignInPending = false;
		// Optimistic dismissal — flips `graph:intro` locally so `shouldShowWelcome` goes false and the
		// welcome unmounts without waiting for the host echo; persists via the onboarding RPC.
		this._dismissals?.dismiss('graph:intro');

		const choice = e.detail?.layoutChoice ?? 'dismissed';
		// Preserve layout analytics: fire only when the layout section was actually shown.
		if (this.layoutPromptNeeded) {
			emitTelemetrySentEvent(this, {
				name: 'graph/layoutPrompt/choice',
				data: { choice: choice },
			});
		}

		// One-and-done: dismisses `graph:layoutPrompt` host-side and moves the view for sidebar/panel;
		// `dismissed` just dismisses with no move. Rides the `welcome` service, not `_ipc`, so the
		// dismissal write and the view move ride the same causally-ordered RPC message (see
		// docs/webview-architecture.md).
		if (this.services != null) {
			notifyService(this.services.welcome, 'welcome/continueToGraph', svc =>
				svc.continueToGraph({ layoutChoice: choice }),
			);
		}
	}

	/** Opens `panel` with the same semantics the rail icon click uses: from a non-graph display mode,
	 *  switch to graph and open the panel; clicking/pressing the already-open active panel closes the
	 *  sidebar; otherwise switches the sidebar to that panel. Shared by the rail click
	 *  (`handleSidebarToggle`) and the Alt+digit shortcut, so the two can't drift. */
	private activateSidebarPanel(panel: GraphSidebarPanel, options?: { focusFilter?: boolean }): void {
		const gs = this.graphState;

		// From a visualization/kanban mode the rail icons return to the graph with the chosen panel
		// open rather than toggling — a click here always means "show me this in the graph". Written
		// inline (not via `setSidebarPanel`) so the `displayMode` change is always persisted: the
		// preserved `gs.sidebar` state can already match this panel, and `setSidebarPanel` early-returns
		// without persisting in that case.
		if ((gs.displayMode ?? 'graph') !== 'graph') {
			gs.displayMode = 'graph';
			gs.sidebar = { activePanel: panel, visible: true };
			this.persistState();
			if (options?.focusFilter !== false) {
				this.focusSidebarFilterAfterRender();
			}

			return;
		}

		if (gs.sidebar?.visible && gs.sidebar?.activePanel === panel) {
			const focusWasInside = this.isFocusInside(this.sidebarPanelEl);
			this.hideSidebar();
			if (focusWasInside) {
				this.graph?.focus();
			}
		} else {
			this.setSidebarPanel(panel, options);
		}
	}

	private handleSidebarToggle(e: CustomEvent<GraphSidebarToggleEventDetail>) {
		this.activateSidebarPanel(e.detail.panel);
	}

	private handleSidebarTogglePinned = (): void => {
		const next = !(this.graphState.config?.sidebarPinned ?? false);
		fireAndForget(this.updateGraphConfig({ sidebarPinned: next }), 'configuration/update');
	};

	private handleDisplayModeChange = (e: CustomEvent<GraphSidebarDisplayModeChangeEventDetail>): void => {
		const gs = this.graphState;
		if (gs.displayMode === e.detail.mode) return;

		// Synchronously flip the loading flag BEFORE the mode change triggers re-render, so the
		// timeline mounts with its overlay on first paint. Gated by `rowsStatsIncluded` (mirrors the
		// host's `_graph.includes.stats`) so it aligns with the host's refetch decision — checking
		// `_state.rowsStats` presence here would miss the stale-entries case where a prior stats-
		// bearing graph left keys behind but the current graph was rebuilt without stats.
		if (e.detail.mode === 'visualizations' && !this.graphState.rowsStatsIncluded) {
			gs.rowsStatsLoading = true;
		}

		gs.displayMode = e.detail.mode;
		// `renderGraphPaneContent` short-circuits the sidebar split when `displayMode !== 'graph'`, so
		// the user's `sidebarVisible` setting is preserved automatically and restored on return.
		this.persistState();
	};

	/** Toggles into/out of a display mode with the same semantics as the rail's bottom toggle click
	 *  (`sidebar.ts`'s `handleDisplayModeToggle`): the active mode returns to graph, any other mode
	 *  switches directly to it. Routes through `handleDisplayModeChange` — the same handler the rail's
	 *  click drives via `gl-graph-sidebar-display-mode-change` — so there is one behavior, not two. */
	private toggleDisplayMode(mode: Exclude<GraphDisplayMode, 'graph'>): void {
		const current = this.graphState.displayMode ?? 'graph';
		const next: GraphDisplayMode = current === mode ? 'graph' : mode;
		this.handleDisplayModeChange(
			new CustomEvent<GraphSidebarDisplayModeChangeEventDetail>('gl-graph-sidebar-display-mode-change', {
				detail: { mode: next },
			}),
		);
	}

	/** One-shot guard: `shown` telemetry per webview session, not per mount — the welcome screen's
	 *  full-viewport early-return can unmount/remount (e.g. a sign-out/sign-in cycle, or the Pro gate
	 *  toggling), and a remount must not mint a second impression. */
	private _introShownReported = false;

	private handleTimelineCommitSelect = (e: CustomEvent<GlGraphTimelineCommitSelectDetail>): void => {
		// Defensive — the timeline element only exists in timeline mode, but a queued event could
		// in theory land just after a mode flip; don't let it write the alt slot then.
		if ((this.graphState.displayMode ?? 'graph') !== 'visualizations') return;

		const { sha, repoPath, datum } = e.detail;
		const fallbackRepoPath = repoPath || this.fallbackRepoPath || '';

		// Build a lightweight commit shell from the timeline datum so the details panel can paint
		// synchronously, mirroring the eager commitLite flow that graph row clicks use.
		const commitLite = datum != null ? toCommitLiteFromTimelineDatum(datum, fallbackRepoPath) : undefined;

		const effectiveSha = sha === '' ? uncommitted : sha;
		this._altModeSelectedCommit = { sha: effectiveSha, repoPath: fallbackRepoPath, commitLite: commitLite };

		// Show the details panel on first selection, the same way graph-row double-click does.
		if (!this.graphState.details?.visible) {
			this.setDetailsVisible(true);
			this.ensureDetailsPosition();
		}
	};

	private handleTimelineClose = (): void => {
		const gs = this.graphState;
		if (gs.displayMode === 'graph') return;

		gs.displayMode = 'graph';
		this.persistState();
	};

	private handleTimelineConfigChange = (e: CustomEvent<GlGraphTimelineConfigChangeDetail>): void => {
		const gs = this.graphState;
		// Merge with existing gs.timeline — partial config events (e.g. the treemap
		// dispatches only `{ period }` from its shared period picker) must NOT erase
		// the timeline's `sliceBy` / `showAllBranches` selections.
		const next: NonNullable<typeof gs.timeline> = { ...gs.timeline };
		if (e.detail.period != null) {
			next.period = e.detail.period;
		}
		if (e.detail.sliceBy != null) {
			next.sliceBy = e.detail.sliceBy;
		}
		if (e.detail.showAllBranches != null) {
			next.showAllBranches = e.detail.showAllBranches;
		}
		gs.timeline = next;
		this.persistState();
	};

	/** Opens Repository Health from the in-graph health banner — same target as picking Health from
	 *  the visualizations switcher, plus the graph→visualizations entry the switcher never needs
	 *  because it only renders once already in visualizations mode. */
	private handleShowGitHealth = (): void => {
		const gs = this.graphState;
		gs.visualizationMode = 'health';
		// Mirrors `handleVisualizationModeChange`'s guard: a user-driven pick must clear any pending
		// scope-restore mode, or `handleTimelineScopeApplied` could clobber this choice later.
		this._modeBeforeScope = undefined;

		if (gs.displayMode !== 'visualizations') {
			// Mirrors `handleDisplayModeChange`'s own gate on entering 'visualizations' — a fresh
			// entry primes rowsStats the same way the sidebar rail toggle and the visualizations
			// switcher already do, in case the user switches to Visual History from here.
			if (!gs.rowsStatsIncluded) {
				gs.rowsStatsLoading = true;
			}
			gs.displayMode = 'visualizations';
		}

		this.persistState();
	};

	private handleVisualizationModeChange = (e: CustomEvent<GraphVisualizationModeChangeDetail>): void => {
		const gs = this.graphState;
		if (gs.visualizationMode === e.detail.mode) return;

		// User-driven mode change while a scope-open auto-restore is pending: drop the captured
		// prior mode so `handleTimelineScopeApplied` doesn't clobber the user's explicit choice.
		this._modeBeforeScope = undefined;

		gs.visualizationMode = e.detail.mode;
		this.persistState();
	};

	private handleTreemapModeChange = (e: CustomEvent<GraphTreemapModeChangeDetail>): void => {
		const gs = this.graphState;
		if (gs.treemapMode === e.detail.mode) return;

		gs.treemapMode = e.detail.mode;
		this.persistState();
	};

	private handleSidebarPanelSelect(e: CustomEvent<GraphSidebarPanelSelectEventDetail>): void {
		const navigate = () =>
			void this.graph?.navigateToCommit(e.detail.sha, { source: 'sidebar', flash: true, ref: e.detail.name });

		if (e.detail.scoped) {
			// The select's own scope event is restructuring the view — position once that lands, not
			// against the outgoing layout.
			void this.waitForScopeProjection().then(navigate);
		} else if (e.detail.canFocus) {
			this.sidebarOverlay.deferSelectNavigation(navigate);
		} else {
			// This select supersedes any navigation still held for a previous row — without the clear,
			// the stale timer fires after this immediate navigation and snaps the graph back.
			this.sidebarOverlay.cancelSelectNavigation();
			navigate();
		}

		if (this.sidebarOverlay.shouldAutoCollapse()) {
			this.sidebarOverlay.deferFocusHandoff();
		}

		// Agent leaves carry a `sessionId`; when present, open the details panel anchored on the
		// session's worktree WIP, expand the agents section, and highlight + scroll-into-view the
		// matching session card. Non-agent leaves (branches, tags, stashes, …) leave `sessionId`
		// undefined and skip this entirely so their existing behavior is unchanged.
		const sessionId = e.detail.sessionId;
		if (sessionId == null) return;

		const wasAlreadyVisible = this.graphState.details?.visible === true;
		this.setDetailsVisible(true, 'request-agents');
		this.ensureDetailsPosition();
		// `setDetailsVisible` short-circuits when the panel is already visible, so the
		// `request-agents` trigger telemetry would otherwise be dropped for the common case of a
		// user-initiated sidebar click on an open details pane. Emit explicitly to keep the
		// per-trigger count for sidebar-driven agent navigation honest.
		if (wasAlreadyVisible) {
			this.emitDetailsVisibilityTelemetry(true, 'request-agents');
		}

		// Fire-and-forget the highlight: Lit @-event listeners discard returned promises, so an
		// async handler swallows rejections silently. Keep the handler sync and catch explicitly.
		void this.dispatchAgentHighlight(sessionId);
	}

	private async dispatchAgentHighlight(sessionId: string): Promise<void> {
		try {
			await this.updateComplete;
			// On a cold graph the panel mounts a few frames after `setDetailsVisible(true)` — one
			// update cycle isn't enough when the highlight's own invocation just opened it.
			const panel = this.detailsPanelEl ?? (await this.waitForDetailsPanel());
			panel?.highlightAgentSession(sessionId);
		} catch (ex) {
			Logger.error(ex, 'GraphApp.dispatchAgentHighlight');
		}
	}

	private handleOverviewRecentThresholdChange = (e: CustomEvent<{ threshold: OverviewRecentThreshold }>): void => {
		const gs = this.graphState;
		if (gs.overviewRecentThreshold === e.detail.threshold) return;

		// The overview panel sends the `getOverview` RPC call itself — graph-app only owns the
		// persisted signal + `graph:state` memento write (mirrors `handleTimelineConfigChange`).
		gs.overviewRecentThreshold = e.detail.threshold;
		this.persistState();
	};

	private async handleOverviewBranchSelected(
		e: CustomEvent<{ branchId: string; branchName: string; mergeTargetTipSha?: string }>,
	): Promise<void> {
		// Toggle: clicking the card whose branch is already the active scope clears the scope
		// instead of re-scoping. Mirror the overview bar's scope-clearing click — clear, wait for
		// the host round-trip to settle, then re-reveal the branch so the user keeps their place.
		if (this.graphState.scope?.branchRef === e.detail.branchId) {
			this.graphState.clearScope();
			// Same settled-state predicate as the overview bar's scope-clearing click.
			await this.waitForState(
				() => this.graphState.scope == null && this.graph?.isScopeProjectionActive() !== true,
			);

			const sha = this.getOverviewBranchSelectionSha(e.detail.branchId);
			if (sha != null) {
				void this.graph?.navigateToCommit(sha, { source: 'overview', flash: true, ref: e.detail.branchName });
			}

			if (this.sidebarOverlay.shouldAutoCollapse()) {
				this.graph?.focus();
			}

			return;
		}

		// Await scope publish so the post-scope `navigateToCommit` runs against the settled
		// GK row index — eliminates the "WIP-not-selected on first scope" race where the bare
		// publish hadn't yet been replaced by the anchored publish at selection time.
		await this.scopeToBranchById(e.detail.branchId, e.detail.mergeTargetTipSha);
		// Supersession guard: a concurrent click on another branch can land while our `await` is
		// parked, publishing a different scope. If `this.graphState.scope` is no longer for our
		// branch by the time we resume, the newer scope owns the selection — don't fire a stale
		// `navigateToCommit` against the wrong scope.
		if (this.graphState.scope?.branchRef !== e.detail.branchId) return;

		// Wait for the projection to actually restructure the rows before positioning — otherwise the
		// scroll runs against the outgoing layout and then yanks to the new one once it lands.
		await this.waitForScopeProjection();
		// Same supersession guard: a newer scope can land during this second wait too.
		if (this.graphState.scope?.branchRef !== e.detail.branchId) return;

		const sha = this.getOverviewBranchSelectionSha(e.detail.branchId);
		if (sha != null) {
			void this.graph?.navigateToCommit(sha, { source: 'overview', flash: true, ref: e.detail.branchName });
		}

		// If the user clicked the card without first hovering, the merge-target tip SHA isn't known
		// yet (the card's lazy fetch hasn't run). Kick it off here so the scope's anchor backfills
		// via `reconcileScopeMergeTarget` once the fetch resolves. The card will pick up the result
		// from shared state on first hover and skip its own fetch.
		if (e.detail.mergeTargetTipSha == null) {
			void this.ensureOverviewBranchMergeTarget(e.detail.branchId);
		}

		if (this.sidebarOverlay.shouldAutoCollapse()) {
			this.graph?.focus();
		}
	}

	private async ensureOverviewBranchMergeTarget(branchId: string): Promise<void> {
		// Already resolved into shared state (from a prior hover or click) — nothing to do.
		if (this.graphState.overviewEnrichment?.[branchId]?.mergeTarget != null) return;

		const overview = this.graphState.overview;
		const branch = overview?.active.find(b => b.id === branchId) ?? overview?.recent.find(b => b.id === branchId);
		if (branch == null) return;

		const services = this.services;
		if (services == null) return;

		try {
			const branches = await services.branches;
			const enrichment = await branches.getBranchEnrichment(branch.repoPath, branch.name);
			const mergeTarget = await enrichment?.mergeTargetStatus;
			this.graphState.mergeMergeTargetIntoEnrichment(branchId, mergeTarget);
		} catch {
			// Swallow — the scope-anchor flow tolerates an absent tip SHA.
		}
	}

	private getOverviewBranchSelectionSha(branchId: string): string | undefined {
		const overview = this.graphState.overview;
		const branch = overview?.active.find(b => b.id === branchId) ?? overview?.recent.find(b => b.id === branchId);
		if (branch == null) return undefined;

		return getOverviewBranchSelectionSha(branch, {
			wipRowsById: this.graphState.wipRowsById,
			primaryWipRowId: this.primaryWipRowId,
			rows: this.graphState.rows,
			branchesVisibility: this.graphState.branchesVisibility,
			includeOnlyRefs: this.graphState.includeOnlyRefs,
			scope: this.graphState.scope,
			currentBranch: this.graphState.branch,
		});
	}

	private handleScopeToBranchFromHeader(
		e: CustomEvent<
			GraphScopeBranch & {
				source?: GraphScopeSource;
				additional?: { branchName: string; remote?: boolean }[];
				origin?: GraphScopeOrigin;
			}
		>,
	): Promise<void> {
		// A scope supersedes a sidebar select's held navigation — the scope path navigates on its own.
		this.sidebarOverlay.cancelSelectNavigation();

		// The scope carries additional branches as ref ids, so resolve them against the same repo path
		// `scopeToBranchByName` builds the focal ref from — a mismatched path yields ids that match no row.
		const repoPath = this.fallbackRepoPath;
		const additional = e.detail.additional;
		return this.scopeToBranchByName(e.detail.branchName, e.detail.upstreamName, {
			remote: e.detail.remote,
			source: e.detail.source,
			origin: e.detail.origin,
			additionalBranchRefs:
				additional?.length && repoPath != null
					? additional.map(b => getBranchId(repoPath, b.remote ?? false, b.branchName))
					: undefined,
		});
	}

	/** Focuses (scopes) the graph onto an arbitrary branch by name. Shared by the header popover, the
	 *  sidebar/overview events, and the Focus on Branch/Worktree context-menu commands (via the
	 *  `scope-to-branch` action). */
	private async scopeToBranchByName(
		branchName: string,
		upstreamName?: string,
		options?: {
			remote?: boolean;
			source?: GraphScopeSource;
			additionalBranchRefs?: string[];
			origin?: GraphScopeOrigin;
		},
	): Promise<void> {
		// Use the selected repo's actual path (the opened workspace's path). That's what the host
		// passes as `this.repository.path` when building the graph's row index AND the
		// `wipRowsById` branchRefs, so any scope/lookup branchRef constructed here must use
		// the same path to match. In primary-repo workspaces `path === commonPath`; in worktree
		// workspaces they differ — picking `commonPath` produces a synthetic id that won't match
		// any row or WIP entry.
		const repoPath = this.fallbackRepoPath;
		if (repoPath == null) return;

		const remote = options?.remote ?? false;
		const source = options?.source ?? 'popover';

		// Prefer the overview path so the merge target is resolved consistently with the overview card.
		// Skipped for a remote branch — the overview lists local branches, so a name hit there would be
		// a different ref entirely (a local `origin/x` is a legal, and distinct, branch).
		const overview = remote ? undefined : this.graphState.overview;
		const branch =
			overview?.active.find(b => b.name === branchName) ?? overview?.recent.find(b => b.name === branchName);
		if (branch != null) {
			const mergeTargetTipSha = this.graphState.overviewEnrichment?.[branch.id]?.mergeTarget?.sha;
			await this.scopeToBranchById(
				branch.id,
				mergeTargetTipSha,
				source,
				options?.additionalBranchRefs,
				options?.origin,
			);
			// Supersession guard: a concurrent `setScope` for a different branch can land while
			// our `await` is parked. If `this.graphState.scope` is no longer for our branch by the
			// time we resume, the newer call owns the selection — don't fire a stale one against
			// the wrong scope (would land selection on the previous click's WIP/tip).
			if (this.graphState.scope?.branchRef !== branch.id) return;

			// Position against the restructured rows, not the outgoing layout — the projection moves
			// rows after the publish, so navigating early scrolls to a stale position. Re-guard after:
			// a newer scope can land during the wait.
			await this.waitForScopeProjection();
			if (this.graphState.scope?.branchRef !== branch.id) return;

			const sha = this.getOverviewBranchSelectionSha(branch.id);
			if (sha != null) {
				this.overviewBar.revealForScope(sha, branchName, branch.id, 'sidebar');
			}
			return;
		}

		// Fallback: branch isn't in the overview's active/recent list. Synthesize a minimal
		// `OverviewBranch` and route through the helper — keeps a single source of truth for
		// the selection cascade. Without this, the inline cascade silently drifted from the
		// helper (e.g., missed the `loadedShas` gate, kept a stale `stats > 0` predicate).
		const branchRef = getBranchId(repoPath, remote, branchName);
		await this.setScope(
			{
				branchRef: branchRef,
				branchName: branchName,
				upstreamRef: upstreamName != null ? getBranchId(repoPath, true, upstreamName) : undefined,
				additionalBranchRefs: options?.additionalBranchRefs,
				origin: options?.origin,
			},
			source,
		);
		// Same supersession guard as above.
		if (this.graphState.scope?.branchRef !== branchRef) return;

		// Same restructure-first positioning as the overview path — and the tip lookup below must run
		// against the settled rows too.
		await this.waitForScopeProjection();
		if (this.graphState.scope?.branchRef !== branchRef) return;

		const isCurrent = !remote && this.graphState.branch?.name === branchName;
		// A remote branch's tip is carried by `row.remotes`, never `row.heads`.
		const tipSha = this.graphState.rows?.find(r =>
			remote ? r.remotes?.some(re => re.id === branchRef) : r.heads?.some(h => h.id === branchRef),
		)?.sha;
		// `worktree: undefined` is correct here — no overview hit means we don't know the
		// worktree affiliation, and the helper's case (2) recovers via `wipRowsById`
		// lookup by `branch.id`. Synthesizes the minimal `SelectionBranch` shape so the same
		// cascade serves both overview-card and header-popover paths.
		const synthesizedBranch: SelectionBranch = {
			id: branchRef,
			repoPath: repoPath,
			opened: isCurrent,
			reference: { sha: tipSha },
		};
		const sha = getOverviewBranchSelectionSha(synthesizedBranch, {
			wipRowsById: this.graphState.wipRowsById,
			primaryWipRowId: this.primaryWipRowId,
			rows: this.graphState.rows,
			branchesVisibility: this.graphState.branchesVisibility,
			includeOnlyRefs: this.graphState.includeOnlyRefs,
			scope: this.graphState.scope,
			currentBranch: this.graphState.branch,
		});
		if (sha != null && sha !== '') {
			// If the helper returned the tip and tip isn't loaded, the `rows.loadRow`
			// fallback in `navigateToCommit` will fetch it; otherwise the fast path or
			// synthetic-WIP retry handles it.
			this.overviewBar.revealForScope(sha, branchName, branchRef, 'overview');
			return;
		}

		// Branch tip isn't in the loaded rows page (older branch picked from the popover that
		// falls outside the default item limit). The host-side scope-anchor resolver loads the
		// focal branch on its way to computing `mergeBase`, so `focalBranchTipSha` will land on
		// `graphState.scope` once `resolveScopeMergeBase` completes. Drain it in `updated`.
		this._pendingFocalTipBranchRef = branchRef;
	}

	private async scopeToBranchById(
		branchId: string,
		mergeTargetTipSha?: string,
		source: GraphScopeSource = 'overview-card',
		additionalBranchRefs?: string[],
		origin?: GraphScopeOrigin,
	): Promise<void> {
		const overview = this.graphState.overview;
		if (overview == null) return;

		const branch = overview.active.find(b => b.id === branchId) ?? overview.recent.find(b => b.id === branchId);
		if (branch == null) return;

		const upstreamRef =
			branch.upstream != null && !branch.upstream.missing
				? getBranchId(branch.repoPath, true, branch.upstream.name)
				: undefined;

		// Prefer a passed-in SHA (from a fresh event) over the one on enrichment, but fall back to
		// enrichment so repeated calls pick up data that's arrived since the previous call.
		const sha = mergeTargetTipSha ?? this.graphState.overviewEnrichment?.[branchId]?.mergeTarget?.sha;

		await this.setScope(
			{
				// The graph component indexes rows by head id (e.g. `{repoPath}|heads/{name}`), not bare branch name
				branchRef: branch.id,
				branchName: branch.name,
				upstreamRef: upstreamRef,
				mergeTargetTipSha: sha,
				additionalBranchRefs: additionalBranchRefs,
				origin: origin,
			},
			source,
		);
	}

	private async setScope(scope: NonNullable<typeof this.graphState.scope>, source: GraphScopeSource): Promise<void> {
		// A detached HEAD is a `current` branch, so `getOverviewData` lists it and the Focus Branch
		// popover / overview cards route it here like any other branch. Its `branchName` is the
		// synthesized `(sha…)` label, which matches no row's head — the scope resolves nothing and only
		// hides the primary WIP row. Guarded here because this is the single choke point every entry
		// point funnels through (header, popover, overview card, sidebar, `scope-to-branch` command).
		//
		// Matched against the detached branch's OWN id and name — never a `(…)` shape test, which would
		// reject the legal branch `(release)`. Both are needed: the overview path builds `branchRef` from
		// `branch.id` (SHA-keyed when detached) while `scopeToBranch` builds it from `branch.name` (the
		// synthesized `(sha…)` label), so an id-only check let the name-built path straight through.
		const currentBranch = this.graphState.branch;
		if (
			currentBranch?.detached &&
			(scope.branchRef === currentBranch.id || scope.branchName === currentBranch.name)
		) {
			return;
		}

		// An accepted focus retires the parked walkthrough request — after the detached rejection
		// (the park must survive it), before the equality early-out (which skips `setScope`'s own cancel).
		this.graphState.pendingScopeToBranch = false;

		// Skip re-assignment when structurally equal so the graph doesn't re-evaluate
		// scope highlighting on unrelated graph updates. `additionalBranchRefs` and `origin` are part of
		// that identity: a stack and its base layer resolve to the SAME focal branch, so comparing the
		// focal fields alone made "Focus on Stack" a silent no-op right after focusing its base pull
		// request (and the reverse leave the header naming a stack it no longer shows).
		const current = this.graphState.scope;
		if (
			current?.branchRef === scope.branchRef &&
			current?.branchName === scope.branchName &&
			current?.upstreamRef === scope.upstreamRef &&
			current?.mergeTargetTipSha === scope.mergeTargetTipSha &&
			current?.origin?.kind === scope.origin?.kind &&
			current?.origin?.number === scope.origin?.number &&
			(current?.additionalBranchRefs?.length ?? 0) === (scope.additionalBranchRefs?.length ?? 0) &&
			(current?.additionalBranchRefs ?? []).every((ref, i) => ref === scope.additionalBranchRefs?.[i])
		) {
			return;
		}

		this.trackUsage('action:gitlens.graph.scope.changed:happened');
		emitTelemetrySentEvent(this, {
			name: 'graph/scope/changed',
			data: {
				source: source,
				'scope.hasUpstream': scope.upstreamRef != null,
				'scope.hasMergeTarget': scope.mergeTargetTipSha != null,
			},
		});
		// `stateProvider.setScope` resolves after the final scope publish (anchored when the
		// anchor IPC supplies a usable merge base, bare otherwise). Awaiting keeps the post-scope
		// selection cascade timed correctly — `navigateToCommit` sees the graph row index in
		// the settled state and can lock onto the WIP/tip without racing the bare→anchored render.
		await this.graphState.setScope(scope);
	}

	private _cachedScopeWindow:
		| {
				scope: AppState['scope'];
				rows: GitGraphRow[] | undefined;
				result: { start: number; end: number } | undefined;
		  }
		| undefined;
	/**
	 * Last successfully resolved window. Held across scope transitions so the minimap stays zoomed
	 * to the previous range while a freshly-picked scope's mergeBase is being backfilled — without
	 * this, the gap between `setScope` and `patchScopeMergeBase` shows as a flash to "no scope"
	 * before zooming into the new branch.
	 */
	private _lastResolvedScopeWindow: { start: number; end: number } | undefined;

	private deriveScopeWindow(): { start: number; end: number } | undefined {
		const scope = this.graphState.scope;
		if (scope == null) {
			this._lastResolvedScopeWindow = undefined;
			return undefined;
		}

		const result = this.computeScopeWindow(scope, this.graphState.rows);
		if (result != null) {
			this._lastResolvedScopeWindow = result;
			return result;
		}
		// Couldn't compute a window for the active scope — either `mergeBase` hasn't been backfilled
		// yet, or the branch tip isn't in the loaded rows. Hold the previously resolved window so
		// the minimap doesn't flash to unzoomed; once the missing data lands, `computeScopeWindow`
		// returns a real window and we transition in a single step.
		return this._lastResolvedScopeWindow;
	}

	private computeScopeWindow(
		scope: NonNullable<AppState['scope']>,
		rows: GitGraphRow[] | undefined,
	): { start: number; end: number } | undefined {
		if (scope.mergeBase == null) return undefined;

		const cache = this._cachedScopeWindow;
		if (cache?.scope === scope && cache.rows === rows) {
			return cache.result;
		}

		let result: { start: number; end: number } | undefined;
		const tipRow = rows?.find(
			r => r.heads?.some(h => h.id === scope.branchRef) || r.remotes?.some(re => re.id === scope.branchRef),
		);
		if (tipRow != null) {
			let end = getCommitDateFromRow(tipRow);
			if (scope.upstreamRef != null) {
				const upstreamRow = rows?.find(
					r =>
						r.remotes?.some(re => re.id === scope.upstreamRef) ||
						r.heads?.some(h => h.id === scope.upstreamRef),
				);
				if (upstreamRow != null) {
					const upstreamDate = getCommitDateFromRow(upstreamRow);
					if (upstreamDate > end) {
						end = upstreamDate;
					}
				}
			}
			result = { start: scope.mergeBase.date, end: end };
		}

		this._cachedScopeWindow = { scope: scope, rows: rows, result: result };
		return result;
	}

	// Resolves `not-found` when no repository is open: `this.graph` isn't rendered then (see `render`),
	// and the header is gated on the same condition.
	private navigateToCommit = (sha: string, options?: GraphNavigationOptions): Promise<GraphNavigationResult> =>
		this.graph?.navigateToCommit(sha, options) ?? Promise.resolve({ status: 'not-found' });

	private handleMinimapWheel(e: GraphMinimapWheelEvent) {
		this.graph?.scrollGraphBy(e.detail.deltaY);
	}

	/** Esc in the search box, once its own ladder (autocomplete, then a running search) is exhausted: the
	 *  box keeps its query and the keyboard returns to the rows. The event bubbles up from `gl-search-box`
	 *  through the header; other hosts of that shared component simply don't listen for it.
	 *
	 *  The overlay stack outranks the exit: the input consumes Esc before the document dispatcher can see
	 *  it, so an open transient surface (pinned hover card, minimap zoom) is popped HERE instead — focus
	 *  stays in the box, and the next Esc performs the exit. One action per press, stack-first. */
	private handleSearchExit(): void {
		if (this.keymap.closeTopOverlay()) return;

		this.graph?.focus();
	}

	/** Live overlay-stack registration for a zoomed minimap — non-null exactly while it's zoomed. */
	private _minimapZoomOverlay: Disposable | undefined;

	/** The minimap has no Esc handler of its own — the zoom joins the Esc overlay stack here, so exiting it
	 *  queues behind any transient surface opened over it instead of firing alongside. Driven off the
	 *  zoom-change event, which is the minimap's existing announcement of both directions. */
	private handleMinimapZoomChange(e: GraphMinimapZoomChangeEvent) {
		if (e.detail.zoomed) {
			this._minimapZoomOverlay ??= this.keymap.pushOverlay({
				id: 'graph-minimap-zoom',
				onClose: () => {
					if (this.minimapEl == null) return false;

					this.minimapEl.resetZoom();
					return true;
				},
			});
			return;
		}

		this._minimapZoomOverlay?.dispose();
		this._minimapZoomOverlay = undefined;
	}

	private handleMinimapDaySelected(e: CustomEvent<GraphMinimapDaySelectedEventDetail>) {
		if (!this.graphState.rows) return;

		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find the closest row to the date. Compare against COMMITTER date (what the minimap buckets
			// by) — `row.date` follows the user's ordering setting (author date when so configured), which
			// for rebased commits can be far off and would land on the wrong row.
			const closest = this.graphState.rows.reduce((prev, curr) => {
				return Math.abs(getCommitDateFromRow(curr) - date) < Math.abs(getCommitDateFromRow(prev) - date)
					? curr
					: prev;
			});
			sha = closest.sha;
		}

		// A landing: the click happened on the minimap, so the row's resting position is the only thing that
		// tells the user which day they hit.
		this.graph.selectCommits([sha], { ensureVisible: true, flash: true });

		if (e.target != null) {
			const { target } = e;
			queueMicrotask(() =>
				emitTelemetrySentEvent(target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
			);
		}
	}

	private handleMinimapConfigChange(e: CustomEvent<GraphMinimapConfigChangeEventDetail>) {
		const { minimapDataType, minimapReversed, markerType, checked } = e.detail;

		if (minimapDataType != null) {
			fireAndForget(this.updateGraphConfig({ minimapDataType: minimapDataType }), 'configuration/update');
			return;
		}

		if (minimapReversed != null) {
			fireAndForget(this.updateGraphConfig({ minimapReversed: minimapReversed }), 'configuration/update');
			return;
		}

		if (markerType != null && checked != null) {
			const currentTypes = this.graphState.config?.minimapMarkerTypes ?? [];
			let minimapMarkerTypes: GraphMinimapMarkerTypes[];
			if (checked) {
				if (currentTypes.includes(markerType)) return;

				minimapMarkerTypes = [...currentTypes, markerType];
			} else {
				const index = currentTypes.indexOf(markerType);
				if (index === -1) return;

				minimapMarkerTypes = [...currentTypes];
				minimapMarkerTypes.splice(index, 1);
			}
			fireAndForget(this.updateGraphConfig({ minimapMarkerTypes: minimapMarkerTypes }), 'configuration/update');
		}
	}

	private handleGraphSelectionChanged(e: CustomEventType<'gl-graph-change-selection'>) {
		this.graphHover.hide();

		const { selection, reachability, commits, userIntent } = e.detail;

		// Never clear the inspection anchor on an empty selection. The wrapper only dispatches genuine
		// (non-empty) intent here; an empty report is a scope/visibility filter-out or a transient GK
		// race, both of which must KEEP the details anchor (graph shows no highlight, details stay put).
		if (selection.length === 0) return;

		const fallbackRepoPath = this.fallbackRepoPath ?? '';

		if (selection.length >= 2) {
			const shas = selection.filter(s => s.type !== ('workdir' satisfies GitGraphRowKind)).map(s => s.id);

			if (shas.length >= 2) {
				this._selectedCommit = undefined;
				// `commits` from the wrapper is already scoped to the current selection (WIP rows
				// excluded), so it can be forwarded directly as the per-sha lite map.
				this._selectedCommits = { shas: shas, repoPath: fallbackRepoPath, commitLites: commits };
				// Multi-select (compare) isn't part of single-commit history; leave the guard intact.
			} else if (shas.length === 1) {
				// Multi-select included WIP + 1 commit — treat as single-select on the commit
				const sha = shas[0];
				this._selectedCommit = {
					sha: sha,
					repoPath: fallbackRepoPath,
					commitLite: commits?.[sha],
				};
				this._selectedCommits = undefined;
				this.recordNavSelection(sha, fallbackRepoPath, commits?.[sha]);
			} else {
				this._selectedCommit = undefined;
				this._selectedCommits = undefined;
				this._navExpectedSha = undefined;
			}
		} else {
			const active = selection[0];
			const sha = active.type === ('workdir' satisfies GitGraphRowKind) ? uncommitted : active.id;
			// Prefer per-row repoPath (for multi-worktree WIP); fall back to selected repo
			const repoPath = active.repoPath ?? fallbackRepoPath;

			this._selectedCommit = {
				sha: sha,
				repoPath: repoPath,
				reachability: reachability,
				commitLite: commits?.[active.id],
			};
			this._selectedCommits = undefined;

			// Record every viewed selection (commits, stashes, AND WIP) so back/forward is a true
			// history of what the details panel showed — Back from WIP returns to the prior commit.
			this.recordNavSelection(sha, repoPath, commits?.[active.id]);

			// When `graph.showWorktreeWipStats` is disabled, PEER worktree WIP rows start stats-less
			// (the graph's own rides the working-tree push). Force-fetch stats for the selected row so
			// it populates its pill.
			const selectedWorktreePath = getWipRowWorktreePath(active.id);
			if (
				selectedWorktreePath != null &&
				selectedWorktreePath !== fallbackRepoPath &&
				this.graphState.config?.showWorktreeWipStats === false
			) {
				void this.fetchSelectedWorktreeWipStats(active.id);
			}
		}

		// First-time experience: with no saved details location the panel starts hidden — the first
		// user-intent selection (row click / keyboard select) shows it, and the visibility transition
		// in `updated` then saves the location as 'auto'. Programmatic selection echoes (e.g. a
		// scope-to-branch focal-tip sync) must not open the panel uninvited.
		if (userIntent && !this.graphState.details?.visible && this.graphState.config?.detailsLocation == null) {
			this.setDetailsVisible(true);
			this.ensureDetailsPosition();
		}

		const count = this._selectionTrackingCounter.next();
		if (count === 1 || count % 100 === 0) {
			queueMicrotask(() =>
				this._telemetry.sendEvent({
					name: 'graph/row/selected',
					data: { rows: selection.length, count: count },
				}),
			);
		}
	}

	/** Records a viewed single selection (commit, stash, or WIP) into back/forward history. Suppresses the
	 *  selection echo(es) of our own {@link navigateTo} re-drive. The guard is STICKY (matched by
	 *  sha, not cleared on the first match) because the graph component can re-emit the same
	 *  selection multiple times (RAF retries / focus-row churn) — clearing on the first echo would
	 *  let a later duplicate re-record the target and clobber the forward history. It stays armed
	 *  until a genuinely different commit arrives, which records and disarms it. */
	private recordNavSelection(sha: string, repoPath: string, commitLite?: CommitDetails): void {
		if (sha === this._navExpectedSha) return;

		this._navExpectedSha = undefined;
		// Capture the commit shell so back/forward can paint synchronously (no skeleton/IPC wait),
		// matching a row click — and so it still works when the row has since been paged out.
		this._nav.record({ sha: sha, repoPath: repoPath, commitLite: commitLite });
	}

	private handleNavBack = (): void => this.navigateTo(this._nav.back());
	private handleNavForward = (): void => this.navigateTo(this._nav.forward());

	/** Navigates the details panel to a recorded commit. The panel always updates (we set the
	 *  selection slot directly); re-selecting the graph row is best-effort and may no-op for
	 *  filtered/paged-out/synthetic rows — the guard then clears on the next real selection. */
	private navigateTo(target: { sha: string; repoPath: string; commitLite?: CommitDetails } | undefined): void {
		if (target == null) return;

		this._navExpectedSha = target.sha;
		if (this.effectiveDisplayMode !== 'graph') {
			this._altModeSelectedCommit = { sha: target.sha, repoPath: target.repoPath, commitLite: target.commitLite };
		} else {
			// Carry the recorded commit shell so the details panel paints from cache — including when
			// the row has been paged out of the graph — then re-select the row in the graph.
			this._selectedCommit = { sha: target.sha, repoPath: target.repoPath, commitLite: target.commitLite };
			// WIP selections are recorded as the bare `uncommitted` revision + the worktree they came from;
			// re-select THAT worktree's row, or navigation maps the revision to our own WIP row.
			// Stepping back and forward mostly revisits rows still in view, which the reveal rule leaves
			// alone, so the graph follows the panel without fighting it for attention. Flashes because the
			// user pressed back/forward, and the row taking the selection needs to say so.
			void this.graph?.navigateToCommit(
				target.sha === uncommitted && target.repoPath ? createWipRowId(target.repoPath) : target.sha,
				{ source: 'history', flash: true },
			);
		}
	}

	private handleGraphVisibleDaysChanged({ detail }: CustomEventType<'gl-graph-change-visible-days'>) {
		this.graphState.visibleDays = detail;
	}

	/**
	 * Fetches working-tree stats for a single peer-worktree WIP row and writes them into
	 * `wipStateById` so the row's stats pill renders. Used when `graph.showWorktreeWipStats`
	 * is disabled — the host's `onGetWipStats` ignores non-`force` calls in that mode, and the
	 * graph's visible-scan dedup never re-asks for an unchanged missing set, so this is the only
	 * way to show stats for a row once the user opts in by selecting it.
	 */
	private async fetchSelectedWorktreeWipStats(sha: string): Promise<void> {
		const existing = this.graphState.wipStateById;
		if (existing == null) return;

		const current = existing[sha];
		if (current == null) return;

		// Already have stats for this row (user re-selected it) — nothing to do.
		if (current.workDirStats != null && !current.workDirStatsStale) return;

		const services = this.services;
		if (services == null) return;

		const ticket = this.graphState.claimWipStatsRequest([sha]);
		const response = (await (await services.wip).getStats([sha], { force: true })) ?? {};

		// A newer request for this row supersedes ours regardless of which response lands first — batches
		// no longer cancel each other, and the responses carry no revision to order by.
		if (!this.graphState.isCurrentWipStatsRequest(sha, ticket)) return;

		const map = this.graphState.wipStateById;
		if (map == null) return;

		const prev = map[sha];
		if (prev == null) return;

		const stats = response[sha];
		// `force: true` bypasses the disabled-feature short-circuit on the host, so a missing entry here
		// means the status read failed, or a later batch cancelled this one. Preserve any prior
		// `workDirStats` (including a sticky-restored value) rather than clobbering it with `undefined` —
		// and leave it stale, since nothing verified it. When the response does land, also pick up the
		// secondary's `pausedOpStatus` so the row reflects any in-progress rebase/merge/cherry-pick.
		if (stats === undefined) return;

		const updated = {
			...prev,
			workDirStats: stats.workDirStats,
			workDirStatsStale: false,
			// Retire the probe's bit against these counts, same as the other two authoritative writers
			// (`mergeWipState`, `graph-wrapper`'s stats merge) — a preserved `true` outlives the status that
			// disproved it and resurfaces as a phantom pill once these counts go stale.
			hasChanges: hasDirtyCounts(stats.workDirStats),
			pausedOpStatus: stats.pausedOpStatus,
			hasConflicts: stats.hasConflicts,
		};
		const next = { ...map, [sha]: updated };
		this.graphState.wipStateById = next;
	}

	// The Changes header mode picker's pick — a dedicated host write (not the columns persist, which drops
	// echoed `mode`), keeping the mode host-authoritative. Mirrors `gl-graph-filter-column`'s route.
	private handleGraphChangeColumnMode(e: CustomEventType<'gl-graph-change-column-mode'>): void {
		const services = this.services;
		if (services == null) return;

		notifyService(services.columns, 'set column mode', svc => svc.setColumnMode(e.detail.name, e.detail.mode));
	}

	// The dormant Changes column's one-time opt-in — a dedicated consent write (`graph.changesColumn.enabled`).
	private handleGraphEnableChangesColumn(_e: CustomEventType<'gl-graph-enable-changes-column'>): void {
		const services = this.services;
		if (services == null) return;

		notifyService(services.columns, 'enable changes column', svc => svc.enableChangesColumn());
	}

	private handleGraphFilterColumn(e: CustomEventType<'gl-graph-filter-column'>) {
		const header = this.graphHeader;
		if (header == null) return;

		switch (e.detail.zone) {
			case 'author':
				void header.pickAuthors();
				return;
			case 'ref':
				void header.pickRefs();
				return;
			case 'changes':
				void header.pickFiles();
				return;
			case 'message':
				header.insertSearchOperator('message:');
				return;
			case 'datetime':
				header.insertSearchOperator('since:');
				return;
			case 'sha':
				header.insertSearchOperator('commit:');
		}
	}

	/** `Ctrl`/`Cmd`+`C` inside the graph — `gl-lit-graph` serializes the focused/selected row's own
	 *  `data-vscode-context` string (same format the right-click menu uses) and we forward it to the
	 *  existing `gitlens.graph.copy` command, which already prefers `worktreePath` and newline-joins a
	 *  multi-selection — no new command needed. */
	private handleGraphCopyRequest(e: CustomEventType<'gl-graph-copy-request'>) {
		const { context, selectionContexts } = e.detail;
		let item: GraphItemContext | undefined;
		try {
			item = context != null ? (JSON.parse(context) as GraphItemContext) : undefined;
		} catch {
			item = undefined;
		}
		if (item != null) {
			// The parsed item only carries `webviewItem`/`webviewItemValue` — the host's
			// `isWebviewItemContext` guard also needs `webview`/`webviewInstance`, which a real
			// right-click gets for free from the root element's merged `data-vscode-context`.
			item.webview = this.graphState.webviewId;
			item.webviewInstance = this.graphState.webviewInstanceId;

			if (selectionContexts != null && selectionContexts.length > 1) {
				const parsedContexts: GraphItemContext[] = [];
				for (const s of selectionContexts) {
					let parsed: GraphItemContext | undefined;
					try {
						parsed = JSON.parse(s) as GraphItemContext;
					} catch {
						parsed = undefined;
					}

					if (parsed == null) continue;

					parsedContexts.push(parsed);
				}

				item.webviewItems = mergeWebviewItems(parsedContexts.map(c => c.webviewItem));
				item.webviewItemsValues = parsedContexts.map(c => ({
					webviewItem: c.webviewItem,
					webviewItemValue: c.webviewItemValue,
				}));
				item.listMultiSelection = true;
			}
		}
		this._ipc.sendCommand(ExecuteCommand, { command: 'gitlens.graph.copy', args: item != null ? [item] : [] });
	}

	private handleGraphRowContextMenu(_e: CustomEventType<'gl-graph-row-context-menu'>) {
		// A pinned keyboard peek would sit behind the context menu — end it explicitly, since `hide()`
		// is peek-inert by design (see GlGraphHover.hide).
		this.graphHover.closePeek();
		this.graphHover.hide();
	}

	/** Opens the details panel (unless already open) and, for a WIP row, also toggles the graph's
	 *  scope onto that row's branch — same behavior as the header's Focus button, reached from the
	 *  WIP row itself. Additive: runs regardless of whether the details panel was already open. */
	private handleGraphRowDoubleClick(e: CustomEventType<'gl-graph-row-double-click'>) {
		if (!this.graphState.details?.visible) {
			this.setDetailsVisible(true);
			this.ensureDetailsPosition();
		}

		if (e.detail.graphRow.kind === 'workdir') {
			this.toggleScopeFromWipRow(e.detail.graphRow.sha);
		}
	}

	private toggleScopeFromWipRow(sha: string): void {
		let branchRef: string | undefined;
		let branchName: string | undefined;
		let upstreamName: string | undefined;

		if (isPrimaryWipRowId(sha, this.fallbackRepoPath)) {
			const branch = this.graphState.branch;
			if (branch == null || branch.detached || branch.id == null) return;

			branchRef = branch.id;
			branchName = branch.name;
			upstreamName = branch.upstream?.missing ? undefined : branch.upstream?.name;
		} else {
			const wip = this.graphState.wipRowsById?.[sha];
			if (wip?.branchRef == null || wip.branch == null) return;

			branchRef = wip.branchRef;
			branchName = wip.branch.name;
			upstreamName = wip.branch.upstream?.missing ? undefined : wip.branch.upstream?.name;
		}

		if (this.graphState.scope?.branchRef === branchRef) {
			this.graphState.clearScope();

			return;
		}

		void this.scopeToBranchByName(branchName, upstreamName, { source: 'wip-row' });
	}

	private handleGraphRowHover({
		detail: { graphZoneType, graphRow, clientX, currentTarget },
	}: CustomEventType<'gl-graph-row-hover'>) {
		if (graphZoneType === 'ref') return;

		const hover = this.graphHover;
		if (hover == null) return;

		const rect = currentTarget.getBoundingClientRect();
		const x = clientX;
		const y = rect.top;
		const height = rect.height;
		const width = 60; // Add some width, so `skidding` will be able to apply
		const anchor = {
			getBoundingClientRect: function () {
				return {
					width: width,
					height: height,
					x: x,
					y: y,
					top: y,
					left: x,
					right: x + width,
					bottom: y + height,
				};
			},
		};

		hover.requestMarkdown ??= this.getRowHoverPromise.bind(this);
		hover.onRowHovered(graphRow, anchor);
	}

	/** Keyboard peek (`i` / `mod+I`) — the same hover card the pointer opens, driven
	 *  by the graph's focused row. The graph reads `detail.open` back off the event to learn the card's
	 *  state (it has no other view of it), so this handler must answer synchronously. */
	/** The hover closed a keyboard peek by a path the graph can't observe (Esc's overlay pop) — relay it
	 *  down so the graph syncs its peek flag and announces the close. */
	private handleHoverPeekClosed() {
		this.graph?.notifyPeekClosed();
	}

	private handleGraphRowPeek({ detail }: CustomEventType<'gl-graph-row-peek'>) {
		const hover = this.graphHover;
		if (hover == null) return;

		if (detail.action === 'close') {
			hover.closePeek();
			return;
		}

		hover.requestMarkdown ??= this.getRowHoverPromise.bind(this);
		detail.open =
			detail.action === 'toggle'
				? hover.togglePeek(detail.graphRow, detail.anchor)
				: hover.repeek(detail.graphRow, detail.anchor);
	}

	private handleGraphRowHoverTrack({
		detail: { graphZoneType, graphRow, minimapDate },
	}: CustomEventType<'rowhovertrack'>) {
		if (graphZoneType === 'ref') return;

		this.minimapEl?.select(minimapDate ?? graphRow.date, true);
		this.graphHover?.onRowChanged(graphRow);
	}

	private handleGraphRowUnhover({
		detail: { graphRow, relatedTarget },
	}: CustomEventType<'gl-graph-row-unhover'>): void {
		this.graphHover.onRowUnhovered(graphRow, relatedTarget);
	}

	private handleGraphRowHoverStart() {
		this.graphHover.resetUnhoverTimer();
	}

	private async getRowHoverPromise(row: GitGraphRow): Promise<DidGetRowHoverParams> {
		try {
			this._hoverAbort?.abort();
			const abort = new AbortController();
			this._hoverAbort = abort;

			const hover = await this.services?.hover;
			if (hover == null) throw new Error('Graph hover service unavailable');

			const request = await hover.getRowHover(row.kind, row.sha, abort.signal);

			const count = this._hoverTrackingCounter.next();
			if (count === 1 || count % 100 === 0) {
				queueMicrotask(() => this._telemetry.sendEvent({ name: 'graph/row/hovered', data: { count: count } }));
			}

			return request;
		} catch (ex) {
			return { id: row.sha, markdown: { status: 'rejected' as const, reason: ex } };
		}
	}

	private handleGraphMouseLeave() {
		this.minimapEl?.unselect(undefined, true);
	}
}

function toCommitLiteFromTimelineDatum(
	datum: { sha: string; author: string; email?: string; date: string; message: string; avatarUrl?: string },
	repoPath: string,
): CommitDetails {
	const date = new Date(datum.date);
	return {
		sha: datum.sha,
		shortSha: datum.sha.slice(0, 7),
		message: datum.message,
		author: { name: datum.author, email: datum.email, date: date, avatar: datum.avatarUrl },
		committer: { name: datum.author, email: datum.email, date: date, avatar: datum.avatarUrl },
		parents: [],
		repoPath: repoPath,
	};
}
