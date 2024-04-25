import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { badgeBase } from './badges.css';

@customElement('gl-badge')
export class Badge extends LitElement {
	static override styles = [badgeBase];

	override render() {
		return html`<slot class="badge" part="base"></slot>`;
	}
}
