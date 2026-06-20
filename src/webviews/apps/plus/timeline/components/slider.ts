import type WaSlider from '@awesome.me/webawesome/dist/components/slider/slider.js';
import { css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { TimelineDatum } from '../../../../plus/timeline/protocol.js';
import { GlElement } from '../../../shared/components/element.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';

const tagName = 'gl-chart-slider';

type WaTooltipLike = HTMLElement & { open: boolean; popup?: { reposition: () => void } };

@customElement(tagName)
export class GlChartSlider extends GlElement {
	static readonly tagName = tagName;

	static override styles = css`
		:host {
			display: block;
		}

		.slider-container {
			position: relative;
			width: 100%;
			padding-bottom: var(--gl-space-4);
		}

		wa-slider {
			--track-size: 3px;
			--thumb-width: 16px;
			--thumb-height: 16px;
		}

		wa-slider::part(track) {
			background-color: var(--vscode-scrollbarSlider-background);
		}

		/* Indicator is anchored to max (= the working tree at the right edge) via indicator-offset,
	   so it spans the selected commit to the working tree. Hidden by default (matches track),
	   revealed in the accent color only while Shift is held. */
		wa-slider::part(indicator) {
			background-color: transparent;
		}

		:host([shift]) wa-slider::part(indicator) {
			background-color: var(--wa-color-primary-600);
		}

		/* WA's thumb defaults to var(--wa-form-control-activated-color) (background) + 2px
	   border in var(--wa-color-surface-default) — neither token is defined since we
	   don't ship WA's theme CSS, so the thumb is invisible without these overrides. */
		wa-slider::part(thumb) {
			cursor: pointer;
			background-color: var(--vscode-foreground);
			border: 2px solid var(--vscode-editor-background);
		}
	`;

	@state()
	private _value: number = 0;
	private _max: number = 0;
	private _min: number = 0;

	private _data: TimelineDatum[] | undefined;
	get data() {
		return this._data;
	}
	@property({ type: Array })
	set data(value: TimelineDatum[] | undefined) {
		if (this._data === value) return;

		this._data = value;

		this._min = 0;
		this._max = (value?.length ?? 1) - 1;
		// Snap the thumb back to the working tree (right edge / max in oldest-first data) so the
		// slider's left→right direction matches the chart's X axis (oldest → newest), and so a
		// dataset swap doesn't leave the thumb wherever the user happened to be in the prior
		// history. Matches the chart's auto-select on the most recent commit.
		this._value = this._max;
	}

	private _shift: boolean = false;
	get shift() {
		return this._shift;
	}
	@property({ type: Boolean })
	set shift(value: boolean) {
		this._shift = value;
	}

	get value() {
		return this.data?.[this._value];
	}

	@query('wa-slider')
	private _slider!: WaSlider;

	override render() {
		return html`<div class="slider-container">
			<wa-slider
				id="slider"
				.min=${this._min}
				.max=${this._max}
				.value=${this._value}
				.indicatorOffset=${this._max}
				with-tooltip
				tooltip-placement="top"
				.valueFormatter=${(_: number) => `Hold Shift to Compare with Working Tree`}
				@change=${this.handleSliderInput}
				@input=${this.handleSliderInput}
				@click=${this.handleSliderInput}
				@pointerdown=${this.handleDragStart}
				@pointerup=${this.handleDragEnd}
				@pointercancel=${this.handleDragEnd}
				@pointerenter=${this.handleShowTooltip}
				@pointermove=${this.handleShowTooltip}
				@pointerleave=${this.handleHideTooltip}
			></wa-slider>
		</div>`;
	}

	// True from `pointerdown` on the thumb until `pointerup`/`pointercancel` — gates `pointerleave`
	// so the WA tooltip stays pinned even when the cursor drifts off the thumb mid-drag.
	private _dragging = false;

	// wa-slider's tooltip only opens on focus/drag-start. Add hover triggers by toggling the
	// internal `wa-tooltip` element directly — `showTooltip`/`hideTooltip` exist at runtime but
	// are typed `private`, so go through the rendered shadow tree.
	private getTooltip(): WaTooltipLike | null {
		return (this._slider?.shadowRoot?.getElementById('tooltip') as WaTooltipLike | null) ?? null;
	}

	private handleShowTooltip = () => {
		const tooltip = this.getTooltip();
		if (tooltip != null) {
			// wa-tooltip clamps its body to var(--max-width) (default 30ch) and wraps anything wider.
			// Our label is a single short sentence; let it size to its own content instead of wrapping.
			tooltip.style.setProperty('--max-width', 'none');
			tooltip.open = true;
		}
	};

	private handleHideTooltip = () => {
		// Keep the tooltip pinned through the drag — pointerleave fires the moment the cursor strays
		// off the thumb, but the user is still scrubbing.
		if (this._dragging) return;

		const tooltip = this.getTooltip();
		if (tooltip != null) {
			tooltip.open = false;
		}
	};

	private handleDragStart = () => {
		this._dragging = true;
		this.handleShowTooltip();
	};

	private handleDragEnd = () => {
		this._dragging = false;
		// Always emit a final `interim: false` on drag-release. Otherwise, when the user drags
		// away from a value and back to the same value, the underlying `wa-slider` doesn't fire a
		// `change` event (its value didn't actually change from press → release), and the chart
		// stays stuck in scrub-active mode with the hover halo + tooltip pinned to the thumb's
		// last position. Read from the live `wa-slider`'s value (the source of truth during
		// drag) — `this._value` only updates via `select()` and lags behind the live thumb.
		if (!this.data?.length || this._slider == null) return;

		const index = this._slider.value;
		const datum = this.data[index];
		if (datum == null) return;

		this.emit('gl-slider-change', { date: new Date(datum.date), shift: this.shift, interim: false });
	};

	select(id: string): void;
	select(date: Date): void;
	select(idOrDate: string | Date) {
		let index;
		if (typeof idOrDate === 'string') {
			index = this.data?.findIndex(d => d.sha === idOrDate);
		} else {
			const isoDate = idOrDate.toISOString();
			index = this.data?.findIndex(d => d.date === isoDate);
		}
		if (index == null || index === -1) return;

		this._value = index;
	}

	private handleSliderInput(e: MouseEvent | CustomEvent<void>) {
		if (!this.data?.length) return;

		const index = parseInt((e.target as HTMLInputElement).value);

		// Force the WA tooltip to re-anchor to the thumb on every drag step. WA's tooltip only
		// repositions on its own internal show/hide flow; once we keep it pinned manually, the
		// underlying wa-popup needs an explicit reposition each time the thumb moves or it stays
		// where it was first opened.
		if (e.type === 'input') {
			this.getTooltip()?.popup?.reposition();
		}

		const date = new Date(this.data[index].date);
		this.emit('gl-slider-change', { date: date, shift: this.shift, interim: e.type === 'input' });
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-chart-slider': GlChartSlider;
	}

	interface GlobalEventHandlersEventMap {
		'gl-slider-change': CustomEvent<SliderChangeEventDetail>;
	}
}

export interface SliderChangeEventDetail {
	date: Date;
	shift: boolean;
	/** True for `input` events fired while dragging; false for the final `change`/`click`. */
	interim: boolean;
}
