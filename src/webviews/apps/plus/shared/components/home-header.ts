import { css, html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import type { GlPromoBanner } from '../../../home/components/promo-banner.js';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css.js';
import type { GlAccountBar } from './account-bar.js';
import './account-bar.js';
import '../../../home/components/onboarding.js';
import '../../../home/components/promo-banner.js';
import '../../../shared/components/button.js';
import '../../../shared/components/button-container.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/overlays/popover.js';
// import '../../../shared/components/snow.js';

@customElement('gl-home-header')
export class GlHomeHeader extends LitElement {
	static override styles = [
		elementBase,
		linkBase,
		css`
			:host {
				display: block;
			}

			gl-promo-banner {
				margin: 0 var(--gl-space-2) var(--gl-space-6);
			}

			gl-promo-banner:has(gl-promo:not([has-promo])) {
				display: none;
			}
		`,
	];

	@query('gl-account-bar')
	private accountBar!: GlAccountBar;

	@query('gl-promo-banner')
	private promoBanner!: GlPromoBanner;

	override render(): unknown {
		return html`<gl-promo-banner></gl-promo-banner>
			<gl-account-bar></gl-account-bar>
			<gl-onboarding></gl-onboarding>`;
	}

	show(): void {
		// `show()` may be called before the first render resolves the queried bar.
		this.accountBar?.show();
	}

	refreshPromo(): void {
		this.promoBanner?.requestUpdate();
	}
}
