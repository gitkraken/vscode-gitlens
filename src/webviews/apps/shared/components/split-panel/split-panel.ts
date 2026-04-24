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
		'gl-split-panel-drag-end': CustomEvent<{ position: number }>;
		'gl-split-panel-dblclick': CustomEvent<void>;
		'gl-split-panel-closed-change': CustomEvent<{ closed: boolean; position: number }>;
	}
}

/**
 * A split panel with a draggable divider.
 * Position is a percentage (0–100) representing the start panel's share of the available space.
 *
 * When `primary` is set, the designated panel maintains its pixel width on container resize
 * while the other panel absorbs the change. Without `primary`, both panels scale proportionally.
 *
 * @slot start - Content for the start panel (left in horizontal, top in vertical).
 * @slot end - Content for the end panel (right in horizontal, bottom in vertical).
 *
 * @event gl-split-panel-change - Emitted when the divider position changes (drag or keyboard).
 *        detail: `{ position: number }` — the start panel size as a percentage (0–100).
 * @event gl-split-panel-drag-end - Emitted when a pointer drag gesture ends.
 *        detail: `{ position: number }` — the final position after the drag.
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

	/** Container size in pixels — tracked for pointer drag conversion and primary panel resize. */
	private _size = 0;
	private _position = 0;
	private _positionBeforeCollapse = 0;
	/**
	 * Cached pixel width of the primary panel. Updated only when the position changes via
	 * user interaction (setter), NOT during resize. This allows the primary panel to maintain
	 * its pixel width across container resizes without drift — even when snap clamping occurs
	 * during a shrink, the cache preserves the intended width for when the container grows back.
	 */
	private _cachedPrimaryPx = 0;
	private _dragAc: AbortController | undefined;
	private _resizeObserver: ResizeObserver | undefined;
	private _lastPointerDownTime = 0;

	/** Position of the divider as a percentage (0–100) from the start edge. */
	@property({ type: Number, reflect: true })
	get position(): number {
		return this._position;
	}
	set position(value: number) {
		const old = this._position;
		this._position = clampPosition(value);
		this.updateCachedPrimaryPx();
		// Emit closed-change on programmatic prop updates too (not just user interactions);
		// otherwise a consumer-initiated open (`.position=22`) leaves the internal
		// `_closedState` stale and the next user drag-to-close misses its transition. Skip
		// until `connectedCallback` has seeded the baseline — `_closedState === undefined`
		// marks "not yet seeded". Consumer handlers are idempotent so an echo is safe.
		if (this._closedState !== undefined) {
			this.emitClosedIfChanged();
		}
		this.requestUpdate('position', old);
	}

	/** Layout orientation. `horizontal` splits left/right, `vertical` splits top/bottom. */
	@property({ reflect: true })
	orientation: 'horizontal' | 'vertical' = 'horizontal';

	/**
	 * Custom snap function. Returns a snapped percentage (0–100).
	 * Receives:
	 * - `pos` — the candidate position as a percentage (0–100).
	 * - `size` — the container's current pixel size along the orientation axis
	 *    (width for horizontal, height for vertical). Use this to express pixel-based
	 *    constraints, e.g. `const px = (pos / 100) * size`.
	 *
	 * Called on pointer drag, keyboard navigation, container resize, and once on first
	 * measurement — so returning a pixel-clamped value is sufficient to enforce min/max
	 * in pixels even for the initial/restored position.
	 */
	@property({ attribute: false })
	snap: GlSplitPanelSnapFunction | undefined;

	/**
	 * Which panel maintains its pixel width on container resize.
	 * When unset, both panels scale proportionally.
	 * `start` — the start panel stays fixed, end panel absorbs resize.
	 * `end` — the end panel stays fixed, start panel absorbs resize.
	 * Also affects Enter key collapse direction.
	 */
	@property({ reflect: true })
	primary: 'start' | 'end' | undefined;

	/** Whether resizing is disabled. */
	@property({ type: Boolean, reflect: true })
	disabled = false;

	/**
	 * Tracks the last-emitted closed state. `undefined` doubles as the "not yet seeded"
	 * sentinel — `emitClosedIfChanged` short-circuits until `connectedCallback` seeds the
	 * baseline, which prevents spurious mount-time events for the value the consumer just
	 * rendered (e.g. on first mount with `detailsVisible=false`, the initial `.position=100`
	 * binding would otherwise emit `closed:true` to a consumer that already knows).
	 */
	private _closedState: boolean | undefined;

	@query('.divider')
	private dividerEl!: HTMLElement;

	private get isHorizontal(): boolean {
		return this.orientation !== 'vertical';
	}

	/** Update the cached pixel width of the primary panel from the current position and size. */
	private updateCachedPrimaryPx(): void {
		if (this._size <= 0) return;
		if (this.primary === 'end') {
			this._cachedPrimaryPx = ((100 - this._position) / 100) * this._size;
		} else {
			this._cachedPrimaryPx = (this._position / 100) * this._size;
		}
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		this._resizeObserver = new ResizeObserver(entries => {
			const rect = entries[0].contentRect;
			const size = Math.round(this.isHorizontal ? rect.width : rect.height);
			if (size !== this._size) {
				const oldPos = this._position;
				this._size = size;

				// When a primary panel is set, maintain its pixel width
				if (this.primary && this._cachedPrimaryPx > 0) {
					if (this.primary === 'end') {
						this._position = clampPosition(100 - (this._cachedPrimaryPx / size) * 100);
					} else {
						this._position = clampPosition((this._cachedPrimaryPx / size) * 100);
					}
					// Apply snap for visual constraints but DON'T update the cache —
					// this preserves the intended pixel width for when the container grows back
					this._position = this.applySnap(this._position);
				}
				// No primary: position stays the same percentage → proportional scaling

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
			// Seed initial closed state so transition-detection has a baseline. Setting it to
			// a non-undefined value also flips the position setter's "not seeded" gate, so
			// subsequent programmatic updates emit transitions. Without a `primary` there is
			// no closed edge; seed as `false` to unlock the gate while keeping the setter's
			// `computeClosed` always returning `false` (no transitions will ever fire).
			this._closedState = this.primary != null ? this.computeClosed(this._position) : false;
			// Re-apply snap now that container size is known so pixel-aware snap
			// functions can clamp initial position (from restored/default percentage).
			const snapped = this.applySnap(this._position);
			if (snapped !== this._position) {
				this._position = snapped;
				this.emitChange();
			}
			this.updateCachedPrimaryPx();
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
		this.style.setProperty('--_start-size', `${this._position}%`);
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
				aria-valuenow=${Math.max(0, Math.min(100, Math.round(this._position)))}
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
		this.emitClosedIfChanged();
	}

	/**
	 * Closed state is exact-edge: `primary='end'` → closed at 100, `primary='start'` → closed
	 * at 0. Snap functions are expected to land on the edge when the user drags a pane to hide
	 * it (e.g. `if (pos < min/2) return 0`). Without a `primary`, there's no dedicated panel
	 * to close, so no event is emitted.
	 */
	private computeClosed(pos: number): boolean {
		if (this.primary == null) return false;
		return this.primary === 'end' ? pos >= 100 : pos <= 0;
	}

	/**
	 * Emits `gl-split-panel-closed-change` only when the closed state transitions. The initial
	 * closed state is seeded (without emitting) in `connectedCallback` so consumers receive an
	 * event only for genuine user-driven transitions, not the value they just rendered.
	 */
	private emitClosedIfChanged(): void {
		if (this.primary == null) return;
		const closed = this.computeClosed(this._position);
		if (this._closedState === closed) return;
		this._closedState = closed;
		// Do NOT bubble — split-panels are legitimately nested (details > sidebar > minimap),
		// so bubbling would fire outer handlers for an inner split's transition, corrupting
		// unrelated visibility/position state. Listeners bind directly via `@event=` so they
		// fire regardless.
		this.dispatchEvent(
			new CustomEvent('gl-split-panel-closed-change', {
				detail: { closed: closed, position: this._position },
			}),
		);
	}

	private handlePointerDown(e: PointerEvent): void {
		if (this.disabled || e.button !== 0) return;
		e.preventDefault();

		// Detect double-click from pointer events (dblclick is suppressed by preventDefault above)
		const now = e.timeStamp;
		if (now - this._lastPointerDownTime < 400) {
			this._lastPointerDownTime = 0;
			this.dispatchEvent(new CustomEvent('gl-split-panel-dblclick', { bubbles: true, composed: true }));
			return;
		}
		this._lastPointerDownTime = now;

		const horiz = this.isHorizontal;
		const rect = this.getBoundingClientRect();
		const clickPosPx = horiz ? e.clientX - rect.left : e.clientY - rect.top;

		// Sync _position from actual visual position BEFORE setting [dragging],
		// because [dragging] may change CSS rules (e.g. removing fit-content) which
		// would re-layout the grid and change the divider position.
		const dividerRect = this.dividerEl.getBoundingClientRect();
		const dividerCenterPx = horiz
			? dividerRect.left - rect.left + dividerRect.width / 2
			: dividerRect.top - rect.top + dividerRect.height / 2;
		const visualPos = clampPosition((dividerCenterPx / this._size) * 100);
		if (Math.abs(visualPos - this._position) > 1) {
			this._position = visualPos;
			this.updateCachedPrimaryPx();
			// Sync the CSS variable immediately so the grid doesn't jump when
			// [dragging] removes fit-content and falls back to min(--_start-size, ...)
			this.style.setProperty('--_start-size', `${this._position}%`);
		}

		this.toggleAttribute('dragging', true);
		this.dividerEl.setPointerCapture(e.pointerId);

		this._dragAc?.abort();
		const ac = new AbortController();
		this._dragAc = ac;

		const dividerPosPx = (this._position / 100) * this._size;
		const offsetPx = clickPosPx - dividerPosPx;

		const onMove = (ev: PointerEvent) => {
			if (this._size <= 0) return;
			const rect = this.getBoundingClientRect();
			const posPx = (horiz ? ev.clientX - rect.left : ev.clientY - rect.top) - offsetPx;
			const posPct = (posPx / this._size) * 100;
			this.position = this.applySnap(posPct);
			this.emitChange();
		};

		const cleanup = () => {
			this.toggleAttribute('dragging', false);
			ac.abort();
			this._dragAc = undefined;

			this.dispatchEvent(
				new CustomEvent('gl-split-panel-drag-end', {
					detail: { position: this._position },
					bubbles: true,
					composed: true,
				}),
			);
		};

		this.dividerEl.addEventListener('pointermove', onMove, { passive: true, signal: ac.signal });
		this.dividerEl.addEventListener('lostpointercapture', cleanup, { signal: ac.signal });
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (this.disabled) return;

		const step = e.shiftKey ? 10 : 1;
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
				newPos = 100;
				break;
			case 'Enter':
				if (this.primary === 'end') {
					if (this._position >= 100 && this._positionBeforeCollapse < 100) {
						newPos = this._positionBeforeCollapse;
					} else {
						this._positionBeforeCollapse = this._position;
						newPos = 100;
					}
				} else if (this._position <= 0 && this._positionBeforeCollapse > 0) {
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

function clampPosition(value: number): number {
	return Math.max(0, Math.min(100, value));
}
