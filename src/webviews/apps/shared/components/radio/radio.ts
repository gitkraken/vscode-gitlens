import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { GlElement, observe } from '../element';
import type { RadioGroup } from './radio-group';
import { radioStyles } from './radio.css';

import '../code-icon';

@customElement('gl-radio')
export class Radio extends GlElement {
	static override readonly styles = [radioStyles];

	@property({ type: Boolean })
	disabled: boolean;

	@property({ type: String })
	value: string = '';

	@property({ type: String })
	name: string = '';

	@state()
	checked: boolean = false;

	private _parentGroup: RadioGroup | null = null;
	private set parentGroup(value: RadioGroup | null) {
		this._parentGroup = value;
	}
	private get parentGroup(): RadioGroup {
		if (!this._parentGroup) {
			console.error('Do not use radio without radio-group');
			throw new Error('Do not use radio without radio-group');
		}
		return this._parentGroup;
	}

	constructor() {
		super();
		this.disabled = false;
	}

	handleClick() {
		this.parentGroup.setValue(this.value);
	}

	renderCircle() {
		return html` <code-icon icon="circle-filled"></code-icon> `;
	}

	override connectedCallback(): void {
		this.parentGroup = this.closest<RadioGroup>('gl-radio-group');
		super.connectedCallback();
	}

	@observe(['value'])
	private subscribeElement() {
		if (this.value) this.parentGroup.subscribeRadioElement(this);
	}

	override disconnectedCallback(): void {
		this.parentGroup.unsubscribeRadioElement(this);
		super.disconnectedCallback();
	}

	override render() {
		console.log('render', this.value, this.checked);
		return html`<label ?aria-disabled=${this.disabled}
			><button .disabled=${this.disabled} @click=${this.handleClick}></button>
			<div class="control">${when(this.checked, this.renderCircle.bind(this))}</div>
			<slot></slot>
		</label>`;
	}
}
