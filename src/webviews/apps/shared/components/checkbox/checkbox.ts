import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlElement, observe } from '../element';
import { checkboxBaseStyles } from '../forms/checkbox.css';
import { checkboxStyles } from './checkbox.css';

import '../code-icon';

export const tagName = 'gl-checkbox';

@customElement(tagName)
export class Checkbox extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...GlElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override readonly styles = [checkboxBaseStyles, checkboxStyles];

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
