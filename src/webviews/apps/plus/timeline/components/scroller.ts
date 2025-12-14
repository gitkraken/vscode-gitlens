import type { PropertyValues } from 'lit';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PointerEvent } from 'react';
import { GlElement } from '../../../shared/components/element';

const tagName = 'gl-chart-scroller';

@customElement(tagName)
export class GlChartScroller extends GlElement {
	static readonly tagName = tagName;

	static override styles = css`
		:host {
			--track-top: unset;
			--track-left: 0;
			--track-width: 100%;
			--track-height: 1.2rem;

			--thumb-height: 0.6rem;
			--thumb-width: 2rem;
			--thumb-left: 0;
		}

		.track {
			visibility: hidden;
			position: absolute;
			background: transparent;
			top: var(--track-top);
			left: var(--track-left);
			width: var(--track-width, 100%);
			height: var(--track-height, 1rem);
			z-index: 1;
		}

		.track[scrollable] {
			visibility: visible;
		}

		.thumb {
			position: absolute;
			top: 0;
			left: var(--thumb-left);
			height: var(--thumb-height);
			width: var(--thumb-width);
			min-width: 2rem;
			background: transparent;
			transition: background 1s linear;
			cursor: default;
		}

		/* :host(:focus-within) .thumb, */
		:host(:hover) .thumb {
			background: var(--vscode-scrollbarSlider-background);
			transition: none;
		}

		.thumb:hover {
			background: var(--vscode-scrollbarSlider-hoverBackground) !important;
		}

		.thumb:active {
			background: var(--vscode-scrollbarSlider-activeBackground) !important;
		}
	`;

	@property({ type: Array })
	range: [number, number] | undefined;

	@property({ type: Array })
	visibleRange: [number, number] | undefined;

	@state()
	private position: number = 0;
	@state()
	private size: number = 100;

	private isScrollable(): this is typeof this & { range: [number, number]; visibleRange: [number, number] } {
		return this.range != null && this.visibleRange != null && this.size < 100;
	}

	private _dragInfo:
		| {
				startX: number;
				startPosition: number;
				trackWidth: number;
				viewRange: number;
				zoomRange: number;
				viewStart: number;
				maxPosition: number;
				pointerId: number;
		  }
		| undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();

