import type { GraphRow, SelectCommitsOptions } from '@gitkraken/gitkraken-components';
import { refZone } from '@gitkraken/gitkraken-components';
import { consume, provide } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import type { GitGraphRowType } from '@gitlens/git/models/graph.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import { basename } from '@gitlens/utils/path.js';
import type { GraphDetailsMode } from '../../../../constants.telemetry.js';
import type { CommitDetails } from '../../../commitDetails/protocol.js';
import type {
	DidRequestOpenCompareModeParams,
	DidRequestOpenTimelineScopeParams,
	DidRequestSearchParams,
	GraphDisplayMode,
	GraphMinimapMarkerTypes,
	GraphShowAction,
	GraphSidebarPanel,
	OverviewRecentThreshold,
	VisualizationMode,
} from '../../../plus/graph/protocol.js';
import {
	createSecondaryWipSha,
	createWipSha,
	DismissVisualizationsButtonCalloutCommand,
	GetRowHoverRequest,
	getSecondaryWipPath,
	GetWipStatsRequest,
	isSecondaryWipSha,
	isWipSha,
	ResetGraphFiltersCommand,
	TrackGraphDetailsCompareModeCommand,
	TrackGraphDetailsComposeModeCommand,
	TrackGraphDetailsResolveModeCommand,
	TrackGraphDetailsReviewModeCommand,
	TrackGraphDetailsWipShownCommand,
	TrackGraphScopeChangedCommand,
	UpdateGraphConfigurationCommand,
	UpdateGraphDisplayModeCommand,
} from '../../../plus/graph/protocol.js';
import {
	formatAgentElapsed,
	indexAgentSessionsByRepoAndWorktree,
	matchAgentSessionsForWorktree,
} from '../../shared/agentUtils.js';
import type { CustomEventType } from '../../shared/components/element.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../shared/contexts/telemetry.js';
import type { NavigationState } from '../../shared/controllers/navigationStack.js';
import { NavigationStack } from '../../shared/controllers/navigationStack.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import type { GlGraphDetailsPanel } from './components/gl-graph-details-panel.js';
import type { GlGraphKeyboardShortcuts } from './components/gl-graph-keyboard-shortcuts.js';
import type {
	GlGraphTimelineCommitSelectDetail,
	GlGraphTimelineConfigChangeDetail,
} from './components/gl-graph-timeline.js';
import type { GraphTreemapModeChangeDetail } from './components/gl-graph-treemap.js';
import type { GraphVisualizationModeChangeDetail } from './components/gl-graph-visualizations.js';
import type { WipBarItem, WipBarSelectDetail, WipBarStatsNeededDetail } from './components/gl-graph-wip-bar.js';
import { pickWipRowAgentStatus } from './components/wipRowAgentStatus.js';
import type { AppState } from './context.js';
import { graphServicesContext, graphStateContext } from './context.js';
import { getEffectiveDisplayMode } from './displayMode.js';
import type { GlGraphHeader } from './graph-header.js';
import type { GlGraphWrapper } from './graph-wrapper/graph-wrapper.js';
import type { GraphCrossPaneState } from './graphCrossPaneState.js';
import { abortRunningOperations, createGraphCrossPaneState, graphCrossPaneContext } from './graphCrossPaneState.js';
import type { GlGraphHover } from './hover/graphHover.js';
import type { GlGraphMinimapContainer, GraphMinimapConfigChangeEventDetail } from './minimap/minimap-container.js';
import type { GraphMinimapDaySelectedEventDetail, GraphMinimapWheelEvent } from './minimap/minimap.js';
import type { GlGraphSidebarPanel, GraphSidebarPanelSelectEventDetail } from './sidebar/sidebar-panel.js';
import type { GraphSidebarDisplayModeChangeEventDetail, GraphSidebarToggleEventDetail } from './sidebar/sidebar.js';
import type { SelectionBranch } from './utils/branchSelection.utils.js';
import { getOverviewBranchSelectionSha } from './utils/branchSelection.utils.js';
import { getSelectedRepoPath } from './utils/repository.utils.js';
import { getCommitDateFromRow } from './utils/row.utils.js';
import { serializeWipContext } from './utils/rowContext.utils.js';
import { shouldShowPrimaryWipRow } from './utils/wip.utils.js';
import './gate.js';
import './graph-header.js';
import './graph-wrapper/graph-wrapper.js';
import './hover/graphHover.js';
import './minimap/minimap-container.js';
import '../../shared/components/split-panel/split-panel.js';
import './sidebar/sidebar.js';
import './sidebar/sidebar-panel.js';
import '../../shared/components/mcp-banner.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import './components/gl-graph-details-panel.js';
import './components/gl-graph-kanban.js';
import './components/gl-graph-keyboard-shortcuts.js';
import './components/gl-graph-wip-bar.js';
import './components/gl-graph-timeline.js';
import './components/gl-graph-visualizations.js';

/** Extract the user-visible branch name from a ref id of the form `{repoPath}|heads/{name}`. */
function branchNameFromRef(branchRef: string | undefined): string | undefined {
	if (branchRef == null) return undefined;

	const idx = branchRef.indexOf('|heads/');
	return idx >= 0 ? branchRef.slice(idx + '|heads/'.length) : undefined;
}

/** Derives a user-friendly label for the primary worktree when no branch is checked out
 *  (detached HEAD). Uses the worktree directory basename — matches how worktrees typically
 *  appear in VS Code's worktree list and tooling. Falls back to `(detached)` for safety. */
function primaryFallbackLabel(repoPath: string): string {
	return basename(repoPath) || '(detached)';
}

const sidebarDefaultPct = 20;
const sidebarMinPct = 15;
const sidebarMaxPct = 80;

const detailsDefaultPct = 50;
const detailsMinPct = 20;
const detailsMaxPct = 80;

const minimapDefaultPx = 40;
const minimapMaxPct = 40;

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

@customElement('gl-graph-app')
export class GraphApp extends SignalWatcher(LitElement) {
	private _hoverTrackingCounter = getScopedCounter();
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

	private _sidebarSnap = ({ pos }: { pos: number }) => {
		if (pos < sidebarMinPct / 2) return 0;
		if (pos < sidebarMinPct) return sidebarMinPct;
		if (pos > sidebarMaxPct) return sidebarMaxPct;
		if (Math.abs(pos - sidebarDefaultPct) <= 1.5) return sidebarDefaultPct;
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

	private _minimapSnap = ({ pos, size }: { pos: number; size: number }) => {
		if (size <= 0) return pos;

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

	/** Shared back/forward history of visited single commits, mirrored into {@link _navState} for
	 *  the details header. Re-driving selection via {@link navigateTo} is guarded by
	 *  {@link _navExpectedSha} so the resulting (async) selection echo isn't recorded as new. */
	private readonly _nav = new NavigationStack<{ sha: string; repoPath: string; commitLite?: CommitDetails }>(
		10,
		undefined,
		s => (this._navState = s),
	);

	@state()
	private _navState: NavigationState = { count: 0, position: 0, canBack: false, canForward: false };

	/** Sha of an in-flight back/forward re-drive — sha-based (not boolean) because the
	 *  `ensureAndSelectCommit` re-drive re-emits the selection asynchronously through React. */
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
	 *  commit shas (WIP rows are excluded from compare). For the single anchor the row sha is derived
	 *  from `(sha, repoPath)`: a real sha is itself; `uncommitted` maps to the primary `work-dir-changes`
	 *  row when its repoPath is the opened repo, else to the secondary worktree's synthetic row sha
	 *  (`repoPath` IS the worktree path for a secondary WIP, so the reconstruction is exact). */
	private get activeAnchorShas(): readonly string[] | undefined {
		if (this.effectiveDisplayMode !== 'graph') return undefined;
		if (this._selectedCommits != null) return this._selectedCommits.shas;

		const single = this._selectedCommit;
		if (single == null) return undefined;

		if (single.sha !== uncommitted) return [single.sha];

		// A WIP anchor is the SECONDARY-worktree row only when its repoPath differs from the opened
		// repo's. Guard on a resolved `fallbackRepoPath`: during a repo-switch/reload tick it can be
		// transiently undefined, and treating that as "different" would mis-map a PRIMARY WIP anchor to
		// a `worktree-wip::` sha that matches no row (dropping the highlight). Default to the primary row.
		const fallbackRepoPath = this.fallbackRepoPath;
		const rowSha =
			fallbackRepoPath != null && single.repoPath !== '' && single.repoPath !== fallbackRepoPath
				? createSecondaryWipSha(single.repoPath)
				: ('work-dir-changes' satisfies GitGraphRowType);
		return [rowSha];
	}

	private get fallbackRepoPath(): string | undefined {
		return getSelectedRepoPath(this.graphState);
	}

	/** Graph's currently-selected repo "family" — `commonPath` when available, otherwise the
	 *  repo path itself. Mirrors {@link GraphRepository.commonPath} semantics in `sidebar-panel`'s
	 *  `resolveGraphAnchorContext`. Used to gate cross-repo session interactions: a kanban click
	 *  on a session whose `commonPath` doesn't match the graph's family cannot resolve a row in
	 *  the currently-rendered graph, so we don't drive `ensureAndSelectCommit` for it. */
	private get fallbackRepoFamily(): string | undefined {
		const repoId = this.graphState.selectedRepository;
		const repos = this.graphState.repositories;
		const repo = repoId != null ? repos?.find(r => r.id === repoId) : repos?.[0];
		return repo?.commonPath ?? repo?.path;
	}

	// use Light DOM
	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	@consume({ context: graphStateContext, subscribe: true })
	graphState!: typeof graphStateContext.__context__;

	@consume({ context: graphServicesContext, subscribe: true })
	private services?: typeof graphServicesContext.__context__;

	// Cross-pane shared signals: state owned by one pane (e.g. the details panel's
	// running-modes registry) but observed by another (e.g. row adornments in the graph
	// component). Provided here at the common-ancestor level so producer (details panel)
	// and consumers (graph row component, future agent-session pane, etc.) share a single
	// signal instance.
	@provide({ context: graphCrossPaneContext })
	private readonly _crossPaneState: GraphCrossPaneState = createGraphCrossPaneState();

	@consume({ context: ipcContext })
	private readonly _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as any })
	private readonly _telemetry!: TelemetryContext;

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

