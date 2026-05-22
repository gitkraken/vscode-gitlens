import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { ref } from 'lit/directives/ref.js';
import { cspStyleMap } from './csp-style-map.directive.js';
import { focusableBaseStyles, srOnlyStyles } from './styles/lit/a11y.css.js';
import './code-icon.js';
import './overlays/popover.js';
import './overlays/tooltip.js';

export type BreadcrumbAppearance = 'default' | 'segment' | 'ellipsis';
export type BreadcrumbCollapse = 'outer-in' | 'shrink' | 'none';
export type BreadcrumbDensity = 'normal' | 'compact';

@customElement('gl-breadcrumbs')
export class GlBreadcrumbs extends LitElement {
	static override styles = css`
		* {
			box-sizing: border-box;
		}

		:host {
			display: flex;
			flex-direction: row;
			flex-wrap: nowrap;
			align-items: center;
			gap: 0;
			overflow: hidden;
			/* Use VS Code's default font-size by default; density="compact" shrinks it. */
			font-size: var(--vscode-font-size);
			line-height: 1.4;
			color: var(--vscode-descriptionForeground);
			width: 100%;

			--gl-breadcrumb-separator-content: '\\eab6'; /* chevron-right codicon */
			--gl-breadcrumb-separator-font: codicon;
			--gl-breadcrumb-separator-size: 1.1rem;
		}

		:host([density='compact']) {
			font-size: 1.2rem;
		}

		nav {
			display: contents;
		}

		ol {
			display: contents;
			list-style: none;
			margin: 0;
			padding: 0;
		}

		.overflow-wrapper {
			display: flex;
			align-items: center;
			min-width: 0;
			flex-shrink: 0;
		}

		.overflow-menu {
			display: flex;
			flex-direction: column;
			min-width: 16rem;
			max-width: 32rem;
			padding: 0.4rem 0.2rem;
			gap: 0.1rem;
		}

		/* Style the cloned tooltip content from each menu row's tooltip — the source
		   markup is text + hr + path, and the default browser hr style looks wrong
		   in our dark tooltip body. */
		.overflow-menu gl-tooltip hr {
			border: none;
			border-top: 1px solid var(--color-foreground--25);
			margin: 0.4rem 0;
		}

		/* Bump tooltip z-index above the popover menu's own stacking context so
		   menu-row tooltips don't get clipped behind webview content. */
		.overflow-menu gl-tooltip {
			--wa-z-index-tooltip: 9999;
		}

		.overflow-menu-item {
			display: flex;
			flex-direction: row;
			align-items: center;
			gap: 0.6rem;
			padding: 0.4rem 0.8rem;
			background: none;
			border: none;
			border-radius: 0.3rem;
			color: var(--vscode-foreground);
			font: inherit;
			text-align: start;
			cursor: pointer;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.overflow-menu-item:hover,
		.overflow-menu-item:focus-visible {
			background: var(--vscode-list-hoverBackground);
			outline: none;
		}

		.overflow-menu-item-label {
			overflow: hidden;
			text-overflow: ellipsis;
			min-width: 0;
		}
	`;

	@property() label: string = 'Breadcrumb';

	@property({ reflect: true })
	collapse: BreadcrumbCollapse = 'outer-in';

	/**
	 * Visual density of the breadcrumb chain. `compact` shrinks icons, font-size, and
	 * slotted button heights for narrow contexts (e.g. Timeline editor header). The
	 * attribute is propagated to each gl-breadcrumb-item child via `slotchange`.
	 *
	 * Note: a few styles (the inner gl-button's --button-padding/--button-line-height)
	 * can't be reached from this component's shadow scope. Consumers using
	 * density="compact" should also include `compactBreadcrumbsConsumerStyles` in
	 * their `static styles` so those overrides take effect.
	 */
	@property({ reflect: true })
	density: BreadcrumbDensity = 'normal';

	@query('slot') private defaultSlot!: HTMLSlotElement;

	@state() private _items: GlBreadcrumbItem[] = [];
	@state() private _hiddenIndices: Set<number> = new Set();

