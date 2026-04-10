import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { splitPanelStyles } from './split-panel.css.js';

export const tagName = 'gl-split-panel';

export type GlSplitPanelSnapFunction = (params: { pos: number; size: number }) => number;

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSplitPanel;
	}

	interface GlobalEventHandlersEventMap {
		'gl-split-panel-change': CustomEvent<{ position: number }>;
	}
}

/**
 * A split panel with a draggable divider.
 * All positioning is in pixels. The `primary` property controls which
 * panel preserves its pixel size across container resizes (default: start).
 *
 * @slot start - Content for the start panel (left in horizontal, top in vertical).
 * @slot end - Content for the end panel (right in horizontal, bottom in vertical).
 *
 * @event gl-split-panel-change - Emitted when the divider position changes (drag or keyboard).
 *        detail: `{ position: number }` — the start panel size in pixels.
 *
 * @csspart start - The start panel container.
 * @csspart end - The end panel container.
 * @csspart divider - The divider element.
 *
 * @cssproperty --gl-split-panel-divider-width - Divider visual width. Default `4px`.
 * @cssproperty --gl-split-panel-divider-hit-area - Divider interactive hit area. Default `var(--vscode-sash-hoverSize, 8px)`.
 */
@customElement(tagName)
export class GlSplitPanel extends LitElement {
	static override styles = splitPanelStyles;

	private _size = 0;
	private _position = 0;
	private _positionBeforeCollapse = 0;
	private _endPanelSize: number | undefined;
	private _dragAc: AbortController | undefined;
	private _resizeObserver: ResizeObserver | undefined;

	/** Position of the divider in pixels from the start edge. */
	@property({ type: Number, reflect: true })
	get position(): number {
		return this._position;
	}
	set position(value: number) {
		const old = this._position;
		this._position = this.clampPosition(value);
		if (this._size > 0) {
			this._endPanelSize = this._size - this._position;
		}
		this.requestUpdate('position', old);
	}

	/** Layout orientation. `horizontal` splits left/right, `vertical` splits top/bottom. */
	@property({ reflect: true })
	orientation: 'horizontal' | 'vertical' = 'horizontal';

	/** Custom snap function. Receives `{ pos, size }` in pixels, returns snapped position. */
	@property({ attribute: false })
	snap: GlSplitPanelSnapFunction | undefined;

	/**
	 * Which panel keeps its pixel size on container resize.
	 * `start` (default) — the start panel stays fixed, end panel absorbs resize.
	 * `end` — the end panel stays fixed, start panel absorbs resize.
	 */
	@property({ reflect: true })
	primary: 'start' | 'end' = 'start';

	/** Whether resizing is disabled. */
	@property({ type: Boolean, reflect: true })
	disabled = false;

	@query('.divider')
	private dividerEl!: HTMLElement;

	private get isHorizontal(): boolean {
		return this.orientation !== 'vertical';
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._resizeObserver = new ResizeObserver(entries => {
			const rect = entries[0].contentRect;
			const size = Math.round(this.isHorizontal ? rect.width : rect.height);
			if (size !== this._size) {
				const oldPos = this._position;
				const oldSize = this._size;

				if (this.primary === 'end' && (oldSize > 0 || this._endPanelSize != null)) {
					// Keep end panel size fixed — use stored size to survive shrink-then-grow
					this._endPanelSize ??= oldSize - this._position;
					this._position = Math.max(0, size - this._endPanelSize);
				} else if (this._position <= 0) {
					// Stick to start edge (collapsed start panel stays collapsed)
					this._position = 0;
				}
				// primary="start" with position > 0: no change needed
				// (start panel keeps its pixel width; CSS min() handles overflow)

				this._size = size;
				this._position = this.applySnap(this._position);
				if (this._position !== oldPos) {
					this.emitChange();
				}
				this.requestUpdate();
			}
		});
		void this.updateComplete.then(() => {
			this._resizeObserver!.observe(this);
			const rect = this.getBoundingClientRect();
			this._size = Math.round(this.isHorizontal ? rect.width : rect.height);
			this.requestUpdate();
		});
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		this._dragAc?.abort();
		this._dragAc = undefined;
	}

