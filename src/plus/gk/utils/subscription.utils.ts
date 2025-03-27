import type { SubscriptionStateString } from '../../../constants.subscription';
import { SubscriptionPlanId, SubscriptionState } from '../../../constants.subscription';
import { createFromDateDelta, getDateDifference } from '../../../system/date';
import type { PaidSubscriptionPlans, Subscription, SubscriptionPlan } from '../models/subscription';

export const SubscriptionUpdatedUriPathPrefix = 'did-update-subscription';

export function getSubscriptionStateName(
	state: SubscriptionState,
	planId?: SubscriptionPlanId,
	_effectivePlanId?: SubscriptionPlanId,
): string {
	switch (state) {
		case SubscriptionState.Community:
		case SubscriptionState.ProPreviewExpired:
			return getSubscriptionPlanName(SubscriptionPlanId.Community);
		case SubscriptionState.ProPreview:
			return `${getSubscriptionPlanName(SubscriptionPlanId.Pro)} Preview`;
		case SubscriptionState.ProTrial:
			return `${getSubscriptionPlanName(SubscriptionPlanId.Pro)} Trial`;
		// return `${getSubscriptionPlanName(
		// 	effectivePlanId != null &&
		// 		getSubscriptionPlanPriority(effectivePlanId) >
		// 			getSubscriptionPlanPriority(planId ?? SubscriptionPlanId.Pro)
		// 		? effectivePlanId
		// 		: planId ?? SubscriptionPlanId.Pro,
		// )} Trial`;
		case SubscriptionState.ProTrialExpired:
			return getSubscriptionPlanName(SubscriptionPlanId.CommunityWithAccount);
		case SubscriptionState.ProTrialReactivationEligible:
			return getSubscriptionPlanName(SubscriptionPlanId.CommunityWithAccount);
		case SubscriptionState.VerificationRequired:
			return `${getSubscriptionPlanName(planId ?? SubscriptionPlanId.Pro)} (Unverified)`;
		default:
			return getSubscriptionPlanName(planId ?? SubscriptionPlanId.Pro);
	}
}

export function getSubscriptionStateString(state: SubscriptionState | undefined): SubscriptionStateString {
	switch (state) {
		case SubscriptionState.VerificationRequired:
			return 'verification';
		case SubscriptionState.Community:
			return 'free';
		case SubscriptionState.ProPreview:
			return 'preview';
		case SubscriptionState.ProPreviewExpired:
			return 'preview-expired';
		case SubscriptionState.ProTrial:
			return 'trial';
		case SubscriptionState.ProTrialExpired:
			return 'trial-expired';
		case SubscriptionState.ProTrialReactivationEligible:
			return 'trial-reactivation-eligible';
		case SubscriptionState.Paid:
			return 'paid';
		default:
			return 'unknown';
	}
}

export function computeSubscriptionState(subscription: Optional<Subscription, 'state'>): SubscriptionState {
	const {
		account,
		plan: { actual, effective },
		previewTrial: preview,
	} = subscription;

	if (account?.verified === false) return SubscriptionState.VerificationRequired;

	if (
		actual.id === effective.id ||
		getSubscriptionPlanPriority(actual.id) > getSubscriptionPlanPriority(effective.id)
	) {
		switch (actual.id === effective.id ? effective.id : actual.id) {
			case SubscriptionPlanId.Community:
				return preview == null ? SubscriptionState.Community : SubscriptionState.ProPreviewExpired;

			case SubscriptionPlanId.CommunityWithAccount: {
				if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
					return SubscriptionState.ProTrialReactivationEligible;
				}

				return SubscriptionState.ProTrialExpired;
			}

			case SubscriptionPlanId.Pro:
			case SubscriptionPlanId.Advanced:
			case SubscriptionPlanId.Teams:
			case SubscriptionPlanId.Enterprise:
				return SubscriptionState.Paid;
		}
	}

	// If you have a paid license, any trial license higher tier than your paid license is considered paid
	if (getSubscriptionPlanPriority(actual.id) > getSubscriptionPlanPriority(SubscriptionPlanId.CommunityWithAccount)) {
		return SubscriptionState.Paid;
	}
	switch (effective.id) {
		case SubscriptionPlanId.Community:
			return preview == null ? SubscriptionState.Community : SubscriptionState.ProPreview;

		case SubscriptionPlanId.CommunityWithAccount: {
			if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
				return SubscriptionState.ProTrialReactivationEligible;
			}

			return SubscriptionState.ProTrialExpired;
		}

		case SubscriptionPlanId.Pro:
		case SubscriptionPlanId.Advanced:
		case SubscriptionPlanId.Teams:
		case SubscriptionPlanId.Enterprise:
			return actual.id === SubscriptionPlanId.Community
				? SubscriptionState.ProPreview
				: SubscriptionState.ProTrial;
	}
}

export function getSubscriptionPlan(
	id: SubscriptionPlanId,
	bundle: boolean,
	trialReactivationCount: number,
	organizationId: string | undefined,
	startedOn?: Date,
	expiresOn?: Date,
	cancelled: boolean = false,
	nextTrialOptInDate?: string,
): SubscriptionPlan {
	return {
		id: id,
		name: getSubscriptionPlanName(id),
		bundle: bundle,
		cancelled: cancelled,
		organizationId: organizationId,
		trialReactivationCount: trialReactivationCount,
		nextTrialOptInDate: nextTrialOptInDate,
		startedOn: (startedOn ?? new Date()).toISOString(),
		expiresOn: expiresOn != null ? expiresOn.toISOString() : undefined,
	};
}