	private resizeObserver?: ResizeObserver;
	private rafId?: number;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.resizeObserver = new ResizeObserver(() => this.scheduleRecompute());
		this.resizeObserver.observe(this);
	}

	override disconnectedCallback(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		if (this.rafId != null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = undefined;
		}
		super.disconnectedCallback?.();
	}

	override updated(changed: Map<string, unknown>): void {
		if (changed.has('collapse')) {
			this.scheduleRecompute();
		}
		if (changed.has('density')) {
			this.applyDensityToItems();
		}
	}

	private applyDensityToItems(): void {
		for (const item of this._items) {
			item.setAttribute('density', this.density);
		}
	}

	private handleSlotChange = (): void => {
		const items = this.defaultSlot
			.assignedElements({ flatten: true })
			.filter((el): el is GlBreadcrumbItem => el.tagName.toLowerCase() === 'gl-breadcrumb-item');

		// Pre-compute effective priorities so we can identify the highest tier. When the outer-in
		// collapse algorithm can run, items in the highest tier keep their per-item flex-shrink
		// (so the file/leaf can ellipsize as a last resort), while everyone else gets flex-shrink: 0
		// so the host actually overflows (rather than items shrinking to fit, which would defeat the
		// overflow detection). With <= 2 items, outer-in compaction is disabled, so keep per-item
		// shrink behavior for all crumbs.
		const priorities: number[] = [];
		this._items = items;
		items.forEach((item, idx) => {
			priorities[idx] = this.getEffectivePriority(item, idx);
		});
		const maxPriority = priorities.length > 0 ? Math.max(...priorities) : 0;
		const canOuterInCollapse = this.collapse === 'outer-in' && items.length > 2;

		items.forEach((item, idx) => {
			if (idx === items.length - 1) {
				item.setAttribute('aria-current', 'page');
			} else {
				item.removeAttribute('aria-current');
			}
			// flex order: items at even orders, overflow indicators slot in at odd orders
			// based on the run's first hidden index — see renderOverflowIndicator.
			item.style.order = String(idx * 2);
			if (canOuterInCollapse && priorities[idx] !== maxPriority) {
				item.style.flexShrink = '0';
			} else {
				item.style.flexShrink = '';
			}
			item.setAttribute('density', this.density);
		});

		this.scheduleRecompute();
	};

	private scheduleRecompute(): void {
		if (this.rafId != null) return;

		this.rafId = requestAnimationFrame(() => {
			this.rafId = undefined;
			void this.recompute();
		});
	}

	private async recompute(): Promise<void> {
		if (this.collapse !== 'outer-in' || this._items.length <= 2) {
			// Clear any prior compact/hidden state if recompute disabled or chain too short.
			if (this._items.some(it => it.hasAttribute('compact') || it.hasAttribute('hidden'))) {
				this.applyState(new Set(), new Set());
			}
			return;
		}

		// Reset all state to measure natural width, then progressively collapse priority tiers.
		// For each item we'd otherwise hide:
		//   - has icon → mark `compact` (label hidden, icon stays in place; click still navigates)
		//   - no icon → mark `hidden` (fully removed; represented by a `...` indicator at its run)
		// We await `updateComplete` after each step so any newly-rendered indicators are in the DOM
		// before we re-measure.
		this.applyState(new Set(), new Set());
		await this.updateComplete;
		void this.offsetHeight;

		if (this.scrollWidth <= this.clientWidth + 1) return;

		const tiers = this.getPriorityTiers();
		if (tiers.length <= 1) return;

		const compact = new Set<number>();
		const hidden = new Set<number>();
		for (let t = 0; t < tiers.length - 1; t++) {
			for (const idx of tiers[t]) {
				const item = this._items[idx];
				if (item.icon) {
					compact.add(idx);
				} else {
					hidden.add(idx);
				}
			}
			this.absorbFoldTargets(compact, hidden);
			this.applyState(compact, hidden);
			await this.updateComplete;
			void this.offsetHeight;
			if (this.scrollWidth <= this.clientWidth + 1) return;
		}
	}

	/**
	 * If a `foldable` compact item is immediately followed by a hidden item, fold it into the run:
	 * it stops being shown as a standalone compact icon and instead lends its icon to the run's
	 * popover trigger. This collapses chains like `[folder-icon] [...]` into a single trigger
	 * `[folder-icon-as-popover]`.
	 */
	private absorbFoldTargets(compact: Set<number>, hidden: Set<number>): void {
		// Snapshot compact state before mutating — otherwise consecutive foldables would chain-absorb.
		const initiallyCompact = new Set(compact);
		for (const idx of initiallyCompact) {
			if (idx >= this._items.length - 1) continue;
			if (!hidden.has(idx + 1)) continue;

			const item = this._items[idx];
			if (!item.foldable || !item.icon) continue;

			compact.delete(idx);
			hidden.add(idx);
		}
	}

	private getPriorityTiers(): number[][] {
		// Group item indices by effective priority (ascending).
		const groups = new Map<number, number[]>();
		this._items.forEach((item, idx) => {
			const p = this.getEffectivePriority(item, idx);
			if (!groups.has(p)) {
				groups.set(p, []);
			}
			groups.get(p)!.push(idx);
		});
		return [...groups.entries()].sort(([a], [b]) => a - b).map(([, indices]) => indices);
	}

	private getEffectivePriority(item: GlBreadcrumbItem, idx: number): number {
		if (item.priority != null) return item.priority;
		// Default: edges (first and last) keep their place; middle items hide first.
		if (idx === 0 || idx === this._items.length - 1) return 1;
		return 0;
	}

	private applyState(compact: Set<number>, hidden: Set<number>): void {
		this._items.forEach((item, idx) => {
			if (hidden.has(idx)) {
				item.setAttribute('hidden', '');
				item.removeAttribute('compact');
			} else if (compact.has(idx)) {
				item.setAttribute('compact', '');
				item.removeAttribute('hidden');
			} else {
				item.removeAttribute('hidden');
				item.removeAttribute('compact');
			}
		});
		// Fresh Set instance so Lit's identity-based change detection re-renders the overflow
		// indicators. Compact items don't drive rendering so their state lives only on attributes.
		this._hiddenIndices = new Set(hidden);
	}

	private getHiddenRuns(): { startIdx: number; items: GlBreadcrumbItem[] }[] {
		const runs: { startIdx: number; items: GlBreadcrumbItem[] }[] = [];
		let currentRun: { startIdx: number; items: GlBreadcrumbItem[] } | null = null;
		this._items.forEach((item, idx) => {
			if (this._hiddenIndices.has(idx)) {
				if (currentRun == null) {
					currentRun = { startIdx: idx, items: [] };
					runs.push(currentRun);
				}
				currentRun.items.push(item);
			} else {
				currentRun = null;
			}
		});
		return runs;
	}

	override render(): unknown {
		const runs = this.getHiddenRuns();
		return html`<nav part="base" aria-label=${this.label}>
			<ol>
				<slot @slotchange=${this.handleSlotChange}></slot>
				${runs.map(run => this.renderOverflowIndicator(run))}
			</ol>
		</nav>`;
	}

	private renderOverflowIndicator(run: { startIdx: number; items: GlBreadcrumbItem[] }) {
		// Position the indicator at an odd flex `order` between the previous visible item
		// (order = (startIdx - 1) * 2) and the run's would-be slot (order = startIdx * 2).
		// Applied via `cspStyleMap` (CSSOM) — the webview CSP forbids inline `style="…"` attributes.
		const order = run.startIdx * 2 - 1;
		// If the run starts with a folded fold-target, its icon becomes the popover trigger
		// instead of the default `…` glyph.
		const first = run.items[0];
		const foldedIcon = first?.foldable && first.icon ? first.icon : undefined;
		return html`<span class="overflow-wrapper" style=${cspStyleMap({ order: String(order) })}>
			<gl-popover appearance="menu" trigger="click focus" placement="bottom-start" .arrow=${false} distance="0">
				<gl-breadcrumb-item
					slot="anchor"
					appearance="ellipsis"
					interactive
					icon=${ifDefined(foldedIcon)}
				></gl-breadcrumb-item>
				<div slot="content" class="overflow-menu">
					${run.items.map(item => this.renderHiddenItemMenu(item))}
				</div>
			</gl-popover>
		</span>`;
	}

	private renderHiddenItemMenu(item: GlBreadcrumbItem) {
		// Prefer the explicit `label` property when provided — labelText collects everything
		// in the default slot, which can include text from complex widgets and tooltip siblings.
		const text = item.label || item.labelText || 'breadcrumb';
		// Segment items don't carry an `icon` attribute (the visible chain skips the icon for
		// visual lightness), but they still represent folders — show the folder glyph in the menu.
		const icon = item.icon || (item.appearance === 'segment' ? 'folder' : undefined);
		// Clone the original item's `slot="tooltip"` content (if any) into this menu row's tooltip
		// so the popover entries surface the same context the visible crumbs would on hover.
		const tooltipSource = item.tooltipNode;
		const button = html`<button class="overflow-menu-item" type="button" @click=${() => item.click()}>
			${icon ? html`<code-icon icon=${icon}></code-icon>` : nothing}
			<span class="overflow-menu-item-label">${text}</span>
		</button>`;

		if (tooltipSource == null) return button;

		return html`<gl-tooltip placement="right" distance="8">
			${button}
			<span
				slot="content"
				${ref(el => {
					if (el instanceof HTMLElement) {
						el.replaceChildren(tooltipSource.cloneNode(true));
					}
				})}
			></span>
		</gl-tooltip>`;
	}
}