	protected override willUpdate(): void {
		this.style.setProperty('--_start-size', this._size > 0 ? `${this._position}px` : '0px');
	}

	override render() {
		return html`
			<slot name="start" part="start" class="start"></slot>

			<div
				part="divider"
				class="divider"
				tabindex=${this.disabled ? -1 : 0}
				role="separator"
				aria-orientation=${this.orientation}
				aria-valuenow=${this._size > 0
					? Math.max(0, Math.min(100, Math.round((this._position / this._size) * 100)))
					: 0}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-label="Resize"
				@keydown=${this.handleKeyDown}
				@pointerdown=${this.handlePointerDown}
			>
				<slot name="divider"></slot>
			</div>

			<slot name="end" part="end" class="end"></slot>
		`;
	}

	private clampPosition(value: number): number {
		if (this._size <= 0) return Math.max(0, Math.round(value));
		return Math.max(0, Math.min(Math.round(value), this._size));
	}

	private applySnap(pos: number): number {
		if (this.snap) {
			return this.snap({ pos: pos, size: this._size });
		}
		return pos;
	}

	private emitChange(): void {
		this.dispatchEvent(
			new CustomEvent('gl-split-panel-change', {
				detail: { position: this._position },
			}),
		);
	}

	private handlePointerDown(e: PointerEvent): void {
		if (this.disabled || e.button !== 0) return;
		e.preventDefault();

		this.toggleAttribute('dragging', true);
		this.dividerEl.setPointerCapture(e.pointerId);

		this._dragAc?.abort();
		const ac = new AbortController();
		this._dragAc = ac;

		const horiz = this.isHorizontal;
		const rect = this.getBoundingClientRect();
		const clickPos = horiz ? e.clientX - rect.left : e.clientY - rect.top;
		const offset = clickPos - this._position;

		const onMove = (ev: PointerEvent) => {
			const rect = this.getBoundingClientRect();
			const pos = (horiz ? ev.clientX - rect.left : ev.clientY - rect.top) - offset;
			this.position = this.applySnap(pos);
			this.emitChange();
		};

		const cleanup = () => {
			this.toggleAttribute('dragging', false);
			ac.abort();
			this._dragAc = undefined;
		};

		this.dividerEl.addEventListener('pointermove', onMove, { passive: true, signal: ac.signal });
		this.dividerEl.addEventListener('lostpointercapture', cleanup, { signal: ac.signal });
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (this.disabled) return;

		const step = (this._size * (e.shiftKey ? 10 : 1)) / 100;
		let newPos = this._position;
		let handled = true;
		const horiz = this.isHorizontal;

		switch (e.key) {
			case 'ArrowLeft':
				if (horiz) {
					newPos -= step;
				} else {
					handled = false;
				}
				break;
			case 'ArrowRight':
				if (horiz) {
					newPos += step;
				} else {
					handled = false;
				}
				break;
			case 'ArrowUp':
				if (!horiz) {
					newPos -= step;
				} else {
					handled = false;
				}
				break;
			case 'ArrowDown':
				if (!horiz) {
					newPos += step;
				} else {
					handled = false;
				}
				break;
			case 'Home':
				newPos = 0;
				break;
			case 'End':
				newPos = this._size;
				break;
			case 'Enter':
				if (this._position <= 0 && this._positionBeforeCollapse > 0) {
					newPos = this._positionBeforeCollapse;
				} else {
					this._positionBeforeCollapse = this._position;
					newPos = 0;
				}
				break;
			default:
				handled = false;
				break;
		}

		if (handled) {
			e.preventDefault();
			this.position = this.applySnap(newPos);
			this.emitChange();
		}
	}
}