export function getSubscriptionPlanName(id: SubscriptionPlanId): string {
	return `GitLens ${getSubscriptionPlanTier(id)}`;
}

export function getSubscriptionPlanTier(
	id: SubscriptionPlanId,
): 'Community' | 'Pro' | 'Advanced' | 'Teams' | 'Enterprise' {
	switch (id) {
		case SubscriptionPlanId.Pro:
			return 'Pro';
		case SubscriptionPlanId.Advanced:
			return 'Advanced';
		case SubscriptionPlanId.Teams:
			return 'Teams';
		case SubscriptionPlanId.Enterprise:
			return 'Enterprise';
		default:
			return 'Community';
	}
}
const plansPriority = new Map<SubscriptionPlanId | undefined, number>([
	[undefined, -1],
	[SubscriptionPlanId.Community, 0],
	[SubscriptionPlanId.CommunityWithAccount, 1],
	[SubscriptionPlanId.Pro, 2],
	[SubscriptionPlanId.Advanced, 3],
	[SubscriptionPlanId.Teams, 4],
	[SubscriptionPlanId.Enterprise, 5],
]);

export function getSubscriptionPlanPriority(id: SubscriptionPlanId | undefined): number {
	return plansPriority.get(id) ?? -1;
}

export function getSubscriptionTimeRemaining(
	subscription: Optional<Subscription, 'state'>,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
): number | undefined {
	return getTimeRemaining(subscription.plan.effective.expiresOn, unit);
}

export function getTimeRemaining(
	expiresOn: string | undefined,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
): number | undefined {
	return expiresOn != null ? getDateDifference(Date.now(), new Date(expiresOn), unit, Math.round) : undefined;
}

export function isSubscriptionPaid(subscription: Optional<Subscription, 'state'>): boolean {
	return isSubscriptionPaidPlan(subscription.plan.actual.id);
}

export function isSubscriptionPaidPlan(id: SubscriptionPlanId): id is PaidSubscriptionPlans {
	return id !== SubscriptionPlanId.Community && id !== SubscriptionPlanId.CommunityWithAccount;
}

export function isSubscriptionExpired(subscription: Optional<Subscription, 'state'>): boolean {
	const remaining = getSubscriptionTimeRemaining(subscription);
	return remaining != null && remaining <= 0;
}

export function isSubscriptionTrial(subscription: Optional<Subscription, 'state'>): boolean {
	return subscription.plan.actual.id !== subscription.plan.effective.id;
}

export function isSubscriptionInProTrial(subscription: Optional<Subscription, 'state'>): boolean {
	if (
		subscription.account == null ||
		!isSubscriptionTrial(subscription) ||
		isSubscriptionPreviewTrialExpired(subscription) === false
	) {
		return false;
	}

	const remaining = getSubscriptionTimeRemaining(subscription);
	return remaining != null ? remaining <= 0 : true;
}

export function isSubscriptionPreviewTrialExpired(subscription: Optional<Subscription, 'state'>): boolean | undefined {
	const remaining = getTimeRemaining(subscription.previewTrial?.expiresOn);
	return remaining != null ? remaining <= 0 : undefined;
}

export function isSubscriptionStatePaidOrTrial(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return (
		state === SubscriptionState.Paid ||
		state === SubscriptionState.ProPreview ||
		state === SubscriptionState.ProTrial
	);
}

export function isSubscriptionStateTrial(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return state === SubscriptionState.ProPreview || state === SubscriptionState.ProTrial;
}

export function hasAccountFromSubscriptionState(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return (
		state !== SubscriptionState.Community &&
		state !== SubscriptionState.ProPreviewExpired &&
		state !== SubscriptionState.ProPreview
	);
}

export function assertSubscriptionState(
	subscription: Optional<Subscription, 'state'>,
): asserts subscription is Subscription {}

export function getCommunitySubscription(subscription?: Subscription): Subscription {
	return {
		...subscription,
		plan: {
			actual: getSubscriptionPlan(
				SubscriptionPlanId.Community,
				false,
				0,
				undefined,
				subscription?.plan?.actual?.startedOn != null
					? new Date(subscription.plan.actual.startedOn)
					: undefined,
			),
			effective: getSubscriptionPlan(
				SubscriptionPlanId.Community,
				false,
				0,
				undefined,
				subscription?.plan?.actual?.startedOn != null
					? new Date(subscription.plan.actual.startedOn)
					: undefined,
			),
		},
		account: undefined,
		activeOrganization: undefined,
		state: SubscriptionState.Community,
	};
}

export function getPreviewSubscription(days: number, subscription?: Subscription): Subscription {
	const startedOn = new Date();

	let expiresOn = new Date(startedOn);
	if (days !== 0) {
		// Normalize the date to just before midnight on the same day
		expiresOn.setHours(23, 59, 59, 999);
		expiresOn = createFromDateDelta(expiresOn, { days: days });
	}

	subscription ??= getCommunitySubscription();
	return {
		...subscription,
		plan: {
			...subscription.plan,
			effective: getSubscriptionPlan(SubscriptionPlanId.Pro, false, 0, undefined, startedOn, expiresOn),
		},
		previewTrial: {
			startedOn: startedOn.toISOString(),
			expiresOn: expiresOn.toISOString(),
		},
	};
}