	@query('gl-graph-details-panel')
	private readonly detailsPanelEl: GlGraphDetailsPanel | undefined;

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

	/**
	 * Last observed non-zero size of the top-level `.graph` element, used to freeze it
	 * across editor-tab hide/show transitions. Without this freeze the external GK
	 * GraphContainer's internal ResizeObserver sees the iframe's layout collapse to 0 (and
	 * then re-expand on restore), producing a visible re-layout cascade. VS Code applies
	 * `display: none` to the webview iframe even with `retainContextWhenHidden: true` —
	 * that flag preserves the iframe content but not its layout visibility.
	 */
	private _lastGraphSize: { width: number; height: number } | undefined;
	private _graphSizeObserver: ResizeObserver | undefined;
	private _releaseSuspensionRafId: number | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();
		// Overlay mode auto-collapse — listeners gate themselves on mode + visibility, so they
		// stay attached for the lifetime of the component and become inert in split mode.
		document.addEventListener('focusout', this._handleSidebarOverlayFocusOut, true);
		document.addEventListener('pointerdown', this._handleSidebarOverlayPointerDown, true);
		document.addEventListener('contextmenu', this._handleSidebarOverlayContextMenu, true);
		window.addEventListener('webview-blur', this._handleSidebarOverlayWebviewBlur, false);
		window.addEventListener('webview-focus', this._handleSidebarOverlayWebviewFocus, false);

