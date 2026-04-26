import type { GraphRefOptData } from '@gitkraken/gitkraken-components';
import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import type { PropertyValues } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import type { GraphBranchesVisibility } from '../../../../../config.js';
import type { RepositoryShape } from '../../../../../git/models/repositoryShape.js';
import type {
	DidGetSidebarDataParams,
	GraphExcludeTypes,
	GraphSidebarBranch,
	UpdateGraphConfigurationParams,
} from '../../../../plus/graph/protocol.js';
import {
	ResetGraphFiltersCommand,
	UpdateExcludeTypesCommand,
	UpdateGraphConfigurationCommand,
	UpdateIncludedRefsCommand,
} from '../../../../plus/graph/protocol.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import type { TreeItemSelectionDetail, TreeModel } from '../../../shared/components/tree/base.js';
import { ipcContext } from '../../../shared/contexts/ipc.js';
import { graphStateContext } from '../context.js';
import { sidebarActionsContext } from '../sidebar/sidebarContext.js';
import type { SidebarActions } from '../sidebar/sidebarState.js';
import { graphScopePopoverStyles } from './gl-graph-scope-popover.css.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/button.js';
import '../../../shared/components/checkbox/checkbox.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/menu/menu-divider.js';
import '../../../shared/components/menu/menu-item.js';
import '../../../shared/components/overlays/popover.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/tree/tree-view.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-scope-popover': GlGraphScopePopover;
	}
}

type DisplayedMode = 'all' | 'current' | 'smart' | 'favorited' | 'scoped';

export function getDisplayedMode(graphState: typeof graphStateContext.__context__): DisplayedMode {
	if (graphState.scope != null) return 'scoped';
	return graphState.branchesVisibility ?? 'all';
}

export function hasActiveHideToggles(graphState: typeof graphStateContext.__context__): boolean {
	const { excludeTypes } = graphState;
	return (excludeTypes?.remotes ?? false) || (excludeTypes?.stashes ?? false) || (excludeTypes?.tags ?? false);
}

export function isGraphFiltered(graphState: typeof graphStateContext.__context__): boolean {
	if (getDisplayedMode(graphState) !== 'all') return true;
	return hasActiveHideToggles(graphState);
}

@customElement('gl-graph-scope-popover')
export class GlGraphScopePopover extends SignalWatcher(LitElement) {
	static override styles = [graphScopePopoverStyles];

	@consume({ context: ipcContext })
	private _ipc!: typeof ipcContext.__context__;

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _sidebarActions?: SidebarActions;

	@property({ attribute: false })
	repo?: RepositoryShape;

	@state()
	private _focusBranchExpanded = false;

	@state()
	private _branchLayoutOverride: 'tree' | 'list' | undefined;

	private _lastBranchesData: DidGetSidebarDataParams | undefined;
	private _branchesFetchRetryTimer: ReturnType<typeof setTimeout> | undefined;

	override updated(changedProperties: PropertyValues): void {
		// If the mode popover is open but the branches resource was invalidated (e.g. a filter
		// toggle triggered a sidebar invalidation), re-fetch so the list doesn't stay empty.
		const popover = this.renderRoot.querySelector<GlPopover>('gl-popover.mode-popover');
		if (popover?.open) {
			const resource = this._sidebarActions?.state.panels.branches;
			if (resource != null && resource.value.get() == null && !resource.loading.get()) {
				this.tryFetchBranches();
			}
		}

		// Once fresh server data matches our optimistic layout override, drop the override
		// so we're back in sync with the resource.
		if (this._branchLayoutOverride != null) {
			const freshLayout = this._sidebarActions?.state.panels.branches.value.get()?.layout;
			if (freshLayout === this._branchLayoutOverride) {
				this._branchLayoutOverride = undefined;
			}
		}

		super.updated(changedProperties);
	}

	private get displayedMode(): DisplayedMode {
		return getDisplayedMode(this.graphState);
	}

	private get hasActiveHideToggles(): boolean {
		return hasActiveHideToggles(this.graphState);
	}

	private get isFiltered(): boolean {
		return isGraphFiltered(this.graphState);
	}

