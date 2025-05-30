import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { Promo } from '../../../../plus/gk/account/promos';

@customElement('gl-promo')
export class GlPromo extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}

			.promo {
				margin: 0;
				margin-top: 0.8rem;
				text-align: center;
			}

			.header {
				margin-right: 0.4rem;
			}

			.content {
				font-size: smaller;
			}

			.muted {
				opacity: 0.7;
			}

			.link {
				display: block;
				color: inherit;
				max-width: 100%;
				text-align: center;
				text-decoration: none;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.link:hover {
				color: inherit;
				text-decoration: underline;
			}
		`,
	];

	@property({ type: Object })
	promo: Promo | undefined;

	@property({ reflect: true, type: String })
	type: 'link' | 'info' = 'info';

	@property({ reflect: true, type: Boolean, attribute: 'has-promo' })
	get hasPromo() {
		return this.promo != null;
	}

	override render() {
		if (!this.promo) return;

		const promoHtml = this.renderPromo(this.promo);
		if (!promoHtml) return;

		if (this.type === 'link') {
			return html`<a
				class="link"
				href="${this.promo.command?.command ?? 'command:gitlens.plus.upgrade'}"
				title="${ifDefined(this.promo.command?.tooltip)}"
				>${promoHtml}</a
			>`;
		}

		return html`<p class="promo">${promoHtml}</p>`;
	}

	private renderPromo(promo: Promo) {
		// NOTE: Don't add a default case or return at the end, so that if we add a new promo the build will break without handling it
		switch (promo.key) {
			case 'pro50':
				return html`<span class="content${this.type === 'link' ? nothing : ' muted'}"
					><b>Save 33% or more</b> on your 1st seat of Pro</span
				>`;

			case 'gitlens16':
				return html`<span class="content${this.type === 'link' ? nothing : ' muted'}"
					><b>Save more than 55%</b> during our GitLens 16 sale!</span
				>`;
		}
	}
}
