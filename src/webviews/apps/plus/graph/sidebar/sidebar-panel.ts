import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { URI } from 'vscode-uri';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { fromNow } from '@gitlens/utils/date.js';
import { basename } from '@gitlens/utils/path.js';
import type { AgentSessionState } from '../../../../../agents/models/agentSessionState.js';
import type { GlCommands } from '../../../../../constants.commands.js';
import type { WebviewItemContext } from '../../../../../system/webview.js';
import { serializeWebviewItemContext, withWebviewItemFlag } from '../../../../../system/webview.js';
import type {
	DidGetSidebarDataParams,
	GraphSidebarBranch,
	GraphSidebarPanel,
	GraphSidebarRemote,
	GraphSidebarTag,
	GraphSidebarWorktree,
} from '../../../../plus/graph/protocol.js';
import { createWipSha } from '../../../../plus/graph/protocol.js';
import {
	branchTooltip,
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
	getAgentPhaseLabel,
} from '../../../shared/agentUtils.js';
import { scrollableBase, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemDecoration,
	TreeItemSelectionDetail,
	TreeModel,
	TreeModelFlat,
} from '../../../shared/components/tree/base.js';
import { ContextMenuProxyController } from '../../../shared/controllers/context-menu-proxy.js';
import type { AppState } from '../context.js';
import { graphStateContext } from '../context.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import '../overview/graph-overview.js';
import '../../../shared/components/commit/commit-stats.js';
import '../../../shared/components/commit/wip-stats.js';
import '../../../shared/components/markdown/markdown.js';
import './agent-tooltip.js';
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
	remotes: {
		title: 'Remotes',
		actions: [{ icon: 'add', tooltip: 'Add Remote...', command: 'gitlens.views.addRemote' }],
	},
	stashes: {
		title: 'Stashes',
		actions: [
			{ icon: 'gl-stash-save', tooltip: 'Stash All Changes...', command: 'gitlens.stashSave:views' },
			{ icon: 'gl-stash-pop', tooltip: 'Apply Stash...', command: 'gitlens.stashesApply:views' },
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

type SidebarItemContext = [sha: string | undefined, scope?: SidebarItemScope, sessionId?: string];

interface LeafProps {
	label: string;
	filterText?: string;
	tooltip?: TreeModel<SidebarItemContext>['tooltip'];
	icon: TreeModel<SidebarItemContext>['icon'];
	description?: string;
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
				display: flex;
				flex-direction: column;
				height: 100%;
				overflow: visible;
				background-color: var(--color-view-background);
				z-index: 1;
				border-right: 1px solid transparent;
				border-color: var(--vscode-sideBar-border, transparent);
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
				animation: panel-enter 0.2s ease-out;
			}
			:host([switching]) .panel {
				animation: sub-panel-enter 0.2s ease-out;
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
				align-items: center;
				gap: 0.6rem;
				padding: 0 0 0 0.4rem;
				font-size: 1.1rem;
				font-weight: 600;
				text-transform: uppercase;
				color: var(--color-view-header-foreground);
				background-color: var(--color-view-background);
				border-bottom: 1px solid transparent;
				border-color: var(--vscode-sideBarSectionHeader-border, transparent);
				flex: none;
				min-height: 2.2rem;
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
				align-items: center;
				flex: none;
				text-transform: none;
			}

			.header-actions gl-button {
				--button-padding: 0.3rem;
			}

			.content {
				flex: 1;
				overflow: hidden;
				min-height: 0;
			}

			gl-tree-view {
				height: 100%;
				--gitlens-gutter-width: 0.8rem;
			}

			.loading {
				display: flex;
				flex-direction: column;
				gap: 0.6rem;
				padding: 0.4rem 0;
			}

			.skeleton {
				display: flex;
				align-items: center;
				gap: 0.6rem;
				padding: 0.2rem 1rem;
				height: 2.2rem;
			}

			.skeleton-icon {
				width: 16px;
				height: 16px;
				border-radius: 3px;
				background: var(--vscode-foreground);
				opacity: 0.07;
				flex: none;
			}

			.skeleton-text {
				height: 10px;
				border-radius: 3px;
				background: var(--vscode-foreground);
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
				padding: 1rem;
				text-align: center;
				color: var(--vscode-descriptionForeground);
				font-size: 1.2rem;
			}

			.agents-banner {
				flex: none;
				padding: 0 0.4rem 0.4rem;
			}
		`,
	];

	@property({ type: String, attribute: 'active-panel' })
	activePanel: GraphSidebarPanel | undefined;

	@property({ attribute: 'date-format' })
	dateFormat: string | null | undefined;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _actions!: SidebarActions;

	@consume({ context: graphStateContext, subscribe: true })
	private readonly _state!: AppState;

	/** Memo for `buildTreeModel`. Renders fire on every filter/expansion change, so without this
	 *  the tree model is rebuilt for an unchanged `data` reference. Reset on key change. */
	private _treeModelCache?: {
		data: DidGetSidebarDataParams;
		dateFormat: string | null | undefined;
		model: TreeModel<SidebarItemContext>[];
	};

	private readonly _contextMenuProxy = new ContextMenuProxyController(this);

	private _pendingFocus = false;

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

	private readonly _handlePanelAnimationEnd = (e: Event): void => {
		const name = (e as AnimationEvent).animationName;
		if (name === 'panel-enter' || name === 'sub-panel-enter') {
			this.removeAttribute('opening');
			this.removeAttribute('switching');
		}
	};

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		if (changedProperties.has('activePanel') && this._actions != null) {
			// Keep the actions module in sync so invalidateAll can refetch
			this._actions.activePanel = this.activePanel;

			// Always fetch on panel switch — data may be stale even if non-null.
			// The Resource's cancelPrevious handles dedup.
			// Overview/Agents panels manage their own data via reactive state, skip sidebar fetch.
			if (this.activePanel != null && this.activePanel !== 'overview' && this.activePanel !== 'agents') {
				this._actions.fetchPanel(this.activePanel);
			}
		}
	}

	override updated(_changedProperties: Map<PropertyKey, unknown>): void {
		if (this._pendingFocus) {
			this.focusFilter();
		}
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

		return html`<div class="panel">
			${this.renderHeader(config, isLoading)}
			<div class="content">
				${hasError
					? html`<div class="empty">Failed to load data</div>`
					: data != null
						? this.renderTreeContent(config, data)
						: this.renderSkeleton()}
			</div>
		</div>`;
	}

	private renderHeader(config: PanelConfig, isLoading: boolean) {
		const pinned = this._state.config?.sidebarPinned ?? true;
		const pinTooltip = pinned ? 'Unpin Side Bar' : 'Pin Side Bar';
		const pinIcon = pinned ? 'pinned' : 'pin';
		return html`<div class="header">
			<span class="header-title">${config.title}</span>
			<div class="header-actions">
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
			</div>
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
		if (cache?.data === data && cache.dateFormat === this.dateFormat) {
			model = cache.model;
		} else {
			model = this.buildTreeModel(data);
			this._treeModelCache = { data: data, dateFormat: this.dateFormat, model: model };
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

		return html`<gl-tree-view
			focused-path=${this._actions.selectedPath[this.activePanel!] ?? nothing}
			.model=${model}
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
			>${hasLayout
				? html`<gl-button
						slot="filter-actions"
						appearance="toolbar"
						density="compact"
						tooltip="${currentLayout === 'tree' ? 'View as List' : 'View as Tree'}"
						@click=${this.handleToggleLayout}
						><code-icon icon="${currentLayout === 'tree' ? 'list-flat' : 'list-tree'}"></code-icon
					></gl-button>`
				: nothing}</gl-tree-view
		>`;
	}

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
			case 'branches':
				return this.buildItemTree(
					data.items,
					useTree,
					compact,
					b => (b.current || b.worktreeOpened || b.disposition != null ? [b.name] : b.name.split('/')),
					(b, isTree) => this.toBranchLeaf(b, isTree),
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
							{ icon: 'gl-stash-pop', label: 'Apply Stash...', action: 'gitlens.stashApply:graph' },
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
		const actions: TreeItemAction[] = [];

		if (b.tracking?.behind) {
			actions.push({
				icon: 'repo-pull',
				label: 'Pull',
				action: 'gitlens.graph.pull',
				altIcon: 'repo-fetch',
				altLabel: 'Fetch',
				altAction: 'gitlens.fetch:graph',
			});
		} else if (b.tracking?.ahead) {
			actions.push({ icon: 'repo-push', label: 'Push', action: 'gitlens.graph.push' });
		} else if (b.upstream && !b.upstream.missing) {
			actions.push({
				icon: 'repo-fetch',
				label: 'Fetch',
				action: 'gitlens.fetch:graph',
				altIcon: 'repo-pull',
				altLabel: 'Pull',
				altAction: 'gitlens.graph.pull',
			});
		}

		if (b.current) {
			actions.unshift({
				icon: 'gl-switch',
				label: 'Switch to Another Branch...',
				action: 'gitlens.switchToAnotherBranch:graph',
			});
			actions.push({
				icon: 'gl-compare-ref-working',
				label: 'Compare with Working Tree',
				action: 'gitlens.graph.compareWithWorking',
			});
		} else if (b.checkedOut) {
			actions.push({
				icon: 'empty-window',
				label: 'Open Worktree in New Window...',
				action: 'gitlens.openWorktreeInNewWindow:graph',
				altIcon: 'window',
				altLabel: 'Open Worktree...',
				altAction: 'gitlens.openWorktree:graph',
			});
		} else {
			actions.unshift({
				icon: 'gl-switch',
				label: 'Switch to Branch...',
				action: 'gitlens.switchToBranch:graph',
			});
			actions.push({
				icon: 'compare-changes',
				label: 'Compare with HEAD',
				action: 'gitlens.graph.compareBranchWithHead',
				altIcon: 'gl-compare-ref-working',
				altLabel: 'Compare with Working Tree',
				altAction: 'gitlens.graph.compareWithWorking',
			});
		}

		return {
			label: isTree ? (b.name.split('/').pop() ?? b.name) : b.name,
			filterText: isTree ? b.name : undefined,
			tooltip: branchTooltip(b, this.dateFormat),
			icon: { type: 'branch', status: b.status, worktree: b.worktree },
			description: b.date != null ? fromNow(b.date) : undefined,
			context: [b.sha] as SidebarItemContext,
			decorations: trackingDecorations(b.tracking, b.upstream?.missing),
			actions: actions,
			contextValue: b.context,
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

		// Place the WIP pill before the tracking arrows so the row reads `[wip][↑↓][active][lock]`,
		// matching the overview card's left-to-right ordering. Bare worktrees never have a working
		// tree of their own (`hasChanges` stays undefined) and stay pill-less.
		const wipDecoration: TreeItemDecoration[] =
			w.hasChanges != null
				? [
						{
							type: 'wip',
							label: w.hasChanges ? 'Working tree has changes' : 'No changes',
							hasChanges: w.hasChanges,
							added: w.workingTreeState?.added,
							changed: w.workingTreeState?.changed,
							deleted: w.workingTreeState?.deleted,
						},
					]
				: [];

		// Compose a rich row tooltip: the existing markdown text + a wip stats pill where the
		// "Has Uncommitted Changes" line used to be. Falls back to the bare markdown when no
		// breakdown is known (bare worktrees, or a probe that hasn't resolved yet).
		// Trailing `\\\n` is a single markdown hard line break — keeps the wip pill / fallback
		// from sitting flush against the markdown's last text line.
		const tooltipMarkdown = `${worktreeTooltipWithoutChangesLine(w)}\\\n`;
		const wts = w.workingTreeState;
		// Destructure into locals so TS narrows the optional fields once and the template below
		// doesn't have to repeat `wts?.` / non-null assertions.
		const added = wts?.added ?? 0;
		const changed = wts?.changed ?? 0;
		const deleted = wts?.deleted ?? 0;
		const hasBreakdown = wts != null && added + changed + deleted > 0;
		const tooltip =
			w.hasChanges != null
				? html`<gl-markdown density="compact" .markdown=${tooltipMarkdown}></gl-markdown> ${hasBreakdown
							? html`<commit-stats
									added=${added || nothing}
									modified=${changed || nothing}
									removed=${deleted || nothing}
									symbol="icons"
									appearance="pill"
									no-tooltip
								></commit-stats>`
							: html`<span class="tooltip-fallback"
									>${w.hasChanges ? 'Has Uncommitted Changes' : 'No Uncommitted Changes'}</span
								>`}`
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
				...(w.opened ? [{ type: 'icon' as const, icon: 'check', label: 'Active' }] : []),
				...(w.locked ? [{ type: 'icon' as const, icon: 'lock', label: 'Locked' }] : []),
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
	 *  sha — a cross-repo session would otherwise drive `ensureAndSelectCommit` to scan the graph
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
		return {
			wipSha: worktreePath != null ? createWipSha(worktreePath, graph.repoPath) : undefined,
			scope:
				session.worktree?.branch != null
					? { branchName: session.worktree.branch.name, upstreamName: session.worktree.branch.upstreamName }
					: undefined,
		};
	}

	private toAgentLeaf(session: AgentSessionState, anchor: { wipSha?: string; scope?: SidebarItemScope }): LeafProps {
		const category = agentPhaseToCategory[session.phase];
		const elapsed = formatAgentElapsed(session.phaseSince);
		const phaseLabel = getAgentPhaseLabel(category, session.pendingPermission);
		// Description = last prompt; otherwise the describeSession line for needs-input / working
		// (`Awaiting: tool` / `Running tool`). The "Last active …" fallback is intentionally
		// excluded — elapsed time already shows up on the phase decoration, no need to repeat it.
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
		actions.push({
			icon: 'link-external',
			label: 'Open Session',
			action: 'gitlens.agents.openSession',
			arguments: [session.id],
		});

		// Phase decoration uses agent-* kinds so the textual phase color matches the leaf's
		// agent icon — both pulled from the shared `--gl-agent-*` palette in theme.scss.
		const decorations: TreeItemDecoration[] = [
			{
				type: 'text',
				label: phaseLabel + (elapsed != null ? ` · ${elapsed}` : ''),
				kind:
					category === 'needs-input'
						? 'agent-waiting'
						: category === 'working'
							? 'agent-working'
							: 'agent-idle',
				position: 'before',
			},
		];

		return {
			label: session.displayName,
			tooltip: html`<gl-agent-tooltip .sessionId=${session.id}></gl-agent-tooltip>`,
			filterText: `${session.displayName} ${session.lastPrompt ?? ''}`.trim(),
			icon: { type: 'agent', phase: session.phase },
			description: description,
			context: [sha, scope, session.id] as SidebarItemContext,
			decorations: decorations,
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
		return this.hierarchyToTreeModel(hierarchy, baseLevel, item => toLeaf(item, true));
	}

	private hierarchyToTreeModel<T>(
		node: HierarchicalItem<T>,
		level: number,
		toLeaf: (item: T) => LeafProps,
	): TreeModel<SidebarItemContext>[] {
		const models: TreeModel<SidebarItemContext>[] = [];

		if (node.children != null) {
			for (const child of node.children.values()) {
				if (child.value != null) {
					const leaf = toLeaf(child.value);
					leaf.label = child.name;
					models.push(leafToTreeModel(leaf, child.relativePath, level));
				} else if (child.children != null && child.children.size > 0) {
					const childModels = this.hierarchyToTreeModel(child, level + 1, toLeaf);
					models.push({
						branch: true,
						expanded: false,
						path: `folder:${child.relativePath}`,
						level: level,
						label: child.name,
						icon: 'folder',
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
		this._actions?.executeAction(command, undefined, args);
	}

	private handleToggleLayout() {
		if (this.activePanel == null) return;

		this._actions?.toggleLayout(this.activePanel);
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
		this._actions?.executeAction(command, node.contextData as string | undefined, args);
	}

	private handleTreeItemSelected(
		e: CustomEvent<TreeItemSelectionDetail & { context?: SidebarItemContext; node?: { path?: string } }>,
	) {
		if (this.activePanel != null && e.detail.node?.path != null) {
			this._actions.selectedPath[this.activePanel] = e.detail.node.path;
		}

		const context = e.detail.context;
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

		const sessionId = context?.[2];
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
