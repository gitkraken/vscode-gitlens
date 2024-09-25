import { html } from 'lit';
import { customElement, property, queryAssignedElements } from 'lit/decorators.js';
import { GlElement, observe } from '../element';
import type { Radio } from './radio';
import { radioStyles } from './radio.css';

import '../code-icon';

export const tagName = 'gl-radio-group';

@customElement(tagName)
export class RadioGroup extends GlElement {
	static override readonly styles = [radioStyles];

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	@property({ type: String })
	value?: string;

	@observe(['value', 'disabled'])
	private handleValueChange() {
		this.updateRadioElements();
	}

	@queryAssignedElements({ flatten: true })
	private radioEls!: Radio[];

	override firstUpdated() {
		this.role = 'group';
	}

	private updateRadioElements(updateParentGroup = false) {
		this.radioEls.forEach(radio => {
			if (updateParentGroup) {
				radio.parentGroup = this;
			}
			radio.checked = radio.value === this.value;
			radio.disabled = this.disabled;
		});
	}

	override render() {
		return html`<slot @slotchange=${() => this.updateRadioElements(true)}></slot>`;
	}

	setValue(value: string) {
		this.value = value;
		const event = new CustomEvent('gl-change-value');
		this.dispatchEvent(event);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: RadioGroup;
	}
}
