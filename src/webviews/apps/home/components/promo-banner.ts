import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { PromosContext } from '../../shared/contexts/promos';
import { promosContext } from '../../shared/contexts/promos';
import '../../shared/components/promo';

@customElement('gl-promo-banner')
export class GlPromoBanner extends LitElement {
	static override styles = [
		css`
			:host {
				display: block;
			}
			.promo-banner {
				text-align: center;
				margin-bottom: 1rem;
			}
			.promo-banner--eyebrow {
				color: var(--color-foreground--50);
				margin-bottom: 0.2rem;
			}
			.promo-banner:has(gl-promo:not([has-promo])) {
				display: none;
			}
		`,
	];

	@consume({ context: promosContext })
	private promos!: PromosContext;

	override render(): unknown {
		return html`
			<gl-promo
				.promoPromise=${this.promos.getApplicablePromo(undefined, 'home')}
				.source="${{ source: 'home' } as const}"
				class="promo-banner promo-banner--eyebrow"
				id="promo"
				type="link"
			></gl-promo>
		`;
	}
}
