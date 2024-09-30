import type { PromoKeys } from '../../../constants.subscription';
import { SubscriptionState } from '../../../constants.subscription';

export interface Promo {
	readonly key: PromoKeys;
	readonly code?: string;
	readonly states?: SubscriptionState[];
	readonly expiresOn?: number;
	readonly startsOn?: number;

	readonly command?: `command:${string}`;
	readonly commandTooltip?: string;
}

// Must be ordered by applicable order
const promos: Promo[] = [
	{
		key: 'launchpad',
		code: 'GLLAUNCHPAD24',
		states: [
			SubscriptionState.Community,
			SubscriptionState.ProPreview,
			SubscriptionState.ProPreviewExpired,
			SubscriptionState.ProTrial,
			SubscriptionState.ProTrialExpired,
			SubscriptionState.ProTrialReactivationEligible,
		],
		expiresOn: new Date('2024-09-27T06:59:00.000Z').getTime(),
		commandTooltip: 'Launchpad Sale: Save 75% or more on GitLens Pro',
	},
	{
		key: 'launchpad-extended',
		code: 'GLLAUNCHPAD24',
		states: [
			SubscriptionState.Community,
			SubscriptionState.ProPreview,
			SubscriptionState.ProPreviewExpired,
			SubscriptionState.ProTrial,
			SubscriptionState.ProTrialExpired,
			SubscriptionState.ProTrialReactivationEligible,
		],
		startsOn: new Date('2024-09-27T06:59:00.000Z').getTime(),
		expiresOn: new Date('2024-10-14T06:59:00.000Z').getTime(),
		commandTooltip: 'Launchpad Sale: Save 75% or more on GitLens Pro',
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
		commandTooltip: 'Limited-Time Sale: Save 33% or more on your 1st seat of Pro. See your special price',
	},
];

export function getApplicablePromo(state: number | undefined, key?: PromoKeys): Promo | undefined {
	if (state == null) return undefined;

	for (const promo of promos) {
		if ((key == null || key === promo.key) && isPromoApplicable(promo, state)) return promo;
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
