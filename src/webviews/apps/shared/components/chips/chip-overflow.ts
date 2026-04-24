import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '../overlays/popover.js';
import '../code-icon.js';

@customElement('gl-chip-overflow')
export class GlChipOverflow extends LitElement {
	static override styles = css`
		:host {
			display: contents;
		}

		.container {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: var(--gl-chip-overflow-gap, 0.5rem);
			overflow: hidden;
			flex: 1 1 auto;
			min-width: 0;
		}

		::slotted([data-overflow-hidden]) {
			display: none !important;
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
			display: flex;
			align-items: center;
			flex-shrink: 0;
		}

		.suffix {
			display: flex;
			align-items: center;
			margin-inline-start: auto;
			flex-shrink: 0;
		}

		.overflow-popover {
			max-height: 300px;
			max-width: 400px;
			overflow-y: auto;
			scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		}

		.overflow-popover::-webkit-scrollbar-thumb {
			background-color: var(--vscode-scrollbarSlider-background);
		}

		.overflow-popover::-webkit-scrollbar-thumb:hover {
			background-color: var(--vscode-scrollbarSlider-hoverBackground);
		}

		.overflow-popover::-webkit-scrollbar-thumb:active {
			background-color: var(--vscode-scrollbarSlider-activeBackground);
		}

		.overflow-popover::-webkit-scrollbar-corner {
			background-color: transparent;
		}
	`;

	@property({ type: Number, attribute: 'max-rows' })
	maxRows: number = 1;

	@state()
	private _overflowCount: number = 0;

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
		return html`<div class="container" part="container">
			<span class="prefix"><slot name="prefix"></slot></span
			><slot @slotchange=${this.handleSlotChange}></slot>${this._overflowCount > 0
				? html`<gl-popover hoist trigger="click" placement="bottom-start" appearance="menu">
						<button
							slot="anchor"
							class="overflow-chip"
							part="overflow-chip"
							aria-label="${this._overflowCount} more items"
						>
							+${this._overflowCount}
						</button>
						<div slot="content" class="overflow-popover" part="popover">
							<slot name="popover"></slot>
						</div>
					</gl-popover>`
				: nothing}<span class="suffix"><slot name="suffix"></slot></span>
		</div>`;
	}

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

			// Get row height from the first child
			const firstChild = children[0];
			const rowHeight = firstChild.offsetHeight;
			if (rowHeight === 0) return;

			const containerStyle = getComputedStyle(container);
			const gap = parseFloat(containerStyle.rowGap) || 0;
			const maxHeight = this.maxRows * rowHeight + (this.maxRows - 1) * gap;

			// Set max-height before measuring positions — children beyond it
			// are still laid out (flex-wrap positions by width), just clipped
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

			// If there's overflow, check if the "+N" chip fits alongside the last visible child
			if (overflowCount > 0 && visibleCount > 0) {
				const lastVisible = children[visibleCount - 1];
				const lastVisibleRight = lastVisible.offsetLeft + lastVisible.offsetWidth;
				// Estimate "+N" chip width (measure if already rendered, otherwise estimate)
				const overflowChip = this.shadowRoot?.querySelector('.overflow-chip') as HTMLElement | null;
				const chipWidth = overflowChip != null ? overflowChip.offsetWidth : 40;
				const containerWidth =
					container.clientWidth -
					(parseFloat(containerStyle.paddingLeft) || 0) -
					(parseFloat(containerStyle.paddingRight) || 0);

				if (lastVisibleRight + gap + chipWidth > containerWidth) {
					visibleCount--;
					overflowCount++;
				}
			}

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
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-chip-overflow': GlChipOverflow;
	}
}
