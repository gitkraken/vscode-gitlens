/**
 * Standalone Promos RPC service.
 *
 * Serves promo applicability to webviews — any surface that displays promos can compose
 * this service into its services interface. Supersedes the legacy core-scope promos request.
 *
 * NOTE: this now also serves non-promo remote product config (plan marketing copy), so the `promos` /
 * `PromosService` / `PromosContext` naming is due a rename to something like "product config". Deliberately
 * deferred — a release is imminent and the rename touches every webview that composes this service.
 */

import type { Container } from '../../container.js';
import type { PlansContent } from '../../plus/gk/models/plans.js';
import type { Promo, PromoLocation, PromoPlans } from '../../plus/gk/models/promo.js';
import { getSubscriptionNextPaidPlanId } from '../../plus/gk/utils/subscription.utils.js';

export interface ApplicablePromoParams {
	plan?: PromoPlans;
	location?: PromoLocation;
	expiringOnly?: boolean;
}

export interface ApplicablePromoResponse {
	promo: Promo | undefined;
}

/**
 * The RPC-facing surface of {@link PromosService} — the shape webviews compose into
 * their services interface (the class carries only host-only lookups).
 */
export interface ApplicablePromoService {
	getApplicablePromo(params: ApplicablePromoParams): Promise<ApplicablePromoResponse>;
	getPlans(): Promise<PlansContent>;
}

export class PromosService implements ApplicablePromoService {
	readonly #container: Container;

	constructor(container: Container) {
		this.#container = container;
	}

	async getApplicablePromo(params: ApplicablePromoParams): Promise<ApplicablePromoResponse> {
		const subscription = await this.#container.subscription.getSubscription();
		const promo = await this.#container.productConfig.getApplicablePromo(
			subscription.state,
			params.plan ?? getSubscriptionNextPaidPlanId(subscription),
			params.location,
			params.expiringOnly,
		);
		return { promo: promo };
	}

	getPlans(): Promise<PlansContent> {
		return this.#container.productConfig.getPlans();
	}
}
