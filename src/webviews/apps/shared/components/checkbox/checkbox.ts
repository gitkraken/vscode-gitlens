import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ModifierKeysController } from '../../controllers/modifier-keys.js';
import { GlElement } from '../element.js';
import { checkboxBaseStyles } from './checkbox.css.js';

import '../code-icon.js';

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
	get defaultChecked(): boolean {
		return this._defaultChecked;
	}

	@property({ type: Boolean, reflect: true })
	checked: boolean = false;

	@property({ type: Boolean, reflect: true })
	indeterminate: boolean = false;

	constructor() {
		super();
		this._defaultChecked = this.checked;
	}

	private _clickAlt = false;
	private readonly _modifiers = new ModifierKeysController(this);

	private handleClick(e: MouseEvent) {
		this._clickAlt = e.altKey;
	}

	private handleChange(e: Event) {
		let newChecked = (e.target as HTMLInputElement).checked;
		// Alt+click on an indeterminate checkbox flips the natural transition to unchecked so
		// the "Unstage All currently staged" intent is reachable in one click. Read alt from
		// BOTH the captured click event AND the live modifier tracker — keyboard activation
		// (Space) skips the click handler, and some platforms may not fire click before change.
		const altHeld = this._clickAlt || this._modifiers.altKey;
		if (this.indeterminate && altHeld) {
			newChecked = false;
			(e.target as HTMLInputElement).checked = false;
		}
		this._clickAlt = false;
		this.checked = newChecked;
		this.indeterminate = false;
		this.dispatchEvent(new CustomEvent('gl-change-value'));
	}

	private renderCheck() {
		return html`<code-icon icon=${this.indeterminate ? 'dash' : 'check'}></code-icon>`;
	}

	override render(): unknown {
		return html`<label ?aria-disabled=${this.disabled}
			><input
				class="input"
				.disabled=${this.disabled}
				type="checkbox"
				.checked=${this.checked}
				@change=${this.handleChange}
				@click=${this.handleClick}
			/>
			<div class="control">${this.renderCheck()}</div>
			<slot class="label-text" part="label"></slot>
		</label>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: Checkbox;
	}
}