	override render(): unknown {
		const mode = this.displayedMode;
		const headName = this.graphState.branch?.name;
		const scopedName = this.graphState.scope?.branchName;
		const hideFiltered = this.hasActiveHideToggles;

		let icon: string;
		let label: string;
		let tooltip: string;
		switch (mode) {
			case 'all':
				if (hideFiltered) {
					icon = 'filter-filled';
					label = 'Filtered';
					tooltip = 'Showing All Branches with Filters Applied';
				} else {
					icon = 'repo';
					label = 'All';
					tooltip = 'Showing All Branches';
				}
				break;
			case 'current':
				icon = 'target';
				label = headName ?? 'Current Branch';
				tooltip = 'Showing Current Branch Only';
				break;
			case 'smart':
				icon = 'wand';
				label = headName ?? 'Smart';
				tooltip = 'Showing Smart Branches Only';
				break;
			case 'favorited':
				icon = 'star-empty';
				label = 'Favorites';
				tooltip = 'Showing Favorited Branches Only';
				break;
			case 'scoped':
				icon = 'eye';
				label = scopedName ?? 'Scoped';
				tooltip = `Showing ${scopedName ?? 'Specific Branch'} Only`;
				break;
		}

		const filtered = this.isFiltered;
		const scoped = mode === 'scoped';

		return html`<gl-popover
			class="popover mode-popover"
			placement="right-start"
			trigger="click"
			?arrow=${false}
			distance=${4}
			auto-size-vertical
			resize="bottom right"
			@gl-popover-show=${this.handleModePopoverShow}
			@gl-popover-hide=${this.handleModePopoverHide}
		>
			<gl-tooltip placement="top" slot="anchor" content=${tooltip}>
				<button
					type="button"
					class="mode-chip ${scoped ? 'mode-chip--scoped' : filtered ? 'mode-chip--filtered' : ''}"
					aria-label=${tooltip}
				>
					<code-icon class="mode-chip__icon" icon=${icon}></code-icon>
					<span class="mode-chip__label">${label}</span>
					<code-icon class="mode-chip__chevron" icon="chevron-down" aria-hidden="true"></code-icon>
					${when(
						filtered,
						() =>
							html`<gl-tooltip
								class="mode-chip__clear-tooltip"
								placement="bottom"
								content="Reset Filters"
							>
								<span
									class="mode-chip__clear"
									role="button"
									tabindex="0"
									aria-label="Reset Filters"
									@click=${this.handleModeClear}
									@keydown=${this.handleModeClearKeydown}
								>
									<code-icon icon="close"></code-icon>
								</span>
							</gl-tooltip>`,
					)}
				</button>
			</gl-tooltip>
			<div slot="content" class="mode-popover__content" role="menu" @keydown=${this.handleContentKeydown}>
				${this.renderModeMenuItem('all', 'repo', 'All Branches', undefined, mode, this.repo?.virtual ?? false)}
				${this.renderModeMenuItem('current', 'target', 'Current Branch', 'Follows HEAD', mode, false)}
				${this.renderModeMenuItem(
					'smart',
					'wand',
					'Smart Branches',
					'Shows only relevant branches — includes the current branch, its upstream, and its base or target branch',
					mode,
					this.repo?.virtual ?? false,
				)}
				${this.renderModeMenuItem(
					'favorited',
					'star-empty',
					'Favorited Branches',
					'Shows only branches that have been starred as favorites — also includes the current branch',
					mode,
					this.repo?.virtual ?? false,
				)}
				${this.renderFocusBranchRow(mode)}
				<menu-divider></menu-divider>
				${this.renderGraphFiltersSection()}
			</div>
		</gl-popover>`;
	}

