import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { baseStyles, pulseStyles } from './indicator.css';

@customElement('gl-indicator')
export class GlIndicator extends LitElement {
	static override styles = [baseStyles, pulseStyles];

	@property({ type: Boolean })
	pulse = false;

	override render() {
		return html`<slot class="indicator${this.pulse ? ' indicator--pulse' : ''}"></slot>`;
	}
}
