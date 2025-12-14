import { SubscriptionState } from '../../../constants.subscription';
import { getTimeRemaining } from '../../../system/date';
import type {
	PaidSubscriptionPlanIds,
	Subscription,
	SubscriptionPlan,
	SubscriptionPlanIds,
	SubscriptionStateString,
} from '../models/subscription';

const orderedPlans: SubscriptionPlanIds[] = [
	'community',
	'community-with-account',
	'student',
	'pro',
	'advanced',
	'teams',
	'enterprise',
];
const orderedPaidPlans: PaidSubscriptionPlanIds[] = ['student', 'pro', 'advanced', 'teams', 'enterprise'];
export const SubscriptionUpdatedUriPathPrefix = 'did-update-subscription';
export const AiAllAccessOptInPathPrefix = 'ai-all-access-opt-in';

export function compareSubscriptionPlans(
	planA: SubscriptionPlanIds | undefined,
	planB: SubscriptionPlanIds | undefined,
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
			case 'community':
				return SubscriptionState.Community;

			case 'community-with-account': {
				if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
					return SubscriptionState.TrialReactivationEligible;
				}

				return SubscriptionState.TrialExpired;
			}
			case 'student':
			case 'pro':
			case 'advanced':
			case 'teams':
			case 'enterprise':
				return SubscriptionState.Paid;
		}
	}

	// If you have a paid license, any trial license higher tier than your paid license is considered paid
	if (compareSubscriptionPlans(actual.id, 'community-with-account') > 0) {
		return SubscriptionState.Paid;
	}
	switch (effective.id) {
		case 'community':
			return SubscriptionState.Community;

		case 'community-with-account': {
			if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
				return SubscriptionState.TrialReactivationEligible;
			}

			return SubscriptionState.TrialExpired;
		}

		case 'student':
		case 'pro':
		case 'advanced':
		case 'teams':
		case 'enterprise':
			return SubscriptionState.Trial;
	}
}

export function getSubscriptionNextPaidPlanId(subscription: Optional<Subscription, 'state'>): PaidSubscriptionPlanIds {
	let next = orderedPaidPlans.indexOf(subscription.plan.actual.id as PaidSubscriptionPlanIds) + 1;
	// Skip the student plan since we cannot determine if the user is student-eligible or not
	if (next === 0) {
		next++;
	}

	if (next >= orderedPaidPlans.length) return 'enterprise'; // Not sure what to do here

	return orderedPaidPlans[next] ?? 'pro';
}

export function getSubscriptionPlan(
	id: SubscriptionPlanIds,
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
	id: SubscriptionPlanIds,
): 'Community' | 'Student' | 'Pro' | 'Advanced' | 'Business' | 'Enterprise' {
	switch (id) {
		case 'student':
			return 'Student';
		case 'pro':
			return 'Pro';
		case 'advanced':
			return 'Advanced';
		case 'teams':
			return 'Business';
		case 'enterprise':
			return 'Enterprise';
		default:
			return 'Community';
	}
}

export function getSubscriptionPlanOrder(id: SubscriptionPlanIds | undefined): number {
	return id != null ? orderedPlans.indexOf(id) : -1;
}

/** Only for gk.dev `planType` query param */
export function getSubscriptionPlanType(
	id: SubscriptionPlanIds,
): 'STUDENT' | 'PRO' | 'ADVANCED' | 'BUSINESS' | 'ENTERPRISE' {
	switch (id) {
		case 'student':
			return 'STUDENT';
		case 'advanced':
			return 'ADVANCED';
		case 'teams':
			return 'BUSINESS';
		case 'enterprise':
			return 'ENTERPRISE';
		default:
			return 'PRO';
	}
}

/** Gets the "product" (fully qualified) plan name for the given plan id */
export function getSubscriptionProductPlanName(id: SubscriptionPlanIds): string {
	return `GitLens ${getSubscriptionPlanName(id)}`;
}

/** Gets the "product" (fully qualified) plan name for the given subscription state */
export function getSubscriptionProductPlanNameFromState(
	state: SubscriptionState,
	planId?: SubscriptionPlanIds,
	effectivePlanId?: SubscriptionPlanIds,
): string {
	switch (state) {
		case SubscriptionState.Community:
		case SubscriptionState.Trial:
			return `${effectivePlanId === 'student' ? getSubscriptionProductPlanName('student') : getSubscriptionProductPlanName('pro')} Trial`;
		// return `${getSubscriptionProductPlanName(
		// 	_effectivePlanId != null &&
		// 		compareSubscriptionPlans(_effectivePlanId, planId ?? 'pro') > 0
		// 		? _effectivePlanId
		// 		: planId ?? 'pro',
		// )} Trial`;
		case SubscriptionState.TrialExpired:
			return getSubscriptionProductPlanName('community-with-account');
		case SubscriptionState.TrialReactivationEligible:
			return getSubscriptionProductPlanName('community-with-account');
		case SubscriptionState.VerificationRequired:
			return `${getSubscriptionProductPlanName(planId ?? 'pro')} (Unverified)`;
		default:
			return getSubscriptionProductPlanName(planId ?? 'pro');
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

export function isSubscriptionPaidPlan(id: SubscriptionPlanIds): id is PaidSubscriptionPlanIds {
	return orderedPaidPlans.includes(id as PaidSubscriptionPlanIds);
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
				'community',
				false,
				0,
				undefined,
				subscription?.plan?.actual?.startedOn != null
					? new Date(subscription.plan.actual.startedOn)
					: undefined,
			),
			effective: getSubscriptionPlan(
				'community',
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