	private renderGraphFiltersSection() {
		const { config, excludeTypes } = this.graphState;
		const isVirtual = this.repo?.virtual === true;

		// Toggle semantics: icon "active" (pressed/highlighted) means the ref type is SHOWN.
		// Clicking toggles it off to hide.
		const remotesShown = !(excludeTypes?.remotes ?? false);
		const stashesShown = !(excludeTypes?.stashes ?? false);
		const tagsShown = !(excludeTypes?.tags ?? false);

		return html`<div class="mode-popover__section-header">
				<span class="mode-popover__section-title">Graph Options</span>
				${when(
					!isVirtual,
					() => html`
						<gl-tooltip
							placement="top"
							content=${remotesShown ? 'Hide Remote-only Branches' : 'Show Remote-only Branches'}
						>
							<gl-button
								appearance="toolbar"
								density="compact"
								aria-pressed=${remotesShown ? 'true' : 'false'}
								class=${remotesShown ? 'is-active' : ''}
								@mousedown=${this.preventMouseDefault}
								@click=${this.handleToggleRemotes}
							>
								<code-icon icon="cloud"></code-icon>
							</gl-button>
						</gl-tooltip>
						<gl-tooltip placement="top" content=${stashesShown ? 'Hide Stashes' : 'Show Stashes'}>
							<gl-button
								appearance="toolbar"
								density="compact"
								aria-pressed=${stashesShown ? 'true' : 'false'}
								class=${stashesShown ? 'is-active' : ''}
								@mousedown=${this.preventMouseDefault}
								@click=${this.handleToggleStashes}
							>
								<code-icon icon="archive"></code-icon>
							</gl-button>
						</gl-tooltip>
					`,
				)}
				<gl-tooltip placement="top" content=${tagsShown ? 'Hide Tags' : 'Show Tags'}>
					<gl-button
						appearance="toolbar"
						density="compact"
						aria-pressed=${tagsShown ? 'true' : 'false'}
						class=${tagsShown ? 'is-active' : ''}
						@mousedown=${this.preventMouseDefault}
						@click=${this.handleToggleTags}
					>
						<code-icon icon="tag"></code-icon>
					</gl-button>
				</gl-tooltip>
			</div>
			${when(
				!isVirtual,
				() =>
					html`<div class="mode-popover__checkbox-item">
						<gl-checkbox
							value="onlyFollowFirstParent"
							@gl-change-value=${this.handleFilterChange}
							?checked=${config?.onlyFollowFirstParent ?? false}
						>
							Simplify Merge History
						</gl-checkbox>
					</div>`,
			)}
			<div class="mode-popover__checkbox-item">
				<gl-checkbox
					value="mergeCommits"
					@gl-change-value=${this.handleFilterChange}
					?checked=${config?.dimMergeCommits ?? false}
				>
					Dim Merge Commit Rows
				</gl-checkbox>
			</div>`;
	}

	private renderModeMenuItem(
		value: GraphBranchesVisibility,
		icon: string,
		label: string,
		description: string | undefined,
		currentMode: string,
		disabled: boolean,
	) {
		const isCurrent = currentMode === value;
		return html`<menu-item
			class="mode-menu-item ${isCurrent ? 'mode-menu-item--current' : ''}"
			?disabled=${disabled}
			@click=${(e: Event) => {
				e.stopPropagation();
				this.handleModeSelect(value);
			}}
		>
			<span class="mode-menu-item__icon">
				<code-icon icon=${icon}></code-icon>
			</span>
			<span class="mode-menu-item__label">${label}</span>
			${description != null
				? html`<gl-tooltip placement="right" content=${description}>
						<code-icon class="mode-menu-item__info" icon="info"></code-icon>
					</gl-tooltip>`
				: nothing}
		</menu-item>`;
	}

	private renderFocusBranchRow(currentMode: string) {
		const isCurrent = currentMode === 'scoped';
		const scopedName = this.graphState.scope?.branchName;
		const expanded = this._focusBranchExpanded;

		return html`<menu-item
				class="mode-menu-item mode-menu-item--focus ${isCurrent ? 'mode-menu-item--current' : ''} ${expanded
					? 'mode-menu-item--expanded'
					: ''}"
				aria-expanded=${expanded ? 'true' : 'false'}
				@click=${this.handleFocusBranchRowClick}
			>
				<span class="mode-menu-item__icon">
					<code-icon icon="eye"></code-icon>
				</span>
				<span class="mode-menu-item__label">Focus Branch</span>
				${scopedName != null
					? html`<gl-branch-name
							class="mode-menu-item__branch"
							.name=${scopedName}
							.size=${11}
						></gl-branch-name>`
					: nothing}
				<code-icon
					class="mode-menu-item__chevron"
					icon=${expanded ? 'chevron-down' : 'chevron-right'}
					aria-hidden="true"
				></code-icon>
			</menu-item>
			${when(expanded, () => this.renderFocusBranchPane())}`;
	}

