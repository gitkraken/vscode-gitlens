import type { PromoKeys, SubscriptionState } from '../../../constants.subscription';
import type { Promo, PromoLocation } from './promos';

export const pickApplicablePromo = (
	promoList: Promo[] | undefined,
	subscriptionState: SubscriptionState | undefined,
	location?: PromoLocation,
	key?: PromoKeys,
) => {
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
export function isPromoApplicable(promo: Promo, state: number): boolean {
	const now = Date.now();
	return (
		(promo.states == null || promo.states.includes(state)) &&
		(promo.expiresOn == null || promo.expiresOn > now) &&
		(promo.startsOn == null || promo.startsOn < now)
	);
}