		this._graphSizeObserver = new ResizeObserver(entries => {
			// Use `borderBoxSize` (not `contentRect`) so the snapshot matches what
			// `style.width/height` sets when applied with `box-sizing: border-box`. Using
			// contentRect would leave a 2× padding gap (.graph has `padding: 0.1rem`), which
			// cascades into a visible 2–10px row jump in the GK GraphContainer on restore.
			const box = entries[0]?.borderBoxSize?.[0];
			if (box == null) return;

			const width = Math.round(box.inlineSize);
			const height = Math.round(box.blockSize);
			// Only remember non-zero sizes — when the iframe is hidden the element collapses
			// to 0, and we want to keep the LAST good measurement for use across the
			// hide/show cycle.
			if (width > 0 && height > 0) {
				this._lastGraphSize = { width: width, height: height };
			}
		});
	}

	protected override firstUpdated(): void {
		// Observe the outer `.graph` div once it's been rendered. It contains the entire
		// layout — header, panes, sidebar, the React mount — so freezing this single element
		// freezes everything inside it without needing to touch other components.
		if (this.graphRootEl != null) {
			this._graphSizeObserver?.observe(this.graphRootEl);
		}
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		// Abort in-flight AI runs — this element owns the registry, so teardown cancels them here.
		abortRunningOperations(this._crossPaneState);
		// Flush any pending debounced persist write so close-within-200ms-of-a-toggle doesn't
		// lose the last visualization choice. The debouncer is leading-trailing by default;
		// `flush()` runs the queued trailing call immediately, no-ops if nothing's queued.
		this._persistStateDebounced.flush();
		document.removeEventListener('focusout', this._handleSidebarOverlayFocusOut, true);
		document.removeEventListener('pointerdown', this._handleSidebarOverlayPointerDown, true);
		document.removeEventListener('contextmenu', this._handleSidebarOverlayContextMenu, true);
		window.removeEventListener('webview-blur', this._handleSidebarOverlayWebviewBlur, false);
		window.removeEventListener('webview-focus', this._handleSidebarOverlayWebviewFocus, false);

		this._graphSizeObserver?.disconnect();
		this._graphSizeObserver = undefined;
		if (this._releaseSuspensionRafId != null) {
			cancelAnimationFrame(this._releaseSuspensionRafId);
			this._releaseSuspensionRafId = undefined;
		}
	}

	// Set when a right-click / context-menu request is in flight. VS Code's native context menu
	// steals webview focus on open, which would otherwise cascade through focusout +
	// webview-blur and dismiss the overlay sidebar before the user can interact with the menu.
	// Cleared on webview-focus (when the menu closes and focus returns) or on the next primary
	// pointerdown (safety net in case no menu actually appears).
	private _suppressOverlayCollapseForMenu = false;

	private _handleSidebarOverlayFocusOut = (e: FocusEvent): void => {
		if (!this.shouldAutoCollapseOverlay()) return;
		if (this._suppressOverlayCollapseForMenu) return;

		const next = e.relatedTarget as Node | null;
		// Focus left the webview entirely — handled by _handleSidebarOverlayWebviewBlur, not
		// here, so we don't react to in-webview focus moves to non-focusable nodes.
		if (next == null) return;
		if (this.isInsideSidebarZone(next)) return;

		this.scheduleAutoCollapse();
	};

	private _handleSidebarOverlayPointerDown = (e: PointerEvent): void => {
		if (!this.shouldAutoCollapseOverlay()) return;
		if (e.button !== 0) {
			// Non-primary button — almost certainly a right-click context menu. Set a flag
			// before the focusout/webview-blur cascade so they don't dismiss the sidebar.
			this._suppressOverlayCollapseForMenu = true;
			return;
		}

		// Primary button — clear any stale suppression (e.g. a prior right-click that opened
		// no menu and never received a webview-focus to clear the flag).
		this._suppressOverlayCollapseForMenu = false;

		const target = e.target as Node | null;
		if (target == null) return;
		if (this.isInsideSidebarZone(target)) return;

		this.scheduleAutoCollapse();
	};

	private _handleSidebarOverlayContextMenu = (): void => {
		// Covers keyboard-triggered context menus (Shift+F10, ContextMenu key) which fire no
		// pointerdown. For mouse-triggered menus, the pointerdown handler has already set the
		// flag; setting it again here is a harmless no-op.
		if (!this.shouldAutoCollapseOverlay()) return;

		this._suppressOverlayCollapseForMenu = true;
	};

	private _handleSidebarOverlayWebviewBlur = (): void => {
		if (!this.shouldAutoCollapseOverlay()) return;
		if (this._suppressOverlayCollapseForMenu) return;

		this.scheduleAutoCollapse();
	};

	private _handleSidebarOverlayWebviewFocus = (): void => {
		// Menu closed (or focus otherwise returned) — clear the suppression so subsequent
		// click-outside interactions collapse normally.
		this._suppressOverlayCollapseForMenu = false;
	};

	// Pre-collapse sidebarVisible captured synchronously when the auto-collapse fires. The
	// sidebar toggle button's click runs in a later task — by then the queued hide has
	// already mutated state, so handleToggleSidebar would see the post-collapse value and
	// flip the toggle backwards. This snapshot lets the click handler honor the user's
	// actual pre-click intent. Cleared on read.
	private _sidebarVisibleAtAutoCollapse: boolean | undefined;

	private scheduleAutoCollapse(): void {
		this._sidebarVisibleAtAutoCollapse = this.graphState.sidebar?.visible ?? false;
		// Microtask, not sync: lets any same-task handlers run before the actual hide; the
		// click handler in a later task reads _sidebarVisibleAtAutoCollapse instead of current
		// state. hideSidebar gates on already-hidden so a stale schedule is a no-op.
		queueMicrotask(() => this.hideSidebar());
	}

	private shouldAutoCollapseOverlay(): boolean {
		if (this.graphState.config?.sidebarPinned !== false) return false;
		if (!this.graphState.sidebar?.visible) return false;
		return true;
	}

	private isInsideSidebarZone(node: Node): boolean {
		const rail = this.querySelector('gl-graph-sidebar');
		if (rail?.contains(node)) return true;

		const panel = this.sidebarPanelEl;
		if (panel?.contains(node)) return true;

		// Pointerdown / focusout from the split-panel divider (in its shadow DOM) retargets to
		// the split-panel host. Without this, dragging the divider auto-collapses the panel.
		const sidebarSplit = this.querySelector('.graph__sidebar-split');
		if (sidebarSplit === node) return true;
		return false;
	}

	onWebviewVisibilityChanged(visible: boolean): void {
		// Freeze the layout across the hide/show cycle so the ResizeObserver cascade that
		// VS Code's iframe resize (down to ~300x150 then back) produces does NOT propagate
		// into the GK GraphContainer. The IPC `visible=false` arrives with ~1.5s of headroom
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
				// when the GraphContainer's internal RO runs its first post-restore callback
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
		this.setDetailsVisible(true, 'request-compare');
		this.ensureDetailsPosition();
		this.detailsPanelEl?.openCompareMode(params);
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
	 *  the separate `DidChangeSelectionNotification` push, not via the search query.
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

	private _pendingScopeToBranch = false;

	private async consumePendingAction(pending: {
		action: GraphShowAction;
		target?: { sha: string; worktreePath: string; filePaths?: string[] };
		commitMessage?: string;
	}): Promise<void> {
		const { action, target, commitMessage } = pending;
		if (action === 'scope-to-branch') {
			await this.scopeToBranch();
			return;
		}

		// When a target is supplied (e.g. context-menu invocation on a secondary WIP row), route
		// the action to that row's worktree; otherwise fall back to the primary repo + uncommitted.
		const repoPath = target?.worktreePath ?? this.fallbackRepoPath ?? '';
		const sha = target?.sha ?? uncommitted;
		this._selectedCommit = { sha: sha, repoPath: repoPath };
		this._selectedCommits = undefined;

		// Reliably select the target row in the graph itself, not just the details panel. The host's
		// selection notification is prop-driven and can drop the synthetic WIP row to a render race
		// (the row is injected by `getDecoratedRows` only after Lit+React catch up), which surfaces as
		// review/compose updating the details but leaving the row unselected. `ensureAndSelectCommit`
		// normalizes `uncommitted`→the WIP row and retries across frames until it's injected. Skip for
		// compare (it drives its own range selection).
		if (action !== 'open-compare') {
			this.graph?.ensureAndSelectCommit(sha);
		}

		const showDetails = () => {
			this.setDetailsVisible(true, 'request-mode');
			this.ensureDetailsPosition();
		};

		if (action === 'open-compare') {
			await this.updateComplete;
			const compareParams =
				target != null
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
						};
			this.detailsPanelEl?.openCompareMode(compareParams, showDetails);
			return;
		}

		showDetails();

		if (action === 'enter-review' || action === 'enter-compose' || action === 'enter-resolve') {
			// On a cold graph open the details panel mounts only after the initial graph data/layout
			// settles. Poll for the element directly (independent of this app's `updateComplete`,
			// which can stay pending through the busy cold load) so the mode request doesn't silently
			// no-op via the `?.` below. `enterModeForWip` builds its own selection from repoPath/sha,
			// so it doesn't need the panel to have reconciled to the row first.
			const panel = await this.waitForDetailsPanel();
			const mode = action === 'enter-review' ? 'review' : action === 'enter-compose' ? 'compose' : 'resolve';
			// `filePaths` (resolve only) scopes the run to specific conflicted files; undefined = all conflicts.
			panel?.enterModeForWip(mode, repoPath, sha, target?.filePaths);
			return;
		}

		await this.updateComplete;
		// Seed the WIP details commit input AFTER the panel has reconciled to the target row —
		// the panel clears `commitMessage` when its repo identity changes, so writing before
		// reconciliation can be wiped out. Used after Undo Commit so the user can immediately
		// edit and re-commit the message in the same box they'd normally type into.
		if (commitMessage != null && action === 'show-wip') {
			this.detailsPanelEl?.setCommitMessage(repoPath, commitMessage);
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

	private async scopeToBranch(): Promise<void> {
		const branch = this.graphState.branch;
		if (branch == null) {
			this._pendingScopeToBranch = true;
			return;
		}

		this._pendingScopeToBranch = false;
		const repoPath = this.fallbackRepoPath;
		if (repoPath != null) {
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

	private handleWipBarSelect = async (e: CustomEvent<WipBarSelectDetail>): Promise<void> => {
		const { id, repoPath } = e.detail;
		// Bar is a global WIP affordance; clicking it always lands the user in graph mode
		// so the corresponding WIP row is visible (matches the stated user intent: "select that
		// WIP row in the graph and reveal the WIP details panel").
		const gs = this.graphState;
		// Snapshot pre-state — `persistState()` can flow back through host and flip visibility
		// between the mode switch and the visibility check, so capture both up front.
		const wasVisible = gs.details?.visible === true;
		if (gs.displayMode !== 'graph') {
			gs.displayMode = 'graph';
			this.persistState();
		}
		// Drop the active scope when the clicked WIP isn't part of it, so the worktree's row
		// materializes in the now-unscoped graph and `ensureAndSelectCommit` below can reveal it.
		// Leave the scope untouched when the pill already matches it. Uses the canonical clear
		// (`deferScopeClear` + `ResetGraphFilters`): the host's filter-reset reloads unscoped rows and
		// fires the deferred clear in the same pass. (Pills hidden purely by `branchesVisibility` are
		// out of this rule's scope — the product decision is scope-only.)
		const scopeCleared = gs.scope != null && !this.isWipPillInScope(id, gs.scope);
		if (scopeCleared) {
			gs.deferScopeClear();
			this._ipc.sendCommand(ResetGraphFiltersCommand, undefined);
		}
		// Anchor the selection synchronously, normalized to `uncommitted` — every WIP row (primary
		// and secondary alike) collapses to that sha and is distinguished by `repoPath`, matching
		// what `handleWipRowOpen` and the graph's own selection path produce. Setting it here, before
		// the telemetry emit below, ensures the already-visible `graphDetails/shown` event reflects
		// the newly-selected WIP rather than the prior selection. `openWipDetails` re-applies the
		// same values.
		this._selectedCommit = { sha: uncommitted, repoPath: repoPath };
		this._selectedCommits = undefined;
		// Pre-await telemetry — covers the setDetailsVisible-short-circuit case inside openWipDetails:
		// if the details panel is already visible, downstream telemetry would lose this bar-click
		// intent. Emitting pre-await also avoids a race where visibility flips off/on during the await.
		if (wasVisible) {
			this.emitDetailsVisibilityTelemetry(true, 'request-graph-wip-bar');
		}
		await this.openWipDetails(repoPath, uncommitted, undefined, 'request-graph-wip-bar');
		// When we cleared the scope above, the unscoped rows arrive via a host round-trip
		// (`ResetGraphFilters` → `DidChangeRefsVisibilityNotification`), which can take longer than
		// `ensureAndSelectCommit`'s short row-retry window. Wait for the scope to actually clear first
		// so that retry window starts against the settled (unscoped) state instead of expiring before
		// the worktree's row materializes.
		if (scopeCleared) {
			await this.waitForScopeCleared();
		}
		// Select + reveal the WIP row in the graph itself — the bar's stated intent. The `id` is the
		// row's sha (`uncommitted` for the primary, `worktree-wip::<path>` for secondaries);
		// `ensureAndSelectCommit` normalizes/handles both and retries through the render + scope
		// catch-up. The `openWipDetails` await above ensures the graph is mounted (e.g. after the
		// displayMode switch) before we call it.
		this.graph?.ensureAndSelectCommit(id);
	};

	/** Resolves once the active scope has cleared (or a safety timeout elapses). Used after a
	 *  scope-clearing WIP-bar click: the clear lands via a host round-trip, so this lets the
	 *  subsequent `ensureAndSelectCommit` run against the settled unscoped state rather than racing
	 *  the reload. Polls with `setTimeout` (not RAF) so it still resolves if the webview is hidden. */
	private waitForScopeCleared(timeoutMs = 2000): Promise<void> {
		if (this.graphState.scope == null) return Promise.resolve();

		return new Promise<void>(resolve => {
			const start = Date.now();
			const check = (): void => {
				if (this.graphState.scope == null || Date.now() - start >= timeoutMs) {
					resolve();
					return;
				}

				setTimeout(check, 32);
			};
			setTimeout(check, 32);
		});
	}

	/** Whether a clicked WIP pill's worktree is part of the active graph scope. The primary WIP
	 *  (`uncommitted`) matches when the scoped branch is HEAD's branch; a secondary matches when its
	 *  worktree branch is the scope's focal or one of its additional refs. Detached secondaries (no
	 *  `branchRef`) never match a branch scope. */
	private isWipPillInScope(id: string, scope: NonNullable<typeof this.graphState.scope>): boolean {
		if (id === uncommitted) return scope.branchRef === this.graphState.branch?.id;

		const branchRef = this.graphState.wipMetadataBySha?.[id]?.branchRef;
		if (branchRef == null) return false;
		return scope.branchRef === branchRef || scope.additionalBranchRefs?.includes(branchRef) === true;
	}

	/** In-flight set so repeated hovers over a stats-less pill fire at most one fetch per worktree. */
	private readonly _wipStatsInFlight = new Set<string>();

	/** Lazily fetches a hovered secondary WIP pill's stats (primary's come from `workingTreeStats`).
	 *  Skips when `graph.showWorktreeWipStats` is off: hover isn't selection, so it mustn't trigger a
	 *  per-worktree `git status` (clicking still reveals the breakdown). Backstop to the bar's own
	 *  `statsOnHover` suppression. */
	private handleWipBarStatsNeeded = (e: CustomEvent<WipBarStatsNeededDetail>): void => {
		const { id } = e.detail;
		if (id === uncommitted || this._wipStatsInFlight.has(id)) return;
		if (this.graphState.config?.showWorktreeWipStats === false) return;

		const meta = this.graphState.wipMetadataBySha?.[id];
		if (meta == null || (meta.workDirStats != null && !meta.workDirStatsStale)) return;

		this._wipStatsInFlight.add(id);
		void this.fetchSelectedWorktreeWipStats(id).finally(() => this._wipStatsInFlight.delete(id));
	};

	/** Computes WIP entries for the bar from real graph state: the primary worktree's WIP
	 *  (when there are changes) plus one entry per secondary worktree with WIP. Agent state is
	 *  resolved per-worktree via the existing session-by-worktree index. Returns an empty array
	 *  when no WIPs exist — the bar renders nothing in that case. */
	private get wipBarItems(): readonly WipBarItem[] {
		const gs = this.graphState;
		const fallbackRepoPath = this.fallbackRepoPath;
		if (fallbackRepoPath == null) return [];

		const now = Date.now();
		const items: WipBarItem[] = [];

		// The bar is a GLOBAL working-changes affordance: it surfaces every worktree that has working
		// changes, independent of the graph's active scope / branchesVisibility. (The in-graph WIP
		// rows ARE scope/visibility-filtered — see `getDecoratedRows` — so the bar can intentionally
		// show worktrees the graph has filtered out.)

		// Resolve agent state per worktree through a single index (O(sessions) to build, O(1) per
		// lookup) instead of re-scanning every session per worktree — mirrors `getAgentStatusByRowSha`
		// in graph-wrapper so the bar and the in-graph WIP rows surface the same indicator.
		const sessionIndex = indexAgentSessionsByRepoAndWorktree(gs.agentSessions);
		const pickAgent = (repoPath: string): Pick<WipBarItem, 'agent' | 'lastActivity'> => {
			const status = pickWipRowAgentStatus(
				matchAgentSessionsForWorktree(sessionIndex, { repoPath: repoPath, worktreePath: repoPath }),
				now,
			);
			if (status == null) return {};

			// The row collapses the worktree's sessions to one indicator; surface their most-recent
			// activity as the "Updated … ago" hint.
			const latest = status.sessions.reduce((max, s) => Math.max(max, s.lastActivity.getTime()), 0);
			return { agent: status.category, lastActivity: formatAgentElapsed(latest) };
		};

		// Primary worktree's WIP, whenever it has changes — shown regardless of scope/visibility
		// (`workingTreeStats` is computed independent of the graph's filters). WorkDirStats fields are
		// FILE counts: `added` (new files), `modified` (changed files), `deleted` (removed files).
		// When no branch is checked out (detached HEAD), fall back to the worktree directory basename
		// so the user still sees their primary WIP entry in the bar.
		// Unpushed comes free from `branchState.ahead` (tracked branch); a primary on a local-only
		// branch is intentionally NOT probed — those commits are already visible in the main graph,
		// unlike a hidden secondary's.
		const primary = gs.workingTreeStats;
		const primaryDirty = primary != null && (primary.added > 0 || primary.modified > 0 || primary.deleted > 0);
		const primaryAhead = gs.branchState?.ahead ?? 0;
		if (primaryDirty || primaryAhead > 0) {
			items.push({
				id: uncommitted,
				branch: gs.branch?.name ?? primaryFallbackLabel(fallbackRepoPath),
				repoPath: fallbackRepoPath,
				hasWorkingChanges: primaryDirty,
				...(primary != null && primaryDirty
					? {
							files: primary.added + primary.modified + primary.deleted,
							added: primary.added,
							modified: primary.modified,
							deleted: primary.deleted,
						}
					: {}),
				...(primaryAhead > 0 ? { hasUnpushed: true, ahead: primaryAhead } : {}),
				...pickAgent(fallbackRepoPath),
				isPrimary: true,
				context: serializeWipContext(fallbackRepoPath, false),
			});
		}

		// Secondary worktrees — one pill per worktree that has working changes OR unpushed commits, NOT
		// scope/visibility filtered (unlike the graph's WIP rows). A worktree is "dirty" by its fetched
		// `workDirStats` when present, else by the host's cheap `hasChanges` probe — so the pill appears
		// before the full breakdown is fetched (lazily, on hover). `hasUnpushed` is host-computed (free
		// ahead for tracked branches; a `rev-list` probe for local-only). Ordered by HEAD commit date,
		// most-recent first (`parentDate`); the primary pushed above stays first.
		const wipMetadata = gs.wipMetadataBySha;
		if (wipMetadata != null) {
			const secondaries = Object.entries(wipMetadata)
				.map(([sha, meta]) => {
					const stats = meta.workDirStats;
					const dirty =
						stats != null ? stats.added + stats.modified + stats.deleted > 0 : meta.hasChanges === true;
					return { sha: sha, meta: meta, dirty: dirty };
				})
				.filter(({ meta, dirty }) => dirty || meta.hasUnpushed === true)
				.sort((a, b) => (b.meta.parentDate ?? 0) - (a.meta.parentDate ?? 0));

			for (const { sha, meta, dirty } of secondaries) {
				const stats = meta.workDirStats;
				items.push({
					id: sha,
					branch: branchNameFromRef(meta.branchRef) ?? meta.label,
					repoPath: meta.repoPath,
					hasWorkingChanges: dirty,
					// Stats omitted until hover fetches them — the pill renders from the dirty signal.
					// `workDirStatsStale === false` with no `workDirStats` means a forced fetch settled
					// without a breakdown (failed/cancelled), so flag it for the hover's terminal state
					// instead of leaving the tooltip stuck on "Loading changes…".
					...(stats != null
						? {
								files: stats.added + stats.modified + stats.deleted,
								added: stats.added,
								modified: stats.modified,
								deleted: stats.deleted,
							}
						: meta.workDirStatsStale === false
							? { statsUnavailable: true }
							: {}),
					...(meta.hasUnpushed === true
						? { hasUnpushed: true, ...(meta.ahead != null && meta.ahead > 0 ? { ahead: meta.ahead } : {}) }
						: {}),
					...pickAgent(meta.repoPath),
					isPrimary: false,
					context: serializeWipContext(meta.repoPath, true),
				});
			}
		}

		return items;
	}

	private handleWipRowOpen = async (
		e: CustomEvent<{ target: 'compose' | 'review' | 'resolve' | 'agents'; row: GraphRow }>,
	): Promise<void> => {
		const { target, row } = e.detail;
		const fallbackRepoPath = this.fallbackRepoPath ?? '';
		// For secondary WIP rows the worktree path is encoded in the sha (`worktree-wip::<path>`);
		// extract it. Primary WIP and any other row types resolve to the primary (fallback) repo.
		const isSecondary = isSecondaryWipSha(row.sha);
		const repoPath = isSecondary ? getSecondaryWipPath(row.sha) : fallbackRepoPath;
		const sha = row.type === ('work-dir-changes' satisfies GitGraphRowType) ? uncommitted : row.sha;
		await this.openWipDetails(repoPath, sha, target, target === 'agents' ? 'request-agents' : 'request-mode');
	};

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated(changedProperties);

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
				this.graph?.ensureAndSelectCommit(sha);
			}
		}

		const detailsVisible = this.graphState.details?.visible ?? false;
		if (detailsVisible !== this._wasDetailsVisible) {
			this._wasDetailsVisible = detailsVisible;
			if (detailsVisible) {
				const pane = this.querySelector<HTMLElement>('.graph__details-pane');
				if (pane) {
					const isBottom = this.graphState.config?.detailsLocation === 'bottom';
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
			this._wasDisplayMode = displayMode;
			// Notify the host so it can fetch row stats when entering Visualizations mode (stats are
			// otherwise only loaded when the minimap or changes column is visible).
			this._ipc.sendCommand(UpdateGraphDisplayModeCommand, { mode: displayMode });
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
		const sidebarVisible = this.graphState.sidebar?.visible ?? false;
		const sidebarActivePanel = this.graphState.sidebar?.activePanel ?? null;
		const becameVisible = sidebarVisible && !this._wasSidebarVisible;
		const activePanelChanged =
			sidebarVisible &&
			!becameVisible &&
			this._wasSidebarActivePanel !== undefined &&
			sidebarActivePanel !== this._wasSidebarActivePanel;
		this._wasSidebarVisible = sidebarVisible;
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

		if (this._pendingScopeToBranch && this.graphState.branch != null) {
			void this.updateComplete.then(() => this.scopeToBranch());
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
		this.graphHover.reset();
	}

	override render() {
		const detailsVisible = this.graphState.details?.visible ?? false;
		const minimapVisible = this.graphState.minimap?.visible ?? true;
		const { single, multi } = this.activeSelection;
		return html`
			<div class="graph">
				<gl-graph-header
					class="graph__header"
					.selectCommits=${this.selectCommits}
					.getCommits=${this.getCommits}
					.detailsVisible=${detailsVisible}
					.minimapVisible=${minimapVisible}
					.hasSelectedCommit=${single != null || multi != null}
					@toggle-sidebar=${this.handleToggleSidebar}
					@toggle-details=${this.handleToggleDetails}
					@show-details=${this.handleShowDetails}
					@toggle-minimap=${this.handleToggleMinimap}
					@jump-to-wip=${this.handleJumpToWip}
					@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
				></gl-graph-header>
				<div class="graph__workspace">
					${when(!this.graphState.allowed, () => html`<gl-graph-gate class="graph__gate"></gl-graph-gate>`)}
					<gl-graph-hover id="commit-hover" distance=${0} skidding=${15}></gl-graph-hover>
					<main id="main" class="graph__panes">${this.renderDetailsPanel()}</main>
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
		const detailsVisible = this.graphState.details?.visible ?? false;
		const isBottom = this.graphState.config?.detailsLocation === 'bottom';
		const persisted = isBottom ? this.graphState.details?.bottomPosition : this.graphState.details?.position;
		const position = detailsVisible ? (persisted ?? 100 - detailsDefaultPct) : 100;
		return html`<gl-split-panel
			class=${classMap({ 'graph__details-split': true, '-vertical': isBottom })}
			orientation=${isBottom ? 'vertical' : 'horizontal'}
			primary="end"
			.position=${position}
			.snap=${hasContent ? this._detailsSnap : undefined}
			.disabled=${!hasContent}
			@gl-split-panel-change=${this.handleDetailsSplitChange}
			@gl-split-panel-drag-end=${this.handleSplitDragEnd}
			@gl-split-panel-closed-change=${this.handleDetailsClosedChange}
		>
			<div slot="start" class="graph__graph-pane">${this.renderGraphPaneContent()}</div>
			<div slot="end" class="graph__details-pane">
				<gl-graph-details-panel
					sha=${effectiveSha ?? nothing}
					repo-path=${effectiveRepoPath ?? nothing}
					.shas=${multi?.shas}
					.graphReachability=${single?.reachability}
					.commitLite=${single?.commitLite}
					.commitLites=${multi?.commitLites}
					.showSearchBox=${this.graphState.details?.showSearchBox ?? true}
					.searchBoxFilter=${this.graphState.details?.searchBoxFilter ?? true}
					.navigation=${this._navState}
					@select-commit=${this.handleSelectCommit}
					@gl-nav-back=${this.handleNavBack}
					@gl-nav-forward=${this.handleNavForward}
					@gl-graph-details-mode-changed=${this.handleDetailsModeChanged}
					@gl-show-search-box-change=${this.handleDetailsShowSearchBoxChange}
					@gl-search-box-filter-change=${this.handleDetailsSearchBoxFilterChange}
					@next-steps-shown=${this.handleNextStepsShown}
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

		this.graph?.selectCommits([e.detail.sha], { ensureVisible: true });
	}

	private _nextStepsShownWhileHidden = false;

	private handleNextStepsShown() {
		if (!this.graphState.details?.visible) {
			this._nextStepsShownWhileHidden = true;
			return;
		}

		this._ipc.sendCommand(TrackGraphDetailsWipShownCommand, undefined);
	}

	private renderGraphPaneContent() {
		// Use the gated effective mode (see `effectiveDisplayMode`) so the body, the sidebar
		// toggle visibility, `handleSelectCommit` routing, and the mode-leave cleanup all agree
		// on what's actually visible — important when the user has disabled the kanban
		// experimental flag while persisted `displayMode === 'kanban'`.
		const displayMode = this.effectiveDisplayMode;
		const isGraphMode = displayMode === 'graph';
		// Always render the graph subtree to avoid the cascade of remounts (split-panels +
		// React root + GK GraphContainer) that produces a visible "smaller, then bigger"
		// resize when returning from Visual History. Mirrors the always-render pattern used
		// by `renderDetailsPanel`. Alternate-mode bodies still mount/unmount on demand.
		// `gl-graph-kanban-open-session` is listened for at the pane-body level (not on
		// `<gl-graph-kanban>` alone) so both the kanban view AND the Activity-mode treemap inside
		// `<gl-graph-visualizations>` can route a session-card / file click through the same
		// handler. These two subtrees are mutually exclusive sibling render branches — without
		// hoisting, a bubbled event from the treemap would never reach a listener.
		return html`
			<div class="graph__graph-pane-body" @gl-graph-kanban-open-session=${this.handleKanbanOpenSession}>
				${when(
					this.graphState.config?.sidebar,
					() =>
						html`<gl-graph-sidebar
								active-panel=${this.graphState.sidebar?.activePanel ?? nothing}
								.sidebarVisible=${this.graphState.sidebar?.visible ?? false}
								@gl-graph-sidebar-toggle=${this.handleSidebarToggle}
								@gl-graph-sidebar-display-mode-change=${this.handleDisplayModeChange}
								@gl-graph-sidebar-visualizations-callout-dismiss=${this
									.handleVisualizationsCalloutDismiss}
								@gl-graph-sidebar-show-shortcuts=${this.handleShowShortcuts}
							></gl-graph-sidebar>
							<gl-graph-keyboard-shortcuts></gl-graph-keyboard-shortcuts>`,
				)}
				${this.graphState.config?.sidebar
					? this.renderSidebarSplit(!isGraphMode)
					: html`<div class="graph__graph-content" ?hidden=${!isGraphMode}>${this.renderGraphMain()}</div>`}
				${displayMode === 'visualizations'
					? html`<div class="graph__graph-content">${this.renderVisualizationsMain()}</div>`
					: nothing}
				${displayMode === 'kanban'
					? html`<div class="graph__graph-content">${this.renderKanbanMain()}</div>`
					: nothing}
			</div>
		`;
	}

	private renderKanbanMain() {
		return html`<gl-graph-kanban @gl-graph-kanban-close=${this.handleAlternateModeClose}></gl-graph-kanban>`;
	}

	private handleShowShortcuts = (): void => {
		this.keyboardShortcutsEl?.show();
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

			// `createWipSha` compares `worktreePath` against the GRAPH'S selected repo path (not
			// commonPath) to decide primary-vs-secondary. Passing commonPath here would return
			// `uncommitted` whenever `worktreePath === commonPath` — true for any session on the
			// main worktree (where `resolveGitInfo` sets commonPath = repo.path) — and the details
			// panel would then paint the graph's primary WIP (i.e., the currently-viewed worktree)
			// instead of the clicked session's worktree. Mirrors sidebar-panel.ts `resolveAgentAnchor`.
			const graphRepoPath = this.fallbackRepoPath;
			if (graphRepoPath == null) return;

			const repoPath = worktreePath ?? commonPath;
			if (repoPath == null || repoPath === '') return;

			const sha = worktreePath != null ? createWipSha(worktreePath, graphRepoPath) : uncommitted;

			// Write the alt-mode slot — kanban's `activeSelection` reads it directly. We deliberately
			// do NOT call `graph?.ensureAndSelectCommit(sha)` here: the graph is hidden in kanban
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
			@gl-graph-visualization-mode-change=${this.handleVisualizationModeChange}
			@gl-graph-timeline-commit-select=${this.handleTimelineCommitSelect}
			@gl-graph-timeline-config-change=${this.handleTimelineConfigChange}
			@gl-graph-timeline-close=${this.handleTimelineClose}
			@gl-graph-timeline-scope-applied=${this.handleTimelineScopeApplied}
			@gl-graph-treemap-mode-change=${this.handleTreemapModeChange}
		></gl-graph-visualizations>`;
	}

	private renderSidebarSplit(hidden = false) {
		const isOpen = (this.graphState.sidebar?.visible ?? false) && this.graphState.sidebar?.activePanel != null;
		const sidebarPosition = this.graphState.sidebar?.position ?? sidebarDefaultPct;
		const sidebarPinned = this.graphState.config?.sidebarPinned ?? true;
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
				active-panel=${this.graphState.sidebar?.activePanel ?? nothing}
				date-format=${this.graphState.config?.dateFormat ?? nothing}
				@gl-graph-sidebar-panel-select=${this.handleSidebarPanelSelect}
				@gl-graph-sidebar-toggle-pinned=${this.handleSidebarTogglePinned}
				@gl-graph-sidebar-search-box-filter-change=${this.handleSidebarSearchBoxFilterChange}
				@gl-graph-overview-branch-selected=${this.handleOverviewBranchSelected}
				@gl-graph-overview-recent-threshold-change=${this.handleOverviewRecentThresholdChange}
				@gl-graph-scope-to-branch=${this.handleScopeToBranchFromHeader}
			></gl-graph-sidebar-panel>
			<div slot="end" class="graph__graph-content">${this.renderGraphMain()}</div>
		</gl-split-panel>`;
	}

	private renderGraphMain() {
		if (this.graphState.config?.minimap === false) {
			return this.renderGraphContent();
		}

		const minimapVisible = this.graphState.minimap?.visible ?? true;
		const minimapPosition = this.graphState.minimap?.position ?? 6;
		const position = minimapVisible ? minimapPosition : 0;
		return html`
			<gl-split-panel
				class="graph__minimap-split"
				orientation="vertical"
				primary="start"
				.position=${position}
				.snap=${this._minimapSnap}
				@gl-split-panel-change=${this.handleMinimapSplitChange}
				@gl-split-panel-drag-end=${this.handleSplitDragEnd}
				@gl-split-panel-closed-change=${this.handleMinimapClosedChange}
			>
				<gl-graph-minimap-container
					slot="start"
					.activeDay=${this.graphState.activeDay}
					.disabled=${!this.graphState.config?.minimap}
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
					.visibleDays=${this.graphState.visibleDays
						? { ...this.graphState.visibleDays } // Need to clone the object since it is a signal proxy
						: undefined}
					.wipMetadataBySha=${this.graphState.wipMetadataBySha}
					@gl-graph-minimap-selected=${this.handleMinimapDaySelected}
					@gl-graph-minimap-config-change=${this.handleMinimapConfigChange}
					@gl-graph-minimap-wheel=${this.handleMinimapWheel}
				></gl-graph-minimap-container>
				${this.renderGraphContent('end')}
			</gl-split-panel>
		`;
	}

	private renderGraphContent(slot?: 'end') {
		// Compute once per render — getter allocates a fresh array, and we read it twice
		// (length check + binding). Local var dedupes the work and gives the bar a stable
		// reference identity within a single render cycle.
		const wipItems = this.wipBarItems;
		// `_selectedCommit.sha` is normalized to `uncommitted` for ALL WIP selections (the graph
		// collapses secondary WIP rows to `uncommitted` at selection time), so the selected worktree
		// is identified by `repoPath`, not `sha`. Resolve the selected pill by repoPath so selecting a
		// secondary WIP highlights its own pill instead of the primary's.
		const selectedCommit = this._selectedCommit;
		const selectedWipId =
			selectedCommit != null && isWipSha(selectedCommit.sha)
				? wipItems.find(i => i.repoPath === selectedCommit.repoPath)?.id
				: undefined;
		return html`
			<div class="graph__graph-column" slot=${ifDefined(slot)}>
				${wipItems.length > 0
					? html`
							<gl-graph-wip-bar
								.items=${wipItems}
								.selectedId=${selectedWipId}
								.statsOnHover=${this.graphState.config?.showWorktreeWipStats !== false}
								@gl-graph-wip-bar-select=${this.handleWipBarSelect}
								@gl-graph-wip-bar-stats-needed=${this.handleWipBarStatsNeeded}
							></gl-graph-wip-bar>
						`
					: nothing}
				<gl-graph-wrapper
					.anchorShas=${this.activeAnchorShas}
					@gl-graph-change-selection=${this.handleGraphSelectionChanged}
					@gl-graph-change-visible-days=${this.handleGraphVisibleDaysChanged}
					@gl-graph-filter-column=${this.handleGraphFilterColumn}
					@gl-graph-mouse-leave=${this.handleGraphMouseLeave}
					@gl-graph-row-context-menu=${this.handleGraphRowContextMenu}
					@gl-graph-row-double-click=${this.handleGraphRowDoubleClick}
					@gl-graph-row-hover=${this.handleGraphRowHover}
					@gl-graph-row-unhover=${this.handleGraphRowUnhover}
					@gl-graph-wip-row-open=${this.handleWipRowOpen}
					@row-action-hover=${this.handleGraphRowActionHover}
					@rowhoverstart=${this.handleGraphRowHoverStart}
					@rowhovertrack=${this.handleGraphRowHoverTrack}
				></gl-graph-wrapper>
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
		const state = {
			panels: {
				details: { ...gs.details },
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
		if (gs.minimap?.position !== e.detail.position) {
			gs.minimap = { position: e.detail.position };
		}
	}

	private handleMinimapClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
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
			next.activePanel = 'worktrees';
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

	private setSidebarPanel(panel: GraphSidebarPanel): void {
		const gs = this.graphState;
		if (gs.sidebar?.activePanel === panel && gs.sidebar?.visible === true) return;

		gs.sidebar = { activePanel: panel, visible: true };
		this.persistState();
		this.focusSidebarFilterAfterRender();
	}

	private focusSidebarFilterAfterRender(): void {
		void this.updateComplete.then(() => this.sidebarPanelEl?.focusFilter());
	}

	private hideSidebar(): void {
		const gs = this.graphState;
		if (!gs.sidebar?.visible) return;

		gs.sidebar = { visible: false };
		this.persistState();
	}

	private get detailsPositionKey(): 'position' | 'bottomPosition' {
		return this.graphState.config?.detailsLocation === 'bottom' ? 'bottomPosition' : 'position';
	}

	private ensureDetailsPosition(): void {
		const gs = this.graphState;
		const key = this.detailsPositionKey;
		// Reset to the default when the stored position is missing or snapped to closed — so
		// reopening after a drag-to-close shows a usable width instead of a zero-width pane.
		// Snap lands at exact 100 when the pane is closed; anything less is a usable open width.
		const stored = gs.details?.[key];
		if (stored != null && stored < 100) return;

		gs.details = { [key]: 100 - detailsDefaultPct };
		this.persistState();
	}

	private setDetailsVisible(
		visible: boolean,
		trigger?:
			| 'toggle'
			| 'request-compare'
			| 'request-mode'
			| 'request-agents'
			| 'request-graph-wip-bar'
			| 'auto-restore',
	): void {
		const gs = this.graphState;
		if (gs.details?.visible === visible) return;

		gs.details = { visible: visible };
		this.persistState();
		this.emitDetailsVisibilityTelemetry(visible, trigger ?? 'toggle');
	}

	private emitDetailsVisibilityTelemetry(
		visible: boolean,
		trigger:
			| 'toggle'
			| 'request-compare'
			| 'request-mode'
			| 'request-agents'
			| 'request-graph-wip-bar'
			| 'auto-restore',
	): void {
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
				isWipSha(selectedSha) || (single == null && multi == null && this.fallbackRepoPath != null);
			if (effectivelyUncommitted && this._nextStepsShownWhileHidden) {
				this._nextStepsShownWhileHidden = false;
				this._ipc.sendCommand(TrackGraphDetailsWipShownCommand, undefined);
			}
			const host = this.graphState.webviewId === 'gitlens.graph' ? 'editor' : 'panel';
			const location = this.graphState.config?.detailsLocation === 'bottom' ? 'bottom' : 'right';
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
		// `shown`/`closed` already capture mode at open/close — only emit transitions while the
		// panel stays visible (e.g. swap-to-close, mode chip toggles), so the event isolates
		// in-panel transitions from open/close noise.
		if (this.graphState.details?.visible !== true) return;

		switch (e.detail.current) {
			case 'review':
				this._ipc.sendCommand(TrackGraphDetailsReviewModeCommand, undefined);
				break;
			case 'compose':
				this._ipc.sendCommand(TrackGraphDetailsComposeModeCommand, undefined);
				break;
			case 'resolve':
				this._ipc.sendCommand(TrackGraphDetailsResolveModeCommand, undefined);
				break;
			case 'compare':
				this._ipc.sendCommand(TrackGraphDetailsCompareModeCommand, undefined);
				break;
		}

		this._telemetry.sendEvent({
			name: 'graphDetails/mode/changed',
			data: { 'mode.old': e.detail.previous, 'mode.new': e.detail.current },
		});
	};

	private handleDetailsSplitChange(e: CustomEvent<{ position: number }>) {
		// Skip the closed-edge position (snap lands at exact 100). `handleDetailsClosedChange`
		// owns visibility; recording position=100 here would clobber the last open width.
		if (e.detail.position >= 100) return;

		this.graphState.details = { [this.detailsPositionKey]: e.detail.position };
	}

	private handleDetailsClosedChange = (e: CustomEvent<{ closed: boolean; position: number }>): void => {
		const gs = this.graphState;
		if (e.detail.closed) {
			this.setDetailsVisible(false);
		} else if (gs.details?.visible !== true) {
			gs.details = { [this.detailsPositionKey]: e.detail.position };
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
		if (scope != null && scope.branchRef !== this.graphState.branch?.id) {
			const wouldShow = shouldShowPrimaryWipRow(
				this.graphState.branchesVisibility,
				this.graphState.includeOnlyRefs,
				this.graphState.branch?.id,
				undefined,
			);
			if (!wouldShow) return;

			this.graphState.clearScope();
		}

		this.graph?.ensureAndSelectCommit(uncommitted);
	};

	private handleToggleDetails(e: CustomEvent<{ altKey?: boolean } | void>) {
		if (e.detail?.altKey) {
			const next = this.graphState.config?.detailsLocation === 'bottom' ? 'right' : 'bottom';
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: { detailsLocation: next } });
			return;
		}

		const gs = this.graphState;
		if (gs.details?.visible) {
			this.setDetailsVisible(false);
		} else {
			this.setDetailsVisible(true, 'toggle');
			this.ensureDetailsPosition();
		}
	}

	private handleToggleMinimap() {
		if (this.graphState.config?.minimap === false) {
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: { minimap: true } });
			return;
		}

		const gs = this.graphState;
		gs.minimap = { visible: !(gs.minimap?.visible ?? true) };
		this.persistState();
	}

	private handleToggleSidebar() {
		const gs = this.graphState;
		const stashed = this._sidebarVisibleAtAutoCollapse;
		this._sidebarVisibleAtAutoCollapse = undefined;
		const wasVisible = stashed ?? gs.sidebar?.visible ?? false;
		if (wasVisible) {
			this.hideSidebar();
		} else {
			this.setSidebarPanel(gs.sidebar?.activePanel ?? 'branches');
		}
	}

	private handleSidebarToggle(e: CustomEvent<GraphSidebarToggleEventDetail>) {
		const gs = this.graphState;
		const panel = e.detail.panel;
		if (gs.sidebar?.visible && gs.sidebar?.activePanel === panel) {
			this.hideSidebar();
		} else {
			this.setSidebarPanel(panel);
		}
	}

	private handleSidebarTogglePinned = (): void => {
		const next = !(this.graphState.config?.sidebarPinned ?? true);
		this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: { sidebarPinned: next } });
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

	private handleVisualizationsCalloutDismiss = (): void => {
		const gs = this.graphState;
		if (gs.visualizationsButtonCalloutDismissed) return;

		// Optimistic flip — the host echo via `DidChangeVisualizationsButtonCallout` would otherwise
		// leave the callout glowing for a frame after the user has already clicked.
		gs.visualizationsButtonCalloutDismissed = true;
		this._ipc.sendCommand(DismissVisualizationsButtonCalloutCommand, undefined);
	};

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
		this.graph?.ensureAndSelectCommit(e.detail.sha);
		if (this.shouldAutoCollapseOverlay()) {
			this.graph?.focus();
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
			this.detailsPanelEl?.highlightAgentSession(sessionId);
		} catch (ex) {
			Logger.error(ex, 'GraphApp.dispatchAgentHighlight');
		}
	}

	private handleOverviewRecentThresholdChange = (e: CustomEvent<{ threshold: OverviewRecentThreshold }>): void => {
		const gs = this.graphState;
		if (gs.overviewRecentThreshold === e.detail.threshold) return;

		// The overview panel sends the `GetOverviewRequest` itself — graph-app only owns the
		// persisted signal + `graph:state` memento write (mirrors `handleTimelineConfigChange`).
		gs.overviewRecentThreshold = e.detail.threshold;
		this.persistState();
	};

	private async handleOverviewBranchSelected(
		e: CustomEvent<{ branchId: string; branchName: string; mergeTargetTipSha?: string }>,
	): Promise<void> {
		// Await scope publish so the post-scope `ensureAndSelectCommit` runs against the settled
		// GK row index — eliminates the "WIP-not-selected on first scope" race where the bare
		// publish hadn't yet been replaced by the anchored publish at selection time.
		await this.scopeToBranchById(e.detail.branchId, e.detail.mergeTargetTipSha);
		// Supersession guard: a concurrent click on another branch can land while our `await` is
		// parked, publishing a different scope. If `this.graphState.scope` is no longer for our
		// branch by the time we resume, the newer scope owns the selection — don't fire a stale
		// `ensureAndSelectCommit` against the wrong scope.
		if (this.graphState.scope?.branchRef !== e.detail.branchId) return;

		const sha = this.getOverviewBranchSelectionSha(e.detail.branchId);
		if (sha != null) {
			this.graph?.ensureAndSelectCommit(sha);
		}

		// If the user clicked the card without first hovering, the merge-target tip SHA isn't known
		// yet (the card's lazy fetch hasn't run). Kick it off here so the scope's anchor backfills
		// via `reconcileScopeMergeTarget` once the fetch resolves. The card will pick up the result
		// from shared state on first hover and skip its own fetch.
		if (e.detail.mergeTargetTipSha == null) {
			void this.ensureOverviewBranchMergeTarget(e.detail.branchId);
		}

		if (this.shouldAutoCollapseOverlay()) {
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
			wipMetadataBySha: this.graphState.wipMetadataBySha,
			rows: this.graphState.rows,
			branchesVisibility: this.graphState.branchesVisibility,
			includeOnlyRefs: this.graphState.includeOnlyRefs,
		});
	}

	private async handleScopeToBranchFromHeader(
		e: CustomEvent<{ branchName: string; upstreamName?: string }>,
	): Promise<void> {
		// Use the selected repo's actual path (the opened workspace's path). That's what the host
		// passes as `this.repository.path` when building the graph's row index AND the
		// `wipMetadataBySha` branchRefs, so any scope/lookup branchRef constructed here must use
		// the same path to match. In primary-repo workspaces `path === commonPath`; in worktree
		// workspaces they differ — picking `commonPath` produces a synthetic id that won't match
		// any row or WIP entry.
		const repoPath = this.fallbackRepoPath;
		if (repoPath == null) return;

		const { branchName, upstreamName } = e.detail;

		// Prefer the overview path so the merge target is resolved consistently with the overview card.
		const overview = this.graphState.overview;
		const branch =
			overview?.active.find(b => b.name === branchName) ?? overview?.recent.find(b => b.name === branchName);
		if (branch != null) {
			const mergeTargetTipSha = this.graphState.overviewEnrichment?.[branch.id]?.mergeTarget?.sha;
			await this.scopeToBranchById(branch.id, mergeTargetTipSha, 'popover');
			// Supersession guard: a concurrent `setScope` for a different branch can land while
			// our `await` is parked. If `this.graphState.scope` is no longer for our branch by the
			// time we resume, the newer call owns the selection — don't fire a stale one against
			// the wrong scope (would land selection on the previous click's WIP/tip).
			if (this.graphState.scope?.branchRef !== branch.id) return;

			const sha = this.getOverviewBranchSelectionSha(branch.id);
			if (sha != null) {
				this.graph?.ensureAndSelectCommit(sha);
			}
			return;
		}

		// Fallback: branch isn't in the overview's active/recent list. Synthesize a minimal
		// `OverviewBranch` and route through the helper — keeps a single source of truth for
		// the selection cascade. Without this, the inline cascade silently drifted from the
		// helper (e.g., missed the `loadedShas` gate, kept a stale `stats > 0` predicate).
		const branchRef = getBranchId(repoPath, false, branchName);
		await this.setScope(
			{
				branchRef: branchRef,
				branchName: branchName,
				upstreamRef: upstreamName != null ? getBranchId(repoPath, true, upstreamName) : undefined,
			},
			'popover',
		);
		// Same supersession guard as above.
		if (this.graphState.scope?.branchRef !== branchRef) return;

		const isCurrent = this.graphState.branch?.name === branchName;
		const tipSha = this.graphState.rows?.find(r => r.heads?.some(h => h.id === branchRef))?.sha;
		// `worktree: undefined` is correct here — no overview hit means we don't know the
		// worktree affiliation, and the helper's case (2) recovers via `wipMetadataBySha`
		// lookup by `branch.id`. Synthesizes the minimal `SelectionBranch` shape so the same
		// cascade serves both overview-card and header-popover paths.
		const synthesizedBranch: SelectionBranch = {
			id: branchRef,
			repoPath: repoPath,
			opened: isCurrent,
			reference: { sha: tipSha },
		};
		const sha = getOverviewBranchSelectionSha(synthesizedBranch, {
			wipMetadataBySha: this.graphState.wipMetadataBySha,
			rows: this.graphState.rows,
			branchesVisibility: this.graphState.branchesVisibility,
			includeOnlyRefs: this.graphState.includeOnlyRefs,
		});
		if (sha != null && sha !== '') {
			// If the helper returned the tip and tip isn't loaded, the IPC `EnsureRowRequest`
			// fallback in `ensureAndSelectCommit` will fetch it; otherwise the fast path or
			// synthetic-WIP retry handles it.
			this.graph?.ensureAndSelectCommit(sha);
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
		source: 'popover' | 'overview-card' = 'overview-card',
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
			},
			source,
		);
	}

	private async setScope(
		scope: NonNullable<typeof this.graphState.scope>,
		source: 'popover' | 'overview-card',
	): Promise<void> {
		// Skip re-assignment when structurally equal so GraphContainer doesn't re-evaluate
		// scope highlighting on unrelated graph updates.
		const current = this.graphState.scope;
		if (
			current?.branchRef === scope.branchRef &&
			current?.branchName === scope.branchName &&
			current?.upstreamRef === scope.upstreamRef &&
			current?.mergeTargetTipSha === scope.mergeTargetTipSha
		) {
			return;
		}

		this._ipc.sendCommand(TrackGraphScopeChangedCommand, undefined);
		emitTelemetrySentEvent<'graph/scope/changed'>(this, {
			name: 'graph/scope/changed',
			data: {
				source: source,
				'scope.hasUpstream': scope.upstreamRef != null,
				'scope.hasMergeTarget': scope.mergeTargetTipSha != null,
			},
		});
		// `stateProvider.setScope` resolves after the final scope publish (anchored when the
		// anchor IPC supplies a usable merge base, bare otherwise). Awaiting keeps the post-scope
		// selection cascade timed correctly — `ensureAndSelectCommit` sees the GK row index in
		// the settled state and can lock onto the WIP/tip without racing the bare→anchored render.
		await this.graphState.setScope(scope);
	}

	private _cachedScopeWindow:
		| {
				scope: AppState['scope'];
				rows: GraphRow[] | undefined;
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
		rows: GraphRow[] | undefined,
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

	private selectCommits = (shas: string[], options?: SelectCommitsOptions) => {
		return this.graph.selectCommits(shas, options);
	};

	private getCommits = (shas: string[]) => {
		return this.graph.getCommits(shas);
	};

	private handleMinimapWheel(e: GraphMinimapWheelEvent) {
		this.graph?.scrollGraphBy(e.detail.deltaY);
	}

	private handleMinimapDaySelected(e: CustomEvent<GraphMinimapDaySelectedEventDetail>) {
		if (!this.graphState.rows) return;

		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find closest row to the date
			const closest = this.graphState.rows.reduce((prev, curr) => {
				return Math.abs(curr.date - date) < Math.abs(prev.date - date) ? curr : prev;
			});
			sha = closest.sha;
		}

		this.graph.selectCommits([sha], { ensureVisible: true });

		if (e.target != null) {
			const { target } = e;
			queueMicrotask(() =>
				emitTelemetrySentEvent<'graph/minimap/day/selected'>(target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
			);
		}
	}

	private handleMinimapConfigChange(e: CustomEvent<GraphMinimapConfigChangeEventDetail>) {
		const { minimapDataType, minimapReversed, markerType, checked } = e.detail;

		if (minimapDataType != null) {
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, {
				changes: { minimapDataType: minimapDataType },
			});
			return;
		}

		if (minimapReversed != null) {
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, {
				changes: { minimapReversed: minimapReversed },
			});
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
			this._ipc.sendCommand(UpdateGraphConfigurationCommand, {
				changes: { minimapMarkerTypes: minimapMarkerTypes },
			});
		}
	}

	private handleGraphSelectionChanged(e: CustomEventType<'gl-graph-change-selection'>) {
		this.graphHover.hide();

		const { selection, reachability, commits } = e.detail;

		// Never clear the inspection anchor on an empty selection. The wrapper only dispatches genuine
		// (non-empty) intent here; an empty report is a scope/visibility filter-out or a transient GK
		// race, both of which must KEEP the details anchor (graph shows no highlight, details stay put).
		if (selection.length === 0) return;

		const fallbackRepoPath = this.fallbackRepoPath ?? '';

		if (selection.length >= 2) {
			const shas = selection
				.filter(s => s.type !== ('work-dir-changes' satisfies GitGraphRowType))
				.map(s => s.id);

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
			const sha = active.type === ('work-dir-changes' satisfies GitGraphRowType) ? uncommitted : active.id;
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

			// When `graph.showWorktreeWipStats` is disabled, secondary worktree WIP rows start
			// stats-less. Force-fetch stats for the selected row so it populates its pill.
			if (isSecondaryWipSha(active.id) && this.graphState.config?.showWorktreeWipStats === false) {
				void this.fetchSelectedWorktreeWipStats(active.id);
			}
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

	/** Records a real (non-WIP) single-commit selection into back/forward history. Suppresses the
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
			this.graph?.ensureAndSelectCommit(target.sha);
		}
	}

	private handleGraphVisibleDaysChanged({ detail }: CustomEventType<'gl-graph-change-visible-days'>) {
		this.graphState.visibleDays = detail;
	}

	/**
	 * Fetches working-tree stats for a single secondary-worktree WIP row and writes them into
	 * `wipMetadataBySha` so the GK component's pill renders. Used when `graph.showWorktreeWipStats`
	 * is disabled — the server's `onGetWipStats` ignores non-`force` calls in that mode, and the GK
	 * component's `requestedMissingWipStats` dedup is persistent, so this is the only way to show
	 * stats for a row once the user opts in by selecting it.
	 */
	private async fetchSelectedWorktreeWipStats(sha: string): Promise<void> {
		const existing = this.graphState.wipMetadataBySha;
		if (existing == null) return;

		const current = existing[sha];
		if (current == null) return;

		// Already have stats for this row (user re-selected it) — nothing to do.
		if (current.workDirStats != null && !current.workDirStatsStale) return;

		const response = await this._ipc.sendRequest(GetWipStatsRequest, { shas: [sha], force: true });
		if (response == null) return;

		const map = this.graphState.wipMetadataBySha;
		if (map == null) return;

		const prev = map[sha];
		if (prev == null) return;

		const stats = response[sha];
		// `force: true` bypasses the disabled-feature short-circuit on the host, so a missing
		// entry here means the underlying `git status` failed. Preserve any prior `workDirStats`
		// (including a sticky-restored value) rather than clobbering it with `undefined`. When the
		// response does land, also pick up the secondary's `pausedOpStatus` so the row reflects
		// any in-progress rebase/merge/cherry-pick.
		const updated =
			stats === undefined
				? { ...prev, workDirStatsStale: false }
				: {
						...prev,
						workDirStats: stats.workDirStats,
						workDirStatsStale: false,
						pausedOpStatus: stats.pausedOpStatus,
					};
		const next = { ...map, [sha]: updated };
		this.graphState.wipMetadataBySha = next;
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

	private handleGraphRowContextMenu(_e: CustomEventType<'gl-graph-row-context-menu'>) {
		this.graphHover.hide();
	}

	private handleGraphRowDoubleClick(_e: CustomEventType<'gl-graph-row-double-click'>) {
		if (this.graphState.details?.visible) return;

		this.setDetailsVisible(true);
		this.ensureDetailsPosition();
	}

	private handleGraphRowHover({
		detail: { graphZoneType, graphRow, clientX, currentTarget },
	}: CustomEventType<'gl-graph-row-hover'>) {
		if (graphZoneType === refZone) return;

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

	private handleGraphRowHoverTrack({ detail: { graphZoneType, graphRow } }: CustomEventType<'rowhovertrack'>) {
		if (graphZoneType === refZone) return;

		this.minimapEl?.select(graphRow.date, true);
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

	private handleGraphRowActionHover() {
		this.graphHover.hide();
	}

	private async getRowHoverPromise(row: GraphRow) {
		try {
			const request = await this._ipc.sendRequest(GetRowHoverRequest, {
				type: row.type,
				id: row.sha,
			});

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
