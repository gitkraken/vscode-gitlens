import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getApplicablePromo } from '../../../../plus/gk/account/promos';
import type { State } from '../../../home/protocol';
import { stateContext } from '../context';
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
			.promo-banner:not([has-promo]) {
				display: none;
			}
		`,
	];

	@consume<State>({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@property({ type: Boolean, reflect: true, attribute: 'has-promo' })
	get hasPromos() {
		return this.promo == null ? undefined : true;
	}

	get promo() {
		return getApplicablePromo(this._state.subscription.state, 'home');
	}

	override render() {
		if (!this.promo) {
			return nothing;
		}

		return html`
			<gl-promo .promo=${this.promo} class="promo-banner promo-banner--eyebrow" id="promo" type="link"></gl-promo>
		`;
	}
}