	private renderFocusBranchPane() {
		const actions = this._sidebarActions;
		const resource = actions?.state.panels.branches;
		const freshData = resource?.value.get();
		const status = resource?.status.get() ?? 'idle';

		// Cache the last non-null data so we can keep rendering branches during invalidation/refetch
		// (e.g. toggleLayout triggers a full sidebar invalidation that transiently clears the value).
		if (freshData != null) {
			this._lastBranchesData = freshData;
		}
		const data = freshData ?? this._lastBranchesData;

		// Local override lets the layout toggle take effect instantly — without waiting for
		// the round-trip that persists the setting and re-fetches the panel.
		const layout = this._branchLayoutOverride ?? data?.layout ?? 'list';

		return html`<div class="mode-popover__focus-pane">${this.renderScopeBranchList(data, status, layout)}</div>`;
	}

	private renderScopeBranchList(
		data: { items: unknown; layout?: 'tree' | 'list' } | undefined,
		status: 'idle' | 'loading' | 'success' | 'error',
		layout: 'tree' | 'list',
	) {
		// 'idle' means fetch hasn't started yet (or was cancelled) — treat as loading;
		// 'loading' is self-explanatory. Both should show a loading state, not "empty".
		if (data == null) {
			if (status === 'error') {
				return html`<div class="mode-popover__empty">Failed to load branches</div>`;
			}
			return html`<div class="mode-popover__empty">Loading branches…</div>`;
		}

		const branches = data.items as GraphSidebarBranch[];
		if (branches.length === 0) {
			return html`<div class="mode-popover__empty">No branches available</div>`;
		}

		const scopedBranchName = this.graphState.scope?.branchName;
		const focusedPath = scopedBranchName != null ? `branch:${scopedBranchName}` : undefined;
		const model =
			layout === 'tree'
				? buildBranchTreeModel(branches, scopedBranchName)
				: buildBranchListModel(branches, scopedBranchName);

		return html`<div class="mode-popover__branches">
			<gl-tree-view
				class="mode-popover__tree"
				.model=${model}
				.focusedPath=${focusedPath}
				filterable
				tooltip-anchor-right
				filter-placeholder="Filter branches..."
				aria-label="Branches"
				@gl-tree-generated-item-selected=${this.handleModeTreeItemSelected}
			>
				<gl-tooltip
					slot="filter-actions"
					placement="top"
					content=${layout === 'tree' ? 'Switch to List Layout' : 'Switch to Tree Layout'}
				>
					<gl-button
						appearance="toolbar"
						density="compact"
						?disabled=${data == null}
						@mousedown=${this.preventMouseDefault}
						@click=${this.handleToggleBranchLayout}
					>
						<code-icon icon=${layout === 'tree' ? 'list-flat' : 'list-tree'}></code-icon>
					</gl-button>
				</gl-tooltip>
			</gl-tree-view>
		</div>`;
	}

	private toggleExcludeType(key: 'remotes' | 'stashes' | 'tags', e: Event) {
		e.stopPropagation();
		const current = this.graphState.excludeTypes?.[key] ?? false;
		this.onExcludeTypesChanged(key, !current);
	}

	private handleToggleRemotes = (e: Event) => this.toggleExcludeType('remotes', e);
	private handleToggleStashes = (e: Event) => this.toggleExcludeType('stashes', e);
	private handleToggleTags = (e: Event) => this.toggleExcludeType('tags', e);

	private preventMouseDefault = (e: Event) => {
		e.preventDefault();
	};

