import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { scrollableBase } from '../styles/lit/base.css.js';
import '../overlays/popover.js';
import '../code-icon.js';

@customElement('gl-chip-overflow')
export class GlChipOverflow extends LitElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: contents;
			}

			/* Multi-row layout (maxRows > 1): block layout (display:flow-root) lets the suffix float
		   to the top-right while inline chips flow around it. Row 1 chips share the line with the
		   suffix; subsequent rows reclaim full width once they pass the suffix's bottom edge.
		   Pure CSS, no JS measure for the float positioning itself. */
			.container {
				display: flow-root;
				flex: 1 1 auto;
				min-width: 0;
				/* Negative bottom-margin trims the last row's gap so the container hugs its content. */
				margin-bottom: calc(-1 * var(--gl-chip-overflow-gap, 0.5rem));
			}

			/* Single-row layout (maxRows === 1): flex puts chips, "+N", and suffix on one line with
		   the suffix pushed right via auto-margin. No float — so the "+N" never wraps off-line
		   the way it can with floated suffix on row 1, where chips fill up to the suffix's left
		   edge and any inline content past that point gets pushed to row 2. */
			.container.is-single-row {
				display: flex;
				align-items: center;
				flex-wrap: nowrap;
				min-width: 0;
				margin-bottom: 0;
			}

			::slotted([data-overflow-hidden]) {
				display: none !important;
			}

			/* Chip-layout styles must only target the DEFAULT slot's content (the actual chips) —
		   not the named "suffix"/"prefix"/"popover" slots, whose content (e.g. the popover's
		   <div slot="popover"> wrapper) would otherwise inherit 'display: inline-flex' and lay
		   its own children horizontally. */
			::slotted(:not([slot])) {
				display: inline-flex;
				vertical-align: middle;
				margin-inline-end: var(--gl-chip-overflow-gap, 0.5rem);
				margin-block-end: var(--gl-chip-overflow-gap, 0.5rem);
			}

			.container.is-single-row ::slotted(:not([slot])) {
				flex-shrink: 0;
				margin-block-end: 0;
			}

			.overflow-chip {
				display: inline-flex;
				justify-content: center;
				align-items: center;
				height: 2rem;
				padding: 0.2rem 0.4rem;
				border-radius: 0.5rem;
				border: none;
				background: none;
				color: inherit;
				font: inherit;
				white-space: nowrap;
				cursor: pointer;
				opacity: 0.65;
				transition: opacity 0.15s ease;
				margin-inline-end: var(--gl-chip-overflow-gap, 0.5rem);
				margin-block-end: var(--gl-chip-overflow-gap, 0.5rem);
				vertical-align: middle;
			}

			.overflow-chip:hover,
			.overflow-chip:focus-visible {
				opacity: 1;
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			.overflow-chip:active {
				background-color: var(--vscode-toolbar-activeBackground);
			}

			.overflow-chip:focus-visible {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 1px;
			}

			.prefix {
				display: inline-flex;
				align-items: center;
				vertical-align: middle;
				margin-inline-end: var(--gl-chip-overflow-gap, 0.5rem);
				margin-block-end: var(--gl-chip-overflow-gap, 0.5rem);
			}

			/* Floated to the top-right so chips flow around it on the first row, then wrap
		   beneath once they exceed the suffix's bottom edge (multi-row mode). */
			.suffix {
				float: right;
				display: inline-flex;
				align-items: center;
				height: var(--gl-chip-overflow-row-height, 2rem);
				gap: var(--gl-chip-overflow-gap, 0.5rem);
				margin-inline-start: var(--gl-chip-overflow-gap, 0.5rem);
				margin-block-end: var(--gl-chip-overflow-gap, 0.5rem);
			}

			/* Single-row: drop float, push to end of the line via auto margin, drop block-end gap. */
			.container.is-single-row .suffix {
				float: none;
				order: 3;
				margin-inline-start: auto;
				margin-block-end: 0;
			}

			.container.is-single-row .prefix {
				order: 0;
				margin-block-end: 0;
			}

			/* Wraps the gl-popover so we can give the +N a flex order distinct from the chips and
		   suffix. gl-popover itself is display:contents so it'd otherwise inherit no order. */
			.overflow-host {
				display: inline-flex;
				vertical-align: middle;
			}

			.container.is-single-row .overflow-host {
				order: 2;
				flex-shrink: 0;
			}

			.container.is-single-row .overflow-chip {
				margin-inline-end: 0;
				margin-block-end: 0;
			}

			/* When prefix/suffix slots have no assigned content, drop them out of layout entirely
		   so the container gap does not leave a phantom inset before the first chip (or
		   after the last). The empty-state class is set by handleSlotChange. */
			.prefix.is-empty,
			.suffix.is-empty {
				display: none;
			}

			.overflow-popover {
				max-height: 300px;
				max-width: 400px;
				overflow-y: auto;
			}
		`,
	];

	@property({ type: Number, attribute: 'max-rows' })
	maxRows: number = 1;

	@state()
	private _overflowCount: number = 0;

	@state()
	private _prefixEmpty: boolean = true;

	@state()
	private _suffixEmpty: boolean = true;

	@query('.container')
	private containerEl!: HTMLDivElement;

	@query('slot:not([name])')
	private defaultSlot!: HTMLSlotElement;

	private _resizeObserver: ResizeObserver | undefined;
	private _measurePending = false;
	private _measuring = false;
	private _lastVisibleCount = -1;

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
	}

	override firstUpdated(): void {
		if (this.containerEl != null) {
			this._resizeObserver?.observe(this.containerEl);
		}
		this.scheduleMeasure();
	}

	override updated(changedProperties: Map<PropertyKey, unknown>): void {
		if (changedProperties.has('maxRows')) {
			this._lastVisibleCount = -1;
			this.scheduleMeasure();
		}
	}

	override render() {
		const isSingleRow = this.maxRows === 1;
		// Multi-row: floated suffix MUST come first in DOM so subsequent inline content wraps
		// around it (visual order unchanged because float:right pulls it to the top-right).
		// Single-row: DOM order matches the desired visual order via flex `order` properties.
		return html`<div class="container ${isSingleRow ? 'is-single-row' : ''}" part="container">
			<span class="suffix ${this._suffixEmpty ? 'is-empty' : ''}"
				><slot name="suffix" @slotchange=${this.handleNamedSlotChange}></slot></span
			><span class="prefix ${this._prefixEmpty ? 'is-empty' : ''}"
				><slot name="prefix" @slotchange=${this.handleNamedSlotChange}></slot></span
			><slot @slotchange=${this.handleSlotChange}></slot>${this._overflowCount > 0
				? html`<span class="overflow-host"
						><gl-popover hoist trigger="click" placement="bottom-start" appearance="menu">
							<button
								slot="anchor"
								class="overflow-chip"
								part="overflow-chip"
								aria-label="${this._overflowCount} more items"
							>
								+${this._overflowCount}
							</button>
							<div slot="content" class="overflow-popover scrollable" part="popover">
								<slot name="popover"></slot>
							</div> </gl-popover
					></span>`
				: nothing}
		</div>`;
	}

	private handleNamedSlotChange = (e: Event): void => {
		const slot = e.target as HTMLSlotElement;
		const isEmpty = slot.assignedNodes({ flatten: true }).every(n => {
			// Treat whitespace-only text nodes as empty too — Lit can emit those between bindings.
			return n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length === 0;
		});
		if (slot.name === 'prefix') {
			this._prefixEmpty = isEmpty;
		} else if (slot.name === 'suffix') {
			this._suffixEmpty = isEmpty;
		}
	};

	private handleSlotChange(): void {
		this._lastVisibleCount = -1;
		this.scheduleMeasure();
	}

	private scheduleMeasure(): void {
		if (this._measurePending || this._measuring) return;
		this._measurePending = true;
		requestAnimationFrame(() => {
			this._measurePending = false;
			this.measureOverflow();
		});
	}

	private measureOverflow(): void {
		if (this._measuring) return;
		this._measuring = true;

		try {
			const container = this.containerEl;
			if (container == null) return;

			const slot = this.defaultSlot;
			if (slot == null) return;

			const children = slot.assignedElements({ flatten: true }) as HTMLElement[];
			if (children.length === 0) {
				this._lastVisibleCount = 0;
				if (this._overflowCount !== 0) {
					this._overflowCount = 0;
				}
				return;
			}

			// Reset all children to visible for accurate measurement
			for (const child of children) {
				child.removeAttribute('data-overflow-hidden');
			}

			const result =
				this.maxRows === 1
					? this.measureSingleRow(container, children)
					: this.measureFloat(container, children);
			if (result == null) return;
			let { visibleCount, overflowCount } = result;

			// Ensure at least 1 child visible if there are any
			if (visibleCount === 0 && children.length > 0) {
				visibleCount = 1;
				overflowCount = children.length - 1;
			}

			// Skip DOM writes if result hasn't changed
			if (visibleCount === this._lastVisibleCount) return;
			this._lastVisibleCount = visibleCount;

			// Hide overflow children
			for (let i = visibleCount; i < children.length; i++) {
				children[i].setAttribute('data-overflow-hidden', '');
			}

			if (this._overflowCount !== overflowCount) {
				this._overflowCount = overflowCount;
			}
		} finally {
			// Delay clearing the guard to absorb ResizeObserver callbacks
			// triggered by our own DOM changes
			requestAnimationFrame(() => {
				this._measuring = false;
			});
		}
	}

	/** Single-row (flex) measure: pure width math against the available inline space, with
	 *  prefix/suffix/"+N" widths reserved upfront so the visible chip count is correct on the
	 *  first measure pass and doesn't need a second-pass refinement. */
	private measureSingleRow(
		container: HTMLDivElement,
		children: HTMLElement[],
	): { visibleCount: number; overflowCount: number } | undefined {
		const firstChild = children[0];
		if (firstChild.offsetHeight === 0) return undefined;

		const containerStyle = getComputedStyle(container);
		const containerWidth =
			container.clientWidth -
			(parseFloat(containerStyle.paddingLeft) || 0) -
			(parseFloat(containerStyle.paddingRight) || 0);

		const measureChromeWidth = (selector: string): number => {
			const el = this.shadowRoot?.querySelector(selector) as HTMLElement | null;
			if (el == null || el.offsetWidth === 0) return 0;
			const style = getComputedStyle(el);
			return (
				el.offsetWidth + (parseFloat(style.marginInlineStart) || 0) + (parseFloat(style.marginInlineEnd) || 0)
			);
		};

		const prefixWidth = measureChromeWidth('.prefix');
		const suffixWidth = measureChromeWidth('.suffix');

		// Inter-chip spacing comes from each chip's margin-inline-end (not container gap).
		const chipMargin = parseFloat(getComputedStyle(firstChild).marginInlineEnd) || 0;

		// Sum all chip widths (with the trailing margin on each — that's the inline space they
		// actually consume).
		let totalChipsWidth = 0;
		for (const child of children) {
			totalChipsWidth += child.offsetWidth + chipMargin;
		}

		const availableForChips = containerWidth - prefixWidth - suffixWidth;
		// All chips fit alongside prefix + suffix → no overflow needed.
		if (totalChipsWidth <= availableForChips) {
			return { visibleCount: children.length, overflowCount: 0 };
		}

		// Overflow needed — reserve "+N" width too. Use the rendered chip if present; otherwise
		// estimate generously (40px is comfortable for "+99").
		const overflowChip = this.shadowRoot?.querySelector('.overflow-chip') as HTMLElement | null;
		const overflowChipWidth = overflowChip != null && overflowChip.offsetWidth > 0 ? overflowChip.offsetWidth : 40;
		const availableForChipsWithOverflow = availableForChips - overflowChipWidth;

		let usedWidth = 0;
		let visibleCount = 0;
		for (const child of children) {
			const w = child.offsetWidth + chipMargin;
			if (usedWidth + w > availableForChipsWithOverflow) break;
			usedWidth += w;
			visibleCount++;
		}

		return { visibleCount: visibleCount, overflowCount: children.length - visibleCount };
	}

	/** Multi-row (float) measure: row-position-based detection. Counts chips that fit within
	 *  `maxRows` rows, then trims one more if the "+N" chip would land past the floated suffix
	 *  on row 1 (where the inline space is `containerWidth - suffixWidth`, not `containerWidth`). */
	private measureFloat(
		container: HTMLDivElement,
		children: HTMLElement[],
	): { visibleCount: number; overflowCount: number } | undefined {
		// Get row height from the first child
		const firstChild = children[0];
		const rowHeight = firstChild.offsetHeight;
		if (rowHeight === 0) return undefined;

		const containerStyle = getComputedStyle(container);
		const gap = parseFloat(containerStyle.rowGap) || 0;
		const maxHeight = this.maxRows * rowHeight + (this.maxRows - 1) * gap;

		// Set max-height before measuring positions — children beyond it are still laid out
		// (flex-wrap positions by width), just clipped.
		container.style.maxHeight = `${maxHeight}px`;

		// Use offsetTop relative to the container's first child to determine rows.
		// This avoids getBoundingClientRect which can have floating-point issues.
		const baseTop = firstChild.offsetTop;

		let visibleCount = 0;
		for (const child of children) {
			if (child.offsetTop - baseTop + 1 >= maxHeight) {
				break;
			}
			visibleCount++;
		}

		let overflowCount = children.length - visibleCount;

		// If there's overflow, ensure the "+N" chip fits alongside the last visible child.
		if (overflowCount > 0 && visibleCount > 0) {
			const containerWidth =
				container.clientWidth -
				(parseFloat(containerStyle.paddingLeft) || 0) -
				(parseFloat(containerStyle.paddingRight) || 0);
			const suffixEl = this.shadowRoot?.querySelector('.suffix') as HTMLElement | null;
			const suffixWidth = suffixEl != null && suffixEl.offsetWidth > 0 ? suffixEl.offsetWidth : 0;
			const overflowChip = this.shadowRoot?.querySelector('.overflow-chip') as HTMLElement | null;
			const chipWidth = overflowChip != null ? overflowChip.offsetWidth : 40;

			while (visibleCount > 0) {
				const lastVisible = children[visibleCount - 1];
				const lastVisibleRight = lastVisible.offsetLeft + lastVisible.offsetWidth;
				const lastMargin = parseFloat(getComputedStyle(lastVisible).marginInlineEnd) || 0;
				const isOnRow1 = lastVisible.offsetTop - baseTop === 0;
				const availableWidth = isOnRow1 ? containerWidth - suffixWidth : containerWidth;

				if (lastVisibleRight + lastMargin + chipWidth <= availableWidth) break;
				visibleCount--;
				overflowCount++;
			}
		}

		return { visibleCount: visibleCount, overflowCount: overflowCount };
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-chip-overflow': GlChipOverflow;
	}
}