@customElement('gl-breadcrumb-item')
export class GlBreadcrumbItem extends LitElement {
	static override styles = [
		focusableBaseStyles,
		css`
			* {
				box-sizing: border-box;
			}

			:host {
				display: flex;
				flex-direction: row;
				align-items: center;
				white-space: nowrap;
				overflow: hidden;
				min-width: 0;
				flex-shrink: var(--gl-breadcrumb-item-shrink, 1);
				color: var(--vscode-descriptionForeground);
				/* Defensive — section headings (e.g. Home) apply uppercase to their
				   contents; reset here so crumbs always render in natural casing. */
				text-transform: none;
			}

			/* density="compact" — set on the host by gl-breadcrumbs (propagated to each
			   child on slotchange / density change). Shrinks icons and caps slotted
			   toolbar widget heights so the row stays tight. The inner gl-button's
			   --button-padding/--button-line-height live in compactBreadcrumbsConsumerStyles
			   (must be in consumer scope to cross the shadow boundary). */
			:host([has-widget]) .breadcrumb-label {
				overflow: visible;
			}
			:host([has-widget]) .separator {
				margin-left: 0;
			}

			:host([density='compact']) {
				--code-icon-size: 1.3rem;
				--gl-file-icon-size: 1.3rem;
			}

			:host([density='compact']) ::slotted(gl-ref-button),
			:host([density='compact']) ::slotted(gl-repo-button-group) {
				max-height: 1.6rem;
			}

			:host([icon]) {
				min-width: calc(1.3rem + 0.6rem);
			}

			:host([hidden]) {
				display: none;
			}

			:host(:hover),
			:host(:focus-within) {
				flex-shrink: 0;
			}

			:host([aria-current='page']) {
				color: var(--vscode-foreground);
				font-weight: 600;
			}

			:host([appearance='segment']) {
				min-width: 0;
			}

			:host([appearance='ellipsis']) {
				min-width: 0;
				flex-shrink: 0;
				user-select: none;
			}

			.breadcrumb-item {
				display: flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4rem;
				white-space: nowrap;
				overflow: hidden;
				min-width: 0;
				width: 100%;
				/* Horizontal padding matches HALF the inside gap so that the visual
				   space between elements is uniform — inside a crumb, gap supplies
				   0.4rem between content and chevron; across crumbs, this item's
				   padding-right (0.2rem) plus the next item's padding-left (0.2rem)
				   sums to the same 0.4rem. */
				padding: 0.1rem 0.2rem;
				/* Fixed min-height keeps every crumb the same height regardless of
				   slotted content size or collapsed state — without this, a collapsed
				   icon-only crumb is shorter than a text crumb. */
				min-height: 1.8rem;
				border-radius: 0.3rem;
				cursor: default;
				background: none;
				border: none;
				color: inherit;
				font: inherit;
				text-align: start;
			}

			button.breadcrumb-item {
				cursor: pointer;
			}

			button.breadcrumb-item:focus {
				outline: none;
			}

			:host(:hover) .breadcrumb-item,
			:host(:focus-within) .breadcrumb-item {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
			}

			.icon {
				flex-shrink: 0;
				z-index: 2;
			}

			.breadcrumb-label {
				display: inline-block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
				min-width: 0;
				max-width: 100%;
				/* Generous line-height (1.4 ratio) ensures the label's line-box accommodates
				   both descenders for plain-text crumbs AND the natural height of slotted
				   gl-button widgets (gl-ref-button, gl-repo-button-group) without clipping
				   them at overflow: hidden. With symmetric leading, the text x-height visual
				   center sits at the line-box geometric center, aligning with centered icons
				   under align-items: center. */
				line-height: 1.4;
				padding: 0;
			}

			/* Use :host(:hover) instead of .breadcrumb-item:hover so hovering anywhere on the
			   host (not just the inner button) reveals the label when [compact] is auto-set
			   by the breadcrumbs host on overflow. */
			:host([compact]:not(:hover):not(:focus-within)) .breadcrumb-label,
			:host([appearance='ellipsis'][icon]:not(:hover):not(:focus-within)) .breadcrumb-label {
				max-width: 0;
				padding: 0;
				margin: 0;
			}

			.separator {
				display: inline-flex;
				flex-shrink: 0;
				align-items: center;
				justify-content: center;
				margin-left: -0.2rem;
				width: var(--gl-breadcrumb-separator-size, 1rem);
				height: var(--gl-breadcrumb-separator-size, 1rem);
				/* No additional margin — let the breadcrumb-item's gap supply the spacing
				   on both sides (gap before the separator + the next item's padding-left
				   after). Keeps spacing uniform throughout the chain. */
				color: var(--vscode-descriptionForeground);
				opacity: 0.5;
				user-select: none;
				-webkit-user-select: none;
				transition:
					opacity 120ms ease,
					color 120ms ease;
			}

			.separator::before {
				content: var(--gl-breadcrumb-separator-content, '\\eab6');
				font-family: var(--gl-breadcrumb-separator-font, codicon);
				font-size: var(--gl-breadcrumb-separator-size, 1rem);
				line-height: 1;
			}

			:host(:hover) .separator,
			:host(:focus-within) .separator {
				opacity: 1;
				color: var(--vscode-foreground);
			}

			:host([aria-current='page']) .separator {
				display: none;
			}

			.sr-only {
				${srOnlyStyles}
			}
		`,
	];

