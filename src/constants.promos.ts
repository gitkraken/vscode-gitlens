import { SubscriptionState } from './constants.subscription';
import type { Promo } from './plus/gk/models/promo';

export type PromoKeys = 'pro50';

// Must be ordered by applicable order
export const promos: Promo[] = [
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
		command: { tooltip: 'Save 55% or more on your 1st seat of Pro.' },
		locations: ['home', 'account', 'badge', 'gate'],
		quickpick: {
			detail: '$(star-full) Save 55% or more on your 1st seat of Pro',
		},
	},
];
