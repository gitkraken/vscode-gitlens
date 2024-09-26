import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GlElement } from '../element';
import { checkboxBaseStyles } from '../forms/checkbox.css';

import '../code-icon';

export const tagName = 'gl-checkbox';

@customElement(tagName)
export class Checkbox extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...GlElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override readonly styles = [checkboxBaseStyles];

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	@property({ type: String })
	value: string = '';

	_defaultChecked: boolean = false;
	@property({ type: Boolean })
	get defaultChecked() {
		return this._defaultChecked;
	}

	@property({ type: Boolean, reflect: true })
	checked: boolean = false;

	constructor() {
		super();
		this._defaultChecked = this.checked;
	}

	handleChange(e: Event) {
		this.checked = (e.target as HTMLInputElement).checked;
		const event = new CustomEvent('gl-change-value');
		this.dispatchEvent(event);
	}

	renderCheck() {
		if (!this.checked) return undefined;

		return html` <code-icon icon="check"></code-icon> `;
	}

	override render() {
		return html`<label ?aria-disabled=${this.disabled}
			><input
				class="input"
				.disabled=${this.disabled}
				type="checkbox"
				.checked=${this.checked}
				@change=${this.handleChange}
			/>
			<div class="control">${this.renderCheck()}</div>
			<slot class="label-text"></slot>
		</label>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: Checkbox;
	}
}
