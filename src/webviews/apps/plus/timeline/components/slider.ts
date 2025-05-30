import type SlRange from '@shoelace-style/shoelace/dist/components/range/range.js';
import type { PropertyValues } from 'lit';
import { css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '../../../../../git/utils/revision.utils';
import type { Commit } from '../../../../plus/timeline/protocol';
import { GlElement } from '../../../shared/components/element';
import '@shoelace-style/shoelace/dist/components/range/range.js';

const tagName = 'gl-chart-slider';

@customElement(tagName)
export class GlChartSlider extends GlElement {
	static readonly tagName = tagName;

	static override styles = css`
		:host {
			display: block;
		}

		.slider-container {
			width: 100%;
			position: relative;
			padding-bottom: 0.4rem;
		}

		sl-range::part(input) {
			--track-height: 3px;
			--thumb-size: 16px;
			--track-active-offset: 100%;
			--track-color-active: var(--gl-track-color-active, var(--sl-color-neutral-200));
		}
	`;

	@query('#slider')
	private slider!: SlRange;

	@state()
	private _value: number = 0;
	private _max: number = 0;
	private _min: number = 0;

	private _data: Commit[] | undefined;
	get data() {
		return this._data;
	}
	@property({ type: Array })
	set data(value: Commit[] | undefined) {
		if (this._data === value) return;

		this._data = value;

		this._min = 0;
		this._max = (value?.length ?? 1) - 1;
	}

	private _shift: boolean = false;
	get shift() {
		return this._shift;
	}
	@property({ type: Boolean })
	set shift(value: boolean) {
		this._shift = value;
		if (value) {
			this.style.setProperty('--gl-track-color-active', 'var(--sl-color-primary-600');
		} else {
			this.style.removeProperty('--gl-track-color-active');
		}
	}

	protected override firstUpdated(_changedProperties: PropertyValues): void {
		this.slider.tooltipFormatter = (value: number) => {
			const sha = this.data?.[value]?.sha;
			if (sha == null) return '';

			if (!sha) return 'Working Changes';
			if (isUncommitted(sha)) {
				return isUncommittedStaged(sha) ? 'Staged Changes' : 'Working Changes';
			}

			return `Commit ${shortenRevision(sha)}`;
		};
	}

	override render() {
		return html`<div class="slider-container">
			<sl-range
				id="slider"
				.min=${this._min}
				.max=${this._max}
				.value=${this._value}
				@sl-change=${this.handleSliderInput}
				@sl-input=${this.handleSliderInput}
			></sl-range>
		</div>`;
	}

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

	private handleSliderInput(e: CustomEvent<void>) {
		if (!this.data?.length) return;

		const index = parseInt((e.target as HTMLInputElement).value);

		const date = new Date(this.data[index].date);
		this.emit('gl-slider-change', { date: date, shift: this.shift });
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
}
