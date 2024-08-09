import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { GlElement } from '../element';
import { accordionBaseStyles } from './accordion.css';

/**
 * An uncontrolled accordion component
 *
 * @element gk-accordion
 *
 * @slot button-content - items in this slot show up in the accordion button element.
 * @slot details content - items in this slot show up in the accordion details. They are hidden/shown when the accordion is toggled
 *
 * @cssprop --gk-accordion-button-border - Defines the border of the accordion button.
 * @cssprop --gk-accordion-button-border-radius - Defines the border radius of the accordion button.
 * @cssprop --gk-accordion-button-background-color - Defines the background color of the accordion button.
 * @cssprop --gk-accordion-button-color - Defines the button color of the accordion button.
 * @cssprop --gk-accordion-button-padding - Defines the accordion button padding.
 * @cssprop --gk-accordion-button-background-color-hovered - Defines the background color of the accordion button on :hover or :focus-within
 * @cssprop --gk-accordion-button-width - Defines the width of the accordion button
 * @cssprop --gk-accordion-button-focus-outline - Defines the outline of the accordion button on :focus-within
 * @cssprop --gk-accordion-button-chevron-size - Defines the size of the chevron in the right of the accordion button
 *
 * @cssprop --gk-accordion-details-border - Defines the border of the accordion details section.
 * @cssprop --gk-accordion-details-background-color - Defines the background color of the accordion details section.
 * @cssprop --gk-accordion-details-color - Defines the button color of the accordion details section.
 * @cssprop --gk-accordion-details-padding - Defines the accordion details section padding.

 * @csspart wrapper - the wrapping div around the accordion elements
 * @csspart button - the accordion button
 * @csspart details - the accordion details section
 */
@customElement('gl-accordion')
export class Accordion extends GlElement {
	static override readonly styles = accordionBaseStyles;
	static override readonly shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	@property()
	override id!: string;

	@property({ attribute: 'default-is-expanded', type: Boolean }) defaultIsExpanded: boolean = false;
	@property({ attribute: 'show-chevron', type: Boolean }) showChevron: boolean = false;

	get buttonId() {
		return `accordion-${this.id}__trigger`;
	}
	get detailsId() {
		return `accordion-${this.id}__details`;
	}

	@state() isExpanded = false;

	override connectedCallback() {
		super.connectedCallback();
		this.isExpanded = this.defaultIsExpanded;
	}

	_handleClick(e: MouseEvent) {
		e.stopPropagation();
		this.isExpanded = !this.isExpanded;
		const buttonEl = this as any;
		buttonEl.dispatchEvent(new Event('click'));
	}

	get chevronIcon() {
		return html` <code-icon icon="chevron-down"></code-icon>`;
	}

	override render() {
		return html`
			<div class="accordion" part="wrapper">
				<button
					?aria-expanded=${this.isExpanded}
					aria-controls="${this.detailsId}"
					class=${classMap({
						'accordion-button': true,
						'accordion-button--expanded': this.isExpanded,
					})}
					id="${this.buttonId}"
					@click="${this._handleClick}"
					type="button"
					part="button"
				>
					<slot name="button-content"></slot>
					${this.showChevron ? html`${this.chevronIcon}` : null}
				</button>
				<div
					aria-labelledby="${this.buttonId}"
					class=${classMap({
						'accordion-details': true,
						'accordion-details--expanded': this.isExpanded,
					})}
					?hidden=${!this.isExpanded}
					id="${this.detailsId}"
					role="region"
					part="details"
				>
					<slot name="details-content"></slot>
				</div>
			</div>
		`;
	}
}
