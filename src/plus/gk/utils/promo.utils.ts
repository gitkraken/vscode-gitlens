import type { PromoKeys } from '../../../constants.promos';
import { promos } from '../../../constants.promos';
import type { Promo, PromoLocation } from '../models/promo';

export function getApplicablePromo(
	state: number | undefined,
	location?: PromoLocation,
	key?: PromoKeys,
): Promo | undefined {
	if (state == null) return undefined;

	for (const promo of promos) {
		if ((key == null || key === promo.key) && isPromoApplicable(promo, state)) {
			if (location == null || promo.locations == null || promo.locations.includes(location)) {
				return promo;
			}

			break;
		}
	}

	return undefined;
}

function isPromoApplicable(promo: Promo, state: number): boolean {
	const now = Date.now();
	return (
		(promo.states == null || promo.states.includes(state)) &&
		(promo.expiresOn == null || promo.expiresOn > now) &&
		(promo.startsOn == null || promo.startsOn < now)
	);
}
