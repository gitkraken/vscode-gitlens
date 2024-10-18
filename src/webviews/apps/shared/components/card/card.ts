import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { cardStyles } from './card.css';

export const cardTagName = 'gl-card';

@customElement(cardTagName)
export class GlCard extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = [cardStyles];

	@property({ type: Boolean, reflect: true })
	active = false;

	@property()
	href?: string;

	override render() {
		if (this.href != null) {
			return html`<a class="card${this.active ? ' is-active' : ''}" href=${this.href}
				>${this.renderContent()}</a
			>`;
		}

		return html`<div class="card${this.active ? ' is-active' : ''}">${this.renderContent()}</div>`;
	}

	private renderContent() {
		return html`
			<slot class="card__content"></slot>
			<slot name="actions" class="card__actions"></slot>
		`;
	}

	override focus(options?: FocusOptions) {
		if (this.href != null) {
			this.shadowRoot?.querySelector('a')?.focus(options);
		} else {
			super.focus(options);
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[cardTagName]: GlCard;
	}
}
