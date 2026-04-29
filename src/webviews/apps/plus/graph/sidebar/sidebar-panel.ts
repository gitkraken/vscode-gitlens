import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { fromNow } from '@gitlens/utils/date.js';
import type { GlCommands } from '../../../../../constants.commands.js';
import type {
	DidGetSidebarDataParams,
	GraphSidebarBranch,
	GraphSidebarPanel,
	GraphSidebarRemote,
	GraphSidebarStash,
	GraphSidebarTag,
	GraphSidebarWorktree,
} from '../../../../plus/graph/protocol.js';
import {
	branchTooltip,
	remoteTooltip,
	stashTooltip,
	tagTooltip,
	worktreeTooltip,
} from '../../../../plus/graph/sidebarTooltips.js';
import { scrollableBase, subPanelEnterStyles } from '../../../shared/components/styles/lit/base.css.js';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemSelectionDetail,
	TreeModel,
	TreeModelFlat,
} from '../../../shared/components/tree/base.js';
import { sidebarActionsContext } from './sidebarContext.js';
import type { SidebarActions } from './sidebarState.js';
import '../overview/graph-overview.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/progress.js';
import '../../../shared/components/tree/tree-view.js';

interface PanelAction {
	icon: string;
	tooltip: string;
	command: GlCommands;
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
			{ icon: 'rocket', tooltip: 'Start Work', command: 'gitlens.startWork' },
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
}

type SidebarItemContext = [sha: string | undefined];