	@property({ reflect: true })
	appearance: BreadcrumbAppearance = 'default';

	@property({ type: Boolean, reflect: true })
	interactive: boolean = false;

	/**
	 * Marks this item as a fold target. When the item is in compact state and is immediately
	 * followed by a hidden run, the run is "folded" into this item: this item is hidden visually,
	 * its icon becomes the popover trigger for the run, and its label appears in the popover
	 * alongside the run's items. Useful for path-style chains where a folder icon should serve
	 * as the entry point to the hidden sub-folders.
	 */
	@property({ type: Boolean, reflect: true })
	foldable: boolean = false;

	/**
	 * Collapse priority — items with the lowest priority hide first when the breadcrumb overflows.
	 * The highest-priority tier never hides. Items at the same priority hide together as a group.
	 *
	 * If unset, default behavior is "first/last visible, middle hides" (effective priority of 1 for
	 * edges, 0 for middle items).
	 */
	@property({ type: Number, reflect: true })
	priority?: number;

	@property()
	icon?: string;

	/**
	 * Explicit label text used by the parent host when rendering this item in the overflow popover.
	 * Falls back to `labelText` (default-slot text) which can be unreliable when the slotted content
	 * is a complex widget (e.g. `gl-repo-button-group`) that renders its name in its own shadow DOM
	 * or contains a `slot="tooltip"` sibling whose text would pollute the label.
	 */
	@property()
	label?: string;

