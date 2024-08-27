import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlElement, observe } from '../element';
import { checkboxStyles } from './checkbox.css';

import '../code-icon';

@customElement('gl-checkbox')
export class Checkbox extends GlElement {
	static override readonly styles = [checkboxStyles];

	@property({ type: Boolean })
	disabled: boolean;

	@property({ type: String })
	value: string = '';

	@property({ type: Boolean })
	defaultChecked: boolean = false;

	@state()
	checked: boolean;

	constructor() {
		super();
		this.disabled = false;
		this.checked = this.defaultChecked;
	}

	@observe(['defaultChecked'], { afterFirstUpdate: true })
	private initChecked() {
		this.checked = this.defaultChecked;
	}

	handleChange(e: Event) {
		this.checked = (e.target as HTMLInputElement).checked;
		const event = new Event('gl-change-value');
		this.dispatchEvent(event);
	}

	renderCheck() {
		return html` <code-icon icon="check"></code-icon> `;
	}

	override render() {
		return html`<label ?aria-disabled=${this.disabled}
			><input .disabled=${this.disabled} type="checkbox" .checked=${this.checked} @change=${this.handleChange} />
			<div class="control">${when(this.checked, this.renderCheck.bind(this))}</div>
			<span><slot></slot></span
		></label>`;
	}
}
