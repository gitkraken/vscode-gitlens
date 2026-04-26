import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { badgeBase } from './badges.css.js';

export type BadgeAppearance = 'filled';

@customElement('gl-badge')
export class Badge extends LitElement {
	static override styles = [badgeBase];

	@property({ reflect: true })
	appearance?: BadgeAppearance;

	override render(): unknown {
		return html`<slot class="badge" part="base"></slot>`;
	}
}
