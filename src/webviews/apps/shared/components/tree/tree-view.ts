import { flow } from '@lit-labs/virtualizer/layouts/flow.js';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { styleMap } from 'lit/directives/style-map.js';
import { when } from 'lit/directives/when.js';
import { GlElement } from '../element.js';
import type { GlGitStatus } from '../status/git-status.js';
import { scrollableBase } from '../styles/lit/base.css.js';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
	TreeModelFlat,
} from './base.js';
import type { GlTreeItem } from './tree-item.js';
import '@lit-labs/virtualizer';
import '../actions/action-item.js';
import '../branch-icon.js';
import '../markdown/markdown.js';
import '../overlays/popover.js';
import '../pills/tracking.js';
import '../file-icon/file-icon.js';
import '../status/git-status.js';
import '../button.js';
import '../code-icon.js';
import './tree-item.js';

const filterableCharRegex = /^[a-zA-Z0-9\s\-_.]$/;

@customElement('gl-tree-view')
export class GlTreeView extends GlElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: flex;
				flex-direction: column;
				height: 100%;
				width: 100%;
				overflow: hidden;
			}

			.scrollable {
				flex: 1;
				width: 100%;
				min-height: 0;
				overflow-y: auto;
				overflow-x: visible; /* Allow horizontal overflow for tooltips */
				outline: none;
			}

			.scrollable:focus-within {
				outline: none;
			}

			lit-virtualizer {
				display: block;
				width: 100%;
				height: 100%;
				/* Use layout containment instead of strict to avoid rendering issues */
				/* Removed paint containment to allow tooltips to escape */
				contain: layout;
				/* lit-virtualizer sets an inline min-height based on its initial item-size
				   estimate, which can exceed the scrollable container in small viewports and
				   push scrolling onto the outer .scrollable div instead of the virtualizer's
				   own scroller. Since height: 100% already provides correct sizing from the
				   flex layout, the min-height is always redundant. */
				min-height: 0 !important;
			}

			gl-tree-item {
				width: 100%;
			}

			/* Dim non-matched items when highlighting */
			:host([filtered]:not([filter-mode='filter'])) gl-tree-item:not([matched]) {
				opacity: 0.6;
			}

			.filter {
				display: flex;
				align-items: center;
				gap: 0.4rem;
				padding: 0.4rem 0.6rem;
				flex: none;
			}

			.filter-field {
				position: relative;
				flex: 1;
				min-width: 0;
			}

			.filter-input {
				width: 100%;
				height: 2.4rem;
				box-sizing: border-box;
				padding: 0 2rem 0 0.6rem;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				color: var(--vscode-input-foreground);
				background-color: var(--vscode-input-background);
				border: 1px solid var(--vscode-input-border, transparent);
				border-radius: 2px;
				outline: none;
			}

			.filter-input:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			.filter-input::placeholder {
				color: var(--vscode-input-placeholderForeground);
			}

			.filter-input::-webkit-search-cancel-button {
				-webkit-appearance: none;
				cursor: pointer;
				width: 16px;
				height: 16px;
				background-color: var(--vscode-foreground);
				-webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z'/%3E%3C/svg%3E");
				-webkit-mask-size: contain;
			}

			.filter-controls {
				position: absolute;
				top: 1px;
				right: 0;
				bottom: 1px;
				display: inline-flex;
				align-items: center;
				gap: 0.1rem;
				padding-right: 0.2rem;
			}

			.filter-controls gl-button {
				--button-line-height: 1;
				--button-input-height: 2rem;
			}

			mark {
				background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.33));
				color: inherit;
				border-radius: 1px;
			}

			/* Shared by both the no-data case (emptyText) and the filter-yields-no-matches
			   case ("No results found"); class name dates from the latter. */
			.no-results {
				padding: 1rem;
				color: var(--vscode-descriptionForeground);
				font-style: italic;
				text-align: center;
			}

			.hover-content {
				font-size: 1.2rem;
				line-height: 1.5;
				max-width: min(92vw, 35rem);
				--code-icon-size: 1em;
			}

			.conflict-count {
				display: inline-flex;
				align-items: center;
				gap: 0.3rem;
				padding: 0 0.6rem;
				height: 1.8rem;
				border-radius: 0.9rem;
				font-size: 1.1rem;
				font-weight: 500;
				border: 1px solid;
			}
		`,
	];

	@state()
	treeItems?: TreeModelFlat[] = undefined;

	@property({ reflect: true })
	guides?: 'none' | 'onHover' | 'always';

	@property({ type: Boolean, reflect: true })
	filtered = false;

	@property({ type: Boolean, reflect: true })
	filterable = false;

	@property({ type: String, attribute: 'filter-placeholder' })
	filterPlaceholder = 'Filter...';

	@property({ type: String, attribute: 'filter-mode', reflect: true })
	filterMode: 'filter' | 'highlight' = 'filter';

	@property({ type: String, attribute: 'empty-text' })
	emptyText = 'No items';

	@property({ type: Boolean, attribute: 'tooltip-anchor-right' })
	tooltipAnchorRight = false;

	private _filterText = '';
	@property({ type: String, attribute: 'filter-text' })
	get filterText(): string {
		return this._filterText;
	}
	set filterText(value: string) {
		const old = this._filterText;
		if (old === value) return;
		this._filterText = value;
		clearTimeout(this._filterDebounceTimer);
		this.applyFilterToModel();
		this.requestUpdate('filterText', old);
	}

	private _filterLower = '';
	private _filterTerms: string[] = [];
	private _filterDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	@property({ type: String, attribute: 'aria-label' })
	override ariaLabel = 'Tree';

	/** External hint for which path should be focused when the model is set. Consumed once on model update. */
	@property({ type: String, attribute: 'focused-path' })
	focusedPath?: string;

	private _lastSelectedPath?: string;
	private _focusedItemPath?: string;
	private _focusedItemIndex: number = -1;
	private virtualizerRef: Ref<any> = createRef();
	private scrollableRef: Ref<HTMLElement> = createRef();

	@state()
	private _containerHasFocus = false;

	@state()
	private _filterHasFocus = false;

	@state()
	private _actionButtonHasFocus = false;

	private _scrolling = false;

	// Hover tooltip state
	private _hoverTimer?: ReturnType<typeof setTimeout>;
	private _unhoverTimer?: ReturnType<typeof setTimeout>;

	@state()
	private _hoveredTooltip?: string;

	@state()
	private _hoveredAnchor?: HTMLElement | { getBoundingClientRect: () => Omit<DOMRect, 'toJSON'> };

	@state()
	private _hoverOpen = false;

	// Type-ahead search state
	private _typeAheadBuffer = '';
	private _typeAheadTimer?: number;
	private readonly _typeAheadTimeout = 800; // Matches VS Code's implementation

	// Performance optimization: Maps for O(1) lookups
	private _nodeMap = new Map<string, TreeModel>(); // path -> TreeModel
	private _pathToIndexMap = new Map<string, number>(); // path -> index in treeItems

	override connectedCallback(): void {
		super.connectedCallback?.();

		// Add capture-phase listeners to handle Tab navigation and focus tracking
		this.addEventListener('keydown', this.handleKeydown, { capture: true });
		this.addEventListener('focusin', this.handleFocusIn, { capture: true });
		this.addEventListener('focusout', this.handleFocusOut, { capture: true });

		// Listen for contextmenu events from tree items and re-dispatch them
		// so they can cross the shadow DOM boundary with the context data
		this.addEventListener('contextmenu', this.handleContextMenu);
	}

	override focus(options?: FocusOptions): void {
		// Prefer the filter input when present — lets callers that open a tree-view-with-filter
		// (e.g. from a menu or popover) drop the user straight into search.
		if (this.filterable) {
			const filter = this.renderRoot.querySelector<HTMLInputElement>('.filter-input');
			if (filter != null) {
				filter.focus(options);
				return;
			}
		}
		this.scrollableRef.value?.focus(options);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this.removeEventListener('keydown', this.handleKeydown, { capture: true });
		this.removeEventListener('focusin', this.handleFocusIn, { capture: true });
		this.removeEventListener('focusout', this.handleFocusOut, { capture: true });
		this.removeEventListener('contextmenu', this.handleContextMenu);

		// Clean up timers and reset state
		if (this._typeAheadTimer) {
			clearTimeout(this._typeAheadTimer);
			this._typeAheadTimer = undefined;
		}
		clearTimeout(this._filterDebounceTimer);
		this._typeAheadBuffer = '';
	}

	private _model?: TreeModel[];
	@property({ type: Array, attribute: false })
	set model(value: TreeModel[] | undefined) {
		if (this._model === value) return;

		this._model = value;

		// Apply active filter to the new model so matched flags are set before flattening
		if (this._filterTerms.length > 0 && this._model != null) {
			applyFilter(this._model, this._filterTerms);
		}

		// Clear stale node map before processing new model
		// This prevents stale node references when switching commits or toggling filters
		this._nodeMap.clear();

		// Build both maps during tree flattening (single traversal)
		let treeItems: TreeModelFlat[] | undefined;
		if (this._model != null) {
			const size = this._model.length;
			const hideNonMatched = this.filtered && this.filterMode === 'filter';
			treeItems = [];
			for (let i = 0; i < size; i++) {
				flattenTree(this._model[i], size, i + 1, undefined, this._nodeMap, hideNonMatched, treeItems);
			}
		}

		this.treeItems = treeItems;

		// Build path-to-index map for O(1) index lookups
		this.buildPathToIndexMap();

		// Apply external focus hint if available (set before .model in template order)
		if (this.focusedPath) {
			this._focusedItemPath = this.focusedPath;
			this._lastSelectedPath = this.focusedPath;
		}

		// Reconcile focus with new model
		if (this._focusedItemPath) {
			const newIndex = this._pathToIndexMap.get(this._focusedItemPath);
			if (newIndex != null) {
				// Path still exists — update cached index
				this._focusedItemIndex = newIndex;
			} else {
				// Path gone — fall back to nearest positional neighbor
				if (this.treeItems?.length) {
					const clamped = Math.min(this._focusedItemIndex, this.treeItems.length - 1);
					this._focusedItemPath = this.treeItems[Math.max(0, clamped)].path;
					this._focusedItemIndex = Math.max(0, clamped);
				} else {
					this._focusedItemPath = undefined;
					this._focusedItemIndex = -1;
				}
				// Sync selection if it also pointed to the removed item
				if (this._lastSelectedPath && !this._pathToIndexMap.has(this._lastSelectedPath)) {
					this._lastSelectedPath = this._focusedItemPath;
				}
			}
		} else if (this.treeItems?.length) {
			this._focusedItemPath = this.treeItems[0].path;
			this._focusedItemIndex = 0;
		}
	}

	get model() {
		return this._model;
	}

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		// `filtered` / `filterMode` gate `hideNonMatched` in the model setter. Because Lit commits
		// property bindings in template order, consumers that bind `.model` before `.filtered` /
		// `filter-mode` cause the model setter to flatten with STALE filter state — cycling the
		// filter-mode button from 'matched' → 'off' re-committed a full model while `filtered`
		// was still true, so non-matched items stayed hidden in the flattened list. By the time
		// willUpdate runs all bindings are committed, so re-flatten here whenever either changed —
		// cheap and correct regardless of how the consumer ordered its bindings in the template.
		if ((changedProperties.has('filtered') || changedProperties.has('filterMode')) && this._model != null) {
			this.rebuildFlattenedTree();
		}

		// Apply focused-path hint here (after all properties are set) rather than in the model
		// setter, because Lit sets bindings in template order — the model setter may run before
		// the focused-path attribute is updated, leaving focusedPath stale.
		if (this.focusedPath && (changedProperties.has('focusedPath') || changedProperties.has('model'))) {
			const index = this._pathToIndexMap.get(this.focusedPath);
			if (index != null) {
				this._focusedItemPath = this.focusedPath;
				this._focusedItemIndex = index;
				this._lastSelectedPath = this.focusedPath;
				// Scroll the focused item into view after the render completes
				this._pendingScrollToIndex = index;
			}
		} else if (changedProperties.has('model') && !this.focusedPath) {
			// Model changed with no focus hint — clear stale selection and reset to first item
			this._lastSelectedPath = undefined;
			if (this.treeItems?.length) {
				this._focusedItemPath = this.treeItems[0].path;
				this._focusedItemIndex = 0;
			} else {
				this._focusedItemPath = undefined;
				this._focusedItemIndex = -1;
			}
			this._pendingScrollToIndex = 0;
		}
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated?.(changedProperties);
		if (this._pendingScrollToIndex != null) {
			const index = this._pendingScrollToIndex;
			this._pendingScrollToIndex = undefined;
			this.scrollToItem(index, false);
		}
	}

	private _pendingScrollToIndex: number | undefined;

	private renderIcon(
		icon?:
			| string
			| { type: 'status'; name: GlGitStatus['status'] }
			| { type: 'branch'; status?: string; worktree?: boolean; hasChanges?: boolean }
			| { type: 'file-icon'; filename: string },
	) {
		if (icon == null) return nothing;

		if (typeof icon === 'string') {
			return html`<code-icon slot="icon" icon=${icon}></code-icon>`;
		}

		if (icon.type === 'status') {
			return html`<gl-git-status slot="icon" .status=${icon.name}></gl-git-status>`;
		}

		if (icon.type === 'branch') {
			return html`<gl-branch-icon
				slot="icon"
				.status=${icon.status}
				.worktree=${icon.worktree ?? false}
				.hasChanges=${icon.hasChanges ?? false}
			></gl-branch-icon>`;
		}

		if (icon.type === 'file-icon') {
			return html`<gl-file-icon slot="icon" .filename=${icon.filename}></gl-file-icon>`;
		}

		return nothing;
	}

	private renderActions(model: TreeModelFlat) {
		const actions = model.actions;
		if (actions == null || actions.length === 0) return nothing;

		return actions.map(action => {
			return html`<action-item
				slot="actions"
				.icon=${action.icon}
				.label=${action.label}
				.altIcon=${action.altIcon}
				.altLabel=${action.altLabel}
				@mouseenter=${() => this.onSuspendRowTooltip()}
				@mouseleave=${() => this.onResumeRowTooltip()}
				@click=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action, false)}
				@dblclick=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action, true)}
			></action-item>`;
		});
	}

	private renderDecorations(model: TreeModelFlat) {
		const decorations = model.decorations;
		if (decorations == null || decorations.length === 0) return nothing;

		return decorations.map(decoration => {
			const slot = decoration.position === 'before' ? 'decorations-before' : 'decorations-after';

			if (decoration.type === 'icon') {
				return html`<code-icon
					slot=${slot}
					part=${slot}
					aria-label="${decoration.label}"
					.icon=${decoration.icon}
				></code-icon>`;
			}

			if (decoration.type === 'text') {
				return html`<span
					slot=${slot}
					part=${slot}
					class="decoration-text"
					aria-label=${ifDefined(decoration.tooltip ?? decoration.label)}
					style=${decoration.color ? styleMap({ color: decoration.color }) : nothing}
					>${decoration.label}</span
				>`;
			}

			if (decoration.type === 'tracking') {
				return html`<gl-tracking-pill
					slot=${slot}
					part=${slot}
					.ahead=${decoration.ahead}
					.behind=${decoration.behind}
					colorized
					outlined
					?missingUpstream=${decoration.missingUpstream ?? false}
				></gl-tracking-pill>`;
			}

			if (decoration.type === 'conflict') {
				return html`<span
					slot=${slot}
					part=${slot}
					class="conflict-count"
					aria-label=${ifDefined(decoration.tooltip ?? decoration.label)}
					style=${decoration.color
						? styleMap({
								color: decoration.color,
								'border-color': `color-mix(in srgb, transparent 60%, ${decoration.color})`,
							})
						: nothing}
					><code-icon icon="warning" size="12"></code-icon>${decoration.count}</span
				>`;
			}

			// TODO: implement badge and indicator decorations

			return undefined;
		});
	}

	private highlightText(text: string): unknown {
		if (!this.filtered || this._filterTerms.length === 0) return text;

		const lowerText = text.toLowerCase();

		// Collect all matched character indices across all filter terms
		const allIndices = new Set<number>();
		for (const term of this._filterTerms) {
			// Try exact substring first
			const idx = lowerText.indexOf(term);
			if (idx !== -1) {
				for (let i = idx; i < idx + term.length; i++) {
					allIndices.add(i);
				}
				continue;
			}
			// Fuzzy match
			const matched = fuzzyMatch(lowerText, term);
			if (matched != null) {
				for (const i of matched) {
					allIndices.add(i);
				}
			}
		}

		if (allIndices.size === 0) return text;

		const sorted = [...allIndices].sort((a, b) => a - b);
		return renderFuzzyHighlight(text, sorted);
	}

	private renderTreeItem(model: TreeModelFlat) {
		const isSelected = this._lastSelectedPath === model.path;
		const isFocused = this._focusedItemPath === model.path;
		// Either the list itself or the filter-as-combobox counts as "the tree is focused" for
		// visual highlight purposes; the filter input drives the virtual active-descendant.
		const hasTreeFocus = (this._containerHasFocus || this._filterHasFocus) && !this._actionButtonHasFocus;

		// All items get tabindex="-1" (not focusable via Tab, only programmatically)
		// Add ID for aria-activedescendant
		const itemId = `tree-item-${model.path}`;

		return html`<gl-tree-item
			id=${itemId}
			.branch=${model.branch}
			.expanded=${model.expanded}
			.path=${model.path}
			.parentPath=${model.parentPath}
			.parentExpanded=${model.parentExpanded}
			.level=${model.level}
			.size=${model.size}
			.position=${model.position}
			.checkable=${model.checkable}
			.checked=${model.checked ?? false}
			.disableCheck=${model.disableCheck ?? false}
			.checkableTooltip=${model.checkableTooltip}
			.showIcon=${model.icon != null}
			.matched=${model.matched ?? false}
			.selected=${isSelected}
			.focused=${isFocused && hasTreeFocus}
			.focusedInactive=${isFocused && !hasTreeFocus}
			.tabIndex=${-1}
			.vscodeContext=${model.contextData as string | undefined}
			@gl-tree-item-select=${() => this.onBeforeTreeItemSelected(model)}
			@gl-tree-item-selected=${(e: CustomEvent<TreeItemSelectionDetail>) => this.onTreeItemSelected(e, model)}
			@gl-tree-item-checked=${(e: CustomEvent<TreeItemCheckedDetail>) => this.onTreeItemChecked(e, model)}
			@mouseenter=${(e: MouseEvent) => this.onTreeItemHover(e.currentTarget as HTMLElement, model)}
			@mouseleave=${() => this.onTreeItemUnhover()}
		>
			${this.renderIcon(model.icon)}
			${this.highlightText(model.label)}${when(
				model.description != null,
				() => html`<span slot="description">${this.highlightText(model.description!)}</span>`,
			)}
			${this.renderActions(model)} ${this.renderDecorations(model)}
		</gl-tree-item>`;
	}

	private renderFilterBar(activeDescendant: string | undefined): unknown {
		if (!this.filterable) return nothing;

		return html`<div class="filter">
			<div class="filter-field">
				<input
					class="filter-input"
					type="search"
					role="combobox"
					aria-controls="tree-list"
					aria-expanded="true"
					aria-haspopup="tree"
					aria-autocomplete="list"
					aria-activedescendant=${activeDescendant || nothing}
					placeholder="${this.filterPlaceholder}"
					.value=${this._filterText}
					@input=${this.handleFilterInput}
					@keydown=${this.handleFilterKeydown}
					@focus=${this.handleFilterFocus}
					@blur=${this.handleFilterBlur}
				/>
				<div class="filter-controls">
					<gl-button
						appearance="input"
						role="checkbox"
						aria-checked=${this.filterMode === 'filter' ? 'true' : 'false'}
						tooltip=${this.filterMode === 'filter' ? 'Filter Results' : 'Highlight Results'}
						aria-label=${this.filterMode === 'filter' ? 'Filter Results' : 'Highlight Results'}
						@click=${this.toggleFilterMode}
					>
						<code-icon icon="list-filter"></code-icon>
					</gl-button>
				</div>
			</div>
			<slot name="filter-actions"></slot>
		</div>`;
	}

	override render(): unknown {
		const hasItems = Boolean(this.treeItems?.length);
		const showNoResults = !hasItems && this._filterText && this._model?.length;
		const showEmptyText = !hasItems && !showNoResults && Boolean(this.emptyText);

		if (!hasItems && !showNoResults && !showEmptyText) return nothing;

		// Container-focused approach: the scrollable div is the focusable element
		// Use aria-activedescendant to indicate which tree item is active for screen readers.
		// Shared with the filter input so it can drive the tree as a combobox listbox.
		const activeDescendant = this._focusedItemPath ? `tree-item-${this._focusedItemPath}` : undefined;

		return html`
			${this.renderFilterBar(activeDescendant)}
			${hasItems
				? html`<div
						${ref(this.scrollableRef)}
						id="tree-list"
						class="scrollable"
						tabindex="0"
						role="tree"
						aria-label=${this.ariaLabel}
						aria-multiselectable="false"
						aria-activedescendant=${activeDescendant || nothing}
						@keydown=${this.handleContainerKeydown}
						@focus=${this.handleContainerFocus}
						@blur=${this.handleContainerBlur}
					>
						<lit-virtualizer
							class="scrollable"
							${ref(this.virtualizerRef)}
							.items=${this.treeItems}
							.keyFunction=${(item: TreeModelFlat) => item.path}
							.layout=${flow({ direction: 'vertical' })}
							.renderItem=${(node: TreeModelFlat) => this.renderTreeItem(node)}
							scroller
						></lit-virtualizer>
					</div>`
				: showNoResults
					? html`<div class="no-results">No results found</div>`
					: html`<div class="no-results">${this.emptyText}</div>`}
			${this._hoverOpen && this._hoveredTooltip
				? html`<gl-popover
						?open=${this._hoverOpen}
						.anchor=${this._hoveredAnchor}
						.placement=${this.tooltipAnchorRight ? 'right-start' : 'bottom'}
						trigger="manual"
						hoist
						.distance=${4}
						@mouseenter=${() => clearTimeout(this._unhoverTimer)}
						@mouseleave=${() => this.onTreeItemUnhover()}
					>
						<div slot="content" class="hover-content">
							<gl-markdown density="compact" .markdown=${this._hoveredTooltip ?? ''}></gl-markdown>
						</div>
					</gl-popover>`
				: nothing}
		`;
	}

	/**
	 * Find a tree node by path using O(1) map lookup
	 */
	private findTreeNode(path: string): TreeModel | undefined {
		return this._nodeMap.get(path);
	}

	/**
	 * Get the index of an item by path using O(1) map lookup
	 */
	private getItemIndex(path: string): number {
		return this._pathToIndexMap.get(path) ?? -1;
	}

	/**
	 * Rebuild the flattened tree from the hierarchical model
	 * This is called when the tree structure changes (expand/collapse)
	 */
	private rebuildFlattenedTree() {
		if (!this._model) return;

		// Clear stale node map before processing new model
		// This prevents stale node references when expanding/collapsing nodes
		this._nodeMap.clear();

		const hideNonMatched = this.filtered && this.filterMode === 'filter';
		const size = this._model.length;
		const newTreeItems: TreeModelFlat[] = [];
		for (let i = 0; i < size; i++) {
			flattenTree(this._model[i], size, i + 1, undefined, this._nodeMap, hideNonMatched, newTreeItems);
		}

		this.treeItems = newTreeItems;

		// Rebuild path-to-index map for O(1) index lookups
		this.buildPathToIndexMap();

		// Sync focused index with rebuilt map. If the highlighted item has been filtered out,
		// fall back to the first row so aria-activedescendant never references a removed node.
		if (this._focusedItemPath) {
			const newIndex = this._pathToIndexMap.get(this._focusedItemPath);
			if (newIndex != null) {
				this._focusedItemIndex = newIndex;
			} else if (this.treeItems?.length) {
				this._focusedItemPath = this.treeItems[0].path;
				this._focusedItemIndex = 0;
			} else {
				this._focusedItemPath = undefined;
				this._focusedItemIndex = -1;
			}
		}
	}

	private onBeforeTreeItemSelected(model: TreeModelFlat) {
		if (this._lastSelectedPath !== model.path) {
			this._lastSelectedPath = model.path;
		}
		// Update focused item when clicking
		if (this._focusedItemPath !== model.path) {
			this._focusedItemPath = model.path;
			this._focusedItemIndex = this.getItemIndex(model.path);
		}
		// Toggle expansion for branch nodes
		if (model.branch) {
			const treeNode = this.findTreeNode(model.path);
			if (treeNode) {
				treeNode.expanded = !treeNode.expanded;
				this.rebuildFlattenedTree();
				this.emit('gl-tree-expansion-changed', { path: model.path, expanded: treeNode.expanded });
			}
		}
		// Trigger a re-render to update selection and tabindex state across all items
		this.requestUpdate();
	}

	private onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-selected', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-checked', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private onTreeItemHover(element: HTMLElement, model: TreeModelFlat) {
		if (!model.tooltip) {
			this.onTreeItemUnhover();
			return;
		}

		clearTimeout(this._hoverTimer);
		clearTimeout(this._unhoverTimer);

		if (this.tooltipAnchorRight) {
			const hostRect = this.getBoundingClientRect();
			const itemRect = element.getBoundingClientRect();
			this._hoveredAnchor = {
				getBoundingClientRect: () => ({
					x: hostRect.right,
					y: itemRect.top,
					top: itemRect.top,
					bottom: itemRect.bottom,
					left: hostRect.right,
					right: hostRect.right,
					width: 0,
					height: itemRect.height,
				}),
			};
		} else {
			this._hoveredAnchor = element;
		}
		this._hoveredTooltip = model.tooltip;

		if (this._hoverOpen) {
			// Already showing — update immediately for the new item
			return;
		}

		this._hoverTimer = setTimeout(() => {
			this._hoverOpen = true;
		}, 500);
	}

	private onTreeItemUnhover() {
		clearTimeout(this._hoverTimer);
		// Debounce unhover to avoid flickering when transitioning between
		// sibling elements (e.g. button → decorations) within the same tree item
		this._unhoverTimer = setTimeout(() => {
			this._hoverOpen = false;
			this._hoveredTooltip = undefined;
			this._hoveredAnchor = undefined;
		}, 100);
	}

	private onSuspendRowTooltip() {
		clearTimeout(this._hoverTimer);
		clearTimeout(this._unhoverTimer);
		this._hoverOpen = false;
		// Keep _hoveredTooltip and _hoveredAnchor so we can resume
	}

	private onResumeRowTooltip() {
		if (this._hoveredTooltip != null && this._hoveredAnchor != null) {
			this._hoverOpen = true;
		}
	}

	private onTreeItemActionClicked(e: MouseEvent, model: TreeModelFlat, action: TreeItemAction, dblClick = false) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-action-clicked', {
			node: model,
			context: model.context,
			action: action,
			dblClick: dblClick,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
		});
	}

	private handleContainerFocus = () => {
		// Mark that the container has focus
		this._containerHasFocus = true;

		// When the container receives focus, if we don't have a focused item, default to first or selected
		if (!this._focusedItemPath) {
			if (this._lastSelectedPath) {
				this._focusedItemPath = this._lastSelectedPath;
				this._focusedItemIndex = this.getItemIndex(this._lastSelectedPath);
			} else if (this.treeItems?.length) {
				this._focusedItemPath = this.treeItems[0].path;
				this._focusedItemIndex = 0;
			}
			this.requestUpdate();
		}
	};

	private handleContainerBlur = () => {
		// Mark that the container lost focus
		// This will trigger a re-render to update the focused item's visual state
		this._containerHasFocus = false;
	};

	private handleFocusIn = (e: FocusEvent) => {
		const target = e.target as HTMLElement;
		// Check if focus moved to an action button
		const actionItem = target.tagName === 'ACTION-ITEM' ? target : target.closest('action-item');
		if (actionItem) {
			this._actionButtonHasFocus = true;
		}
	};

	private handleFocusOut = (e: FocusEvent) => {
		const target = e.target as HTMLElement;
		const relatedTarget = e.relatedTarget as HTMLElement;

		// Check if focus is leaving action buttons entirely
		const leavingActionItem = target.tagName === 'ACTION-ITEM' ? target : target.closest('action-item');
		const enteringActionItem =
			relatedTarget?.tagName === 'ACTION-ITEM' ? relatedTarget : relatedTarget?.closest('action-item');

		if (leavingActionItem && !enteringActionItem) {
			this._actionButtonHasFocus = false;
		}
	};

	private handleContextMenu = (e: MouseEvent) => {
		// Find the tree-item element that triggered the context menu
		const path = e.composedPath();
		const treeItem = path.find(el => (el as HTMLElement).tagName === 'GL-TREE-ITEM') as GlTreeItem | undefined;
		if (!treeItem) return;

		// Get the context data from the tree-item
		const contextData = treeItem.vscodeContext;
		if (!contextData) return;

		// Prevent the original event from bubbling
		e.preventDefault();
		e.stopPropagation();

		// Copy the context data to this element (tree-generator host)
		// so VS Code's injected library can read it
		this.dataset.vscodeContext = contextData;

		// Re-dispatch the event from this element so it can cross the shadow DOM boundary
		const evt = new MouseEvent('contextmenu', {
			bubbles: true,
			composed: true,
			cancelable: true,
			clientX: e.clientX,
			clientY: e.clientY,
			button: e.button,
			buttons: e.buttons,
			ctrlKey: e.ctrlKey,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
			metaKey: e.metaKey,
		});

		// Dispatch the new event
		this.dispatchEvent(evt);

		// Clean up the context data after a short delay
		// (VS Code should have read it by then)
		setTimeout(() => {
			delete this.dataset.vscodeContext;
		}, 100);
	};

	private handleKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Tab') return;

		// In capture phase, e.target is the element with the listener, not the focused element
		// We need to use composedPath to find the action-item in the event path
		const composedPath = e.composedPath();

		// Find the action-item in the composed path
		const actionItem = composedPath.find((el: any) => el.tagName === 'ACTION-ITEM') as HTMLElement;
		if (!actionItem) {
			return;
		}

		if (e.shiftKey) {
			// Shift+Tab - always move back to container
			e.preventDefault();
			const container = this.scrollableRef.value;
			if (container) {
				container.focus();
			}
		} else {
			// Tab forward - blur the action button and let VS Code handle focus
			e.preventDefault();

			// Blur the currently focused element to let VS Code's focus management take over
			const activeElement = document.activeElement as HTMLElement;
			setTimeout(() => {
				if (activeElement && typeof activeElement.blur === 'function') {
					activeElement.blur();
				}
			}, 0);
		}
	};

	private getCurrentFocusedIndex(): number {
		if (!this.treeItems?.length) return -1;

		// Try to find by path first
		if (this._focusedItemPath) {
			const index = this.getItemIndex(this._focusedItemPath);
			if (index !== -1) return index;
		}

		// Fall back to cached index if valid
		if (this._focusedItemIndex >= 0 && this._focusedItemIndex < this.treeItems.length) {
			return this._focusedItemIndex;
		}

		// Fall back to selected item
		if (this._lastSelectedPath) {
			const index = this.getItemIndex(this._lastSelectedPath);
			if (index !== -1) return index;
		}

		// Default to first item
		return 0;
	}

	private handleContainerKeydown = (e: KeyboardEvent) => {
		if (!this.treeItems?.length) return;

		// Don't handle keyboard events when an action button has focus
		// This allows action-nav to handle left/right arrow navigation between action buttons
		if (this._actionButtonHasFocus) return;

		// Handle Tab key to move focus to action buttons
		if (e.key === 'Tab' && !e.shiftKey) {
			// Try to focus the first action button in the focused row
			if (this._focusedItemPath) {
				const virtualizer = this.virtualizerRef.value;

				if (virtualizer) {
					// Query all gl-tree-items and find by ID
					// (virtualizer renders items as direct children)
					const allTreeItems = [...virtualizer.querySelectorAll('gl-tree-item')];
					const focusedTreeItem = allTreeItems.find(
						item => item.id === `tree-item-${this._focusedItemPath}`,
					) as HTMLElement;

					if (focusedTreeItem) {
						// Action items are light DOM children of the tree item
						const firstAction = focusedTreeItem.querySelector('action-item') as HTMLElement;
						if (firstAction) {
							// Prevent default BEFORE focusing to stop Tab from moving focus out
							e.preventDefault();
							e.stopPropagation();

							// Focus the action button
							firstAction.focus();
							return;
						}
					}
				}
			}
			// If no action buttons, let Tab move focus out naturally
			return;
		}

		// Get current focused index using helper method
		const currentIndex = this.getCurrentFocusedIndex();

		let targetIndex = currentIndex;
		let handled = false;

		switch (e.key) {
			case 'Enter':
			case ' ':
				// Trigger selection on the focused item
				e.preventDefault();
				e.stopPropagation();
				this.handleItemActivation(this.treeItems[currentIndex]);
				return;
			case 'ArrowDown':
				targetIndex = Math.min(currentIndex + 1, this.treeItems.length - 1);
				handled = true;
				break;
			case 'ArrowUp':
				// At the top of the list, return focus to the filter input (when present) so the
				// user can keep typing without reaching for the mouse.
				if (currentIndex <= 0 && this.filterable) {
					const filter = this.renderRoot.querySelector<HTMLInputElement>('.filter-input');
					if (filter != null) {
						e.preventDefault();
						e.stopPropagation();
						filter.focus();
						filter.select();
						return;
					}
				}
				targetIndex = Math.max(currentIndex - 1, 0);
				handled = true;
				break;
			case 'Home':
				targetIndex = 0;
				handled = true;
				break;
			case 'End':
				targetIndex = this.treeItems.length - 1;
				handled = true;
				break;
			case 'ArrowLeft':
			case 'ArrowRight': {
				// Try to handle expand/collapse for branch nodes
				const branchHandled = this.handleBranchToggle(e, this.treeItems[currentIndex]);
				if (branchHandled) {
					return;
				}
				// If not handled (already expanded/collapsed), navigate instead
				if (e.key === 'ArrowRight') {
					// Right arrow: move to next row
					targetIndex = Math.min(currentIndex + 1, this.treeItems.length - 1);
				} else {
					// Left arrow: move to parent if possible, otherwise previous row
					const currentItem = this.treeItems[currentIndex];
					if (currentItem.parentPath) {
						// Find the parent in the tree
						const parentIndex = this.getItemIndex(currentItem.parentPath);
						if (parentIndex !== -1) {
							targetIndex = parentIndex;
						} else {
							// Parent not found (shouldn't happen), go to previous row
							targetIndex = Math.max(currentIndex - 1, 0);
						}
					} else {
						// No parent, go to previous row
						targetIndex = Math.max(currentIndex - 1, 0);
					}
				}
				handled = true;
				break;
			}
			default: {
				// Handle type-ahead search for printable characters
				if (this.isPrintableCharacter(e.key)) {
					e.preventDefault();
					e.stopPropagation();
					this.handleTypeAhead(e.key);
					return;
				}
				break;
			}
		}

		if (handled) {
			// Always prevent default for navigation keys to avoid browser scroll behavior
			e.preventDefault();
			e.stopPropagation();

			// Always call focusItemAtIndex, even if we're already at the target
			// This ensures we scroll to the item if the user has scrolled away
			this.focusItemAtIndex(targetIndex);
		}
	};

	private handleItemActivation(item: TreeModelFlat) {
		if (!item) return;

		// First, update selection state (this also handles branch expansion)
		this.onBeforeTreeItemSelected(item);

		// Then emit selection event
		this.onTreeItemSelected(
			new CustomEvent('gl-tree-item-selected', {
				detail: {
					node: null as any, // The tree-item node isn't needed for keyboard activation
					dblClick: false,
					altKey: false,
					ctrlKey: false,
					metaKey: false,
				},
			}),
			item,
		);
	}

	private handleBranchToggle(e: KeyboardEvent, item: TreeModelFlat): boolean {
		if (!item?.branch) return false;

		const shouldExpand = e.key === 'ArrowRight';
		const shouldCollapse = e.key === 'ArrowLeft';

		// If already in the desired state, don't handle it (allow navigation)
		if ((shouldExpand && item.expanded) || (shouldCollapse && !item.expanded)) {
			return false;
		}

		e.preventDefault();
		e.stopPropagation();

		// Find and update the node in the hierarchical model
		const treeNode = this.findTreeNode(item.path);
		if (treeNode) {
			treeNode.expanded = !treeNode.expanded;
			this.rebuildFlattenedTree();
			this.emit('gl-tree-expansion-changed', { path: item.path, expanded: treeNode.expanded });

			// Trigger a re-render
			this.requestUpdate();

			// Emit selection event
			this.onTreeItemSelected(
				new CustomEvent('gl-tree-item-selected', {
					detail: {
						node: null as any,
						dblClick: false,
						altKey: false,
						ctrlKey: false,
						metaKey: false,
					},
				}),
				item,
			);
			return true;
		}
		return false;
	}

	private focusItemAtIndex(index: number) {
		const item = this.treeItems?.[index];
		if (!item) return;

		this._focusedItemPath = item.path;
		this._focusedItemIndex = index;

		// Selection follows focus - update selection to match focus
		if (this._lastSelectedPath !== item.path) {
			this._lastSelectedPath = item.path;
		}

		// Trigger re-render to update aria-activedescendant and focused state
		this.requestUpdate();

		// Then scroll item into view
		this.scrollToItem(index);
	}

	private scrollToItem(index: number, shouldRestoreFocus: boolean = true) {
		// Prevent multiple simultaneous scroll operations
		if (this._scrolling) return;
		this._scrolling = true;

		// Wait for render to complete with updated focused state
		void this.updateComplete.then(() => {
			const virtualizer = this.virtualizerRef.value;
			const container = this.scrollableRef.value;

			if (!virtualizer || !container) {
				this._scrolling = false;
				return;
			}

			// Restore focus helper
			const restoreFocus = () => {
				if (shouldRestoreFocus && container && document.activeElement !== container) {
					container.focus();
				}
				this._scrolling = false;
			};

			// For Home/End (large jumps to first/last item), use manual scrolling
			// scrollToIndex has known issues with large jumps causing blank screens
			const isHome = index === 0;
			const isEnd = index === (this.treeItems?.length ?? 0) - 1;

			if (isHome || isEnd) {
				// Use requestAnimationFrame to ensure DOM is ready
				requestAnimationFrame(() => {
					// Scroll the virtualizer (the actual scroll container, via `scroller` attr)
					// to top or bottom. Setting scrollTop on the outer wrapper is a no-op because
					// it never overflows — the virtualizer fills it and owns the scrollbar.
					if (isHome) {
						virtualizer.scrollTop = 0;
					} else {
						virtualizer.scrollTop = virtualizer.scrollHeight;
					}

					// Restore focus after scroll
					requestAnimationFrame(restoreFocus);
				});
			} else {
				// For small jumps, use scrollToIndex
				requestAnimationFrame(() => {
					const scrollPromise = virtualizer.scrollToIndex(index, 'nearest');

					// If scrollToIndex returns a promise, wait for it
					if (scrollPromise && typeof scrollPromise.then === 'function') {
						void scrollPromise.then(restoreFocus);
					} else {
						// Otherwise use RAF as fallback
						requestAnimationFrame(restoreFocus);
					}
				});
			}
		});
	}

	/**
	 * Handles type-ahead search functionality
	 * @param char The character to add to the search buffer
	 */
	private handleTypeAhead(char: string) {
		// Clear existing timer
		if (this._typeAheadTimer) {
			clearTimeout(this._typeAheadTimer);
		}

		// Check if this is a new search (buffer was cleared/undefined)
		const isNewSearch = !this._typeAheadBuffer;

		// Add character to buffer
		this._typeAheadBuffer += char.toLowerCase();

		// Check if current item still matches the new buffer
		const currentItem = this.treeItems?.[this._focusedItemIndex];
		const currentItemMatches = currentItem?.label?.toLowerCase().startsWith(this._typeAheadBuffer);

		let shouldMoveToNext = false;

		if (isNewSearch) {
			// Starting a new search - always find the best match
			shouldMoveToNext = true;
		} else if (!currentItemMatches) {
			// Current item no longer matches - need to find a new one
			shouldMoveToNext = true;
		}
		// If current item still matches and this is a continuation, stay put

		if (shouldMoveToNext) {
			const matchIndex = this.findNextMatchingItem(this._typeAheadBuffer);
			if (matchIndex !== -1) {
				this.focusItemAtIndex(matchIndex);
			}
		}

		// Set timer to clear buffer
		this._typeAheadTimer = window.setTimeout(() => {
			this._typeAheadBuffer = '';
			this._typeAheadTimer = undefined;
		}, this._typeAheadTimeout);
	}

	private buildPathToIndexMap() {
		this._pathToIndexMap.clear();
		if (!this.treeItems) {
			return;
		}
		let i = 0;
		for (const item of this.treeItems) {
			this._pathToIndexMap.set(item.path, i++);
		}
	}

	/**
	 * Finds the next tree item that matches the search buffer
	 * @param searchText The text to search for
	 * @returns The index of the matching item, or -1 if not found
	 */
	private findNextMatchingItem(searchText: string): number {
		if (!this.treeItems?.length || !searchText) return -1;

		const searchLower = searchText.toLowerCase();
		const currentIndex = this._focusedItemIndex;
		const len = this.treeItems.length;

		// Single loop with wraparound
		for (let offset = 1; offset < len; offset++) {
			const i = (currentIndex + offset) % len;
			if (this.treeItems[i].label?.toLowerCase().startsWith(searchLower)) {
				return i;
			}
		}

		return -1;
	}

	/**
	 * Checks if a character is printable (for type-ahead search)
	 * @param char The character to check
	 * @returns True if the character is printable
	 */
	private isPrintableCharacter(char: string): boolean {
		// Check if it's a single character and is alphanumeric or common punctuation
		return char.length === 1 && filterableCharRegex.test(char);
	}

	private handleFilterInput = (e: InputEvent) => {
		this._filterText = (e.target as HTMLInputElement).value;
		this.dispatchEvent(
			new CustomEvent('gl-tree-filter-changed', { detail: this._filterText, bubbles: true, composed: true }),
		);
		clearTimeout(this._filterDebounceTimer);
		this._filterDebounceTimer = setTimeout(() => this.applyFilterToModel(), 150);
	};

	private handleFilterFocus = () => {
		this._filterHasFocus = true;
		// Seed the virtual active-descendant so the first ArrowDown/Enter targets something
		// visible even if the user hasn't interacted yet.
		if (!this._focusedItemPath && this.treeItems?.length) {
			this._focusedItemPath = this.treeItems[0].path;
			this._focusedItemIndex = 0;
		}
	};

	private handleFilterBlur = () => {
		this._filterHasFocus = false;
	};

	private handleFilterKeydown = (e: KeyboardEvent) => {
		if (!this.treeItems?.length) return;

		// Combobox-style navigation: focus stays in the input, arrow keys drive a virtual
		// active-descendant in the tree, Enter activates it. Typing is never interrupted.
		const currentIndex = this.getCurrentFocusedIndex();
		let targetIndex = currentIndex;
		let handled = false;

		switch (e.key) {
			case 'ArrowDown':
				targetIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, this.treeItems.length - 1);
				handled = true;
				break;
			case 'ArrowUp':
				targetIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
				handled = true;
				break;
			case 'Home':
				targetIndex = 0;
				handled = true;
				break;
			case 'End':
				targetIndex = this.treeItems.length - 1;
				handled = true;
				break;
			case 'Enter': {
				e.preventDefault();
				e.stopPropagation();
				const target = this.treeItems[currentIndex] ?? this.treeItems[0];
				this.handleItemActivation(target);
				return;
			}
		}

		if (handled) {
			e.preventDefault();
			e.stopPropagation();
			this.setActiveDescendant(targetIndex);
		}
	};

	/**
	 * Move the combobox virtual focus to the given index without moving real DOM focus —
	 * the filter input keeps focus so typing stays uninterrupted.
	 */
	private setActiveDescendant(index: number) {
		const item = this.treeItems?.[index];
		if (!item) return;

		this._focusedItemPath = item.path;
		this._focusedItemIndex = index;
		// Selection follows virtual focus, matching the in-list arrow-key model.
		if (this._lastSelectedPath !== item.path) {
			this._lastSelectedPath = item.path;
		}
		this.requestUpdate();
		// Scroll into view without yanking focus away from the filter input.
		this.scrollToItem(index, false);
	}

	private toggleFilterMode = () => {
		this.filterMode = this.filterMode === 'filter' ? 'highlight' : 'filter';
		this.dispatchEvent(
			new CustomEvent('gl-tree-filter-mode-changed', {
				detail: this.filterMode,
				bubbles: true,
				composed: true,
			}),
		);
		if (this.filtered) {
			this.rebuildFlattenedTree();
		}
	};

	private applyFilterToModel() {
		this._filterLower = this._filterText.toLowerCase().trim();
		// Split on whitespace into independent search terms
		this._filterTerms = this._filterLower.split(/\s+/).filter(t => t.length > 0);
		if (this._filterTerms.length === 0) {
			this.filtered = false;
			if (this._model != null) {
				clearMatched(this._model);
			}
		} else {
			this.filtered = true;
			if (this._model != null) {
				applyFilter(this._model, this._filterTerms);
			}
		}

		this.rebuildFlattenedTree();
	}
}

/**
 * Flatten a hierarchical tree node into a flat array.
 * Uses an accumulator to avoid intermediate array allocations.
 * Optionally populates a node map during traversal for O(1) lookups.
 */
function flattenTree(
	tree: TreeModel,
	children: number,
	position: number,
	parentPath: string | undefined,
	nodeMap: Map<string, TreeModel> | undefined,
	hideNonMatched: boolean,
	out?: TreeModelFlat[],
): TreeModelFlat[] {
	if (hideNonMatched && tree.matched === false) return out ?? [];

	const result = out ?? [];

	nodeMap?.set(tree.path, tree);

	result.push({
		...tree,
		size: children,
		position: position,
		parentPath: parentPath,
	});

	if (tree.expanded !== false && tree.children != null && tree.children.length > 0) {
		const childSize = tree.children.length;
		for (let i = 0; i < childSize; i++) {
			flattenTree(tree.children[i], childSize, i + 1, tree.path, nodeMap, hideNonMatched, result);
		}
	}

	return result;
}

function applyFilter(model: TreeModel[], terms: string[]): boolean {
	let anyMatch = false;
	for (const item of model) {
		// All terms must match against the item's searchable text (AND logic)
		// Use exact substring for filterText (full path in tree mode) to avoid
		// false positives from fuzzy matching across long paths.
		// Reserve fuzzy matching for the displayed label only.
		const labelLower = (item.label ?? '').toLowerCase();
		const filterTextLower = item.filterText?.toLowerCase();
		const descLower = item.description?.toLowerCase();
		const selfMatch = terms.every(
			term =>
				filterTextLower?.includes(term) ||
				labelLower.includes(term) ||
				fuzzyMatch(labelLower, term) != null ||
				descLower?.includes(term),
		);
		let childMatch = false;

		if (item.children != null && item.children.length > 0) {
			childMatch = applyFilter(item.children, terms);
		}

		item.matched = selfMatch || childMatch;
		if (item.matched) {
			anyMatch = true;
		}

		// Auto-expand branches with matching children
		if (item.branch && childMatch) {
			item.expanded = true;
		}
	}
	return anyMatch;
}

function clearMatched(model: TreeModel[]): void {
	for (const item of model) {
		item.matched = false;
		if (item.children != null) {
			clearMatched(item.children);
		}
	}
}

/** Sequential character fuzzy match — returns matched indices or undefined */
function fuzzyMatch(text: string, filter: string): number[] | undefined {
	const indices: number[] = [];
	let fi = 0;
	for (let ti = 0; ti < text.length && fi < filter.length; ti++) {
		if (text[ti] === filter[fi]) {
			indices.push(ti);
			fi++;
		}
	}
	return fi === filter.length ? indices : undefined;
}

function renderFuzzyHighlight(text: string, matchedIndices: number[]): unknown[] {
	const parts: unknown[] = [];
	let last = 0;
	let i = 0;
	while (i < matchedIndices.length) {
		let end = i;
		while (end + 1 < matchedIndices.length && matchedIndices[end + 1] === matchedIndices[end] + 1) {
			end++;
		}
		const start = matchedIndices[i];
		const runEnd = matchedIndices[end] + 1;
		if (start > last) {
			parts.push(text.substring(last, start));
		}
		parts.push(html`<mark>${text.substring(start, runEnd)}</mark>`);
		last = runEnd;
		i = end + 1;
	}
	if (last < text.length) {
		parts.push(text.substring(last));
	}
	return parts;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-tree-view': GlTreeView;
	}

	interface GlobalEventHandlersEventMap {
		'gl-tree-generated-item-action-clicked': CustomEvent<TreeItemActionDetail>;
		'gl-tree-generated-item-selected': CustomEvent<TreeItemSelectionDetail>;
		'gl-tree-generated-item-checked': CustomEvent<TreeItemCheckedDetail>;
		'gl-tree-expansion-changed': CustomEvent<{ path: string; expanded: boolean }>;
	}
}
