import type WaSlider from '@awesome.me/webawesome/dist/components/slider/slider.js';
import { html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { sliderStyles } from './slider.css.js';
import '@awesome.me/webawesome/dist/components/slider/slider.js';
import '../shoelace-stub.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-slider']: GlSlider;
	}
}

/**
 * A single-value numeric slider wrapping `wa-slider`, themed for VS Code.
 *
 * Shows the current value (with an optional `unit` suffix) beside the track —
 * the value text is presentational; the slider itself announces its value.
 *
 * Events: `gl-input-value` fires continuously while dragging (drive live previews
 * from it); `gl-change-value` fires once the value is committed (persist from it).
 */
@customElement('gl-slider')
export class GlSlider extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = sliderStyles;

	@query('wa-slider')
	private sliderElement!: WaSlider;

	@property({ type: Number })
	value: number = 0;

	@property({ type: Number })
	min: number = 0;

	@property({ type: Number })
	max: number = 100;

	@property({ type: Number })
	step: number = 1;

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	/** Accessible name for the slider. */
	@property({ type: String })
	label?: string;

	/** Suffix appended to the displayed value (e.g. 'px', ' days'). */
	@property({ type: String })
	unit: string = '';

	private handleInput(e: Event) {
		e.stopPropagation();
		this.value = (e.target as WaSlider).value;

		this.dispatchEvent(new CustomEvent('gl-input-value', { bubbles: true, composed: true }));
	}

	private handleChange(e: Event) {
		// Stop the inner change from bubbling out — we'll re-emit on this host below
		e.stopPropagation();
		this.value = (e.target as WaSlider).value;

		this.dispatchEvent(new CustomEvent('gl-change-value', { bubbles: true, composed: true }));
		this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
	}

	override render(): unknown {
		return html`<wa-slider
				exportparts="base, track, indicator, thumb"
				.value=${this.value}
				min=${this.min}
				max=${this.max}
				step=${this.step}
				?disabled=${this.disabled}
				label=${ifDefined(this.label)}
				.valueFormatter=${(value: number) => `${value}${this.unit}`}
				@input=${this.handleInput}
				@change=${this.handleChange}
			></wa-slider>
			<span class="value" aria-hidden="true">${this.value}${this.unit}</span>`;
	}

	override focus(_options?: FocusOptions): void {
		this.sliderElement?.focus();
	}

	override blur(): void {
		this.sliderElement?.blur();
	}
}
