import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GlElement } from '../element';
import { checkboxBaseStyles } from '../forms/checkbox.css';
import type { RadioGroup } from './radio-group';
import { radioStyles } from './radio.css';

import '../code-icon';

export const tagName = 'gl-radio';

@customElement(tagName)
export class Radio extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...GlElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override readonly styles = [checkboxBaseStyles, radioStyles];

	@property({ type: Boolean, reflect: true })
	disabled: boolean = false;

	@property({ type: String })
	value?: string;

	@property({ type: String, reflect: true })
	name?: string;

	@property({ type: Boolean, reflect: true })
	checked: boolean = false;

	private _parentGroup: RadioGroup | undefined = undefined;
	@property({ type: Object, attribute: false })
	set parentGroup(value: RadioGroup | undefined) {
		this._parentGroup = value;
	}
	get parentGroup() {
		return this._parentGroup;
	}

	handleClick() {
		if (this.value) {
			this.parentGroup?.setValue(this.value);
		}
	}

	renderCircle() {
		if (!this.checked) return undefined;

		return html`<code-icon icon="circle-filled"></code-icon>`;
	}

	override render() {
		return html`<label ?aria-disabled=${this.disabled}
			><button class="input" .disabled=${this.disabled} @click=${this.handleClick}></button>
			<div class="control">${this.renderCircle()}</div>
			<slot class="label-text"></slot>
		</label>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: Radio;
	}
}
