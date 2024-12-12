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

	@property({ reflect: true })
	indicator?: 'active' | 'merging' | 'rebasing' | 'conflict';

	@property()
	href?: string;

	override render() {
		if (this.href != null) {
			return html`<a part="base" class="card${this.indicator ? ` is-${this.indicator}` : ''}" href=${this.href}
				>${this.renderContent()}</a
			>`;
		}

		return html`<div part="base" class="card${this.indicator ? ` is-${this.indicator}` : ''}">
			${this.renderContent()}
		</div>`;
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
