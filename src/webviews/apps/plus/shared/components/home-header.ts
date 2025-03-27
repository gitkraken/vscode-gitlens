import { css, html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css';
import type { GlAccountChip } from './account-chip';
import './account-chip';
import './integrations-chip';
import '../../../home/components/onboarding';
import '../../../shared/components/button';
import '../../../shared/components/button-container';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/popover';
import '../../../shared/components/promo';
// import '../../../shared/components/snow';

@customElement('gl-home-header')
export class GlHomeHeader extends LitElement {
	static override styles = [
		elementBase,
		linkBase,
		css`
			:host {
				display: block;
			}

			.container {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 0.6rem;
			}

			.container:focus,
			.container:focus-within {
				outline: none;
			}

			/* .actions {
				flex: none;
				display: flex;
				gap: 0.2rem;
				flex-direction: row;
				align-items: center;
				justify-content: center;
			} */

			gl-promo-banner {
				margin: 0 0.2rem 0.6rem;
			}

			gl-promo-banner:has(gl-promo:not([has-promo])) {
				display: none;
			}

			.group {
				display: flex;
				align-items: center;
				gap: 0.4rem;
			}
		`,
	];

	@query('gl-account-chip')
	private accountChip!: GlAccountChip;

	override render(): unknown {
		return html`<gl-promo-banner></gl-promo-banner>
			<div class="container" tabindex="-1">
				<span class="group"><gl-account-chip></gl-account-chip></span>
				<gl-integrations-chip></gl-integrations-chip>
			</div>
			<gl-onboarding></gl-onboarding>`;
	}

	show(): void {
		this.accountChip.show();
	}
}