	private handleToggleBranchLayout = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
		const current = this._branchLayoutOverride ?? this._lastBranchesData?.layout ?? 'list';
		this._branchLayoutOverride = current === 'tree' ? 'list' : 'tree';
		this._sidebarActions?.toggleLayout('branches');
	};

	private handleModeTreeItemSelected = (e: CustomEvent<TreeItemSelectionDetail>) => {
		const context = (e.detail as { context?: [branchName: string, upstreamName: string | undefined] }).context;
		const branchName = context?.[0];
		// Skip folder nodes (branch name is empty) — let the tree handle expansion, don't close the popover.
		if (branchName == null || branchName === '') return;
		this.handleScopeToBranch(branchName, context?.[1]);
	};

	private handleFocusBranchRowClick = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
		this._focusBranchExpanded = !this._focusBranchExpanded;
	};

	private handleContentKeydown = (e: KeyboardEvent) => {
		// When focus is inside gl-tree-view's own shadow DOM (filter input, scrollable, tree
		// items), the event target is retargeted to gl-tree-view. Bail so the tree drives its
		// own keyboard model. Slotted light-DOM content (our layout toggle) keeps its own
		// target and is handled by the generic nav below.
		const target = e.target as HTMLElement | null;
		if (target?.tagName.toLowerCase() === 'gl-tree-view') return;

		const key = e.key;
		const active = (this.renderRoot as ShadowRoot).activeElement as HTMLElement | null;
		const onFocusBranchRow = active?.classList.contains('mode-menu-item--focus') ?? false;

		// Left/Right on the Focus Branch row toggles the pane; right-expand also hands focus
		// to the tree-view (its filter input, or the scrollable fallback).
		if (key === 'ArrowRight' && onFocusBranchRow && !this._focusBranchExpanded) {
			e.preventDefault();
			e.stopPropagation();
			this._focusBranchExpanded = true;
			void this.updateComplete.then(() => this.focusTreeView());
			return;
		}
		if (key === 'ArrowLeft' && onFocusBranchRow && this._focusBranchExpanded) {
			e.preventDefault();
			e.stopPropagation();
			this._focusBranchExpanded = false;
			return;
		}

		// ArrowDown on an already-expanded Focus Branch row dives into the pane rather than
		// skipping past it to the toggle buttons below.
		if (key === 'ArrowDown' && onFocusBranchRow && this._focusBranchExpanded && this.focusTreeView()) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;

		const items = this.getFocusableMenuItems();
		if (items.length === 0) return;

		const currentIndex = active != null ? items.indexOf(active) : -1;

		let nextIndex: number;
		if (key === 'Home') {
			nextIndex = 0;
		} else if (key === 'End') {
			nextIndex = items.length - 1;
		} else if (key === 'ArrowDown') {
			nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
		} else {
			nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
		}

		e.preventDefault();
		e.stopPropagation();
		items[nextIndex].focus();
	};

	private focusTreeView(): boolean {
		const tree = this.renderRoot.querySelector<HTMLElement>('gl-tree-view');
		if (tree == null) return false;
		tree.focus();
		return true;
	}

	private getFocusableMenuItems(): HTMLElement[] {
		const content = this.renderRoot.querySelector<HTMLElement>('.mode-popover__content');
		if (content == null) return [];
		return [
			...content.querySelectorAll<HTMLElement>(
				'menu-item:not([disabled]), gl-button:not([disabled]), gl-checkbox:not([disabled])',
			),
		];
	}

	private handleModePopoverShow = () => {
		this.tryFetchBranches();
		// Focus the first menu item once the popover body is visible (body.hidden flips after
		// gl-popover-show fires, so defer until the next frame).
		requestAnimationFrame(() => {
			this.getFocusableMenuItems()[0]?.focus();
		});
	};

	private handleModePopoverHide = () => {
		this.clearBranchesFetchRetry();
		this._focusBranchExpanded = false;
	};

	private tryFetchBranches = () => {
		const actions = this._sidebarActions;
		const resource = actions?.state.panels.branches;
		if (resource == null || resource.value.get() != null) {
			this.clearBranchesFetchRetry();
			return;
		}
		actions?.fetchPanel('branches');
		// If service isn't ready yet, fetchPanel is a no-op; poll until it succeeds.
		if (resource.status.get() === 'idle') {
			this.clearBranchesFetchRetry();
			this._branchesFetchRetryTimer = setTimeout(this.tryFetchBranches, 250);
		}
	};

	private clearBranchesFetchRetry(): void {
		if (this._branchesFetchRetryTimer == null) return;
		clearTimeout(this._branchesFetchRetryTimer);
		this._branchesFetchRetryTimer = undefined;
	}

	private hideModePopover(): void {
		const popover = this.renderRoot.querySelector<GlPopover>('gl-popover.mode-popover');
		if (popover == null) return;
		void popover.hide();
	}

	private handleModeSelect(value: GraphBranchesVisibility) {
		if (this.graphState.scope != null) {
			this.graphState.scope = undefined;
		}
		this.onRefIncludesChanged(value);
		this.hideModePopover();
	}

	private handleScopeToBranch(branchName: string, upstreamName?: string | undefined) {
		this.dispatchEvent(
			new CustomEvent('gl-graph-scope-to-branch', {
				detail: { branchName: branchName, upstreamName: upstreamName },
				bubbles: true,
				composed: true,
			}),
		);
		this.hideModePopover();
	}

	private handleModeClear = (e: Event) => {
		e.stopPropagation();
		e.preventDefault();
		if (this.graphState.scope != null) {
			this.graphState.scope = undefined;
		}
		this._ipc.sendCommand(ResetGraphFiltersCommand, undefined);
		this.hideModePopover();
	};

	private handleModeClearKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		this.handleModeClear(e);
	};

	private handleFilterChange(e: CustomEvent) {
		const $el = e.target as HTMLInputElement;
		if ($el == null) return;

		const { checked } = $el;

		switch ($el.value) {
			case 'mergeCommits':
				this.changeGraphConfiguration({ dimMergeCommits: checked });
				break;

			case 'onlyFollowFirstParent':
				this.changeGraphConfiguration({ onlyFollowFirstParent: checked });
				break;

			case 'remotes':
			case 'stashes':
			case 'tags': {
				const key = $el.value satisfies keyof GraphExcludeTypes;
				const currentFilter = this.graphState.excludeTypes?.[key];
				if ((currentFilter == null && checked) || (currentFilter != null && currentFilter !== checked)) {
					this.onExcludeTypesChanged(key, checked);
				}
				break;
			}
		}
	}

	private changeGraphConfiguration(changes: UpdateGraphConfigurationParams['changes']) {
		this._ipc.sendCommand(UpdateGraphConfigurationCommand, { changes: changes });
	}

	private onExcludeTypesChanged(key: keyof GraphExcludeTypes, value: boolean) {
		this._ipc.sendCommand(UpdateExcludeTypesCommand, { key: key, value: value });
	}

	private onRefIncludesChanged(branchesVisibility: GraphBranchesVisibility, refs?: GraphRefOptData[]) {
		this._ipc.sendCommand(UpdateIncludedRefsCommand, { branchesVisibility: branchesVisibility, refs: refs });
	}
}