	private _shrink: number = 1;
	get shrink(): number {
		return this._shrink;
	}
	@property({ type: Number })
	set shrink(value: number) {
		const oldValue = this._shrink;
		this._shrink = value;
		this.style.setProperty('--gl-breadcrumb-item-shrink', String(value));
		this.requestUpdate('shrink', oldValue);
	}

	@state() private _truncated: boolean = false;
	@state() private _hasTooltipSlot: boolean = false;
	@state() private _labelText: string = '';

	get labelText(): string {
		return this._labelText;
	}

	/** The light-DOM child assigned to `slot="tooltip"`, if any. Used by the parent host to clone tooltip content into popover menu items. */
	get tooltipNode(): HTMLElement | null {
		return this.querySelector<HTMLElement>(':scope > [slot="tooltip"]');
	}

	@query('.breadcrumb-label') private labelEl?: HTMLElement;

	private resizeObserver?: ResizeObserver;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this.setAttribute('role', 'listitem');
	}

	override disconnectedCallback(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		super.disconnectedCallback?.();
	}

	override firstUpdated(): void {
		if (this.labelEl) {
			this.resizeObserver = new ResizeObserver(() => this.updateTruncated());
			this.resizeObserver.observe(this.labelEl);
			this.updateTruncated();
		}
	}

	private updateTruncated(): void {
		const el = this.labelEl;
		if (!el) return;

		this._truncated = el.scrollWidth > el.clientWidth;
	}

	private onLabelSlotChange = (e: Event): void => {
		const slot = e.target as HTMLSlotElement;
		const nodes = slot.assignedNodes({ flatten: true });
		this._labelText = nodes
			.map(n => n.textContent ?? '')
			.join('')
			.trim();

		const hasWidget = nodes.some(n => {
			if (n.nodeType !== Node.ELEMENT_NODE) return false;

			const tag = (n as Element).tagName.toLowerCase();
			return tag === 'gl-repo-button-group' || tag === 'gl-ref-button';
		});
		if (hasWidget) {
			this.setAttribute('has-widget', '');
		} else {
			this.removeAttribute('has-widget');
		}

		this.updateTruncated();
	};

	private onTooltipSlotChange = (e: Event): void => {
		const slot = e.target as HTMLSlotElement;
		this._hasTooltipSlot = slot.assignedNodes({ flatten: true }).some(n => {
			if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').trim().length > 0;
			return true;
		});
	};

	override render(): unknown {
		const { _truncated, _hasTooltipSlot, _labelText, interactive } = this;
		const tooltipEnabled = _hasTooltipSlot || _truncated;
		const showFallbackLabel = !_hasTooltipSlot && _truncated;

		if (this.appearance === 'ellipsis') {
			// When a fold-target's icon is provided, render `[icon] [hover-revealed …]`.
			// Otherwise just render `…`. Always include the trailing separator chevron.
			const ellipsisInner = this.icon
				? html`<code-icon class="icon" icon=${this.icon}></code-icon>
						<span class="breadcrumb-label" aria-hidden="true">…</span>
						<span class="sr-only">Show hidden breadcrumbs</span>`
				: html`<span class="breadcrumb-label" aria-hidden="true">…</span>
						<span class="sr-only">Show hidden breadcrumbs</span>`;
			const trailingSeparator = html`<span class="separator" aria-hidden="true"></span>`;
			if (interactive) {
				return html`<button class="breadcrumb-item" type="button">
					${ellipsisInner}${trailingSeparator}
				</button>`;
			}
			return html`<span class="breadcrumb-item">${ellipsisInner}${trailingSeparator}</span>`;
		}

		const inner = html`${this.icon ? html`<code-icon class="icon" icon=${this.icon}></code-icon>` : nothing}
			<slot name="start"></slot>
			<gl-tooltip class="breadcrumb-tooltip" ?disabled=${!tooltipEnabled} placement="bottom" distance="6">
				<span class="breadcrumb-label" aria-label=${_truncated ? _labelText : nothing}>
					<slot @slotchange=${this.onLabelSlotChange}></slot>
				</span>
				<span slot="content">
					<slot name="tooltip" @slotchange=${this.onTooltipSlotChange}></slot>
					${showFallbackLabel ? _labelText : nothing}
				</span>
			</gl-tooltip>
			<slot name="end"><span class="separator" aria-hidden="true"></span></slot> `;

		if (interactive) {
			return html`<button class="breadcrumb-item" type="button">${inner}</button>`;
		}

		return html`<span class="breadcrumb-item"> ${inner} </span>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-breadcrumbs': GlBreadcrumbs;
		'gl-breadcrumb-item': GlBreadcrumbItem;
	}
}

/**
 * Consumer-side compact styles for gl-breadcrumbs. Add to the `static styles` array of
 * any component that hosts a `<gl-breadcrumbs density="compact">` containing slotted
 * gl-ref-button or gl-repo-button-group widgets.
 *
 * Why this can't live in breadcrumbs.ts shadow: gl-button declares --button-padding and
 * --button-line-height defaults on its own :host, which beat any value inherited from
 * outside its host. The only way to override those defaults is a direct declaration on
 * the gl-button element via ::part() — and ::part() must be authored from a CSS scope
 * where the slotted gl-ref-button / gl-repo-button-group is in light DOM (i.e. the
 * consumer's shadow root, not the breadcrumb-item's). Hence: a string we ship for
 * consumers to install.
 */
export const compactBreadcrumbsConsumerStyles = css`
	gl-breadcrumbs[density='compact'] gl-breadcrumb-item gl-ref-button::part(button),
	gl-breadcrumbs[density='compact'] gl-breadcrumb-item gl-repo-button-group::part(provider-icon),
	gl-breadcrumbs[density='compact'] gl-breadcrumb-item gl-repo-button-group::part(label) {
		--button-padding: 0 0.3rem;
		--button-line-height: 1.2;
		border: 0;
	}
`;
