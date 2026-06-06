import { flow } from '@lit-labs/virtualizer/layouts/flow.js';
import type { TemplateResult } from 'lit';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { Ref } from 'lit/directives/ref.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { when } from 'lit/directives/when.js';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
import type { CollectionIndexController } from '../../controllers/collection-index.js';
import { FilterController } from '../../controllers/filter.js';
import type { FocusController } from '../../controllers/focus.js';
import type { SelectionController } from '../../controllers/selection.js';
import { VirtualCollectionController } from '../../controllers/virtual-collection.js';
import type { VirtualScrollController } from '../../controllers/virtual-scroll.js';
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
	TreeSelectionChangedDetail,
} from './base.js';
import '@lit-labs/virtualizer';
import '../chips/action-chip.js';
import '../branch-icon.js';
import '../commit/wip-stats.js';
import '../overlays/popover.js';
import '../pills/tracking.js';
import '../file-icon/file-icon.js';
import '../status/git-status.js';
import '../button.js';
import '../code-icon.js';
import '../overlays/tooltip.js';
import '../markdown/markdown.js';
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

			/* Signals "the tree has focus" to descendant gl-tree-item rows (inherits across the shadow
			   boundary). Drives the active-vs-inactive selection background on every selected row —
			   reliable for click-focus, which doesn't surface as a focusin on this host. */
			:host(:focus-within) {
				--gl-tree-focus-within: 1;
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

			/* Dim non-matched items when highlighting: either the search box is in highlight mode
			   (search-box-filter absent) or an external source forces dim (dim-unmatched). */
			:host([filtered]:not([search-box-filter])) gl-tree-item:not([matched]),
			:host([filtered][dim-unmatched]) gl-tree-item:not([matched]) {
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
				border-radius: var(--gl-input-border-radius);
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

			.hover-popover {
				pointer-events: none;
				--max-width: min(40rem, 90vw);
			}
			.hover-popover::part(body) {
				box-sizing: border-box;
			}

			.hover-content {
				font-size: 1.2rem;
				line-height: 1.5;
				/* anywhere wraps at any character when forced — avoids the default behavior of
				   breaking paths at hyphens (the worst possible split point). */
				overflow-wrap: anywhere;
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

			/* Phase-tinted agent icon — pulls from the shared --gl-agent-* palette defined in
			   theme.scss so leaf, tooltip, pill, and details panel all dereference the same set
			   of variables. code-icon's :host inherits color from its parent, so styling the
			   element here flows through to its rendered glyph. */
			code-icon.tree-icon-agent {
				color: var(--gl-agent-idle-color);
			}
			code-icon.tree-icon-agent--working {
				color: var(--gl-agent-working-color);
			}
			code-icon.tree-icon-agent--waiting {
				color: var(--gl-agent-waiting-color);
			}

			/* Pair wrapper for the robot + spinner glyphs so they sit flush as one identity
			   marker. The decoration slot's gap applies between the wrapper and any sibling
			   decoration but not between the icons inside. */
			.tree-icon-agent-pair {
				display: inline-flex;
				align-items: center;
				gap: 0;
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

	/**
	 * Placeholder shown when `searchBoxFilter` is `false` (the input acts as a find/highlight
	 * rather than a hide-non-matches filter). Falls back to `filterPlaceholder` when unset so
	 * single-placeholder consumers keep their existing copy.
	 */
	@property({ type: String, attribute: 'search-placeholder' })
	searchPlaceholder?: string;

	/**
	 * Filter strategy for typed-text matches. `true` (default) hides non-matching rows entirely;
	 * `false` keeps the tree intact and dims non-matched rows. Reflected as a Boolean attribute so
	 * shadow-DOM styles can branch via `:host([search-box-filter])`.
	 */
	@property({ type: Boolean, attribute: 'search-box-filter', reflect: true })
	searchBoxFilter = true;

	/**
	 * Dim (rather than hide) non-matched rows while `filtered`, independent of {@link searchBoxFilter}.
	 * Lets an external match source (e.g. the file pane's search-context "highlight matches" mode) force
	 * the dim presentation WITHOUT hijacking the user's search-box filter/highlight mode — so toggling it
	 * never changes the search box placeholder or its filter toggle.
	 */
	@property({ type: Boolean, attribute: 'dim-unmatched', reflect: true })
	dimUnmatched = false;

	@property({ type: String, attribute: 'empty-text' })
	emptyText = 'No items';

	@property({ type: Boolean, attribute: 'tooltip-anchor-right' })
	tooltipAnchorRight = false;

	@property({ type: String, attribute: 'filter-text' })
	get filterText(): string {
		return this._filter.query;
	}
	set filterText(value: string) {
		const old = this._filter.query;
		if (old === value) return;

		// Programmatic set applies synchronously (matches the prior setter); requestUpdate keeps the
		// reflected `filter-text` property in sync for consumers binding it.
		this._filter.setQuery(value);
		this.requestUpdate('filterText', old);
	}

	/** Owns the filter query/terms/debounce. The recursive tree match stays host-side via applyMatch. */
	private readonly _filter = new FilterController(this, {
		debounceMs: 150,
		applyMatch: (terms: readonly string[]) => {
			if (terms.length === 0) {
				this.filtered = false;
				if (this._model != null) {
					clearMatched(this._model);
				}
			} else {
				this.filtered = true;
				if (this._model != null) {
					applyFilter(this._model, [...terms]);
				}
			}
		},
		onApplied: () => this.rebuildFlattenedTree(),
	});

	@property({ type: String, attribute: 'aria-label' })
	override ariaLabel = 'Tree';

	/** External hint for which path should be focused when the model is set. Consumed once on model update. */
	@property({ type: String, attribute: 'focused-path' })
	focusedPath?: string;

	// Single-select highlight is owned by `_selection` (via its anchor). The setter only mutates in
	// single mode, so multi-mode focus moves never collapse the set (multi reads `_selection.has`,
	// not this accessor) — keeping multi-mode behavior identical to before this delegation.
	private get _lastSelectedPath(): string | undefined {
		return this._selection.anchorId;
	}
	private set _lastSelectedPath(value: string | undefined) {
		if (this.multiSelectable) return;

		if (value == null) {
			this._selection.clear();
		} else {
			this._selection.setSingle(value);
		}
	}

	// The focused-row cursor is owned by `_focus` (FocusController). These accessors delegate to it
	// so the cursor has a single source of truth; the movement methods still drive scroll/notify
	// explicitly (incremental migration — see `_focus` field).
	private get _focusedItemPath(): string | undefined {
		return this._focus.focusedId;
	}
	private set _focusedItemPath(value: string | undefined) {
		this._focus.setFocusedId(value);
	}
	private get _focusedItemIndex(): number {
		return this._focus.focusedIndex;
	}
	private set _focusedItemIndex(value: number) {
		this._focus.setFocusedIndex(value);
	}

	// Structurally typed (lit-virtualizer ships no element type): just the members this component +
	// VirtualScrollController touch. Avoids `Ref<any>` (no-unsafe-return on the controller wiring).
	private virtualizerRef: Ref<
		HTMLElement & { scrollToIndex?: (index: number, position?: string) => unknown; layoutComplete?: Promise<void> }
	> = createRef();
	private scrollableRef: Ref<HTMLElement> = createRef();

	@state()
	private _containerHasFocus = false;

	@state()
	private _filterHasFocus = false;

	@state()
	private _actionButtonHasFocus = false;

	// The L1 virtualized-collection facade: instantiates + sequences index/scroll/selection/focus
	// (and keyboard). The sub-controllers stay reachable via the delegating getters below so the
	// host can drive them for tree-specific concerns (Left/Right expand, type-ahead) via the seam.
	private readonly _collection = new VirtualCollectionController<TreeModelFlat>(this, {
		getItems: () => this.treeItems,
		getItemId: item => item.path,
		isSelectable: item => item.branch === false,
		mode: () => (this.multiSelectable ? 'multi' : 'single'),
		focusStrategy: 'activedescendant',
		getVirtualizer: () => this.virtualizerRef.value,
		getContainer: () => this.scrollableRef.value,
		onSelectionChange: () => {
			this.requestUpdate();
			// The selection-changed event is multi-select-specific; single mode keeps its prior
			// (event-free) selection-follows-focus semantics.
			if (this.multiSelectable) {
				this.emitSelectionChanged();
			}
		},
		// Enter / single-mode Space activate the focused row (open / expand).
		onActivate: id => {
			const item = this._index.itemFor(id);
			if (item != null) {
				this.handleItemActivation(item);
			}
		},
		// The seam: keys the shared controller doesn't consume (ArrowLeft/Right expand-collapse,
		// printable type-ahead) are handled here, in tree terms.
		onUnhandledKey: e => this.handleTreeKey(e),
	});

	private get _index(): CollectionIndexController<TreeModelFlat> {
		return this._collection.index;
	}
	private get _scroll(): VirtualScrollController {
		return this._collection.scroll;
	}
	private get _selection(): SelectionController {
		return this._collection.selection;
	}
	private get _focus(): FocusController {
		return this._collection.focus;
	}

	// Hover tooltip state
	private _hoverTimer?: ReturnType<typeof setTimeout>;
	private _unhoverTimer?: ReturnType<typeof setTimeout>;

	@state()
	private _hoveredTooltip?: string | TemplateResult;

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
	/**
	 * Opt-in native multi-select. Default OFF — when off, the single-select path drives selection
	 * through `_selection` via the `_lastSelectedPath` getter/setter (a single selected id at a time),
	 * preserving the prior single-select behavior. When on, Ctrl/Cmd+click toggles, Shift+click selects
	 * a range, and plain click selects one (and still fires the open event). Folders are never members.
	 */
	@property({ type: Boolean, attribute: 'multi-selectable' })
	multiSelectable = false;

	override connectedCallback(): void {
		super.connectedCallback?.();

		// Add capture-phase listeners to handle Tab navigation and focus tracking
		this.addEventListener('keydown', this.handleKeydown, { capture: true });
		this.addEventListener('focusin', this.handleFocusIn, { capture: true });
		this.addEventListener('focusout', this.handleFocusOut, { capture: true });
		this.addEventListener('mousedown', this.dismissRowTooltip, { capture: true });
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
		this.removeEventListener('mousedown', this.dismissRowTooltip, { capture: true });

		// Clean up timers and reset state
		if (this._typeAheadTimer) {
			clearTimeout(this._typeAheadTimer);
			this._typeAheadTimer = undefined;
		}
		this._typeAheadBuffer = '';
	}

	private _model?: TreeModel[];
	@property({ type: Array, attribute: false })
	set model(value: TreeModel[] | undefined) {
		if (this._model === value) return;

		this._model = value;

		// Apply active filter to the new model so matched flags are set before flattening
		if (this._filter.terms.length > 0 && this._model != null) {
			applyFilter(this._model, [...this._filter.terms]);
		}

		// Clear stale node map before processing new model
		// This prevents stale node references when switching commits or toggling filters
		this._nodeMap.clear();

		// Build both maps during tree flattening (single traversal)
		let treeItems: TreeModelFlat[] | undefined;
		if (this._model != null) {
			const size = this._model.length;
			const hideNonMatched = this.filtered && this.searchBoxFilter && !this.dimUnmatched;
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
			const newIndex = this._index.indexOf(this._focusedItemPath);
			if (newIndex !== -1) {
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
				if (this._lastSelectedPath && !this._index.has(this._lastSelectedPath)) {
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
		// `filtered` / `searchBoxFilter` gate `hideNonMatched` in the model setter. Because Lit
		// commits property bindings in template order, consumers that bind `.model` before
		// `.filtered` / `search-box-filter` cause the model setter to flatten with STALE filter
		// state — cycling the toggle from one mode to another re-committed a full model while
		// `filtered` was still true, so non-matched items stayed hidden in the flattened list. By
		// the time willUpdate runs all bindings are committed, so re-flatten here whenever either
		// changed — cheap and correct regardless of how the consumer ordered its bindings.
		if (
			(changedProperties.has('filtered') ||
				changedProperties.has('searchBoxFilter') ||
				changedProperties.has('dimUnmatched')) &&
			this._model != null
		) {
			this.rebuildFlattenedTree();
		}

		// Apply focused-path hint here (after all properties are set) rather than in the model
		// setter, because Lit sets bindings in template order — the model setter may run before
		// the focused-path attribute is updated, leaving focusedPath stale.
		if (this.focusedPath && (changedProperties.has('focusedPath') || changedProperties.has('model'))) {
			const index = this._index.indexOf(this.focusedPath);
			if (index !== -1) {
				this._focusedItemPath = this.focusedPath;
				this._focusedItemIndex = index;
				this._lastSelectedPath = this.focusedPath;
				// Scroll the focused item into view after the render completes
				this._pendingScrollToIndex = index;
			}
		}
		// When the model changes without a focused-path hint, trust the setter's path-based
		// reconciliation (see `set model` above): selection/focus survive if the path is still
		// present, fall back to a positional neighbor if it's gone, undefined if the model is
		// empty. Do NOT wipe state or force scroll-to-top here — that breaks consumers like
		// gl-file-tree-pane whose own scrollTop save/restore relies on the position staying
		// stable across refreshes of the same data (e.g. a WIP working-tree change).
		// The multi-select range anchor is seeded from the focused row by the VirtualCollectionController
		// facade (`hostUpdated`), so a first Shift+click/Shift+Arrow has a pivot — see that controller.
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		super.updated?.(changedProperties);
		if (this._pendingScrollToIndex != null) {
			const index = this._pendingScrollToIndex;
			this._pendingScrollToIndex = undefined;
			this.scrollToItem(index, false);
		}

		// lit-virtualizer dynamically imports its layout module on first mount; the initial
		// `rangechange` event can fire before `FlowLayout`'s listener wires up, dropping the
		// first layout pass — the tree renders blank until something (scroll, resize, items
		// reassignment) triggers another. Force a second pass whenever treeItems transitions
		// from empty to populated. The path-keyed diff inside the virtualizer preserves
		// focus/selection/scroll. Upstream tracking: lit/lit#3472.
		if (changedProperties.has('treeItems')) {
			const prev = changedProperties.get('treeItems') as TreeModelFlat[] | undefined;
			if (!prev?.length && (this.treeItems?.length ?? 0) > 0) {
				void this.kickVirtualizerAfterFirstLayout();
			}
		}
	}

	private async kickVirtualizerAfterFirstLayout(): Promise<void> {
		const virtualizer = this.virtualizerRef.value;
		if (!virtualizer) return;

		await virtualizer.layoutComplete;
		// Re-check after await — the model could have been swapped to empty mid-wait.
		if (this.treeItems?.length) {
			this.treeItems = this.treeItems.slice();
		}
	}

	private _pendingScrollToIndex: number | undefined;

	private renderIcon(
		icon?:
			| string
			| { type: 'status'; name: GlGitStatus['status'] }
			| { type: 'branch'; status?: string; worktree?: boolean; hasChanges?: boolean }
			| { type: 'file-icon'; filename: string }
			| { type: 'agent'; phase: AgentSessionPhase },
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

		if (icon.type === 'agent') {
			// Phase-driven glyph AND color so the leaf telegraphs state at a glance — color alone
			// is a single-axis signal and fails for color-blind scanning. Idle keeps the Claude
			// brand asterisk (default state retains provider identity); working spins a `sync`
			// glyph as an activity cue; waiting flips to `warning` as a call-to-action. Colors
			// come from the shared --gl-agent-* palette via this component's static styles.
			const phaseIcon = icon.phase === 'working' ? 'sync' : icon.phase === 'waiting' ? 'warning' : 'claude';
			const modifier = icon.phase === 'working' ? 'spin' : undefined;
			return html`<code-icon
				slot="icon"
				icon="${phaseIcon}"
				modifier=${ifDefined(modifier)}
				class="tree-icon-agent tree-icon-agent--${icon.phase}"
			></code-icon>`;
		}

		return nothing;
	}

	private renderActions(model: TreeModelFlat) {
		const actions = model.actions;
		if (actions == null || actions.length === 0) return nothing;

		return actions.map(action => {
			return html`<gl-action-chip
				slot="actions"
				.icon=${action.icon}
				.label=${action.label}
				.altIcon=${action.altIcon}
				.altLabel=${action.altLabel}
				@mouseenter=${() => this.onSuspendRowTooltip()}
				@mouseleave=${() => this.onResumeRowTooltip()}
				@click=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action, false)}
				@dblclick=${(e: MouseEvent) => this.onTreeItemActionClicked(e, model, action, true)}
			></gl-action-chip>`;
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
				const classes = `decoration-text${decoration.kind ? ` decoration-text--${decoration.kind}` : ''}`;
				return html`<span
					slot=${slot}
					part=${slot}
					class=${classes}
					aria-label=${ifDefined(decoration.tooltip ?? decoration.label)}
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

			if (decoration.type === 'wip') {
				// `no-tooltip` so the indicator doesn't double-tooltip with the row tooltip — the
				// row's own tooltip carries the breakdown pill (see sidebar-panel toWorktreeLeaf).
				return html`<gl-wip-stats
					slot=${slot}
					part=${slot}
					badge
					show-clean
					no-tooltip
					.dirty=${decoration.hasChanges}
					added=${decoration.added ?? nothing}
					modified=${decoration.changed ?? nothing}
					removed=${decoration.deleted ?? nothing}
				></gl-wip-stats>`;
			}

			if (decoration.type === 'conflict') {
				const classes = `conflict-count${decoration.kind ? ` conflict-count--${decoration.kind}` : ''}`;
				return html`<span
					slot=${slot}
					part=${slot}
					class=${classes}
					aria-label=${ifDefined(decoration.tooltip ?? decoration.label)}
					><code-icon icon="warning" size="12"></code-icon>${decoration.count}</span
				>`;
			}

			if (decoration.type === 'agent') {
				// Robot glyph is the agent's identity (never animates); the spinner is a separate
				// adjacent glyph that only renders during `working`. Color comes from the shared
				// --gl-agent-* palette via the `tree-icon-agent--${phase}` class on each
				// `code-icon` so the CSS rules at the top of this file match the rendered markup.
				// Both icons live inside a flex wrapper so the decoration slot's `gap: 0.4rem`
				// only applies between the wrapper and any other decoration — not between the
				// robot and the spinner, which should sit flush as one identity glyph.
				const tooltip = decoration.tooltip ?? decoration.label;
				return html`<gl-tooltip slot=${slot} part=${slot} placement="top">
					<span class="tree-icon-agent-pair">
						<code-icon
							icon="robot"
							class="tree-icon-agent tree-icon-agent--${decoration.phase}"
							aria-label=${ifDefined(tooltip)}
						></code-icon>
						${decoration.phase === 'working'
							? html`<code-icon
									icon="sync"
									modifier="spin"
									class="tree-icon-agent tree-icon-agent--${decoration.phase}"
									aria-hidden="true"
								></code-icon>`
							: nothing}
					</span>
					<span slot="content">${tooltip}</span>
				</gl-tooltip>`;
			}

			// TODO: implement badge and indicator decorations

			return undefined;
		});
	}

	private highlightText(text: string): unknown {
		if (!this.filtered || this._filter.terms.length === 0) return text;

		const lowerText = text.toLowerCase();

		// Collect all matched character indices across all filter terms
		const allIndices = new Set<number>();
		for (const term of this._filter.terms) {
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
		const isSelected = this.multiSelectable
			? this._selection.has(model.path)
			: this._lastSelectedPath === model.path;
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
			.checkableAltTooltip=${model.checkableAltTooltip}
			.showIcon=${model.icon != null}
			.matched=${model.matched ?? false}
			.selected=${isSelected}
			.focused=${isFocused && hasTreeFocus}
			.focusedInactive=${isFocused && !hasTreeFocus}
			.tabIndex=${-1}
			.vscodeContext=${model.contextData}
			@gl-tree-item-select=${() => this.onBeforeTreeItemSelected(model)}
			@gl-tree-item-selected=${(e: CustomEvent<TreeItemSelectionDetail>) => this.onTreeItemSelected(e, model)}
			@gl-tree-item-checked=${(e: CustomEvent<TreeItemCheckedDetail>) => this.onTreeItemChecked(e, model)}
			@mouseenter=${(e: MouseEvent) => this.onTreeItemHover(e, model)}
			@mouseleave=${() => this.onTreeItemUnhover()}
			@gl-tree-item-suspend-tooltip=${() => this.onSuspendRowTooltip()}
			@gl-tree-item-resume-tooltip=${() => this.onResumeRowTooltip()}
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
					placeholder="${this.searchBoxFilter
						? this.filterPlaceholder
						: (this.searchPlaceholder ?? this.filterPlaceholder)}"
					.value=${this._filter.query}
					@input=${this.handleFilterInput}
					@keydown=${this.handleFilterKeydown}
					@focus=${this.handleFilterFocus}
					@blur=${this.handleFilterBlur}
				/>
				<div class="filter-controls">
					<gl-button
						appearance="input"
						role="checkbox"
						aria-checked=${this.searchBoxFilter ? 'true' : 'false'}
						tooltip="Filter Results"
						aria-label="Filter Results"
						@click=${this.toggleSearchBoxFilter}
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
		const showNoResults = !hasItems && this._filter.query && this._model?.length;
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
						aria-multiselectable=${this.multiSelectable ? 'true' : 'false'}
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
						class="hover-popover"
						?open=${this._hoverOpen}
						.anchor=${this._hoveredAnchor}
						placement="right-start"
						trigger="manual"
						hoist
						.distance=${12}
					>
						<div slot="content" class="hover-content">
							${typeof this._hoveredTooltip === 'string'
								? html`<gl-markdown density="compact" .markdown=${this._hoveredTooltip}></gl-markdown>`
								: this._hoveredTooltip}
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
		return this._index.indexOf(path);
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

		const hideNonMatched = this.filtered && this.searchBoxFilter && !this.dimUnmatched;
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
			const newIndex = this._index.indexOf(this._focusedItemPath);
			if (newIndex !== -1) {
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

		// Multi-select: modifier-clicks mutate the selection set WITHOUT firing the open event, so
		// the familiar plain-click-to-open behavior is preserved and only Ctrl/Cmd/Shift accumulate.
		// Folders are never selection members — they fall through to the normal open/expand path.
		if (this.multiSelectable && !model.branch) {
			const d = e.detail;
			if (d.shiftKey) {
				this._selection.selectRange(model.path, { additive: d.ctrlKey || d.metaKey });
				return;
			}
			if (d.ctrlKey || d.metaKey) {
				this._selection.toggle(model.path);
				return;
			}

			// Plain click: collapse the selection to this row, then fall through to open it.
			this._selection.setSingle(model.path);
		}

		this.emit('gl-tree-generated-item-selected', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	private emitSelectionChanged() {
		// Emit in collection (visual) order, not Set-insertion (click) order — toggle/Ctrl+click
		// insert in interaction order, so iterate the flattened rows and keep the selected ones.
		const selected = this._selection.selectedIds;
		const paths: string[] = [];
		const nodes: TreeModelFlat[] = [];
		const contexts: unknown[] = [];
		for (const item of this.treeItems ?? []) {
			if (selected.has(item.path)) {
				paths.push(item.path);
				nodes.push(item);
				contexts.push(item.context);
			}
		}
		this.emit('gl-tree-generated-selection-changed', {
			nodes: nodes,
			paths: paths,
			contexts: contexts,
			lastPath: this._selection.anchorId,
		} satisfies TreeSelectionChangedDetail);
	}

	/** Drop selected ids no longer present after a flatten/filter/model change (multi-select only). */
	private pruneSelection() {
		if (!this.multiSelectable) return;

		this._selection.pruneTo((id: string) => this._index.has(id));
	}

	private onTreeItemChecked(e: CustomEvent<TreeItemCheckedDetail>, model: TreeModelFlat) {
		e.stopPropagation();
		this.emit('gl-tree-generated-item-checked', {
			...e.detail,
			node: model,
			context: model.context,
		});
	}

	// A single, persistent virtual element used as the popover anchor. We mutate its rect
	// in place on every hover instead of allocating a fresh object — that way the popover's
	// `.anchor` property keeps the same identity, wa-popup never runs its handleAnchorChange
	// (which does hidePopover → rAF → showPopover and produces a visible disappear/reappear
	// jump when the cursor hops between rows), and we just ask wa-popup to recompute the
	// position against the updated rect via reposition().
	private readonly _virtualAnchorRect = { x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
	private readonly _virtualAnchor = {
		getBoundingClientRect: (): Omit<DOMRect, 'toJSON'> => this._virtualAnchorRect,
	};

	private onTreeItemHover(event: MouseEvent, model: TreeModelFlat) {
		if (!model.tooltip) {
			this.onTreeItemUnhover();
			return;
		}

		const element = event.currentTarget as HTMLElement;
		clearTimeout(this._hoverTimer);
		clearTimeout(this._unhoverTimer);

		const itemRect = element.getBoundingClientRect();
		// Anchor at the cursor's X (or the host's right edge in `tooltipAnchorRight` mode), aligned
		// vertically with the row so the tooltip floats just to the side and never sits in the
		// vertical path the cursor takes when moving between rows.
		const x = this.tooltipAnchorRight ? this.getBoundingClientRect().right : event.clientX;
		const rect = this._virtualAnchorRect;
		rect.x = rect.left = rect.right = x;
		rect.y = rect.top = itemRect.top;
		rect.bottom = itemRect.bottom;
		rect.height = itemRect.height;
		// width stays 0
		this._hoveredAnchor = this._virtualAnchor;
		this._hoveredTooltip = model.tooltip;

		if (this._hoverOpen) {
			// Already showing — anchor identity is unchanged so Lit/wa-popup won't trigger a
			// stop/start cycle on the popover. Ask wa-popup to recompute its position against
			// the freshly-mutated rect so the tooltip follows the new row without disappearing.
			void this._repositionHoverPopover();
			return;
		}

		this._hoverTimer = setTimeout(() => {
			this._hoverOpen = true;
		}, 500);
	}

	private async _repositionHoverPopover(): Promise<void> {
		// Wait for Lit to flush any pending property updates (e.g. `_hoveredTooltip` →
		// `gl-markdown`), then ask wa-popup to recompute its position.
		await this.updateComplete;
		const popover = this.renderRoot?.querySelector('gl-popover.hover-popover');
		const waPopup = popover?.shadowRoot?.querySelector('wa-popup') as
			| (HTMLElement & { reposition?: () => void })
			| null;
		waPopup?.reposition?.();
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

	private readonly dismissRowTooltip = (): void => {
		clearTimeout(this._hoverTimer);
		clearTimeout(this._unhoverTimer);
		this._hoverOpen = false;
		this._hoveredTooltip = undefined;
		this._hoveredAnchor = undefined;
	};

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
		const actionItem = target.tagName === 'GL-ACTION-CHIP' ? target : target.closest('gl-action-chip');
		if (actionItem) {
			this._actionButtonHasFocus = true;
		}
	};

	private handleFocusOut = (e: FocusEvent) => {
		const target = e.target as HTMLElement;
		const relatedTarget = e.relatedTarget as HTMLElement;

		// Check if focus is leaving action buttons entirely
		const leavingActionItem = target.tagName === 'GL-ACTION-CHIP' ? target : target.closest('gl-action-chip');
		const enteringActionItem =
			relatedTarget?.tagName === 'GL-ACTION-CHIP' ? relatedTarget : relatedTarget?.closest('gl-action-chip');

		if (leavingActionItem && !enteringActionItem) {
			this._actionButtonHasFocus = false;
		}
	};

	private handleKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Tab') return;

		// In capture phase, e.target is the element with the listener, not the focused element
		// We need to use composedPath to find the action chip in the event path
		const composedPath = e.composedPath();

		// Find the action chip in the composed path
		const actionItem = composedPath.find((el: any) => el.tagName === 'GL-ACTION-CHIP') as HTMLElement;
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

		// Tab → move focus to the first action button in the focused row (tree-specific).
		if (e.key === 'Tab' && !e.shiftKey) {
			if (this._focusedItemPath) {
				const virtualizer = this.virtualizerRef.value;
				if (virtualizer) {
					// Virtualizer renders gl-tree-items as direct children; find the focused one by id.
					const allTreeItems = [...virtualizer.querySelectorAll('gl-tree-item')];
					const focusedTreeItem = allTreeItems.find(
						item => item.id === `tree-item-${this._focusedItemPath}`,
					) as HTMLElement;
					if (focusedTreeItem) {
						// Action chips are light DOM children of the tree item.
						const firstAction = focusedTreeItem.querySelector('gl-action-chip') as HTMLElement;
						if (firstAction) {
							// Prevent default BEFORE focusing to stop Tab from moving focus out.
							e.preventDefault();
							e.stopPropagation();
							firstAction.focus();
							return;
						}
					}
				}
			}
			// If no action buttons, let Tab move focus out naturally.
			return;
		}

		// ArrowUp at the top → return focus to the filter input so the user can keep typing
		// (tree-specific override of the shared controller's plain ArrowUp).
		if (e.key === 'ArrowUp' && this.filterable && this.getCurrentFocusedIndex() <= 0) {
			const filter = this.renderRoot.querySelector<HTMLInputElement>('.filter-input');
			if (filter != null) {
				e.preventDefault();
				e.stopPropagation();
				filter.focus();
				filter.select();
				return;
			}
		}

		// Space on a branch row → activate (expand/collapse) rather than multi-toggle.
		if (e.key === ' ') {
			const focused = this.treeItems[this.getCurrentFocusedIndex()];
			if (focused?.branch) {
				e.preventDefault();
				e.stopPropagation();
				this.handleItemActivation(focused);
				return;
			}
		}

		// Delegate the common vocabulary (Up/Down/Home/End/Page/Enter/Space/Shift+Arrow/Ctrl+A) to the
		// shared keyboard controller; tree-specific keys come back through the onUnhandledKey seam.
		if (this._collection.handleKeydown(e)) {
			e.preventDefault();
			e.stopPropagation();
		}
	};

	/** The keyboard seam (`onUnhandledKey`): tree-specific keys the shared controller forwards. */
	private handleTreeKey(e: KeyboardEvent): boolean {
		const items = this.treeItems;
		if (items == null || items.length === 0) return false;

		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			const currentIndex = this.getCurrentFocusedIndex();
			const item = items[currentIndex];
			if (item == null) return false;

			// Expand/collapse a branch first; if already in the target state, navigate instead.
			if (this.handleBranchToggle(e, item)) return true;

			let targetIndex: number;
			if (e.key === 'ArrowRight') {
				targetIndex = Math.min(currentIndex + 1, items.length - 1);
			} else if (item.parentPath) {
				const parentIndex = this.getItemIndex(item.parentPath);
				targetIndex = parentIndex !== -1 ? parentIndex : Math.max(currentIndex - 1, 0);
			} else {
				targetIndex = Math.max(currentIndex - 1, 0);
			}

			this.focusItemAtIndex(targetIndex);
			if (this.multiSelectable) {
				const focusedItem = items[targetIndex];
				if (focusedItem != null && !focusedItem.branch) {
					if (e.shiftKey) {
						this._selection.selectRange(focusedItem.path);
					} else if (!e.ctrlKey && !e.metaKey) {
						this._selection.setSingle(focusedItem.path);
					}
					// Ctrl/Cmd+Arrow moves focus without changing the selection.
				}
			}
			return true;
		}

		// Type-ahead for printable characters — ignore Ctrl/Cmd/Alt combos so native shortcuts
		// (copy/paste, select-all, etc.) aren't swallowed while the tree has focus.
		if (!e.ctrlKey && !e.metaKey && !e.altKey && this.isPrintableCharacter(e.key)) {
			this.handleTypeAhead(e.key);
			return true;
		}

		return false;
	}

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
		this._scroll.scrollToIndex(index, { restoreFocus: shouldRestoreFocus });
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
		this._index.rebuild();
		this.pruneSelection();
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
		const value = (e.target as HTMLInputElement).value;
		this.dispatchEvent(new CustomEvent('gl-tree-filter-changed', { detail: value, bubbles: true, composed: true }));
		this._filter.setQuery(value, { debounce: true });
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

	private toggleSearchBoxFilter = () => {
		this.searchBoxFilter = !this.searchBoxFilter;
		this.dispatchEvent(
			new CustomEvent<boolean>('gl-tree-search-box-filter-changed', {
				detail: this.searchBoxFilter,
				bubbles: true,
				composed: true,
			}),
		);
		if (this.filtered) {
			this.rebuildFlattenedTree();
		}
	};
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
		'gl-tree-generated-selection-changed': CustomEvent<TreeSelectionChangedDetail>;
		'gl-tree-expansion-changed': CustomEvent<{ path: string; expanded: boolean }>;
	}
}
