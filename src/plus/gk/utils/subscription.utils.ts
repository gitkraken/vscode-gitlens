import type { SubscriptionStateString } from '../../../constants.subscription';
import { SubscriptionPlanId, SubscriptionState } from '../../../constants.subscription';
import { getTimeRemaining } from '../../../system/date';
import type { PaidSubscriptionPlans, Subscription, SubscriptionPlan } from '../models/subscription';

const orderedPlans = [
	SubscriptionPlanId.Community,
	SubscriptionPlanId.CommunityWithAccount,
	SubscriptionPlanId.Pro,
	SubscriptionPlanId.Advanced,
	SubscriptionPlanId.Business,
	SubscriptionPlanId.Enterprise,
];
const orderedPaidPlans = [
	SubscriptionPlanId.Pro,
	SubscriptionPlanId.Advanced,
	SubscriptionPlanId.Business,
	SubscriptionPlanId.Enterprise,
];
export const SubscriptionUpdatedUriPathPrefix = 'did-update-subscription';

export function compareSubscriptionPlans(
	planA: SubscriptionPlanId | undefined,
	planB: SubscriptionPlanId | undefined,
): number {
	return getSubscriptionPlanOrder(planA) - getSubscriptionPlanOrder(planB);
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
					return SubscriptionState.TrialReactivationEligible;
				}

				return SubscriptionState.TrialExpired;
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
				return SubscriptionState.TrialReactivationEligible;
			}

			return SubscriptionState.TrialExpired;
		}

		case SubscriptionPlanId.Pro:
		case SubscriptionPlanId.Advanced:
		case SubscriptionPlanId.Business:
		case SubscriptionPlanId.Enterprise:
			return SubscriptionState.Trial;
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
		name: getSubscriptionProductPlanName(id),
		bundle: bundle,
		cancelled: cancelled,
		organizationId: organizationId,
		trialReactivationCount: trialReactivationCount,
		nextTrialOptInDate: nextTrialOptInDate,
		startedOn: (startedOn ?? new Date()).toISOString(),
		expiresOn: expiresOn != null ? expiresOn.toISOString() : undefined,
	};
}

/** Gets the plan name for the given plan id */
export function getSubscriptionPlanName(
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

export function getSubscriptionPlanOrder(id: SubscriptionPlanId | undefined): number {
	return id != null ? orderedPlans.indexOf(id) : -1;
}

/** Only for gk.dev `planType` query param */
export function getSubscriptionPlanType(id: SubscriptionPlanId): 'PRO' | 'ADVANCED' | 'BUSINESS' | 'ENTERPRISE' {
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

/** Gets the "product" (fully qualified) plan name for the given plan id */
export function getSubscriptionProductPlanName(id: SubscriptionPlanId): string {
	return `GitLens ${getSubscriptionPlanName(id)}`;
}

/** Gets the "product" (fully qualified) plan name for the given subscription state */
export function getSubscriptionProductPlanNameFromState(
	state: SubscriptionState,
	planId?: SubscriptionPlanId,
	_effectivePlanId?: SubscriptionPlanId,
): string {
	switch (state) {
		case SubscriptionState.Community:
		case SubscriptionState.Trial:
			return `${getSubscriptionProductPlanName(SubscriptionPlanId.Pro)} Trial`;
		// return `${getSubscriptionProductPlanName(
		// 	_effectivePlanId != null &&
		// 		compareSubscriptionPlans(_effectivePlanId, planId ?? SubscriptionPlanId.Pro) > 0
		// 		? _effectivePlanId
		// 		: planId ?? SubscriptionPlanId.Pro,
		// )} Trial`;
		case SubscriptionState.TrialExpired:
			return getSubscriptionProductPlanName(SubscriptionPlanId.CommunityWithAccount);
		case SubscriptionState.TrialReactivationEligible:
			return getSubscriptionProductPlanName(SubscriptionPlanId.CommunityWithAccount);
		case SubscriptionState.VerificationRequired:
			return `${getSubscriptionProductPlanName(planId ?? SubscriptionPlanId.Pro)} (Unverified)`;
		default:
			return getSubscriptionProductPlanName(planId ?? SubscriptionPlanId.Pro);
	}
}

export function getSubscriptionStateString(state: SubscriptionState | undefined): SubscriptionStateString {
	switch (state) {
		case SubscriptionState.VerificationRequired:
			return 'verification';
		case SubscriptionState.Community:
			return 'free';
		case SubscriptionState.Trial:
			return 'trial';
		case SubscriptionState.TrialExpired:
			return 'trial-expired';
		case SubscriptionState.TrialReactivationEligible:
			return 'trial-reactivation-eligible';
		case SubscriptionState.Paid:
			return 'paid';
		default:
			return 'unknown';
	}
}

export function getSubscriptionTimeRemaining(
	subscription: Optional<Subscription, 'state'>,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
): number | undefined {
	return getTimeRemaining(subscription.plan.effective.expiresOn, unit);
}

export function isSubscriptionPaid(subscription: Optional<Subscription, 'state'>): boolean {
	return isSubscriptionPaidPlan(subscription.plan.actual.id);
}

export function isSubscriptionPaidPlan(id: SubscriptionPlanId): id is PaidSubscriptionPlans {
	return orderedPaidPlans.includes(id);
}

export function isSubscriptionExpired(subscription: Optional<Subscription, 'state'>): boolean {
	const remaining = getSubscriptionTimeRemaining(subscription);
	return remaining != null && remaining <= 0;
}

export function isSubscriptionTrial(subscription: Optional<Subscription, 'state'>): boolean {
	if (subscription.state != null) {
		return subscription.state === SubscriptionState.Trial;
	}

	return subscription.plan.actual.id !== subscription.plan.effective.id;
}

export function isSubscriptionTrialOrPaidFromState(state: SubscriptionState | undefined): boolean {
	return state != null ? state === SubscriptionState.Trial || state === SubscriptionState.Paid : false;
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
