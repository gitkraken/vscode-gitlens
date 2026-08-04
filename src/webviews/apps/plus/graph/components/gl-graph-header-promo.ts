import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Promo } from '../../../../../plus/gk/models/promo.js';
import type { Subscription } from '../../../../../plus/gk/models/subscription.js';
import type { PromosContext } from '../../../shared/contexts/promos.js';
import { promosContext } from '../../../shared/contexts/promos.js';
import type { SubscriptionContextState } from '../../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../../shared/contexts/subscription.js';
import '../../../shared/components/promo.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-header-promo': GlGraphHeaderPromo;
	}
}

@customElement('gl-graph-header-promo')
export class GlGraphHeaderPromo extends SignalWatcher(LitElement) {
	static override styles = [
		css`
			/* Hidden by default — "too narrow" */
			:host {
				display: none;
				min-width: 0;
				overflow: hidden;
			}

			gl-promo::part(link) {
				color: var(--color-foreground--65);
			}

			gl-promo::part(link):hover {
				color: var(--color-foreground);
			}

			/* Tight: the shortened text */
			@container graph-titlebar-promo (min-width: 24rem) {
				:host {
					display: block;
				}

				gl-promo::part(full) {
					display: none;
				}

				gl-promo::part(compact) {
					display: inline;
				}
			}

			/* Wide: the full text */
			@container graph-titlebar-promo (min-width: 50rem) {
				gl-promo::part(full) {
					display: inline;
				}

				gl-promo::part(compact) {
					display: none;
				}
			}
		`,
	];

	@consume({ context: promosContext })
	private promos!: PromosContext;

	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription?: SubscriptionContextState;

	@property({ type: Boolean, reflect: true, attribute: 'has-promo' })
	hasPromo = false;

	private _promo: Promise<Promo | undefined> | undefined;
	private _promoFor: Subscription | undefined;

	/** Re-requested whenever the subscription change */
	private getPromo(subscription: Subscription | undefined): Promise<Promo | undefined> {
		if (this._promo == null || this._promoFor !== subscription) {
			this._promoFor = subscription;
			this._promo = this.promos.getApplicablePromo(undefined, 'graph', true).then(promo => {
				this.hasPromo = promo?.content?.webview?.link != null;
				return promo;
			});
		}
		return this._promo;
	}

	override render(): unknown {
		// Reading the signal here is what subscribes this component to subscription changes
		const subscription = this._subscription?.subscription.get();

		return html`<gl-promo
			.promoPromise=${this.getPromo(subscription)}
			.source=${{ source: 'graph' } as const}
			type="link"
		></gl-promo>`;
	}
}
