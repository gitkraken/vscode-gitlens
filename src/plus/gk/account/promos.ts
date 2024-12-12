import type { PromoKeys } from '../../../constants.subscription';
import { SubscriptionState } from '../../../constants.subscription';

export type PromoLocation = 'account' | 'badge' | 'gate' | 'home';

export interface Promo {
	readonly key: PromoKeys;
	readonly code?: string;
	readonly states?: SubscriptionState[];
	readonly expiresOn?: number;
	readonly startsOn?: number;

	readonly command?: {
		command?: `command:${string}`;
		tooltip: string;
	};
	readonly locations?: PromoLocation[];
	readonly quickpick: { detail: string };
}

// Must be ordered by applicable order
const promos: Promo[] = [
	{
		key: 'gkholiday',
		code: 'GKHOLIDAY',
		states: [
			SubscriptionState.Community,
			SubscriptionState.ProPreview,
			SubscriptionState.ProPreviewExpired,
			SubscriptionState.ProTrial,
			SubscriptionState.ProTrialExpired,
			SubscriptionState.ProTrialReactivationEligible,
		],
		startsOn: new Date('2024-12-09T06:59:00.000Z').getTime(),
		expiresOn: new Date('2025-01-07T06:59:00.000Z').getTime(),
		command: { tooltip: 'Get the gift of a better DevEx in 2025! Save up to 80% now' },
		quickpick: {
			detail: '$(star-full) Get the gift of a better DevEx in 2025! Save up to 80% now',
		},
	},
	{
		key: 'pro50',
		states: [
			SubscriptionState.Community,
			SubscriptionState.ProPreview,
			SubscriptionState.ProPreviewExpired,
			SubscriptionState.ProTrial,
			SubscriptionState.ProTrialExpired,
			SubscriptionState.ProTrialReactivationEligible,
		],
		command: { tooltip: 'Save 33% or more on your 1st seat of Pro.' },
		locations: ['account', 'badge', 'gate'],
		quickpick: {
			detail: '$(star-full) Save 33% or more on your 1st seat of Pro',
		},
	},
];

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
