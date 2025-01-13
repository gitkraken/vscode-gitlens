import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Promo } from '../../../../plus/gk/account/promos';
import type { State } from '../../../home/protocol';
import '../../shared/components/promo';
import { promoContext } from '../../shared/context';
import { stateContext } from '../context';

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
			.promo-banner:not([has-promo]) {
				display: none;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@property({ type: Boolean, reflect: true, attribute: 'has-promo' })
	hasPromos?: boolean;

	@consume({ context: promoContext, subscribe: true })
	private readonly getApplicablePromo!: typeof promoContext.__context__;

	getPromo(): Promo | undefined {
		const promo = this.getApplicablePromo(this._state.subscription.state, 'home');
		this.hasPromos = promo == null ? undefined : true;
		return promo;
	}

	override render() {
		const promo = this.getPromo();
		if (!promo) {
			return nothing;
		}

		return html`
			<gl-promo .promo=${promo} class="promo-banner promo-banner--eyebrow" id="promo" type="link"></gl-promo>
		`;
	}
}