interface LeafProps {
	label: string;
	filterText?: string;
	tooltip?: string;
	icon: TreeModel<SidebarItemContext>['icon'];
	description?: string;
	context: SidebarItemContext;
	decorations?: TreeModel<SidebarItemContext>['decorations'];
	actions?: TreeModel<SidebarItemContext>['actions'];
	menuContext?: string;
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
		contextData: leaf.menuContext,
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
				background-color: var(--titlebar-bg);
				z-index: 1;
				border-right: 1px solid transparent;
				border-color: var(--vscode-sideBar-border, transparent);
			}

			/* Play enter animations only when the parent signals the user-visible moment —
			   the element is always mounted (inside the split-panel's start slot) so an
			   unconditional :host animation would fire at 0 width where the user can't see it.
			     [opening]   — sidebar went from hidden to visible (slide in from -8px X)
			     [switching] — active panel changed while visible (slide in from 4px Y, matches
			                   the sub-panel-enter used by review/compose/compare panes) */
			:host([opening]) {
				animation: panel-enter 0.2s ease-out;
			}
			:host([switching]) {
				animation: sub-panel-enter 0.2s ease-out;
			}

			@media (prefers-reduced-motion: reduce) {
				/* Near-zero duration, NOT animation:none, so the animationend event still
				   fires — the graph-app updated() hook depends on it to remove the opening
				   / switching attribute and detach the once-listener. animation:none
				   dispatches no event, so the listener would leak per toggle. */
				:host([opening]),
				:host([switching]) {
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
				color: var(--titlebar-fg);
				background-color: var(--titlebar-bg);
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

			.empty {
				padding: 1rem;
				text-align: center;
				color: var(--vscode-descriptionForeground);
				font-size: 1.2rem;
			}
		`,
	];

	@property({ type: String, attribute: 'active-panel' })
	activePanel: GraphSidebarPanel | undefined;

	@property({ attribute: 'date-format' })
	dateFormat: string | null | undefined;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _actions!: SidebarActions;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.addEventListener('contextmenu', this.handleContextMenuProxy);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this.removeEventListener('contextmenu', this.handleContextMenuProxy);
	}

	private handleContextMenuProxy = (e: MouseEvent) => {
		// The event has already crossed the shadow DOM boundary (composed: true)
		// Check if the originating tree-view set data-vscode-context
		const path = e.composedPath();
		const source = path.find(
			el => el instanceof HTMLElement && el.tagName === 'GL-TREE-VIEW' && el.dataset.vscodeContext,
		) as HTMLElement | undefined;
		if (!source) return;

		// Copy context to this host element (which is in light DOM)
		this.dataset.vscodeContext = source.dataset.vscodeContext;
		setTimeout(() => {
			delete this.dataset.vscodeContext;
		}, 100);
	};

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

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		if (changedProperties.has('activePanel') && this._actions != null) {
			// Keep the actions module in sync so invalidateAll can refetch
			this._actions.activePanel = this.activePanel;

			// Always fetch on panel switch — data may be stale even if non-null.
			// The Resource's cancelPrevious handles dedup.
			// Overview panel manages its own data via IPC, skip sidebar fetch.
			if (this.activePanel != null && this.activePanel !== 'overview') {
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
				${this.renderHeader(config, false, undefined)}
				<div class="content">
					<gl-graph-overview></gl-graph-overview>
				</div>
			</div>`;
		}

		const resource = this._actions?.state.panels[this.activePanel];
		const data = resource?.value.get();
		const hasError = resource?.error.get() != null;
		const isLoading = resource?.loading.get() ?? false;

		return html`<div class="panel">
			${this.renderHeader(config, isLoading, data?.layout)}
			<div class="content">
				${hasError
					? html`<div class="empty">Failed to load data</div>`
					: data != null
						? this.renderTreeContent(config, data)
						: this.renderSkeleton()}
			</div>
		</div>`;
	}

	private renderHeader(config: PanelConfig, isLoading: boolean, currentLayout: 'tree' | 'list' | undefined) {
		const hasLayout =
			this.activePanel === 'worktrees' ||
			this.activePanel === 'branches' ||
			this.activePanel === 'remotes' ||
			this.activePanel === 'tags';

		return html`<div class="header">
			<span class="header-title">${config.title}</span>
			<div class="header-actions">
				${config.actions?.map(
					a =>
						html`<gl-button
							appearance="toolbar"
							density="compact"
							tooltip="${a.tooltip}"
							@click=${() => this.handleAction(a.command)}
							><code-icon icon="${a.icon}"></code-icon
						></gl-button>`,
				)}
				${hasLayout
					? html`<gl-button
							appearance="toolbar"
							density="compact"
							tooltip="${currentLayout === 'tree' ? 'Switch to List Layout' : 'Switch to Tree Layout'}"
							@click=${this.handleToggleLayout}
							><code-icon icon="${currentLayout === 'tree' ? 'list-flat' : 'list-tree'}"></code-icon
						></gl-button>`
					: nothing}
				<gl-button appearance="toolbar" density="compact" tooltip="Refresh" @click=${this.handleRefresh}
					><code-icon icon="refresh"></code-icon
				></gl-button>
			</div>
			<progress-indicator position="bottom" ?active=${isLoading}></progress-indicator>
		</div>`;
	}

	private renderTreeContent(config: (typeof panelConfig)[GraphSidebarPanel], data: DidGetSidebarDataParams): unknown {
		const model = this.buildTreeModel(data);

		// Automatically track/restore tree expansion state per panel.
		// On first build (set empty): seed the set from the model's natural defaults.
		// On subsequent builds: override the model's expansion with the remembered set.
		if (this.activePanel != null) {
			const paths = this._actions.expandedPaths[this.activePanel];
			applyOrSeedExpansion(model, paths);
		}

		return html`<gl-tree-view
			focused-path=${this._actions.selectedPath[this.activePanel!] ?? nothing}
			.model=${model}
			filterable
			tooltip-anchor-right
			filter-text=${this._actions.filterText || nothing}
			filter-mode=${this._actions.filterMode}
			filter-placeholder="Filter ${config.title.toLowerCase()}..."
			aria-label="${config.title}"
			@gl-tree-filter-changed=${this.handleFilterChanged}
			@gl-tree-filter-mode-changed=${this.handleFilterModeChanged}
			@gl-tree-generated-item-selected=${this.handleTreeItemSelected}
			@gl-tree-generated-item-action-clicked=${this.handleTreeItemAction}
			@gl-tree-expansion-changed=${this.handleTreeExpansionChanged}
		></gl-tree-view>`;
	}

	private renderSkeleton(): unknown {
		const widths = [65, 45, 80, 55, 70, 40, 60];
		return html`<div class="loading">
			${widths.map(
				w => html`
					<div class="skeleton">
						<div class="skeleton-icon"></div>
						<div class="skeleton-text" style=${styleMap({ width: `${w}%` })}></div>
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
					data.items as GraphSidebarBranch[],
					useTree,
					compact,
					b => (b.current || b.worktreeOpened || b.disposition != null ? [b.name] : b.name.split('/')),
					(b, isTree) => this.toBranchLeaf(b, isTree),
				);
			case 'remotes':
				return this.buildRemoteTree(data.items as GraphSidebarRemote[], useTree, compact);
			case 'stashes':
				return (data.items as GraphSidebarStash[]).map(s => {
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
						contextData: s.menuContext,
					};
				});
			case 'tags':
				return this.buildItemTree(
					data.items as GraphSidebarTag[],
					useTree,
					compact,
					t => t.name.split('/'),
					(t, isTree) => this.toTagLeaf(t, isTree),
				);
			case 'worktrees':
				return this.buildItemTree(
					data.items as GraphSidebarWorktree[],
					useTree,
					compact,
					w => (w.isDefault || w.opened || !w.branch ? [w.name] : w.branch.split('/')),
					(w, isTree) => this.toWorktreeLeaf(w, isTree),
				);
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
				icon: 'window',
				label: 'Open Worktree...',
				action: 'gitlens.openWorktree:graph',
				altIcon: 'empty-window',
				altLabel: 'Open Worktree in New Window...',
				altAction: 'gitlens.openWorktreeInNewWindow:graph',
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
			menuContext: b.menuContext,
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
			menuContext: t.menuContext,
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
				icon: 'window',
				label: 'Open Worktree...',
				action: 'gitlens.openWorktree:graph',
				altIcon: 'empty-window',
				altLabel: 'Open Worktree in New Window...',
				altAction: 'gitlens.openWorktreeInNewWindow:graph',
			});
		}

		return {
			label: isTree ? (branchName.split('/').pop() ?? branchName) : branchName,
			filterText: isTree ? branchName : undefined,
			tooltip: worktreeTooltip(w),
			icon: { type: 'branch', status: w.status, hasChanges: w.hasChanges },
			description: formatWorktreeDescription(w),
			context: [w.sha] as SidebarItemContext,
			decorations: [
				...(trackingDecorations(w.tracking) ?? []),
				...(w.opened ? [{ type: 'icon' as const, icon: 'check', label: 'Active' }] : []),
				...(w.locked ? [{ type: 'icon' as const, icon: 'lock', label: 'Locked' }] : []),
			],
			actions: actions,
			menuContext: w.menuContext,
		};
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
					menuContext: b.menuContext,
				}),
				2,
			);

			const remoteIcon =
				r.providerIcon != null && r.providerIcon !== 'remote' ? `gl-provider-${r.providerIcon}` : 'cloud';
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
				context: [undefined] as SidebarItemContext,
				contextData: r.menuContext,
				children: children,
				decorations: r.isDefault ? [{ type: 'text' as const, label: 'default' }] : undefined,
				actions: [{ icon: 'repo-fetch', label: 'Fetch', action: 'gitlens.fetchRemote:graph' }],
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
						context: [undefined] as SidebarItemContext,
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

	private handleFilterModeChanged = (e: CustomEvent<'filter' | 'highlight'>) => {
		this._actions.filterMode = e.detail;
	};

	private handleAction(command: GlCommands) {
		this._actions?.executeAction(command);
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

	private handleTreeItemAction(e: CustomEvent<TreeItemActionDetail>) {
		const action = e.detail.action;
		const node = e.detail.node as TreeModelFlat;
		const command = (e.detail.altKey && action.altAction ? action.altAction : action.action) as GlCommands;
		this._actions?.executeAction(command, node.contextData as string | undefined);
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

		this.dispatchEvent(
			new CustomEvent<GraphSidebarPanelSelectEventDetail>('gl-graph-sidebar-panel-select', {
				detail: { sha: sha },
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
