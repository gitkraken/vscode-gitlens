import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';

export const activeWorkTagName = 'gl-active-work';

@customElement(activeWorkTagName)
export class GlActiveWork extends LitElement {
	override render() {
		return html``;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[activeWorkTagName]: GlActiveWork;
	}
}
