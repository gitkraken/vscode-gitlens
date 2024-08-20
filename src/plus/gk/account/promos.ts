import { SubscriptionState } from './subscription';

export interface Promo {
	readonly key: string;
	readonly states?: SubscriptionState[];
	readonly expiresOn?: number;
	readonly startsOn?: number;

	readonly code?: string;
	readonly title?: string;
	readonly description?: string;
	readonly descriptionCTA?: string;
	readonly descriptionIntro?: string;
	readonly url?: string;
	readonly command?: string;
}

// Must be ordered by applicable order
const promos: Promo[] = [
	{
		key: 'devex-days',
		expiresOn: new Date('2024-09-05T06:59:00.000Z').getTime(),
		states: [
			SubscriptionState.FreePlusInTrial,
			SubscriptionState.FreePlusTrialExpired,
			SubscriptionState.FreePlusTrialReactivationEligible,
		],
		code: 'DEVEXDAYS24',
		description: 'Save up to 80% on GitLens Pro - lowest price of the year!',
		descriptionIntro: 'Sale',
	},

	{
		key: 'pro50',
		states: [
			SubscriptionState.Free,
			SubscriptionState.FreeInPreviewTrial,
			SubscriptionState.FreePlusInTrial,
			SubscriptionState.FreePlusTrialExpired,
			SubscriptionState.FreePlusTrialReactivationEligible,
		],
		description: '1st seat of Pro is now 50%+ off.',
		descriptionCTA: 'See your special price.',
	},
];

export function getApplicablePromo(state: number): Promo | undefined {
	const now = Date.now();
	for (const promo of promos) {
		if (
			(promo.states == null || promo.states.includes(state)) &&
			(promo.expiresOn == null || promo.expiresOn > now) &&
			(promo.startsOn == null || promo.startsOn < now)
		) {
			return promo;
		}
	}

	return undefined;
}
