import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { URI } from 'vscode-uri';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import type { SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { fromNow } from '@gitlens/utils/date.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { basename } from '@gitlens/utils/path.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { GlCommands } from '../../../../../constants.commands.js';
import { launchpadGroupLabelMap } from '../../../../../plus/launchpad/models/launchpad.js';
import type { WebviewItemContext } from '../../../../../system/webview.js';
import { serializeWebviewItemContext, withWebviewItemFlag } from '../../../../../system/webview.js';
import { sidebarItemActions } from '../../../../plus/graph/graphSidebarActionTelemetry.js';
import type {
	DidGetSidebarDataParams,
	GraphScopeBranch,
	GraphScopeSource,
	GraphSidebarBranch,
	GraphSidebarPanel,
	GraphSidebarPullRequest,
	GraphSidebarPullRequestsEmptyState,
	GraphSidebarRemote,
	GraphSidebarTag,
	GraphSidebarWorktree,
} from '../../../../plus/graph/protocol.js';
import { createWipRowId } from '../../../../plus/graph/protocol.js';
import {
	branchTooltip,
	pullRequestMergesTooltip,
	pullRequestTooltip,
	remoteTooltip,
	stashTooltip,
	tagTooltip,
	worktreeTooltip,
	worktreeTooltipWithoutChangesLine,
} from '../../../../plus/graph/sidebarTooltips.js';
import {
	agentPhaseToCategory,
	describeAgentSession,
	formatAgentElapsed,
	getAgentSessionOpenAction,
} from '../../../shared/agentUtils.js';
import { scrollableBase, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemDecoration,
	TreeItemDecorationIconKind,
	TreeItemSelectionDetail,
	TreeModel,
	TreeModelFlat,
} from '../../../shared/components/tree/base.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import { emitTelemetrySentEvent } from '../../../shared/telemetry.js';
import type { AppState } from '../context.js';
import { graphStateContext } from '../context.js';
import {
	getLaunchpadGroupIconName,
	getLaunchpadItemGroup,
	getLaunchpadItemGrouping,
} from '../utils/overviewActions.utils.js';
import { getSelectedRepoPath } from '../utils/repository.utils.js';
import type { FocusRefActionArgs } from './branchActions.utils.js';
import {
	branchTreeIcon,
	createFocusRefAction,
	focusRefActionId,
	getBranchLeafActions,
	remoteProviderFolderIcon,
	remoteProviderIconsByName,
} from './branchActions.utils.js';
import { getPullRequestLeafActions } from './pullRequestActions.utils.js';
import {
	getPullRequestNumberFromQuery,
	parsePullRequestFilterTerms,
	withSearchedPullRequest,
} from './pullRequestFilter.utils.js';
import type { PullRequestStackEntry } from './pullRequestStacks.utils.js';
import { groupPullRequestsByStack } from './pullRequestStacks.utils.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import { resolveSelectedTag } from './sidebarTelemetry.utils.js';
import '../components/gl-graph-coachmark.js';
import '../overview/graph-overview.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/commit/wip-stats.js';
import '../../../shared/components/markdown/markdown.js';
import './agent-tooltip.js';
import './pr-tooltip.js';
import './worktree-tooltip.js';
import '../../../shared/components/actions/action-nav.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/hooks-banner.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/tree/tree-view.js';

interface PanelAction {
	icon: string;
	tooltip: string;
	command: GlCommands;
	args?: unknown[];
}

interface PanelConfig {
	title: string;
	actions?: PanelAction[];
}

const panelConfig: Record<GraphSidebarPanel, PanelConfig> = {
	overview: {
		title: 'Overview',
		actions: [
			{ icon: 'add', tooltip: 'Create Worktree...', command: 'gitlens.views.title.createWorktree' },
			{
				icon: 'issues',
				tooltip: 'Start Work',
				command: 'gitlens.startWork',
				args: [{ source: 'graph-sidebar' }],
			},
		],
	},
	agents: {
		title: 'Agents',
		actions: [
			{
				icon: 'issues',
				tooltip: 'Start Work with Agent...',
				command: 'gitlens.startWork',
				args: [{ source: 'graph-sidebar', showOpenInAgent: 'agent' }],
			},
			{
				icon: 'git-pull-request',
				tooltip: 'Start PR Review with Agent...',
				command: 'gitlens.startReview',
				args: [{ source: 'graph-sidebar', showOpenInAgent: 'agent' }],
			},
		],
	},
	worktrees: {
		title: 'Worktrees',
		actions: [{ icon: 'add', tooltip: 'Create Worktree...', command: 'gitlens.views.title.createWorktree' }],
	},
	branches: {
		title: 'Branches',
		actions: [
			{ icon: 'gl-switch', tooltip: 'Switch to Branch...', command: 'gitlens.switchToAnotherBranch:views' },
			{ icon: 'add', tooltip: 'Create Branch...', command: 'gitlens.views.title.createBranch' },
		],
	},
	pullRequests: {
		title: 'Pull Requests',
		actions: [
			{
				icon: 'git-pull-request-create',
				tooltip: 'Create Pull Request...',
				command: 'gitlens.createPullRequest:graph',
			},
		],
	},
	remotes: {
		title: 'Remotes',
		actions: [{ icon: 'add', tooltip: 'Add Remote...', command: 'gitlens.views.addRemote' }],
	},
	stashes: {
		title: 'Stashes',
		actions: [
			{ icon: 'gl-stash-save', tooltip: 'Stash All Changes...', command: 'gitlens.stashSave:views' },
			{ icon: 'gl-stash-pop', tooltip: 'Apply / Pop Stash...', command: 'gitlens.stashesApply:views' },
		],
	},
	tags: {
		title: 'Tags',
		actions: [{ icon: 'add', tooltip: 'Create Tag...', command: 'gitlens.views.title.createTag' }],
	},
};

export interface GraphSidebarPanelSelectEventDetail {
	sha: string;
	/** Agent leaves only — the id of the session represented by the clicked tree item. Lets the
	 *  graph-app's handler expand the agents section, highlight the matching card in the details
	 *  pane, and scroll it into view alongside the WIP row selection. Absent on non-agent leaves
	 *  (branches, tags, stashes, …). */
	sessionId?: string;
}

export type GraphSidebarTogglePinnedEventDetail = void;

/** Scope-to-branch payload optionally carried by a sidebar leaf's context tuple. When present
 *  the panel select handler dispatches `gl-graph-scope-to-branch` in addition to the row-select
 *  event, matching the focus behavior of overview cards. Only the agent leaves populate it today. */
export interface SidebarItemScope {
	branchName: string;
	upstreamName?: string;
}

/** `name` is the item's unique full name (branch leaves populate it) — shas can collide across
 *  branches pointing at the same commit, so telemetry resolves the clicked branch by name
 *  (the name itself is not emitted). */
type SidebarItemContext = [sha: string | undefined, scope?: SidebarItemScope, sessionId?: string, name?: string];

interface LeafProps {
	label: string;
	filterText?: string;
	tooltip?: TreeModel<SidebarItemContext>['tooltip'];
	icon: TreeModel<SidebarItemContext>['icon'];
	description?: string;
	muted?: boolean;
	context: SidebarItemContext;
	decorations?: TreeModel<SidebarItemContext>['decorations'];
	actions?: TreeModel<SidebarItemContext>['actions'];
	/** Typed context object — serialized at the leaf→tree-model boundary so consumers (VS Code's
	 *  context-menu API) get the JSON-encoded `data-vscode-context` string they expect, while the
	 *  rest of the panel works with a typed shape. */
	contextValue?: WebviewItemContext;
}

function trackingDecorations(
	tracking: { ahead: number; behind: number } | undefined,
	missingUpstream?: boolean,
): TreeModel<SidebarItemContext>['decorations'] {
	if (tracking == null) return undefined;

	const { ahead, behind } = tracking;
	if (ahead === 0 && behind === 0) return undefined;

	return [
		{
			type: 'tracking',
			label: 'tracking',
			ahead: ahead,
			behind: behind,
			missingUpstream: missingUpstream,
			position: 'before',
		},
	];
}

/** The branch pinned to the graph's edge. The panel header's own Pin button means "pin the side bar", so the
 *  label names the edge to keep the two apart — it's also the glyph's accessible name (icon decorations carry
 *  no visual tooltip). Trailing slot so the row's actions open to its LEFT and the glyph doesn't shift on hover;
 *  muted because it marks state rather than asking to be acted on. */
const pinnedToEdgeDecoration: TreeItemDecoration = {
	type: 'icon',
	icon: 'pinned',
	label: 'Pinned to Edge',
	position: 'after',
	muted: true,
};

/** The branch that's currently checked out. Mirrors the worktree rows' `check`, which marks the active one. */
const currentBranchDecoration: TreeItemDecoration = {
	type: 'icon',
	icon: 'check',
	label: 'Current Branch',
	position: 'after',
	muted: true,
};

function formatWorktreeDescription(w: GraphSidebarWorktree): string | undefined {
	if (w.upstream == null) return undefined;
	return `\u21C6 ${w.upstream}`;
}

function leafToTreeModel(leaf: LeafProps, path: string, level: number): TreeModel<SidebarItemContext> {
	return {
		branch: false,
		expanded: false,
		path: path,
		level: level,
		label: leaf.label,
		tooltip: leaf.tooltip,
		filterText: leaf.filterText,
		icon: leaf.icon,
		description: leaf.description,
		muted: leaf.muted,
		checkable: false,
		context: leaf.context,
		decorations: leaf.decorations,
		actions: leaf.actions,
		contextData: leaf.contextValue != null ? serializeWebviewItemContext(leaf.contextValue) : undefined,
	};
}

@customElement('gl-graph-sidebar-panel')
export class GlGraphSidebarPanel extends SignalWatcher(LitElement) {
	static override styles = [
		scrollableBase,
		subPanelEnterStyles,
		css`
			@keyframes panel-enter {
				from {
					opacity: 0;
					transform: translateX(-8px);
				}

				to {
					opacity: 1;
					transform: translateX(0);
				}
			}

			:host {
				z-index: 1;
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: visible;
				background-color: var(--color-view-background);
				border-color: var(--vscode-sideBar-border, transparent);
				border-right: var(--gl-border-width) solid transparent;
			}

			/* Play enter animations only when the parent signals the user-visible moment —
	   the element is always mounted (inside the split-panel's start slot) so an
	   unconditional animation would fire at 0 width where the user can't see it.
	     [opening]   — sidebar went from hidden to visible (slide in from -8px X)
	     [switching] — active panel changed while visible (slide in from 4px Y, matches
	                   the sub-panel-enter used by review/compose/compare panes)
	   The animation runs on the inner .panel — NOT the :host — so the host's solid
	   background-color stays put and blocks the graph behind it during the animation
	   (in overlay mode the host floats over the graph; an opacity/translate on the host
	   would expose the graph through fade or at the gap left by the translate). */
			:host([opening]) .panel {
				animation: panel-enter var(--gl-duration-medium) var(--gl-ease-out);
			}

			:host([switching]) .panel {
				animation: sub-panel-enter var(--gl-duration-medium) var(--gl-ease-out);
			}

			@media (prefers-reduced-motion: reduce) {
				/* Near-zero duration, NOT animation:none, so the animationend event still
		   fires — the internal handler depends on it to remove the opening / switching
		   attribute. animation:none dispatches no event, so the attribute would stick. */
				:host([opening]) .panel,
				:host([switching]) .panel {
					animation-duration: 0.01ms;
				}
			}

			.panel {
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: hidden;
			}

			.header {
				position: relative;
				display: flex;
				flex: none;
				gap: var(--gl-space-6);
				align-items: center;
				min-height: 2.2rem;
				padding: 0 0 0 var(--gl-space-4);
				font-size: var(--gl-font-sm);
				font-weight: 600;
				color: var(--color-view-header-foreground);
				text-transform: uppercase;
				background-color: var(--color-view-background);
				border-color: var(--vscode-sideBarSectionHeader-border, transparent);
				border-bottom: var(--gl-border-width) solid transparent;
			}

			.header-title {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.header-actions {
				display: flex;
				flex: none;
				align-items: center;
				text-transform: none;
			}

			.header-actions gl-button {
				--button-padding: 0.3rem;
			}

			.content {
				flex: 1;
				min-height: 0;
				overflow: hidden;
			}

			gl-tree-view {
				height: 100%;
				--gitlens-gutter-width: 0.8rem;
			}

			.loading {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				padding: var(--gl-space-4) 0;
			}

			.skeleton {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				height: 2.2rem;
				padding: var(--gl-space-2) var(--gl-space-10);
			}

			.skeleton-icon {
				flex: none;
				width: 16px;
				height: 16px;
				background: var(--vscode-foreground);
				border-radius: var(--gl-radius-sm);
				opacity: 0.07;
			}

			.skeleton-text {
				height: 10px;
				background: var(--vscode-foreground);
				border-radius: var(--gl-radius-sm);
				opacity: 0.07;
			}

			.loading .skeleton:nth-child(1) .skeleton-text {
				width: 65%;
			}

			.loading .skeleton:nth-child(2) .skeleton-text {
				width: 45%;
			}

			.loading .skeleton:nth-child(3) .skeleton-text {
				width: 80%;
			}

			.loading .skeleton:nth-child(4) .skeleton-text {
				width: 55%;
			}

			.loading .skeleton:nth-child(5) .skeleton-text {
				width: 70%;
			}

			.loading .skeleton:nth-child(6) .skeleton-text {
				width: 40%;
			}

			.loading .skeleton:nth-child(7) .skeleton-text {
				width: 60%;
			}

			.empty {
				padding: var(--gl-space-10);
				font-size: var(--gl-font-md);
				color: var(--vscode-descriptionForeground);
				text-align: center;
			}

			.empty--connect {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-10);
				align-items: center;
			}

			.agents-banner {
				flex: none;
				padding: 0 var(--gl-space-4) var(--gl-space-4);
			}

			/* Sits below the tree, so it stays put while the filtered list scrolls above it. */
			.search-fallback {
				display: flex;
				flex: none;
				gap: var(--gl-space-4);
				align-items: center;
				padding: var(--gl-space-8) var(--gl-space-12);
				font-style: italic;
				color: var(--color-foreground--65);
			}
		`,
	];

	@property({ type: String, attribute: 'active-panel' })
	activePanel: GraphSidebarPanel | undefined;

	/** Whether the sidebar is actually on screen. This component is never unmounted — it stays slotted in
	 *  the split panel and is only made `inert` when collapsed — so it has to report visibility itself.
	 *  Rides along as `displayed` on each panel request, where the host uses it to skip the per-worktree git
	 *  fan-out; fetches themselves are deliberately never gated on it. */
	@property({ type: Boolean })
	open = false;

	@property({ attribute: 'date-format' })
	dateFormat: string | null | undefined;

	/** The graph-level coach-mark gate, same one the details panel takes. */
	@property({ type: Boolean, attribute: 'graph-ready' })
	graphReady = false;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _actions!: SidebarActions;

	@consume({ context: graphStateContext, subscribe: true })
	private readonly _state!: AppState;

	/** Memo for `buildTreeModel`. Renders fire on every filter/expansion change, so without this
	 *  the tree model is rebuilt for an unchanged `data` reference. Reset on key change. */
	private _treeModelCache?: {
		data: DidGetSidebarDataParams;
		dateFormat: string | null | undefined;
		searchedPr: GraphSidebarPullRequest | undefined;
		model: TreeModel<SidebarItemContext>[];
	};

	/** A pull request found by the search fallback. Held here rather than in the panel resource so the
	 *  rail's badge keeps counting only the repo's open pull requests. */
	@state() private _prSearchResult: GraphSidebarPullRequest | undefined;
	/** Repo the search result belongs to. `activePanel` is independent of the selected repository, so
	 *  without this a pull request found for one repo keeps rendering against another — and its row
	 *  carries the *original* repo's path, so acting on it would target the wrong repository. */
	private _prSearchRepoId: string | undefined;
	/** The panel data the search result was spliced into, so a refetch can retire it — see `willUpdate`. */
	private _prSearchData: DidGetSidebarDataParams | undefined;
	@state() private _prSearchState: 'idle' | 'searching' | 'notFound' = 'idle';

	private readonly _contextMenuProxy = new ContextMenuProxyController(this);

	private _pendingFocus = false;
	private _agentsFilterActive = false;

	/** Whether `graph/worktrees/shown` has been fired for the current worktrees activation. Reset
	 *  on disconnect and on `activePanel` change so switching away and back emits a fresh event
	 *  while re-renders from data mutations (e.g. WIP pushes) do not. */
	private _worktreesShownEmitted = false;
	/** Same guard as `_worktreesShownEmitted`, for `graph/stashes/shown`. */
	private _stashesShownEmitted = false;
	/** Same guard as `_worktreesShownEmitted`, for `graph/tags/shown`. */
	private _tagsShownEmitted = false;
	/** Same guard as `_worktreesShownEmitted`, for `graph/pullRequests/shown`. */
	private _pullRequestsShownEmitted = false;

	/** Same as `_worktreesShownEmitted`, for the remotes panel. */
	private _remotesShownEmitted = false;

	// Tracks that the branches panel was just shown and its `shown` telemetry is still owed —
	// emitted once the switch-triggered fetch settles (see maybeEmitBranchesShownTelemetry).
	private _branchesShownPending = false;

	// The raw `gl-tree-filter-changed` event fires on every keystroke (only the tree's filter
	// apply is debounced), so debounce the telemetry to emit once per settled query.
	private readonly emitBranchesFilteredTelemetryDebounced = debounce(() => {
		if (this.activePanel !== 'branches') return;

		const filterText = this._actions.filterText;
		emitTelemetrySentEvent<'graph/branches/filtered'>(this, {
			name: 'graph/branches/filtered',
			data: {
				hasFilter: filterText.length > 0,
				'filter.length': filterText.length,
				'branches.count': this.getBranchesCount(),
			},
		});
	}, 500);

	focusFilter(): void {
		if (this.activePanel == null || this.activePanel === 'overview') {
			this._pendingFocus = false;
			return;
		}

		const treeView = this.shadowRoot?.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>(
			'gl-tree-view',
		);
		if (treeView == null) {
			// Tree-view isn't rendered yet (data still loading). Retry when it appears.
			this._pendingFocus = true;
			return;
		}

		this._pendingFocus = false;
		const ready = treeView.updateComplete ?? Promise.resolve();
		void Promise.resolve(ready).then(() => treeView.focus());
	}

	override firstUpdated(_changedProperties: Map<PropertyKey, unknown>): void {
		// Animation runs on the inner .panel (so the host's solid bg can mask the graph behind
		// in overlay mode). animationend doesn't bubble out of the shadow root, so we listen
		// here and clear the [opening]/[switching] attribute the parent set on the host.
		this.shadowRoot?.addEventListener('animationend', this._handlePanelAnimationEnd);
	}

	override disconnectedCallback(): void {
		this.emitWorktreesFilteredTelemetryDebounced.cancel();
		this.emitBranchesFilteredTelemetryDebounced.cancel();
		this.emitRemotesFilteredTelemetryDebounced.cancel();
		this.emitStashesFilteredTelemetryDebounced.cancel();
		this.emitTagsFilteredTelemetryDebounced.cancel();
		this.emitPullRequestsFilteredTelemetryDebounced.cancel();
		this._worktreesShownEmitted = false;
		this._remotesShownEmitted = false;
		this._stashesShownEmitted = false;
		this._tagsShownEmitted = false;
		this._pullRequestsShownEmitted = false;
		super.disconnectedCallback?.();
	}

	private readonly _handlePanelAnimationEnd = (e: Event): void => {
		const name = (e as AnimationEvent).animationName;
		if (name === 'panel-enter' || name === 'sub-panel-enter') {
			this.removeAttribute('opening');
			this.removeAttribute('switching');
		}
	};

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		// Visibility has to sync on its OWN transition, not inside the `activePanel` guard below: collapsing
		// and re-expanding never changes `activePanel` (the sidebar signal merges key-by-key, so the panel
		// selection survives), so a write nested in that guard would go stale in both directions — never set
		// on a live collapse, and stuck `false` after a reload-while-collapsed is re-expanded. A stale value
		// only mis-reports `displayed` (enrichment computed for a collapsed panel, or pills missing until the
		// next fetch); it cannot stale or blank the panel's data, which is never gated on it.
		if (changedProperties.has('open') && this._actions != null) {
			this._actions.sidebarShowing = this.open;
		}

		if (changedProperties.has('activePanel') && this._actions != null) {
			// Reset the shown guards so switching away and back emits a fresh impression
			// while intra-activation re-renders (WIP pushes, refresh) do not.
			this._worktreesShownEmitted = false;
			this._remotesShownEmitted = false;
			this._stashesShownEmitted = false;
			this._tagsShownEmitted = false;
			this._pullRequestsShownEmitted = false;

			// Cancel any pending filtered emits — filterText is shared across panels, so a trailing
			// callback after a switch would report against the wrong (now-inactive) panel.
			// `filterText` is shared across panels, so a result found under the pull-requests panel would
			// otherwise linger (and re-render) after switching away and back.
			this._prSearchResult = undefined;
			this._prSearchRepoId = undefined;
			this._prSearchData = undefined;
			this._prSearchState = 'idle';

			this.emitWorktreesFilteredTelemetryDebounced.cancel();
			this.emitBranchesFilteredTelemetryDebounced.cancel();
			this.emitRemotesFilteredTelemetryDebounced.cancel();
			this.emitStashesFilteredTelemetryDebounced.cancel();
			this.emitTagsFilteredTelemetryDebounced.cancel();
			this.emitPullRequestsFilteredTelemetryDebounced.cancel();

			// Keep the actions module in sync so invalidateAll can refetch. Also seeds `sidebarShowing` on
			// the boot update, where `activePanel` transitions undefined→restored but `open` may not change.
			this._actions.activePanel = this.activePanel;
			this._actions.sidebarShowing = this.open;

			// `_actions.filterText` is a single string shared across panels and survives panel
			// switches (its only write is `handleFilterChanged`), while `_agentsFilterActive` is
			// only maintained while agents is active. Re-sync from the actual filter here, or the
			// empty↔non-empty transition detection in `handleFilterChanged` compares against a
			// stale value — emitting duplicate "activated" or missing "deactivated" events.
			this._agentsFilterActive = this._actions.filterText.length > 0;

			// Always fetch on panel switch — data may be stale even if non-null.
			// The Resource's cancelPrevious handles dedup.
			// Overview/Agents panels manage their own data via reactive state, skip sidebar fetch.
			if (this.activePanel != null && this.activePanel !== 'overview' && this.activePanel !== 'agents') {
				this._actions.fetchPanel(this.activePanel);
			}

			if (this.activePanel === 'agents') {
				this.emitAgentsShownTelemetry();
			}

			// Defer the `shown` event until the branches data actually resolves (see
			// maybeEmitBranchesShownTelemetry). Emitting synchronously here would drop the
			// first-ever view (data still undefined) and report stale counts on later views
			// (the Resource retains the prior fetch's value until the new one lands).
			this._branchesShownPending = this.activePanel === 'branches';
		}

		// The searched row is a snapshot spliced into a list it wasn't fetched with, so it can't outlive
		// that list. An invalidation (a branch checked out, say) replaces the panel's data and the fresh
		// rows re-derive their switch affordances; a frozen row would keep offering a switch that's now a
		// no-op, and the deep link behind it would skip straight to diffing the whole pull request.
		if (this.activePanel === 'pullRequests' && this._actions != null) {
			const data = this._actions.state.panels.pullRequests.value.get();
			if (data !== this._prSearchData) {
				this._prSearchData = data;
				this._prSearchResult = undefined;
				this._prSearchRepoId = undefined;
				this._prSearchState = 'idle';
			}
		}
	}

	override updated(_changedProperties: Map<PropertyKey, unknown>): void {
		// Reveal: warm the per-worktree enrichment the host suppressed while this was collapsed (it gates on
		// the `displayed` flag we send with each request). The panel's own data never went stale — fetches
		// are never gated client-side — so this exists only to fill in the pills. Unconditional, so each
		// reveal costs one small fetch plus a fan-out trigger; `computeWorktreeChanges` coalesces to one
		// running + one trailing run, which bounds rapid collapse/expand cycling.
		if (_changedProperties.has('open') && this.open && this._actions != null) {
			this._actions.refreshOnReveal();
		}

		if (this._pendingFocus) {
			this.focusFilter();
		}

		// Emit `shown` from the settled lifecycle (not render(), which Lit expects side-effect-free).
		// The guards fire it once per panel activation — reset on disconnect and on `activePanel`
		// change so a fresh impression is recorded then, but intra-activation re-renders (WIP pushes,
		// refresh(), filter/expansion changes) do not re-emit.
		this.emitWorktreesShownTelemetry();
		this.emitRemotesShownTelemetry();
		this.maybeEmitBranchesShownTelemetry();
		this.emitStashesShownTelemetry();
		this.emitTagsShownTelemetry();
		this.emitPullRequestsShownTelemetry();
	}

	private emitWorktreesShownTelemetry(): void {
		if (this._worktreesShownEmitted || this.activePanel !== 'worktrees') return;

		const resource = this._actions?.state.panels.worktrees;
		// Wait for a successful fetch (mirrors maybeEmitBranchesShownTelemetry): on reactivation
		// the resource still holds the previous visit's value while the switch-triggered fetch is
		// in flight — emitting off that would report stale counts. 'idle' (webview boot, before
		// the RPC service exists) and 'error' (a later retry may still succeed) also hold; the
		// guard is only latched on emit, so this just delays until fresh data lands.
		if (resource?.status.get() !== 'success') return;

		const data = resource.value.get();
		if (data?.panel !== 'worktrees') return;

		this._worktreesShownEmitted = true;
		emitTelemetrySentEvent<'graph/worktrees/shown'>(this, {
			name: 'graph/worktrees/shown',
			data: {
				layout: data.layout ?? 'list',
				'worktrees.count': data.items.length,
			},
		});
	}

	private emitStashesShownTelemetry(): void {
		if (this._stashesShownEmitted || this.activePanel !== 'stashes') return;

		const resource = this._actions?.state.panels.stashes;
		// Wait for a successful fetch (mirrors emitWorktreesShownTelemetry): on reactivation the
		// resource still holds the previous visit's value while the switch-triggered fetch is in
		// flight — emitting off that would report stale counts.
		if (resource?.status.get() !== 'success') return;

		const data = resource.value.get();
		if (data?.panel !== 'stashes') return;

		this._stashesShownEmitted = true;
		emitTelemetrySentEvent<'graph/stashes/shown'>(this, {
			name: 'graph/stashes/shown',
			data: {
				'stashes.count': data.items.length,
			},
		});
	}

	/** The searched pull request, but only while its repo is still the selected one. */
	private get prSearchResult(): GraphSidebarPullRequest | undefined {
		return this._prSearchRepoId === this._state.selectedRepository ? this._prSearchResult : undefined;
	}

	private emitPullRequestsSelectedTelemetry(path: string): void {
		const data = this._actions?.state.panels.pullRequests?.value.get();
		if (data?.panel !== 'pullRequests') return;

		// The searched result is rendered but lives outside the resource, so match against the same
		// merged list the rows were built from.
		const pr = withSearchedPullRequest(data.items, this.prSearchResult).find(p => `pr:${p.number}` === path);
		if (pr == null) return;

		emitTelemetrySentEvent<'graph/pullRequests/pullRequestSelected'>(this, {
			name: 'graph/pullRequests/pullRequestSelected',
			data: { reachable: pr.focus != null, draft: pr.isDraft ?? false },
		});
	}

	private emitPullRequestsShownTelemetry(): void {
		if (this._pullRequestsShownEmitted || this.activePanel !== 'pullRequests') return;

		const resource = this._actions?.state.panels.pullRequests;
		// Same wait-for-success rule as the other panels: on reactivation the resource still holds the
		// previous visit's value while the switch-triggered fetch is in flight.
		if (resource?.status.get() !== 'success') return;

		const data = resource.value.get();
		if (data?.panel !== 'pullRequests') return;

		this._pullRequestsShownEmitted = true;
		emitTelemetrySentEvent<'graph/pullRequests/shown'>(this, {
			name: 'graph/pullRequests/shown',
			data: {
				'pullRequests.count': data.items.length,
				'pullRequests.draft.count': data.items.filter(pr => pr.isDraft).length,
				'pullRequests.fork.count': data.items.filter(pr => pr.headOwner != null).length,
				emptyReason: data.emptyState?.reason,
			},
		});
	}

	private emitTagsShownTelemetry(): void {
		if (this._tagsShownEmitted || this.activePanel !== 'tags') return;

		const resource = this._actions?.state.panels.tags;
		// Wait for a successful fetch (mirrors emitWorktreesShownTelemetry): on reactivation the
		// resource still holds the previous visit's value while the switch-triggered fetch is in
		// flight — emitting off that would report stale counts.
		if (resource?.status.get() !== 'success') return;

		const data = resource.value.get();
		if (data?.panel !== 'tags') return;

		this._tagsShownEmitted = true;
		emitTelemetrySentEvent<'graph/tags/shown'>(this, {
			name: 'graph/tags/shown',
			data: {
				layout: data.layout ?? 'list',
				'tags.count': data.items.length,
				'tags.annotated.count': data.items.filter(t => t.annotated).length,
			},
		});
	}

	override render(): unknown {
		if (this.activePanel == null) return nothing;

		const config = panelConfig[this.activePanel];

		if (this.activePanel === 'overview') {
			return html`<div class="panel">
				${this.renderHeader(config, false)}
				<div class="content">
					<gl-graph-overview></gl-graph-overview>
				</div>
			</div>`;
		}

		// Agents bypass the resource/IPC fetch loop — sessions arrive on `_state.agentSessions` via
		// reactive notifications. Synthesize a `DidGetSidebarDataParams`-shaped value so the standard
		// tree-view rendering flow (filter box + leaves) takes over.
		if (this.activePanel === 'agents') {
			const data: DidGetSidebarDataParams = {
				panel: 'agents',
				items: this._state.agentSessions ?? [],
				layout: this._actions.agentsLayout.get(),
			};
			return html`<div class="panel">
				${this.renderHeader(config, false)} ${this.renderAgentsBanner(data.items.length === 0)}
				<div class="content">${this.renderTreeContent(config, data)}</div>
			</div>`;
		}

		const resource = this._actions?.state.panels[this.activePanel];
		const data = resource?.value.get();
		const hasError = resource?.error.get() != null;
		const isLoading = resource?.loading.get() ?? false;

		// The pull-requests panel is empty for reasons the host can name — nothing connected, nothing
		// connectable, a lookup that couldn't answer, or a host that can't be asked. Those replace the
		// (blank) tree entirely.
		const emptyState = data?.panel === 'pullRequests' && data.items.length === 0 ? data.emptyState : undefined;
		// ...which takes the filter box with it, so there's no way left to name a pull request to search for —
		// and a search that did somehow succeed would render nothing, since the empty state stands in for the
		// tree the result would have joined.
		const suppressSearchFallback = emptyState != null;

		return html`<div class="panel">
			${this.renderHeader(config, isLoading)}
			<div class="content">
				${
					hasError
						? html`<div class="empty">Failed to load data</div>`
						: emptyState != null
							? this.renderPullRequestsEmptyState(emptyState)
							: data != null
								? this.renderTreeContent(config, data)
								: this.renderSkeleton()
				}
			</div>
			${/* Sibling of `.content`, not inside it — `.content` clips at 100% height around the tree. */ ''}
			${data != null && !hasError && !suppressSearchFallback ? this.renderPullRequestSearchFallback(data) : nothing}
		</div>`;
	}

	/** Stands in for the pull-requests tree when the panel is empty for a reason the host can name — an
	 *  empty list otherwise reads as "no open pull requests", which is the one thing it doesn't mean here. */
	private renderPullRequestsEmptyState(emptyState: GraphSidebarPullRequestsEmptyState): unknown {
		// One shape across the three connect reasons: lead with the connect action and the value it unlocks —
		// for an unrecognized host, connecting a self-managed integration (with its domain) is what makes it
		// recognized; with no remotes the tail names that publishing comes first.
		if (emptyState.reason === 'no-remotes') {
			return this.renderConnectPitch(
				'Connect an integration to see and act on pull requests here once this repository is published to GitHub, GitLab, Azure DevOps, or Bitbucket.',
				'Connect an Integration...',
			);
		}

		if (emptyState.reason === 'no-supported-remote') {
			return this.renderConnectPitch(
				"Connect an integration — including self-managed hosts — to see this repository's pull requests and act on them without leaving the graph.",
				'Connect an Integration...',
			);
		}

		// Connected, but the lookup reported a failure — an expired token or a dropped connection. Say that,
		// because an empty list here would claim the repository has no open pull requests. Retries go through
		// the header's own handler so this refresh is counted like every other one.
		if (emptyState.reason === 'unavailable') {
			return html`<div class="empty empty--connect">
				<span>Unable to load this repository's pull requests.</span>
				<gl-button appearance="secondary" density="compact" @click=${this.handleRefresh}
					><code-icon icon="refresh" slot="prefix"></code-icon> Try Again</gl-button
				>
			</div>`;
		}

		// Connected and reachable, but the host has no repo-scoped pull request query GitLens can issue —
		// so no Try Again, which would only land right back here.
		if (emptyState.reason === 'unsupported') {
			return html`<div class="empty">
				GitLens can't list pull requests for ${emptyState.providerName} repositories yet.
			</div>`;
		}

		const { providerName, integrationId } = emptyState;
		return this.renderConnectPitch(
			`Connect to ${providerName} to see this repository's open pull requests and act on them without leaving the graph.`,
			`Connect to ${providerName}...`,
			integrationId,
		);
	}

	private renderConnectPitch(message: string, label: string, integrationId?: SupportedCloudIntegrationIds) {
		return html`<div class="empty empty--connect">
			<span>${message}</span>
			<gl-button
				appearance="secondary"
				density="compact"
				@click=${() => this.handleConnectIntegration(integrationId)}
				><code-icon icon="plug" slot="prefix"></code-icon> ${label}</gl-button
			>
		</div>`;
	}

	private handleConnectIntegration(integrationId?: SupportedCloudIntegrationIds) {
		// Not a row action, so it goes straight out rather than through `handleAction`'s per-panel action
		// telemetry — the connect funnel is tracked by the integrations service off the command's `source`.
		// Without an id the host routes to the generic manage-integrations flow.
		this._actions?.executeAction('gitlens.plus.cloudIntegrations.connect', undefined, [
			{ integrationId: integrationId },
		]);
	}

	private renderHeader(config: PanelConfig, isLoading: boolean) {
		const pinned = this._state.config?.sidebarPinned ?? false;
		const pinTooltip = pinned ? 'Unpin Side Bar' : 'Pin Side Bar';
		const pinIcon = pinned ? 'pinned' : 'pin';
		return html`<div class="header">
			<span class="header-title">${config.title}</span>
			${
				// Gated on `open` too: collapsing only zero-widths this panel (never unmounts it), so the
				// title still passes `checkVisibility()` and the tip would open over the graph — spending
				// the one force-open on a popover anchored off-screen.
				this.activePanel === 'agents'
					? html`<gl-graph-coachmark
							mark="agents"
							placement="bottom-start"
							.anchor=${() => this.renderRoot.querySelector<HTMLElement>('.header-title')}
							?auto-show=${this.graphReady && this.open}
						></gl-graph-coachmark>`
					: nothing
			}
			<action-nav class="header-actions" role="toolbar" aria-label="${config.title} actions">
				${config.actions?.map(
					a =>
						html`<gl-button
							appearance="toolbar"
							density="compact"
							tooltip="${a.tooltip}"
							@click=${() => this.handleAction(a.command, a.args)}
							><code-icon icon="${a.icon}"></code-icon
						></gl-button>`,
				)}
				<gl-button appearance="toolbar" density="compact" tooltip="Refresh" @click=${this.handleRefresh}
					><code-icon icon="refresh"></code-icon
				></gl-button>
				<gl-button
					appearance="toolbar"
					density="compact"
					aria-pressed=${pinned ? 'true' : 'false'}
					tooltip=${pinTooltip}
					@click=${this.handleTogglePinned}
					><code-icon icon=${pinIcon}></code-icon
				></gl-button>
			</action-nav>
			<progress-indicator position="bottom" ?active=${isLoading}></progress-indicator>
		</div>`;
	}

	private renderAgentsBanner(listIsEmpty: boolean): unknown {
		// Only pitch the install when there are no sessions to act on — once the list has agents,
		// the banner becomes noise above their tree.
		if (!listIsEmpty) return nothing;
		// Only pitch the install when there's something to install — `canInstallClaudeHook` flips
		// false the moment hooks are detected as installed (or claude isn't available).
		if (!(this._state.canInstallClaudeHook ?? false)) return nothing;
		// Respect the same dismissal as the graph-overview banner — `hooksBannerCollapsed` is true
		// when the user dismissed it via the onboarding service.
		if (this._state.hooksBannerCollapsed ?? true) return nothing;
		return html`<div class="agents-banner">
			<gl-hooks-banner source="graph-sidebar-agents" layout="responsive"></gl-hooks-banner>
		</div>`;
	}

	private renderTreeContent(config: (typeof panelConfig)[GraphSidebarPanel], data: DidGetSidebarDataParams): unknown {
		const cache = this._treeModelCache;
		let model: TreeModel<SidebarItemContext>[];
		if (cache?.data === data && cache.dateFormat === this.dateFormat && cache.searchedPr === this.prSearchResult) {
			model = cache.model;
		} else {
			model = this.buildTreeModel(data);
			this._treeModelCache = {
				data: data,
				dateFormat: this.dateFormat,
				searchedPr: this.prSearchResult,
				model: model,
			};
		}

		// Automatically track/restore tree expansion state per panel.
		// On first build (set empty): seed the set from the model's natural defaults.
		// On subsequent builds: override the model's expansion with the remembered set.
		if (this.activePanel != null) {
			const paths = this._actions.expandedPaths[this.activePanel];
			applyOrSeedExpansion(model, paths);
		}

		const hasLayout =
			this.activePanel === 'worktrees' ||
			this.activePanel === 'branches' ||
			this.activePanel === 'remotes' ||
			this.activePanel === 'tags' ||
			this.activePanel === 'agents';
		const currentLayout = data.layout;
		const showRemoteBranches = data.panel === 'branches' ? (data.showRemoteBranches ?? false) : undefined;

		const isPullRequests = this.activePanel === 'pullRequests';

		return html`<gl-tree-view
			focused-path=${this._actions.selectedPath[this.activePanel!] ?? nothing}
			.model=${model}
			.filterTermsParser=${isPullRequests ? parsePullRequestFilterTerms : undefined}
			filterable
			tooltip-anchor-right
			filter-text=${this._actions.filterText || nothing}
			?search-box-filter=${this._state.sidebar?.searchBoxFilter ?? true}
			filter-placeholder="Filter ${config.title.toLowerCase()}..."
			aria-label="${config.title}"
			@gl-tree-filter-changed=${this.handleFilterChanged}
			@gl-tree-search-box-filter-changed=${this.handleSearchBoxFilterChanged}
			@gl-tree-generated-item-selected=${this.handleTreeItemSelected}
			@gl-tree-generated-item-action-clicked=${this.handleTreeItemAction}
			@gl-tree-expansion-changed=${this.handleTreeExpansionChanged}
			>${
				showRemoteBranches != null
					? html`<gl-button
							slot="filter-actions"
							appearance="toolbar"
							density="compact"
							role="checkbox"
							aria-checked=${showRemoteBranches ? 'true' : 'false'}
							tooltip="${showRemoteBranches ? 'Hide Remote Branches' : 'Show Remote Branches'}"
							aria-label="Show Remote Branches"
							@click=${this.handleToggleShowRemoteBranches}
							><code-icon icon="${showRemoteBranches ? 'gl-remote-filled' : 'gl-remote'}"></code-icon
						></gl-button>`
					: nothing
			}${
				hasLayout
					? html`<gl-button
							slot="filter-actions"
							appearance="toolbar"
							density="compact"
							tooltip="${currentLayout === 'tree' ? 'View as List' : 'View as Tree'}"
							@click=${this.handleToggleLayout}
							><code-icon icon="${currentLayout === 'tree' ? 'list-flat' : 'list-tree'}"></code-icon
						></gl-button>`
					: nothing
			}</gl-tree-view
		>`;
	}

	/**
	 * Offer to fetch a pull request the loaded list doesn't hold. This panel lists only *open* pull
	 * requests, so a pasted URL for a merged or closed one finds nothing until we go ask — the same
	 * fallback the scope popover's Focus pane provides, and the one Launchpad provides for its queries.
	 */
	private renderPullRequestSearchFallback(data: DidGetSidebarDataParams): unknown {
		if (data.panel !== 'pullRequests') return nothing;

		const number = getPullRequestNumberFromQuery(this._actions.filterText);
		if (
			number == null ||
			withSearchedPullRequest(data.items, this.prSearchResult).some(pr => pr.number === number)
		) {
			return nothing;
		}

		if (this._prSearchState === 'searching') {
			return html`<div class="search-fallback">
				<code-icon icon="loading" modifier="spin"></code-icon> Searching for #${number}…
			</div>`;
		}
		if (this._prSearchState === 'notFound') {
			return html`<div class="search-fallback">No pull request #${number} in this repository</div>`;
		}

		return html`<div class="search-fallback">
			<span>Not in open pull requests</span>
			<gl-button
				appearance="toolbar"
				density="compact"
				tooltip="Search for #${number}"
				@click=${this.handleSearchPullRequest}
			>
				<code-icon icon="search"></code-icon>
			</gl-button>
		</div>`;
	}

	private handleSearchPullRequest = async (e: Event) => {
		e.stopPropagation();
		e.preventDefault();

		const number = getPullRequestNumberFromQuery(this._actions.filterText);
		if (number == null) return;

		this._prSearchState = 'searching';
		try {
			const pr = await this._actions.findPullRequest(number);
			// The query may have moved on while the request was in flight; a stale result would silently
			// inject a pull request the user is no longer asking about.
			if (getPullRequestNumberFromQuery(this._actions.filterText) !== number) return;

			emitTelemetrySentEvent<'graph/pullRequests/searched'>(this, {
				name: 'graph/pullRequests/searched',
				data: { found: pr != null },
			});

			if (pr == null) {
				this._prSearchState = 'notFound';
				return;
			}

			this._prSearchResult = pr;
			this._prSearchRepoId = this._state.selectedRepository;
			this._prSearchState = 'idle';
		} catch {
			this._prSearchState = 'notFound';
		}
	};

	private renderSkeleton(): unknown {
		// 7 rows; per-row widths are positional (`:nth-child` in component CSS).
		return html`<div class="loading">
			${Array.from(
				{ length: 7 },
				() => html`
					<div class="skeleton">
						<div class="skeleton-icon"></div>
						<div class="skeleton-text"></div>
					</div>
				`,
			)}
		</div>`;
	}

	private buildTreeModel(data: DidGetSidebarDataParams): TreeModel<SidebarItemContext>[] {
		const useTree = data.layout === 'tree';
		const compact = data.compact !== false;

		switch (data.panel) {
			case 'branches': {
				const remoteIcons = useTree ? remoteProviderIconsByName(data.items) : undefined;
				return this.buildItemTree(
					data.items,
					useTree,
					compact,
					// Remote branches always split, so they group under their remote name — `disposition` isn't
					// local-only, and an unsplit remote branch would sit at the top level instead
					b =>
						!b.remote && (b.current || b.worktreeOpened || b.disposition != null)
							? [b.name]
							: b.name.split('/'),
					(b, isTree) => this.toBranchLeaf(b, isTree),
					1,
					remoteIcons != null ? name => remoteProviderFolderIcon(remoteIcons, name) : undefined,
				);
			}
			case 'pullRequests':
				return groupPullRequestsByStack(withSearchedPullRequest(data.items, this.prSearchResult)).map(entry =>
					entry.kind === 'stack'
						? this.toStackBranch(entry)
						: leafToTreeModel(this.toPullRequestLeaf(entry.pr), `pr:${entry.pr.number}`, 1),
				);
			case 'remotes':
				return this.buildRemoteTree(data.items, useTree, compact);
			case 'stashes':
				return data.items.map(s => {
					const parts: string[] = [];
					if (s.stashOnRef) {
						parts.push(s.stashOnRef);
					}
					if (s.date != null) {
						parts.push(fromNow(s.date));
					}
					return {
						branch: false,
						expanded: false,
						path: s.sha,
						level: 1,
						label: s.message || s.name,
						tooltip: stashTooltip(s, this.dateFormat),
						icon: 'archive',
						description: parts.length > 0 ? parts.join(', ') : undefined,
						checkable: false,
						context: [s.sha] as SidebarItemContext,
						actions: [
							{ icon: 'gl-stash-pop', label: 'Apply / Pop Stash...', action: 'gitlens.stashApply:graph' },
							{ icon: 'trash', label: 'Delete Stash...', action: 'gitlens.stashDelete:graph' },
						],
						contextData: s.context != null ? serializeWebviewItemContext(s.context) : undefined,
					};
				});
			case 'tags':
				return this.buildItemTree(
					data.items,
					useTree,
					compact,
					t => t.name.split('/'),
					(t, isTree) => this.toTagLeaf(t, isTree),
				);
			case 'worktrees':
				return this.buildItemTree(
					data.items,
					useTree,
					compact,
					w => (w.isDefault || w.opened || !w.branch ? [w.name] : w.branch.split('/')),
					(w, isTree) => this.toWorktreeLeaf(w, isTree),
				);
			case 'agents': {
				if (useTree) return this.buildAgentTree(data.items);

				const graphAnchor = this.resolveGraphAnchorContext();
				return data.items.map(a =>
					leafToTreeModel(this.toAgentLeaf(a, this.resolveAgentAnchor(a, graphAnchor)), `agent:${a.id}`, 1),
				);
			}
			default:
				return [];
		}
	}

	private toBranchLeaf(b: GraphSidebarBranch, isTree: boolean): LeafProps {
		const actions = getBranchLeafActions(b);
		const tracking = trackingDecorations(b.tracking, b.upstream?.missing);

		return {
			label: isTree ? (b.name.split('/').pop() ?? b.name) : b.name,
			filterText: isTree ? b.name : undefined,
			tooltip: branchTooltip(b, this.dateFormat),
			icon: branchTreeIcon(b),
			description: b.date != null ? fromNow(b.date) : undefined,
			context: [b.sha, undefined, undefined, b.name] as SidebarItemContext,
			// Pin before check so the checkmark closes the row — it's the more permanent of the two states,
			// and keeping it outermost stops it shifting when a pin comes and goes.
			decorations: [
				...(tracking ?? []),
				...(b.pinned ? [pinnedToEdgeDecoration] : []),
				...(b.current ? [currentBranchDecoration] : []),
			],
			actions: actions,
			contextValue: b.context,
		};
	}

	/**
	 * A stack's parent row. Synthetic — it owns no pull request of its own — so it takes its own `stack:`
	 * path namespace, which keeps `pr:${number}` matching exactly the rows that are pull requests
	 * (selection telemetry and focused-path restore both match on that form) and gives the tree a stable
	 * key to persist expansion against.
	 *
	 * The trunk lives here rather than on every layer: it's a property of the stack, and each member's own
	 * base is the layer below it. Stating it once is also what lets the collapsed row stay meaningful.
	 */
	private toStackBranch(entry: PullRequestStackEntry): TreeModel<SidebarItemContext> {
		const children = entry.members.map(pr => leafToTreeModel(this.toPullRequestLeaf(pr), `pr:${pr.number}`, 2));

		// The count states what GitHub reports, not how many rows are below — a paged-off layer still
		// merges when the stack merges, so under-reporting it would understate the blast radius.
		const loaded = entry.members.length;
		const count = loaded < entry.size ? `${loaded} of ${entry.size} PRs` : `${entry.size} PRs`;

		// Focus the whole stack: the BASE layer is focal — it's the one whose merge target really is the
		// trunk, so its spine runs the full depth of the stack — and the layers above ride along as
		// additional branches, since they're descendants the focal walk can't reach on its own. Members are
		// ordered top-first, so the base is last. Needs every layer focusable: a member whose head isn't
		// fetched has no ref to scope to, and a stack shown minus a layer is worse than no action at all.
		const actions: TreeItemAction[] = [];
		const base = entry.members.at(-1);
		if (loaded === entry.size && entry.members.every(m => m.focus != null) && base?.focus != null) {
			actions.push(
				createFocusRefAction('Focus on Stack', {
					...base.focus,
					additional: entry.members
						.slice(0, -1)
						.map(m => ({ branchName: m.focus!.branchName, remote: m.focus!.remote })),
					origin: { kind: 'stack', number: entry.number, size: entry.size },
				}),
			);
		}

		return {
			branch: true,
			expanded: true,
			path: `stack:${entry.number}`,
			level: 1,
			label: `Stack #${entry.number}`,
			description: `→ ${entry.baseRef}`,
			icon: 'layers',
			checkable: false,
			// Matches on the trunk and on the members' own text, so filtering to a layer keeps the group.
			filterText: `stack #${entry.number} ${entry.baseRef}`,
			decorations: [
				{ type: 'text', label: count, position: 'before', kind: 'muted' },
			] satisfies TreeItemDecoration[],
			actions: actions,
			children: children,
		};
	}

	private toPullRequestLeaf(pr: GraphSidebarPullRequest): LeafProps {
		const actions = getPullRequestLeafActions(pr);
		// Last, so it lands on the row's right edge — same rule as the branch and remote-branch rows. With the
		// ref already here the webview scopes directly, which is instant; without it — an unfetched head, or a
		// fork whose remote this repository doesn't have — the host command runs instead, which offers to
		// fetch and then scopes. Same action either way, so the row doesn't explain the difference.
		if (pr.focus != null) {
			actions.push(
				createFocusRefAction('Focus on Pull Request', {
					...pr.focus,
					origin: { kind: 'pullRequest', number: pr.number },
				}),
			);
		} else if (pr.state === 'opened' && pr.headBranch && pr.headUrl) {
			actions.push({
				icon: 'target',
				label: 'Focus on Pull Request',
				action: 'gitlens.focusPullRequest:graph',
			});
		}

		// Grouping resolved through the shared helper the overview card and branch hover use, so one PR
		// never reads as two different states across surfaces.
		const group = getLaunchpadItemGroup({ state: pr.state, draft: pr.isDraft }, pr.launchpad);
		const grouping = getLaunchpadItemGrouping(group);
		const groupIcon = getLaunchpadGroupIconName(group);
		const groupLabel = group != null ? launchpadGroupLabelMap.get(group) : undefined;
		const decorationKind: TreeItemDecorationIconKind | undefined =
			grouping != null ? `launchpad-${grouping}` : undefined;

		// Signals beyond what the markdown can carry (colored grouping line, CI/review/size) go in the
		// Lit half of the hover; a row with none of them keeps the plain markdown tooltip.
		const markdown = pullRequestTooltip(pr, this.dateFormat);
		// Rendered by the Lit half (below the state block), so it has to be folded back in when there's no
		// Lit half to render it.
		const merges = pullRequestMergesTooltip(pr);
		// Mirrors the component's own truthiness guards — a zero count renders nothing, so counting it as a
		// signal would hand the hover an empty second half. `launchpad` being present isn't itself a signal:
		// a row categorized `other` with no conflicts, no failing CI and no reviews resolves no group and
		// renders nothing from it.
		const lp = pr.launchpad;
		const hasSignals =
			group != null ||
			(lp != null &&
				Boolean(
					lp.hasConflicts ||
					lp.failingCI ||
					lp.reviewCounts.approval ||
					lp.reviewCounts.changeRequest ||
					lp.reviewCounts.comment,
				)) ||
			pr.statusCheckRollup != null ||
			pr.reviewDecision != null ||
			Boolean(pr.additions || pr.deletions || pr.commentsCount);

		return {
			// Title leads — the number is the identifier, not the thing you scan for. It rides along as a
			// `before` decoration so it sits just left of the row's actions.
			label: pr.title,
			filterText: `${pr.number} ${pr.title} ${pr.headBranch ?? ''}`,
			tooltip: hasSignals
				? html`<gl-markdown density="compact" .markdown=${markdown}></gl-markdown>
						<gl-pr-tooltip
							.group=${group}
							.launchpad=${pr.launchpad}
							.statusCheckRollup=${pr.statusCheckRollup}
							.reviewDecision=${pr.reviewDecision}
							.merges=${merges}
							additions=${pr.additions ?? nothing}
							deletions=${pr.deletions ?? nothing}
							comments=${pr.commentsCount ?? nothing}
						></gl-pr-tooltip>`
				: merges
					? `${markdown}\n\n${merges}`
					: markdown,
			// A merged/closed row reaches this list only via the search-by-number fallback, and carries no
			// indicator (grouping is open-only) — so the glyph is the only thing distinguishing it. Color
			// comes with it, from GitLens's contributed pull-request colors, and draft keeps its own glyph
			// so the distinction survives for anyone the hue doesn't reach.
			icon: { type: 'pull-request', state: pr.state, draft: pr.isDraft },
			description: pr.authorName,
			decorations: [
				// Leading, in the scanning column, so provenance reads before the title — the trailing slot stays
				// the attention indicator's alone. Muted: it's a property of the row, not a call for attention,
				// and at full strength it competes with the state glyph it sits beside.
				...(pr.headOwner != null
					? [
							{
								type: 'icon' as const,
								icon: 'repo-forked',
								label: `From a fork (${pr.headOwner})`,
								position: 'before' as const,
								muted: true,
							},
						]
					: []),
				{ type: 'text', label: `#${pr.number}`, position: 'before', kind: 'muted' },
				// Which layer this is. The trunk isn't repeated here — the parent row states it once, and a
				// member's own base is the layer below it, which isn't the useful fact at a glance.
				...(pr.stack != null
					? [
							{
								type: 'stack' as const,
								label: `Layer ${pr.stack.position} of ${pr.stack.size}`,
								position: 'before' as const,
								layer: pr.stack.position,
								size: pr.stack.size,
							},
						]
					: []),
				// Trailing indicator, and only for a grouping that asks something of the user — a glyph on
				// every row would stop separating the ones that need attention from the ones that don't.
				...(decorationKind != null && groupIcon != null
					? [{ type: 'icon' as const, icon: groupIcon, label: groupLabel ?? '', kind: decorationKind }]
					: []),
			] satisfies TreeItemDecoration[],
			context: [pr.headSha] as SidebarItemContext,
			contextValue: pr.context,
			actions: actions,
		};
	}

	private toTagLeaf(t: GraphSidebarTag, isTree: boolean): LeafProps {
		return {
			label: isTree ? (t.name.split('/').pop() ?? t.name) : t.name,
			filterText: isTree ? t.name : undefined,
			tooltip: tagTooltip(t, this.dateFormat),
			icon: 'tag',
			description: t.message,
			context: [t.sha] as SidebarItemContext,
			actions: [{ icon: 'gl-switch', label: 'Switch to Tag...', action: 'gitlens.graph.switchToTag' }],
			contextValue: t.context,
		};
	}

	private toWorktreeLeaf(w: GraphSidebarWorktree, isTree: boolean): LeafProps {
		const branchName = w.branch ?? w.name;

		const actions: TreeItemAction[] = [];
		if (w.tracking?.behind) {
			actions.push({
				icon: 'repo-pull',
				label: 'Pull',
				action: 'gitlens.graph.pull',
				altIcon: 'repo-fetch',
				altLabel: 'Fetch',
				altAction: 'gitlens.fetch:graph',
			});
		} else if (w.tracking?.ahead) {
			actions.push({ icon: 'repo-push', label: 'Push', action: 'gitlens.graph.push' });
		} else if (w.upstream) {
			actions.push({
				icon: 'repo-fetch',
				label: 'Fetch',
				action: 'gitlens.fetch:graph',
				altIcon: 'repo-pull',
				altLabel: 'Pull',
				altAction: 'gitlens.graph.pull',
			});
		}

		if (!w.opened) {
			actions.push({
				icon: 'empty-window',
				label: 'Open Worktree in New Window...',
				action: 'gitlens.openWorktreeInNewWindow:graph',
				altIcon: 'window',
				altLabel: 'Open Worktree...',
				altAction: 'gitlens.openWorktree:graph',
			});
		}

		// Always last, same as the branch and remote-branch leaves. A bare or detached worktree has
		// no branch to focus.
		if (w.branch != null) {
			actions.push(createFocusRefAction('Focus on Worktree', { branchName: w.branch, upstreamName: w.upstream }));
		}

		// Place the WIP pill before the tracking arrows so the row reads `[wip][↑↓][active][lock]`,
		// matching the overview card's left-to-right ordering. Bare worktrees never have a working
		// tree of their own (`hasChanges` stays undefined) and stay pill-less.
		// Clean/dirty only — the badge renders a pencil/check from `hasChanges` and draws no numbers. The
		// breakdown lives in the row tooltip, fetched on hover.
		const wipDecoration: TreeItemDecoration[] =
			w.hasChanges != null
				? [
						{
							type: 'wip',
							label: w.hasChanges ? 'Working tree has changes' : 'No changes',
							hasChanges: w.hasChanges,
						},
					]
				: [];

		// A component, not an inline template: the breakdown isn't carried on `w`, so the tooltip requests it
		// when it opens and re-renders when it lands. `gl-tree-view` only instantiates this once the popover
		// actually shows, which is what keeps the fetch on-demand.
		// Trailing `\\\n` is a single markdown hard line break — keeps the stats line from sitting flush
		// against the markdown's last text line.
		const tooltipMarkdown = `${worktreeTooltipWithoutChangesLine(w)}\\\n`;
		const tooltip =
			w.hasChanges != null
				? html`<gl-worktree-tooltip
						.markdown=${tooltipMarkdown}
						.path=${w.uri}
						.wipSha=${w.wipSha}
						.hasChanges=${w.hasChanges}
					></gl-worktree-tooltip>`
				: worktreeTooltip(w);

		return {
			label: isTree ? (branchName.split('/').pop() ?? branchName) : branchName,
			filterText: isTree ? branchName : undefined,
			tooltip: tooltip,
			icon: w.branch != null ? { type: 'branch', status: w.status, hasChanges: w.hasChanges } : 'git-commit',
			description: formatWorktreeDescription(w),
			context: [w.wipSha] as SidebarItemContext,
			decorations: [
				...wipDecoration,
				...(trackingDecorations(w.tracking) ?? []),
				...(w.pinned ? [pinnedToEdgeDecoration] : []),
				...(w.opened ? [{ type: 'icon' as const, icon: 'check', label: 'Active', muted: true }] : []),
				...(w.locked ? [{ type: 'icon' as const, icon: 'lock', label: 'Locked', muted: true }] : []),
			],
			actions: actions,
			// `+working` is appended client-side once the async hasChanges check resolves —
			// the host emits the base context only.
			contextValue: w.context != null && w.hasChanges ? withWebviewItemFlag(w.context, 'working') : w.context,
		};
	}

	/** The graph's repo and its family path. `path` is whatever the graph is showing (could be a
	 *  named worktree); `family` is `commonPath ?? path` — the parent that a session's
	 *  `commonPath` (the authoritative repo identity, set together with `worktreePath` by
	 *  `resolveGitInfo`) compares against to test "same repo family". Without this, a graph
	 *  viewing a worktree would fail to match sessions running in the parent or a sibling
	 *  worktree of the same repo. */
	private resolveGraphAnchorContext(): { repoPath: string; family: string } | undefined {
		const repo = this._state.repositories?.find(r => r.id === this._state.selectedRepository);
		if (repo == null) return undefined;
		return { repoPath: repo.path, family: repo.commonPath ?? repo.path };
	}

	/** Resolves the session's WIP-row sha + branch-scope payload. Only same-family sessions get a
	 *  sha — a cross-repo session would otherwise drive `navigateToCommit` to scan the graph
	 *  for a synthetic id that doesn't exist in it. Same gate stops a future scope-on-click from
	 *  re-targeting the graph to a foreign branch. */
	private resolveAgentAnchor(
		session: AgentSessionState,
		graph: { repoPath: string; family: string } | undefined,
	): { wipSha?: string; scope?: SidebarItemScope } {
		const worktreePath = session.worktreePath;
		// `session.commonPath` is the authoritative repo identity. No fallback — `workspacePath`
		// is a separate concept (matched workspace folder, not repo identity), and dropping the
		// anchor for the narrow cold-cache window before resolveGitInfo completes is preferable
		// to wiring up a wrong family.
		const sameFamily = graph != null && session.commonPath === graph.family;
		if (!sameFamily) return {};
		// The row id keys off the SESSION's worktree, never `commonPath` — a session on the main
		// worktree has `worktreePath === commonPath`, and keying off the latter would point at
		// whichever worktree the graph is showing instead of the session's own.
		return {
			wipSha: worktreePath != null ? createWipRowId(worktreePath) : undefined,
			scope:
				session.worktree?.branch != null
					? { branchName: session.worktree.branch.name, upstreamName: session.worktree.branch.upstreamName }
					: undefined,
		};
	}

	private toAgentLeaf(session: AgentSessionState, anchor: { wipSha?: string; scope?: SidebarItemScope }): LeafProps {
		const category = agentPhaseToCategory[session.phase];
		const elapsed = formatAgentElapsed(session.phaseSince);
		// Description = last prompt; otherwise the describeSession line for needs-input / working
		// (`Awaiting: tool` / `Running tool`). The "Last active …" fallback is intentionally
		// excluded — elapsed time is already surfaced in the tooltip, no need to repeat it.
		const description =
			session.lastPrompt ||
			describeAgentSession(session, category, elapsed, {
				awaitingPrefix: 'short',
				idleFallback: 'lastPrompt',
			});

		// `anchor.wipSha`/`anchor.scope` are pre-computed in `buildAgentTree` — all sessions in a
		// group share workspace + worktree, so they share the same anchor. Avoids recomputing the
		// graphRepo lookup + same-family test per leaf on every snapshot push.
		const sha = anchor.wipSha;
		const scope = anchor.scope;

		const permission = session.pendingPermission;
		const canResolve = category === 'needs-input' && permission != null;
		// Always-Allow is meaningful only for regular tool permissions — plan / question /
		// elicitation have no recurring rule to persist.
		const showAlwaysAllow =
			canResolve &&
			permission.kind === 'tool' &&
			permission.suggestions != null &&
			permission.suggestions.length > 0;
		const allowLabel = canResolve && permission.kind === 'plan' ? 'Approve Plan' : 'Allow';
		const denyLabel = canResolve && permission.kind === 'plan' ? 'Reject Plan' : 'Deny';

		const actions: TreeItemAction[] = [];
		if (canResolve) {
			actions.push({
				icon: 'check',
				label: allowLabel,
				action: 'gitlens.agents.resolvePermission',
				arguments: [{ sessionId: session.id, decision: 'allow' as const }],
				...(showAlwaysAllow
					? {
							altIcon: 'check-all',
							altLabel: 'Always Allow',
							altAction: 'gitlens.agents.resolvePermission',
							altArguments: [{ sessionId: session.id, decision: 'allow' as const, alwaysAllow: true }],
						}
					: {}),
			});
			actions.push({
				icon: 'x',
				label: denyLabel,
				action: 'gitlens.agents.resolvePermission',
				arguments: [{ sessionId: session.id, decision: 'deny' as const }],
			});
		}
		if (canResolve && permission.kind === 'plan' && permission.planFilePath != null) {
			actions.push({
				icon: 'tasklist',
				label: 'View Plan',
				action: 'gitlens.agents.openPlanFile',
				arguments: [permission.planFilePath],
			});
		}
		const openAction = getAgentSessionOpenAction(session);
		actions.push({
			icon: openAction.icon,
			label: openAction.label,
			action: openAction.command,
			arguments: openAction.args,
		});
		// Archive is offered only on terminal (completed) sessions — a live one would have to be
		// killed first, so it stays out of the action row for anything still running.
		if (category === 'completed') {
			actions.push({
				icon: 'archive',
				label: 'Archive Session',
				action: 'gitlens.agents.archiveSession',
				arguments: [session.id],
			});
		}

		// Phase status is conveyed by the leaf's agent icon (glyph + `--gl-agent-*` color) and the
		// tooltip — no redundant text decoration.
		return {
			label: session.displayName,
			tooltip: html`<gl-agent-tooltip .sessionId=${session.id}></gl-agent-tooltip>`,
			filterText: `${session.displayName} ${session.lastPrompt ?? ''}`.trim(),
			icon: { type: 'agent', phase: session.phase },
			description: description,
			// Completed sessions are done history — dim the whole row so they read as distinct from
			// the still-live idle/stale sessions they share the Inactive grouping with.
			muted: category === 'completed',
			context: [sha, scope, session.id] as SidebarItemContext,
			actions: actions,
		};
	}

	/** Tree-mode build for the agents panel: groups sessions by `(workspacePath, worktreePath)` so
	 *  all sessions in the same worktree nest under a single parent. The label is the session's
	 *  transient `worktree.name` (resolved host-side per serialization, so `git checkout` updates
	 *  display without restarting the agent), falling back to the worktree directory basename or
	 *  `Unattached` for sessions with no worktree. Group order preserves the input's actionability
	 *  sort (needs-input → working → idle) by tracking each group's first appearance index in the
	 *  source list. */
	private buildAgentTree(items: readonly AgentSessionState[]): TreeModel<SidebarItemContext>[] {
		if (items.length === 0) return [];

		const graphAnchor = this.resolveGraphAnchorContext();

		interface Group {
			key: string;
			worktreePath: string | undefined;
			firstIndex: number;
			name: string;
			type: 'worktree' | 'folder';
			anchor: { wipSha?: string; scope?: SidebarItemScope };
			sessions: AgentSessionState[];
		}

		// Key by `worktreePath`; fall back to `workspacePath` so sessions in a non-repo workspace
		// folder still cluster together. Empty-string key groups truly unattached sessions.
		const groups = new Map<string, Group>();
		items.forEach((session, index) => {
			const key = session.worktreePath ?? session.workspacePath ?? '';
			let group = groups.get(key);
			if (group == null) {
				group = {
					key: key,
					worktreePath: session.worktreePath,
					firstIndex: index,
					name:
						session.worktree?.name ??
						(session.worktreePath
							? basename(session.worktreePath)
							: session.cwd
								? `Unattached (${basename(session.cwd)})`
								: 'Unattached'),
					type: session.worktreePath != null ? 'worktree' : 'folder',
					// Sessions in a group share the same worktree → share the same anchor.
					anchor: this.resolveAgentAnchor(session, graphAnchor),
					sessions: [],
				};
				groups.set(key, group);
			}
			group.sessions.push(session);
		});

		return [...groups.values()]
			.sort((a, b) => a.firstIndex - b.firstIndex)
			.map(group => {
				const children = group.sessions.map(s =>
					leafToTreeModel(this.toAgentLeaf(s, group.anchor), `agent:${s.id}`, 2),
				);

				// Description hints at the physical worktree directory when its basename differs
				// from the display name (e.g. a worktree at `feature-x/` checked out on a branch
				// named `feature/x`).
				const description =
					group.worktreePath != null && basename(group.worktreePath) !== group.name
						? basename(group.worktreePath)
						: undefined;

				const actions: TreeItemAction[] =
					group.type === 'worktree' && group.worktreePath != null
						? [
								{
									icon: 'terminal',
									label: 'Open in Integrated Terminal',
									action: 'gitlens.openInIntegratedTerminal:graph',
								},
							]
						: [];

				// The command is registered through `WebviewCommandRegistrar` and requires
				// `webview`/`webviewInstance` to be present on the arg — the host augments those when
				// dispatching via `params.context`, so route the worktree URI through `contextData`.
				const contextData =
					group.type === 'worktree' && group.worktreePath != null
						? JSON.stringify({ worktreeUri: URI.file(group.worktreePath).toString() })
						: undefined;

				return {
					branch: true,
					expanded: true,
					path: `agent-group:${group.key}`,
					level: 1,
					label: group.name,
					icon: group.type === 'worktree' ? { type: 'branch' as const, worktree: true } : 'folder',
					description: description !== group.name ? description : undefined,
					checkable: false,
					context: [group.anchor.wipSha, group.anchor.scope] as SidebarItemContext,
					contextData: contextData,
					children: children,
					actions: actions,
				};
			});
	}

	private buildRemoteTree(
		remotes: GraphSidebarRemote[],
		useTree: boolean,
		compact: boolean,
	): TreeModel<SidebarItemContext>[] {
		return remotes.map((r, i) => {
			const children: TreeModel<SidebarItemContext>[] = this.buildItemTree<
				GraphSidebarRemote['branches'][number]
			>(
				r.branches,
				useTree,
				compact,
				b => b.name.split('/'),
				(b, isTree) => ({
					label: isTree ? (b.name.split('/').pop() ?? b.name) : b.name,
					filterText: isTree ? b.name : undefined,
					tooltip: `$(git-branch) \`${r.name}/${b.name}\``,
					icon: 'git-branch',
					context: [b.sha] as SidebarItemContext,
					decorations: b.pinned ? [pinnedToEdgeDecoration] : undefined,
					// Scope is keyed on local heads, so focus the local branch tracking this one when
					// there is one; only an untracked remote branch is scoped as a `remotes/*` ref.
					actions: [
						createFocusRefAction(
							'Focus on Branch',
							b.localBranch != null
								? { branchName: b.localBranch, upstreamName: `${r.name}/${b.name}` }
								: { branchName: `${r.name}/${b.name}`, remote: true },
						),
					],
					contextValue: b.context,
				}),
				2,
			);

			const remoteIcon =
				r.providerIcon != null && r.providerIcon !== 'remote' ? `gl-provider-${r.providerIcon}` : 'cloud';

			const actions: TreeItemAction[] = [
				{ icon: 'repo-fetch', label: 'Fetch', action: 'gitlens.fetchRemote:graph' },
			];
			if (r.connected === false) {
				actions.push({
					icon: 'plug',
					label: 'Connect Remote Integration',
					action: 'gitlens.connectRemoteProvider:graph',
				});
			} else if (r.connected === true) {
				actions.push({
					icon: 'gl-unplug',
					label: 'Disconnect Remote Integration',
					action: 'gitlens.disconnectRemoteProvider:graph',
				});
			}
			actions.push({
				icon: 'globe',
				label: 'Open on Remote',
				action: 'gitlens.openRepoOnRemote:graph',
				altIcon: 'copy',
				altLabel: 'Copy Remote URL',
				altAction: 'gitlens.copyRemoteRepositoryUrl:graph',
			});

			return {
				branch: true,
				expanded: i === 0,
				path: r.name,
				level: 1,
				label: r.name,
				tooltip: remoteTooltip(r),
				icon: remoteIcon,
				description: r.url,
				checkable: false,
				context: [undefined],
				contextData: r.context != null ? serializeWebviewItemContext(r.context) : undefined,
				children: children,
				decorations: r.isDefault ? [{ type: 'text' as const, label: 'default' }] : undefined,
				actions: actions,
			};
		});
	}

	private buildItemTree<T>(
		items: T[],
		useTree: boolean,
		compact: boolean,
		splitPath: (item: T) => string[],
		toLeaf: (item: T, isTree: boolean) => LeafProps,
		baseLevel: number = 1,
		folderIcon?: (name: string) => string | undefined,
	): TreeModel<SidebarItemContext>[] {
		if (items.length === 0) return [];

		if (!useTree) {
			return items.map((item, i) => {
				const leaf = toLeaf(item, false);
				return leafToTreeModel(leaf, `flat:${leaf.context[0] ?? i}:${leaf.label}`, baseLevel);
			});
		}

		const hierarchy = makeHierarchical(
			items,
			splitPath,
			(...paths: string[]) => paths.join('/'),
			compact,
			() => true,
		);
		return this.hierarchyToTreeModel(hierarchy, baseLevel, item => toLeaf(item, true), folderIcon);
	}

	private hierarchyToTreeModel<T>(
		node: HierarchicalItem<T>,
		level: number,
		toLeaf: (item: T) => LeafProps,
		folderIcon?: (name: string) => string | undefined,
	): TreeModel<SidebarItemContext>[] {
		const models: TreeModel<SidebarItemContext>[] = [];

		if (node.children != null) {
			for (const child of node.children.values()) {
				if (child.value != null) {
					const leaf = toLeaf(child.value);
					leaf.label = child.name;
					models.push(leafToTreeModel(leaf, child.relativePath, level));
				} else if (child.children != null && child.children.size > 0) {
					const childModels = this.hierarchyToTreeModel(child, level + 1, toLeaf, folderIcon);
					models.push({
						branch: true,
						expanded: false,
						path: `folder:${child.relativePath}`,
						level: level,
						label: child.name,
						icon: folderIcon?.(child.name) ?? 'folder',
						checkable: false,
						context: [undefined],
						children: childModels,
					});
				}
			}
		}

		return models;
	}

	private handleFilterChanged = (e: CustomEvent<string>) => {
		this._actions.filterText = e.detail;

		if (this.activePanel === 'agents') {
			const hasFilter = e.detail.length > 0;
			if (hasFilter !== this._agentsFilterActive) {
				this._agentsFilterActive = hasFilter;
				emitTelemetrySentEvent<'graph/agents/filtered'>(this, {
					name: 'graph/agents/filtered',
					data: {
						hasFilter: hasFilter,
						'filter.length': e.detail.length,
						'sessions.count': this._state.agentSessions?.length ?? 0,
					},
				});
			}
		}

		if (this.activePanel === 'worktrees') {
			this.emitWorktreesFilteredTelemetryDebounced();
		}

		if (this.activePanel === 'branches') {
			this.emitBranchesFilteredTelemetryDebounced();
		}

		if (this.activePanel === 'remotes') {
			this.emitRemotesFilteredTelemetryDebounced();
		}

		if (this.activePanel === 'stashes') {
			this.emitStashesFilteredTelemetryDebounced();
		}

		if (this.activePanel === 'pullRequests') {
			this.emitPullRequestsFilteredTelemetryDebounced();
		}

		if (this.activePanel === 'tags') {
			this.emitTagsFilteredTelemetryDebounced();
		}
	};

	private handleSearchBoxFilterChanged = (e: CustomEvent<boolean>) => {
		this._state.sidebar = { searchBoxFilter: e.detail };
		this.dispatchEvent(
			new CustomEvent<boolean>('gl-graph-sidebar-search-box-filter-change', {
				detail: e.detail,
				bubbles: true,
				composed: true,
			}),
		);
	};

	private handleAction(command: GlCommands, args?: unknown[]) {
		if (this.activePanel === 'agents') {
			const action =
				command === 'gitlens.startWork'
					? 'startWork'
					: command === 'gitlens.startReview'
						? 'startReview'
						: undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/agents/headerAction'>(this, {
					name: 'graph/agents/headerAction',
					data: { action: action },
				});
			}
		}

		if (this.activePanel === 'worktrees') {
			const action = command === 'gitlens.views.title.createWorktree' ? 'createWorktree' : undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/worktrees/headerAction'>(this, {
					name: 'graph/worktrees/headerAction',
					data: { action: action },
				});
			}
		}

		if (this.activePanel === 'branches') {
			const action =
				command === 'gitlens.switchToAnotherBranch:views'
					? 'switchToBranch'
					: command === 'gitlens.views.title.createBranch'
						? 'createBranch'
						: undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/branches/headerAction'>(this, {
					name: 'graph/branches/headerAction',
					data: { action: action },
				});
			}
		}

		if (this.activePanel === 'remotes') {
			const action = command === 'gitlens.views.addRemote' ? 'addRemote' : undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/remotes/headerAction'>(this, {
					name: 'graph/remotes/headerAction',
					data: { action: action },
				});
			}
		}

		if (this.activePanel === 'stashes') {
			const action =
				command === 'gitlens.stashSave:views'
					? 'stashAll'
					: command === 'gitlens.stashesApply:views'
						? 'applyStash'
						: undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/stashes/headerAction'>(this, {
					name: 'graph/stashes/headerAction',
					data: { action: action },
				});
			}
		}

		if (this.activePanel === 'pullRequests') {
			const action = command === 'gitlens.createPullRequest:graph' ? 'createPullRequest' : undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/pullRequests/headerAction'>(this, {
					name: 'graph/pullRequests/headerAction',
					data: { action: action },
				});
			}
		}

		if (this.activePanel === 'tags') {
			const action = command === 'gitlens.views.title.createTag' ? 'createTag' : undefined;
			if (action != null) {
				emitTelemetrySentEvent<'graph/tags/headerAction'>(this, {
					name: 'graph/tags/headerAction',
					data: { action: action },
				});
			}
		}

		this._actions?.executeAction(command, undefined, args);
	}

	private handleToggleLayout() {
		if (this.activePanel == null) return;

		// Compute the panel layout before toggling — the service update is async, so the
		// resource value still reflects the old layout here; invert it to get the new one.
		const worktreesData =
			this.activePanel === 'worktrees' ? this._actions?.state.panels.worktrees?.value.get() : undefined;
		const worktreesNewLayout = worktreesData?.layout === 'tree' ? 'list' : 'tree';
		const tagsData = this.activePanel === 'tags' ? this._actions?.state.panels.tags?.value.get() : undefined;
		const tagsNewLayout = tagsData?.layout === 'tree' ? 'list' : 'tree';

		const branchesData =
			this.activePanel === 'branches' ? this._actions?.state.panels.branches?.value.get() : undefined;

		const remotesData =
			this.activePanel === 'remotes' ? this._actions?.state.panels.remotes?.value.get() : undefined;

		this._actions.toggleLayout(this.activePanel);

		if (this.activePanel === 'agents') {
			emitTelemetrySentEvent<'graph/agents/layoutToggled'>(this, {
				name: 'graph/agents/layoutToggled',
				data: {
					layout: this._actions.agentsLayout.get(),
					'sessions.count': this._state.agentSessions?.length ?? 0,
				},
			});
		}

		if (this.activePanel === 'worktrees') {
			emitTelemetrySentEvent<'graph/worktrees/layoutToggled'>(this, {
				name: 'graph/worktrees/layoutToggled',
				data: {
					layout: worktreesNewLayout,
					'worktrees.count': worktreesData?.items.length ?? 0,
				},
			});
		}

		// Only report the branches toggle when the current layout is known — predicting off
		// undefined data would misreport 'tree'.
		if (this.activePanel === 'branches' && branchesData?.layout != null) {
			emitTelemetrySentEvent<'graph/branches/layoutToggled'>(this, {
				name: 'graph/branches/layoutToggled',
				data: {
					layout: branchesData.layout === 'tree' ? 'list' : 'tree',
					'branches.count': branchesData.items.length,
				},
			});
		}

		// Same reasoning for remotes — only report when the current layout is known.
		if (this.activePanel === 'remotes' && remotesData?.layout != null) {
			emitTelemetrySentEvent<'graph/remotes/layoutToggled'>(this, {
				name: 'graph/remotes/layoutToggled',
				data: {
					layout: remotesData.layout === 'tree' ? 'list' : 'tree',
					'remotes.count': remotesData.items.length,
				},
			});
		}

		if (this.activePanel === 'tags') {
			emitTelemetrySentEvent<'graph/tags/layoutToggled'>(this, {
				name: 'graph/tags/layoutToggled',
				data: {
					layout: tagsNewLayout,
					'tags.count': tagsData?.items.length ?? 0,
				},
			});
		}
	}

	private handleToggleShowRemoteBranches() {
		const data = this._actions?.state.panels.branches?.value.get();

		// Same reasoning as the layout toggle — the service update is async, so invert the current
		// value to report the state we're moving to. Only report when it's known.
		if (data?.panel === 'branches' && data.showRemoteBranches != null) {
			emitTelemetrySentEvent<'graph/branches/showRemoteBranchesToggled'>(this, {
				name: 'graph/branches/showRemoteBranchesToggled',
				data: {
					enabled: !data.showRemoteBranches,
					'branches.count': data.items.length,
				},
			});
		}

		this._actions.toggleShowRemoteBranches();
	}

	private handleRefresh() {
		if (this.activePanel == null) return;
		if (this.activePanel === 'overview') {
			const overview = this.shadowRoot?.querySelector('gl-graph-overview') as
				| (HTMLElement & { refresh?: () => void })
				| null;
			overview?.refresh?.();
			return;
		}

		if (this.activePanel === 'agents') {
			emitTelemetrySentEvent<'graph/agents/headerAction'>(this, {
				name: 'graph/agents/headerAction',
				data: { action: 'refresh' },
			});
		}

		if (this.activePanel === 'worktrees') {
			emitTelemetrySentEvent<'graph/worktrees/headerAction'>(this, {
				name: 'graph/worktrees/headerAction',
				data: { action: 'refresh' },
			});
		}

		if (this.activePanel === 'branches') {
			emitTelemetrySentEvent<'graph/branches/headerAction'>(this, {
				name: 'graph/branches/headerAction',
				data: { action: 'refresh' },
			});
		}

		if (this.activePanel === 'remotes') {
			emitTelemetrySentEvent<'graph/remotes/headerAction'>(this, {
				name: 'graph/remotes/headerAction',
				data: { action: 'refresh' },
			});
		}

		if (this.activePanel === 'stashes') {
			emitTelemetrySentEvent<'graph/stashes/headerAction'>(this, {
				name: 'graph/stashes/headerAction',
				data: { action: 'refresh' },
			});
		}

		if (this.activePanel === 'tags') {
			emitTelemetrySentEvent<'graph/tags/headerAction'>(this, {
				name: 'graph/tags/headerAction',
				data: { action: 'refresh' },
			});
		}

		if (this.activePanel === 'pullRequests') {
			emitTelemetrySentEvent<'graph/pullRequests/headerAction'>(this, {
				name: 'graph/pullRequests/headerAction',
				data: { action: 'refresh' },
			});
		}

		this._actions?.refresh(this.activePanel);
	}

	private handleTogglePinned = (): void => {
		this.dispatchEvent(
			new CustomEvent<GraphSidebarTogglePinnedEventDetail>('gl-graph-sidebar-toggle-pinned', {
				bubbles: true,
				composed: true,
			}),
		);
	};

	private handleTreeItemAction(e: CustomEvent<TreeItemActionDetail>) {
		const action = e.detail.action;
		const node = e.detail.node as TreeModelFlat;
		const useAlt = e.detail.altKey && action.altAction != null;
		const command = (useAlt ? action.altAction! : action.action) as GlCommands;
		const args = useAlt ? action.altArguments : action.arguments;

		// Focus is view state, not a host command — handle it here, before the per-panel action
		// telemetry (which resolves command ids against the sidebar action tables and would find
		// nothing to map). Scope changes report themselves via `graph/scope/changed|cleared`.
		if (action.action === focusRefActionId) {
			this.focusRef(action.arguments?.[0] as FocusRefActionArgs | undefined);
			return;
		}

		if (this.activePanel === 'agents') {
			this.emitAgentsTreeItemActionTelemetry(command, args);
		}

		if (this.activePanel === 'worktrees') {
			this.emitWorktreesTreeItemActionTelemetry(command, useAlt);
		}

		if (this.activePanel === 'branches') {
			this.emitBranchesTreeItemActionTelemetry(command, useAlt);
		}

		if (this.activePanel === 'remotes') {
			this.emitRemotesTreeItemActionTelemetry(command, useAlt);
		}

		if (this.activePanel === 'stashes') {
			this.emitStashesTreeItemActionTelemetry(command, useAlt);
		}

		if (this.activePanel === 'tags') {
			this.emitTagsTreeItemActionTelemetry(command, useAlt);
		}

		if (this.activePanel === 'pullRequests') {
			this.emitPullRequestsTreeItemActionTelemetry(command, useAlt);
		}

		this._actions?.executeAction(command, node.contextData as string | undefined, args);
	}

	/** Focuses (scopes) the graph onto the action's branch, or unfocuses when that branch is already
	 *  the live scope. Mirrors the header's jump-to-ref button: a scope on any OTHER branch retargets
	 *  rather than clearing. Identity by `branchRef` — the one scope field the anchor resolver never
	 *  rewrites, and the only one that separates a local branch from a same-named remote one. */
	private focusRef(args: FocusRefActionArgs | undefined): void {
		if (args == null) return;

		// Same repo-path resolution the scope path itself uses (`scopeToBranchByName`), so the ref
		// built here matches the one already published on the scope.
		const repoPath = getSelectedRepoPath(this._state);
		const scope = this._state.scope;
		// Same target means same ORIGIN too — focusing a stack over its plain-focused base (or vice versa)
		// is a re-focus that changes the scope's shape, not a toggle of the same one.
		const sameOrigin = scope?.origin?.kind === args.origin?.kind && scope?.origin?.number === args.origin?.number;
		if (
			repoPath != null &&
			sameOrigin &&
			scope?.branchRef === getBranchId(repoPath, args.remote ?? false, args.branchName)
		) {
			this._state.clearScope();
			return;
		}

		this.dispatchEvent(
			new CustomEvent<
				GraphScopeBranch & {
					source: GraphScopeSource;
					additional?: FocusRefActionArgs['additional'];
					origin?: FocusRefActionArgs['origin'];
				}
			>('gl-graph-scope-to-branch', {
				detail: { ...args, source: 'sidebar' },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleTreeItemSelected(
		e: CustomEvent<TreeItemSelectionDetail & { context?: SidebarItemContext; node?: { path?: string } }>,
	) {
		if (this.activePanel != null && e.detail.node?.path != null) {
			this._actions.selectedPath[this.activePanel] = e.detail.node.path;
		}

		const context = e.detail.context;
		const sessionId = context?.[2];

		// Selecting a session is a real user event regardless of whether the graph can navigate to
		// it, so emit before the `sha` guard below. Cross-repo (`!sameFamily`) and worktree-less
		// sessions resolve to a null `wipSha` (`resolveAgentAnchor`) — i.e. `sha == null` — which is
		// exactly the `session.sameRepo: false` case this event exists to measure. Emitting after
		// the guard would drop those clicks and skew the `sameRepo` dimension to `true`.
		if (this.activePanel === 'agents' && sessionId != null) {
			this.emitAgentsSessionSelectedTelemetry(sessionId);
		}

		// Same reasoning for branches: an unborn branch (no commits yet) has no tip sha, but
		// clicking it is still a real selection — and the emit resolves by name, not sha.
		if (this.activePanel === 'branches') {
			this.emitBranchesSelectedTelemetry(context?.[3]);
		}

		if (this.activePanel === 'pullRequests' && e.detail.node?.path != null) {
			this.emitPullRequestsSelectedTelemetry(e.detail.node.path);

			const path = e.detail.node.path;
			// Leaf rows (`pr:${number}`) open that layer's sheet; stack parents (`stack:${number}`) open
			// the stack-root summary sheet instead.
			if (path.startsWith('pr:')) {
				this.dispatchEvent(
					new CustomEvent('gl-graph-show-pr-sheet', {
						detail: { number: path.slice('pr:'.length) },
						bubbles: true,
						composed: true,
					}),
				);
			} else if (path.startsWith('stack:')) {
				this.dispatchEvent(
					new CustomEvent('gl-graph-show-pr-sheet', {
						detail: { stackNumber: Number(path.slice('stack:'.length)) },
						bubbles: true,
						composed: true,
					}),
				);
			}
		}

		const sha = context?.[0];
		if (sha == null) return;

		// Scope first so the graph's visible row set updates before we ask it to position to the
		// WIP row — overview-card clicks do the same order. Agent leaves are the only producer
		// of `scope` today; other panels (branches/tags/stashes/etc.) leave it undefined.
		const scope = context?.[1];
		if (scope != null) {
			this.dispatchEvent(
				new CustomEvent<{ branchName: string; upstreamName?: string }>('gl-graph-scope-to-branch', {
					detail: { branchName: scope.branchName, upstreamName: scope.upstreamName },
					bubbles: true,
					composed: true,
				}),
			);
		}

		if (this.activePanel === 'worktrees') {
			this.emitWorktreesSelectedTelemetry(sha);
		}

		if (this.activePanel === 'stashes') {
			this.emitStashesSelectedTelemetry(sha);
		}

		if (this.activePanel === 'tags') {
			this.emitTagsSelectedTelemetry(sha, e.detail.node?.path);
		}

		this.dispatchEvent(
			new CustomEvent<GraphSidebarPanelSelectEventDetail>('gl-graph-sidebar-panel-select', {
				detail: { sha: sha, sessionId: sessionId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private handleTreeExpansionChanged = (e: CustomEvent<{ path: string; expanded: boolean }>) => {
		if (this.activePanel == null) return;

		const paths = this._actions.expandedPaths[this.activePanel];
		if (e.detail.expanded) {
			paths.add(e.detail.path);
		} else {
			paths.delete(e.detail.path);
		}
	};

	private getRemotesData(): GraphSidebarRemote[] | undefined {
		const data = this._actions?.state.panels.remotes?.value.get();
		if (data?.panel !== 'remotes') return undefined;
		return data.items;
	}

	private getRemotesCount(): number {
		return this.getRemotesData()?.length ?? 0;
	}

	private emitRemotesShownTelemetry(): void {
		if (this._remotesShownEmitted || this.activePanel !== 'remotes') return;

		// Wait for a successful fetch (mirrors emitWorktreesShownTelemetry): on reactivation the
		// resource still holds the previous visit's value while the switch-triggered fetch is in
		// flight — emitting off that would report stale counts.
		const resource = this._actions?.state.panels.remotes;
		if (resource?.status.get() !== 'success') return;

		const data = resource.value.get();
		if (data?.panel !== 'remotes') return;

		this._remotesShownEmitted = true;
		emitTelemetrySentEvent<'graph/remotes/shown'>(this, {
			name: 'graph/remotes/shown',
			data: {
				layout: data.layout ?? 'list',
				'remotes.count': data.items.length,
				'remotes.connected.count': data.items.filter(r => r.connected === true).length,
				hasMultipleRemotes: data.items.length > 1,
			},
		});
	}

	private emitAgentsShownTelemetry(): void {
		// Point-in-time snapshot: fired on the `activePanel → 'agents'` transition only. Sessions
		// arrive asynchronously on `_state.agentSessions` (see `render`), so on first open the counts
		// below may all read 0, and later arrivals don't re-fire this event. `agentSessions` is a
		// signal initialized to `[]`, so "not yet loaded" and "loaded but empty" are indistinguishable
		// here — treat the counts as "what was visible at open", not a settled total. Also no re-fire
		// when the panel is re-revealed without an `activePanel` change: display-mode round trips
		// (graph → kanban/visualizations → graph) hide/show the split but preserve the value, and
		// rail re-clicks that set the same panel don't transition. Close/reopen does re-fire
		// (`hideSidebar` clears `activePanel`).
		const sessions = this._state.agentSessions ?? [];
		let working = 0;
		let needsInput = 0;
		let idle = 0;
		let completed = 0;
		for (const s of sessions) {
			const category = agentPhaseToCategory[s.phase];
			if (category === 'working') {
				working++;
			} else if (category === 'needs-input') {
				needsInput++;
			} else if (category === 'completed') {
				completed++;
			} else {
				idle++;
			}
		}

		emitTelemetrySentEvent<'graph/agents/shown'>(this, {
			name: 'graph/agents/shown',
			data: {
				layout: this._actions.agentsLayout.get(),
				'sessions.count': sessions.length,
				'sessions.working.count': working,
				'sessions.needsInput.count': needsInput,
				'sessions.idle.count': idle,
				'sessions.completed.count': completed,
			},
		});
	}

	private getBranchesData(): GraphSidebarBranch[] | undefined {
		const data = this._actions?.state.panels.branches?.value.get();
		if (data?.panel !== 'branches') return undefined;
		return data.items;
	}

	private getBranchesCount(): number {
		return this.getBranchesData()?.length ?? 0;
	}

	private maybeEmitBranchesShownTelemetry(): void {
		if (!this._branchesShownPending || this.activePanel !== 'branches') return;

		const resource = this._actions?.state.panels.branches;
		if (resource == null) return;

		// Wait for a successful fetch so counts reflect the freshly shown panel rather than a
		// stale prior fetch's value. Gate on status, not `loading`: at webview boot the panel can
		// be restored before the RPC service exists, so fetchPanel no-ops and the resource sits
		// at 'idle' with loading=false — the flag must survive until initialize() refetches.
		// 'error' also keeps the flag: if a retry/refresh succeeds while the panel is still
		// active, the impression should still count. The flag is consumed on first success and
		// reset on every panel switch, so it can't double-emit.
		if (resource.status.get() !== 'success') return;

		this._branchesShownPending = false;
		this.emitBranchesShownTelemetry();
	}

	private emitBranchesShownTelemetry(): void {
		const data = this._actions?.state.panels.branches?.value.get();
		if (data?.panel !== 'branches') return;

		emitTelemetrySentEvent<'graph/branches/shown'>(this, {
			name: 'graph/branches/shown',
			data: {
				layout: data.layout ?? 'list',
				'branches.count': data.items.length,
			},
		});
	}

	private getWorktreesCount(): number {
		const data = this._actions?.state.panels.worktrees?.value.get();
		return data?.panel === 'worktrees' ? data.items.length : 0;
	}

	private readonly emitWorktreesFilteredTelemetryDebounced = debounce(() => {
		const filterText = this._actions.filterText;
		emitTelemetrySentEvent<'graph/worktrees/filtered'>(this, {
			name: 'graph/worktrees/filtered',
			data: {
				hasFilter: filterText.length > 0,
				'filter.length': filterText.length,
				'worktrees.count': this.getWorktreesCount(),
			},
		});
	}, 500);

	private readonly emitRemotesFilteredTelemetryDebounced = debounce(() => {
		if (this.activePanel !== 'remotes') return;

		const filterText = this._actions.filterText;
		emitTelemetrySentEvent<'graph/remotes/filtered'>(this, {
			name: 'graph/remotes/filtered',
			data: {
				hasFilter: filterText.length > 0,
				'filter.length': filterText.length,
				'remotes.count': this.getRemotesCount(),
			},
		});
	}, 500);

	private getStashesCount(): number {
		const data = this._actions?.state.panels.stashes?.value.get();
		return data?.panel === 'stashes' ? data.items.length : 0;
	}

	private readonly emitStashesFilteredTelemetryDebounced = debounce(() => {
		const filterText = this._actions.filterText;
		emitTelemetrySentEvent<'graph/stashes/filtered'>(this, {
			name: 'graph/stashes/filtered',
			data: {
				hasFilter: filterText.length > 0,
				'filter.length': filterText.length,
				'stashes.count': this.getStashesCount(),
			},
		});
	}, 500);

	private getTagsCount(): number {
		const data = this._actions?.state.panels.tags?.value.get();
		return data?.panel === 'tags' ? data.items.length : 0;
	}

	private getPullRequestsCount(): number {
		const data = this._actions?.state.panels.pullRequests?.value.get();
		return data?.panel === 'pullRequests' ? data.items.length : 0;
	}

	private readonly emitPullRequestsFilteredTelemetryDebounced = debounce(() => {
		const filterText = this._actions.filterText;
		emitTelemetrySentEvent<'graph/pullRequests/filtered'>(this, {
			name: 'graph/pullRequests/filtered',
			data: {
				hasFilter: filterText.length > 0,
				'filter.length': filterText.length,
				// Distinguishes "paste a PR URL" from browsing by text — they're different behaviours
				// sharing one box, and only the former can reach the lookup fallback.
				byIdentity: getPullRequestNumberFromQuery(filterText) != null,
				'pullRequests.count': this.getPullRequestsCount(),
			},
		});
	}, 500);

	private readonly emitTagsFilteredTelemetryDebounced = debounce(() => {
		const filterText = this._actions.filterText;
		emitTelemetrySentEvent<'graph/tags/filtered'>(this, {
			name: 'graph/tags/filtered',
			data: {
				hasFilter: filterText.length > 0,
				'filter.length': filterText.length,
				'tags.count': this.getTagsCount(),
			},
		});
	}, 500);

	private emitWorktreesSelectedTelemetry(wipSha: string): void {
		const data = this._actions?.state.panels.worktrees?.value.get();
		if (data?.panel !== 'worktrees') return;

		const worktree = data.items.find(w => w.wipSha === wipSha);
		if (worktree == null) return;

		emitTelemetrySentEvent<'graph/worktrees/worktreeSelected'>(this, {
			name: 'graph/worktrees/worktreeSelected',
			data: {
				isActive: worktree.opened,
				isDefault: worktree.isDefault,
				hasChanges: worktree.hasChanges === true,
				hasUpstream: worktree.upstream != null,
			},
		});
	}

	private emitBranchesSelectedTelemetry(name: string | undefined): void {
		// Resolve by name, not sha — branch tips routinely coincide (e.g. right after
		// `git checkout -b`), and names are unique.
		const branch = name != null ? this.getBranchesData()?.find(b => b.name === name) : undefined;
		if (branch == null) return;

		emitTelemetrySentEvent<'graph/branches/branchSelected'>(this, {
			name: 'graph/branches/branchSelected',
			data: {
				isCurrent: branch.current,
				// A missing upstream (deleted remote branch) is functionally "no upstream" — the
				// leaf offers no upstream affordances for it, so don't count it as one
				hasUpstream: branch.upstream != null && !branch.upstream.missing,
				hasWorktree: branch.worktree === true,
				isStarred: branch.starred === true,
			},
		});
	}

	private emitAgentsSessionSelectedTelemetry(sessionId: string): void {
		const session = this._state.agentSessions?.find(s => s.id === sessionId);
		if (session == null) return;

		const category = agentPhaseToCategory[session.phase];
		const graphAnchor = this.resolveGraphAnchorContext();
		const sameRepo = graphAnchor != null && session.commonPath === graphAnchor.family;

		emitTelemetrySentEvent<'graph/agents/sessionSelected'>(this, {
			name: 'graph/agents/sessionSelected',
			data: {
				'session.phase': session.phase,
				'session.category': category,
				'session.hasPendingPermission': session.pendingPermission != null,
				'session.sameRepo': sameRepo,
				layout: this._actions.agentsLayout.get(),
			},
		});
	}

	private emitAgentsTreeItemActionTelemetry(command: string, args: unknown[] | undefined): void {
		if (command === 'gitlens.agents.resolvePermission') {
			const arg = args?.[0] as { sessionId?: string; decision?: string; alwaysAllow?: boolean } | undefined;
			const session =
				arg?.sessionId != null ? this._state.agentSessions?.find(s => s.id === arg.sessionId) : undefined;

			emitTelemetrySentEvent<'graph/agents/permissionResolved'>(this, {
				name: 'graph/agents/permissionResolved',
				data: {
					decision: (arg?.decision as 'allow' | 'deny') ?? 'allow',
					alwaysAllow: arg?.alwaysAllow ?? false,
					'permission.kind': session?.pendingPermission?.kind ?? 'unknown',
				},
			});
			return;
		}

		let action: 'openSession' | 'resumeSession' | 'openPlanFile' | 'openTerminal' | undefined;
		if (command === 'gitlens.agents.openSession') {
			action = 'openSession';
		} else if (command === 'gitlens.agents.resumeSession') {
			action = 'resumeSession';
		} else if (command === 'gitlens.agents.openPlanFile') {
			action = 'openPlanFile';
		} else if (command === 'gitlens.openInIntegratedTerminal:graph') {
			action = 'openTerminal';
		}

		if (action != null) {
			emitTelemetrySentEvent<'graph/agents/sessionAction'>(this, {
				name: 'graph/agents/sessionAction',
				data: { action: action },
			});
		}
	}

	private emitWorktreesTreeItemActionTelemetry(command: GlCommands, alt: boolean): void {
		const action = sidebarItemActions.worktree[command];
		if (action == null) return;

		emitTelemetrySentEvent<'graph/worktrees/worktreeAction'>(this, {
			name: 'graph/worktrees/worktreeAction',
			data: { action: action, alt: alt, location: 'inline' },
		});
	}

	private emitBranchesTreeItemActionTelemetry(command: GlCommands, alt: boolean): void {
		const action = sidebarItemActions.branch[command];
		if (action == null) return;

		emitTelemetrySentEvent<'graph/branches/branchAction'>(this, {
			name: 'graph/branches/branchAction',
			data: { action: action, alt: alt, location: 'inline' },
		});
	}

	private emitRemotesTreeItemActionTelemetry(command: GlCommands, alt: boolean): void {
		const action = sidebarItemActions.remote[command];
		if (action == null) return;

		emitTelemetrySentEvent<'graph/remotes/remoteAction'>(this, {
			name: 'graph/remotes/remoteAction',
			data: { action: action, alt: alt, location: 'inline' },
		});
	}

	private emitStashesSelectedTelemetry(sha: string): void {
		const data = this._actions?.state.panels.stashes?.value.get();
		if (data?.panel !== 'stashes') return;

		const stash = data.items.find(s => s.sha === sha);
		if (stash == null) return;

		emitTelemetrySentEvent<'graph/stashes/stashSelected'>(this, {
			name: 'graph/stashes/stashSelected',
			data: {
				hasStashOnRef: stash.stashOnRef != null,
			},
		});
	}

	private emitTagsSelectedTelemetry(sha: string, path: string | undefined): void {
		const data = this._actions?.state.panels.tags?.value.get();
		if (data?.panel !== 'tags') return;

		// Resolve by the clicked node's path (unique per tag) rather than sha, since tags can share
		// a commit — see resolveSelectedTag for the path formats and sha fallback.
		const tag = resolveSelectedTag(data.items, sha, path);
		if (tag == null) return;

		emitTelemetrySentEvent<'graph/tags/tagSelected'>(this, {
			name: 'graph/tags/tagSelected',
			data: {
				annotated: tag.annotated,
			},
		});
	}

	private emitStashesTreeItemActionTelemetry(command: GlCommands, alt: boolean): void {
		const action = sidebarItemActions.stash[command];
		if (action == null) return;

		emitTelemetrySentEvent<'graph/stashes/stashAction'>(this, {
			name: 'graph/stashes/stashAction',
			data: { action: action, alt: alt, location: 'inline' },
		});
	}

	private emitPullRequestsTreeItemActionTelemetry(command: GlCommands, alt: boolean): void {
		const action = sidebarItemActions.pullRequest[command];
		if (action == null) return;

		emitTelemetrySentEvent<'graph/pullRequests/pullRequestAction'>(this, {
			name: 'graph/pullRequests/pullRequestAction',
			data: { action: action, alt: alt, location: 'inline' },
		});
	}

	private emitTagsTreeItemActionTelemetry(command: GlCommands, alt: boolean): void {
		const action = sidebarItemActions.tag[command];
		if (action == null) return;

		emitTelemetrySentEvent<'graph/tags/tagAction'>(this, {
			name: 'graph/tags/tagAction',
			data: { action: action, alt: alt, location: 'inline' },
		});
	}
}

/**
 * Automatically tracks/restores tree expansion state.
 * - First call (set empty): seeds the set from the model's natural `expanded` defaults.
 * - Subsequent calls (set populated): overrides the model's expansion with the remembered set.
 */
function applyOrSeedExpansion(model: TreeModel<unknown>[], paths: Set<string>): void {
	const seeding = paths.size === 0;
	walkExpansion(model, paths, seeding);
}

function walkExpansion(model: TreeModel<unknown>[], paths: Set<string>, seeding: boolean): void {
	for (const node of model) {
		if (node.branch) {
			if (seeding) {
				if (node.expanded) {
					paths.add(node.path);
				}
			} else {
				node.expanded = paths.has(node.path);
			}
		}
		if (node.children != null) {
			walkExpansion(node.children, paths, seeding);
		}
	}
}
