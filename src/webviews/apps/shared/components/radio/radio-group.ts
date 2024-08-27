import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GlElement, observe } from '../element';
import type { Radio } from './radio';
import { radioStyles } from './radio.css';

import '../code-icon';

@customElement('gl-radio-group')
export class RadioGroup extends GlElement {
	static override readonly styles = [radioStyles];

	@property({ type: Boolean })
	disabled: boolean;

	@property({ type: String })
	value: string | null = null;

	constructor() {
		super();
		this.disabled = false;
	}

	@observe(['value', 'disabled'])
	private handleValueChange() {
		Object.values(this.radioElements).forEach(radio => {
			if (radio) {
				radio.checked = radio.value === this.value;
				radio.disabled = this.disabled;
			}
		});
	}

	setValue(value: string) {
		this.value = value;
		const event = new Event('gl-change-value');
		this.dispatchEvent(event);
	}

	renderCheck() {
		return html` <code-icon icon="check"></code-icon> `;
	}
	private radioElements: Partial<Record<string, Radio>> = {};

	subscribeRadioElement(element: Radio) {
		if (this.radioElements[element.value]) {
			console.warn(
				'be sure if you do not have the same value of radio in one group',
				element,
				this.radioElements,
			);
		}
		this.radioElements[element.value] = element;
		element.checked = element.value === this.value;
		element.disabled = this.disabled;
	}
	unsubscribeRadioElement(element: Radio) {
		this.radioElements[element.value] = undefined;
	}

	override render() {
		return html`<slot></slot>`;
	}
}
