import type { PromoKeys } from '../../../constants.promos';
import type { SubscriptionState } from '../../../constants.subscription';
import type { Promo, PromoLocation } from '../models/promo';

export const pickApplicablePromo = (
	promoList: Promo[] | undefined,
	subscriptionState: SubscriptionState | undefined,
	location?: PromoLocation,
	key?: PromoKeys,
): Promo | undefined => {
	if (subscriptionState == null || !promoList) return undefined;

	for (const promo of promoList) {
		if ((key == null || key === promo.key) && isPromoApplicable(promo, subscriptionState)) {
			if (location == null || promo.locations == null || promo.locations.includes(location)) {
				return promo;
			}

			break;
		}
	}

	return undefined;
};

function isPromoApplicable(promo: Promo, state: number): boolean {
	const now = Date.now();
	return (
		(promo.states == null || promo.states.includes(state)) &&
		(promo.expiresOn == null || promo.expiresOn > now) &&
		(promo.startsOn == null || promo.startsOn < now)
	);
}
