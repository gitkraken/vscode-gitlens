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
			/* Visibility (no promo / too narrow) is owned entirely by the header row this sits in — see
			   .titlebar__row--promo. This component only swaps which text variant shows: compact by
			   default, full once the strip can seat it. Splitting the "hidden" state across both layers
			   left an empty band: the row showed because a promo existed while the content hid itself. */
			:host {
				display: block;
				min-width: 0;
				overflow: hidden;
			}

			gl-promo::part(link) {
				color: var(--color-foreground--65);
			}

			gl-promo::part(link):hover {
				color: var(--color-foreground);
			}

			gl-promo::part(full) {
				display: none;
			}

			gl-promo::part(compact) {
				display: inline;
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
	private _pending: Promise<Promo | undefined> | undefined;
	private _promoFor: Subscription | undefined;
	private _promoForGeneration: number | undefined;

	/** Re-requested when the subscription changes OR the promo cache is invalidated. Both keys matter:
	 * the two arrive as separate messages with no ordering guarantee, so keying on the subscription alone
	 * can capture a stale cached answer and pin it (see PromosContext.generation).
	 *
	 * The served promise (`_promo`) only advances when the request that OWNS the swap resolves. That one
	 * rule covers two hazards at once: a slower stale response can't overwrite `hasPromo` after a newer
	 * one (last-issued wins, not last-resolved), and during a refetch the previous content keeps showing
	 * instead of `<gl-promo>` rendering a pending promise as a blank strip. */
	private getPromo(subscription: Subscription | undefined, generation: number): Promise<Promo | undefined> {
		if (this._promo == null || this._promoFor !== subscription || this._promoForGeneration !== generation) {
			this._promoFor = subscription;
			this._promoForGeneration = generation;

			const request: Promise<Promo | undefined> = this.promos
				.getApplicablePromo(undefined, 'graph', true)
				.then(promo => {
					if (this._pending === request) {
						this._pending = undefined;
						this._promo = request;
						this.hasPromo = promo?.content?.webview?.link != null;
						// The promo may change without `hasPromo` changing (one campaign replacing
						// another), so an explicit re-render is needed to hand `<gl-promo>` the new promise
						this.requestUpdate();
					}
					return promo;
				});
			this._pending = request;
			// Nothing previous to keep showing on the very first request
			this._promo ??= request;
		}
		return this._promo;
	}

	override render(): unknown {
		// Reading the signals here is what subscribes this component to both of them
		const subscription = this._subscription?.subscription.get();
		const generation = this.promos.generation.get();

		return html`<gl-promo
			.promoPromise=${this.getPromo(subscription, generation)}
			.source=${{ source: 'graph-header' } as const}
			type="link"
		></gl-promo>`;
	}
}