type BranchTreeContext = [branchName: string, upstreamName: string | undefined];

function branchToLeaf(
	b: GraphSidebarBranch,
	label: string,
	scopedBranchName: string | undefined,
	filterText: string,
	level: number,
	path: string,
): TreeModel<BranchTreeContext> {
	return {
		branch: false,
		expanded: false,
		path: path,
		level: level,
		label: label,
		filterText: filterText,
		icon: { type: 'branch', status: b.status, worktree: b.worktree },
		checkable: false,
		context: [b.name, b.upstream?.missing ? undefined : b.upstream?.name],
		matched: b.name === scopedBranchName,
	};
}

function buildBranchListModel(
	branches: GraphSidebarBranch[],
	scopedBranchName: string | undefined,
): TreeModel<BranchTreeContext>[] {
	return branches.map(b => branchToLeaf(b, b.name, scopedBranchName, b.name, 1, `branch:${b.name}`));
}

function buildBranchTreeModel(
	branches: GraphSidebarBranch[],
	scopedBranchName: string | undefined,
): TreeModel<BranchTreeContext>[] {
	const hierarchy = makeHierarchical(
		branches,
		b => (b.current || b.worktreeOpened || b.disposition != null ? [b.name] : b.name.split('/')),
		(...paths: string[]) => paths.join('/'),
		true,
		() => true,
	);
	return hierarchyToTreeModel(hierarchy, 1, scopedBranchName);
}

function hierarchyToTreeModel(
	node: HierarchicalItem<GraphSidebarBranch>,
	level: number,
	scopedBranchName: string | undefined,
): TreeModel<BranchTreeContext>[] {
	const models: TreeModel<BranchTreeContext>[] = [];
	if (node.children != null) {
		for (const child of node.children.values()) {
			if (child.value != null) {
				const label = child.name;
				models.push(
					branchToLeaf(
						child.value,
						label,
						scopedBranchName,
						child.value.name,
						level,
						`branch:${child.value.name}`,
					),
				);
			} else if (child.children != null && child.children.size > 0) {
				const childModels = hierarchyToTreeModel(child, level + 1, scopedBranchName);
				models.push({
					branch: true,
					expanded: false,
					path: `folder:${child.relativePath}`,
					level: level,
					label: child.name,
					icon: 'folder',
					checkable: false,
					context: ['', undefined],
					children: childModels,
				});
			}
		}
	}
	return models;
}