		// `capture:true` is needed to intercept the event before billboard.js
		this.addEventListener('wheel', this.onWheel, { passive: true, capture: true });
	}

	override disconnectedCallback(): void {
		this.onDragEnd();
		this.removeEventListener('wheel', this.onWheel);

		super.disconnectedCallback?.();
	}

	override willUpdate(_changedProperties: PropertyValues): void {
		({ size: this.size, position: this.position } = this.calculateScrollState());

		this.style.setProperty('--thumb-width', `${this.size}%`);
		this.style.setProperty('--thumb-left', `${this.position}%`);
	}

	override render(): unknown {
		return html`<slot></slot>
			<div class="track" part="track" ?scrollable="${this.isScrollable()}" @pointerdown="${this.onTrackClick}">
				<div
					class="thumb"
					@pointerdown="${this.onDragStart}"
					@pointermove="${this.onDragMove}"
					@pointerup="${this.onDragEnd}"
					@pointercancel="${this.onDragEnd}"
					@lostpointercapture="${this.onDragEnd}"
				></div>
			</div>`;
	}

	private readonly onDragStart = (e: PointerEvent): void => {
		if (!this.isScrollable()) return;

		e.preventDefault();
		e.stopPropagation();

		const thumb = e.currentTarget as HTMLElement;
		const track = thumb.parentElement as HTMLElement;
		if (!track) return;

		thumb.setPointerCapture(e.pointerId);

		const [viewStart, viewEnd] = this.range;
		const viewRange = viewEnd - viewStart;
		const zoomRange = this.visibleRange[1] - this.visibleRange[0];

		this._dragInfo = {
			startX: e.clientX,
			startPosition: this.position,
			trackWidth: track.offsetWidth,
			viewRange: viewRange,
			zoomRange: zoomRange,
			viewStart: viewStart,
			maxPosition: 100 - this.size,
			pointerId: e.pointerId,
		};

		this.emit('gl-scroll-start');
	};

	private readonly onDragMove = (e: PointerEvent): void => {
		if (!this._dragInfo || e.pointerId !== this._dragInfo.pointerId) return;

		e.preventDefault();
		e.stopPropagation();

		const deltaX = e.clientX - this._dragInfo.startX;
		const deltaPercent = (deltaX / this._dragInfo.trackWidth) * 100;
		const newPosition = Math.max(
			0,
			Math.min(this._dragInfo.maxPosition, this._dragInfo.startPosition + deltaPercent),
		);

		const timeOffset = (newPosition / (100 - this.size)) * (this._dragInfo.viewRange - this._dragInfo.zoomRange);
		const newStart = this._dragInfo.viewStart + timeOffset;
		const newEnd = newStart + this._dragInfo.zoomRange;

		this.emitScrollEvent(newStart, newEnd);
	};

	private readonly onDragEnd = (e?: PointerEvent): void => {
		if (!this._dragInfo || (e && e.pointerId !== this._dragInfo.pointerId)) return;

		const thumb = this.renderRoot.querySelector('.thumb') as HTMLElement;
		if (thumb) {
			if (this._dragInfo.pointerId) {
				thumb.releasePointerCapture(this._dragInfo.pointerId);
			}
		}

		this._dragInfo = undefined;
		this.requestUpdate();
		this.emit('gl-scroll-end');
	};

	private readonly onTrackClick = (e: PointerEvent): void => {
		if (!this.isScrollable() || e.target !== e.currentTarget) return;

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const clickPercent = (e.clientX - rect.left) / rect.width;

		const [start, end] = this.range;
		const visibleRange = this.visibleRange[1] - this.visibleRange[0];
		const range = end - start;

		const targetPosition = start + range * clickPercent;

		const newStart = Math.max(start, Math.min(end - visibleRange, targetPosition - visibleRange / 2));
		const newEnd = newStart + visibleRange;

		this.emitScrollEvent(newStart, newEnd);
	};

	private _wheelTimer?: ReturnType<typeof setTimeout>;

	private readonly onWheel = (e: WheelEvent): void => {
		if (e.ctrlKey) {
			// Hack to remove `ctrlKey` otherwise the chart will zoom too fast
			Object.defineProperty(e, 'ctrlKey', { value: false });

			return;
		}

		e.stopPropagation();
		e.stopImmediatePropagation();

		if (!this.isScrollable()) return;

		const started = this._wheelTimer != null;
		if (started) {
			clearTimeout(this._wheelTimer);
		}

		this._wheelTimer = setTimeout(() => {
			this._wheelTimer = undefined;
			this.emit('gl-scroll-end');
		}, 150);

		if (!started) {
			this.emit('gl-scroll-start');
		}

		const [start, end] = this.range;
		const [visibleStart, visibleEnd] = this.visibleRange;
		const visibleRange = visibleEnd - visibleStart;

		// Make the scroll amount proportional to the zoom range
		const scrollAmount = e.deltaY * visibleRange * 0.001;
		const newStart = Math.max(start, Math.min(end - visibleRange, visibleStart + scrollAmount));
		const newEnd = newStart + visibleRange;

		this.emitScrollEvent(newStart, newEnd);
	};

	private calculateScrollState(): { position: number; size: number } {
		if (this.range == null || this.visibleRange == null) return { position: 0, size: 100 };

		const [start, end] = this.range;
		const [visibleStart, visibleEnd] = this.visibleRange;

		const range = end - start;
		const visibleRange = visibleEnd - visibleStart;

		if (range <= 1 || visibleRange <= 1) return { position: 0, size: 100 };

		const size = Math.max(20, Math.min(100, (visibleRange / range) * 100));
		const maxOffset = range - visibleRange;
		if (maxOffset <= 0) return { position: 0, size: size };

		const position = Math.max(0, Math.min(100 - size, ((visibleStart - start) / maxOffset) * (100 - size)));

		return { position: position, size: size };
	}

	private emitScrollEvent(start: number, end: number) {
		if (start === this.visibleRange?.[0] && end === this.visibleRange[1]) {
			return;
		}

		this.emit('gl-scroll', { range: [start, end] as const });
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-chart-scrollbar': GlChartScroller;
	}

	interface GlobalEventHandlersEventMap {
		'gl-scroll-start': CustomEvent<void>;
		'gl-scroll-end': CustomEvent<void>;
		'gl-scroll': CustomEvent<{ range: [number, number] }>;
	}
}
