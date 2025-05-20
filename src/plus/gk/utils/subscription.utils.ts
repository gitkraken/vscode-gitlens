import type { SubscriptionStateString } from '../../../constants.subscription';
import { SubscriptionPlanId, SubscriptionState } from '../../../constants.subscription';
import { getDateDifference } from '../../../system/date';
import type { PaidSubscriptionPlans, Subscription, SubscriptionPlan } from '../models/subscription';

export const SubscriptionUpdatedUriPathPrefix = 'did-update-subscription';

export function compareSubscriptionPlans(
	planA: SubscriptionPlanId | undefined,
	planB: SubscriptionPlanId | undefined,
): number {
	return getSubscriptionPlanPriority(planA) - getSubscriptionPlanPriority(planB);
}

export function getSubscriptionStateName(
	state: SubscriptionState,
	planId?: SubscriptionPlanId,
	_effectivePlanId?: SubscriptionPlanId,
): string {
	switch (state) {
		case SubscriptionState.Community:
		case SubscriptionState.ProTrial:
			return `${getSubscriptionPlanName(SubscriptionPlanId.Pro)} Trial`;
		// return `${getSubscriptionPlanName(
		// 	_effectivePlanId != null &&
		// 		compareSubscriptionPlans(_effectivePlanId, planId ?? SubscriptionPlanId.Pro) > 0
		// 		? _effectivePlanId
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
	} = subscription;

	if (account?.verified === false) return SubscriptionState.VerificationRequired;

	if (actual.id === effective.id || compareSubscriptionPlans(actual.id, effective.id) > 0) {
		switch (actual.id === effective.id ? effective.id : actual.id) {
			case SubscriptionPlanId.Community:
				return SubscriptionState.Community;

			case SubscriptionPlanId.CommunityWithAccount: {
				if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
					return SubscriptionState.ProTrialReactivationEligible;
				}

				return SubscriptionState.ProTrialExpired;
			}

			case SubscriptionPlanId.Pro:
			case SubscriptionPlanId.Advanced:
			case SubscriptionPlanId.Business:
			case SubscriptionPlanId.Enterprise:
				return SubscriptionState.Paid;
		}
	}

	// If you have a paid license, any trial license higher tier than your paid license is considered paid
	if (compareSubscriptionPlans(actual.id, SubscriptionPlanId.CommunityWithAccount) > 0) {
		return SubscriptionState.Paid;
	}
	switch (effective.id) {
		case SubscriptionPlanId.Community:
			return SubscriptionState.Community;

		case SubscriptionPlanId.CommunityWithAccount: {
			if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
				return SubscriptionState.ProTrialReactivationEligible;
			}

			return SubscriptionState.ProTrialExpired;
		}

		case SubscriptionPlanId.Pro:
		case SubscriptionPlanId.Advanced:
		case SubscriptionPlanId.Business:
		case SubscriptionPlanId.Enterprise:
			return SubscriptionState.ProTrial;
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
): 'Community' | 'Pro' | 'Advanced' | 'Business' | 'Enterprise' {
	switch (id) {
		case SubscriptionPlanId.Pro:
			return 'Pro';
		case SubscriptionPlanId.Advanced:
			return 'Advanced';
		case SubscriptionPlanId.Business:
			return 'Business';
		case SubscriptionPlanId.Enterprise:
			return 'Enterprise';
		default:
			return 'Community';
	}
}

export function getSubscriptionPlanTierType(id: SubscriptionPlanId): 'PRO' | 'ADVANCED' | 'BUSINESS' | 'ENTERPRISE' {
	switch (id) {
		case SubscriptionPlanId.Advanced:
			return 'ADVANCED';
		case SubscriptionPlanId.Business:
			return 'BUSINESS';
		case SubscriptionPlanId.Enterprise:
			return 'ENTERPRISE';
		default:
			return 'PRO';
	}
}

const plansPriority = new Map<SubscriptionPlanId | undefined, number>([
	[undefined, -1],
	[SubscriptionPlanId.Community, 0],
	[SubscriptionPlanId.CommunityWithAccount, 1],
	[SubscriptionPlanId.Pro, 2],
	[SubscriptionPlanId.Advanced, 3],
	[SubscriptionPlanId.Business, 4],
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
	if (subscription.account == null || !isSubscriptionTrial(subscription)) {
		return false;
	}

	const remaining = getSubscriptionTimeRemaining(subscription);
	return remaining != null ? remaining <= 0 : true;
}

export function isSubscriptionStatePaidOrTrial(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return state === SubscriptionState.Paid || state === SubscriptionState.ProTrial;
}

export function isSubscriptionStateTrial(state: SubscriptionState | undefined): boolean {
	return state === SubscriptionState.ProTrial;
}

export function hasAccountFromSubscriptionState(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return state !== SubscriptionState.Community;
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
