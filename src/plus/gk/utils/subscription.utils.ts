import { getTimeRemaining } from '@gitlens/utils/date.js';
import { SubscriptionState } from '../../../constants.subscription.js';
import type { PlansContent } from '../models/plans.js';
import type {
	PaidSubscriptionPlanIds,
	Subscription,
	SubscriptionPlan,
	SubscriptionPlanIds,
	SubscriptionStateString,
} from '../models/subscription.js';

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

/**
 * Whether this user is allowed to buy AI credit add-ons for whoever is paying: inside an organization only
 * its owner, admin, or billing contact can, and someone with no active organization is spending their own
 * money. Says nothing about whether they NEED more credits — callers still gate on the plan.
 *
 * Shared with the webviews on purpose: the Settings account panel's AI usage card and the weekly
 * usage-limit notification both decide who gets a purchase path from this one predicate, so they can't
 * drift into offering it to different people.
 */
export function canPurchaseAiCredits(subscription: Subscription): boolean {
	const role = subscription.activeOrganization?.role;
	return role == null || role === 'owner' || role === 'admin' || role === 'billing';
}

/**
 * Whether the account itself blocks access — none connected, or one whose email isn't verified.
 * Surfaces gated on this (e.g. the Commit Graph) replace their entire content with an account screen,
 * so callers routing work to one must treat it as unusable ahead of any plan/visibility check.
 */
export function isAccountAccessRequired(subscription: Subscription): boolean {
	return subscription.account == null || subscription.account.verified === false;
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

/** Substitutes every occurrence of the authored `${aiCredits}` placeholder token in plan marketing copy. */
function substituteAiCredits(text: string, credits: string): string {
	// oxlint-disable-next-line no-template-curly-in-string -- `${aiCredits}` is an authored placeholder token, not an interpolation
	return text.split('${aiCredits}').join(credits);
}

/**
 * Weekly GitKraken AI credit allowance for a paid plan — the bare figure only (e.g. `'1M'`, `'500K'`);
 * each caller composes its own "… credits/week" phrasing, since consumers phrase it differently (a plan
 * card's feature bullet, an upsell pitch sentence, a popover tooltip). Takes `PaidSubscriptionPlanIds`
 * rather than `SubscriptionPlanIds` — Community plans have no AI credit allowance at all, so the type
 * system makes passing one impossible rather than silently returning Pro's figure for it; callers with a
 * possibly-unpaid id must narrow first (see `isSubscriptionPaidPlan`).
 *
 * A trial carries its OWN, much smaller grant than the plan it previews — reading the previewed plan's
 * number here would overstate a trial's budget 4x — so `trial` short-circuits into the separate
 * `trialAiCredits` table, keyed by the plan being previewed with a `default` fallback, rather than being
 * derived from `planId` against `aiCredits`.
 */
export function getSubscriptionPlanAiCredits(
	plans: PlansContent,
	planId: PaidSubscriptionPlanIds,
	trial: boolean,
): string {
	return trial ? (plans.trialAiCredits[planId] ?? plans.trialAiCredits.default) : plans.aiCredits[planId];
}

/**
 * What the given plan includes. Each paid tier above Pro stacks on the one below it with an
 * "Everything in X" lead, mirroring how GitKraken's own pricing presents them, so the list stays short
 * enough to scan instead of restating four tiers' worth of bullets.
 */
export function getSubscriptionPlanFeatures(
	plans: PlansContent,
	planId: SubscriptionPlanIds,
	trial: boolean,
): string[] {
	// The default list is the Pro pitch, shown to Community/unpaid users as well as to Pro and Student — so a
	// Community id must resolve to Pro's figure deliberately (via the paid-plan guard), not by falling
	// through `getSubscriptionPlanAiCredits`, whose table has no entry for an unpaid id at all.
	const creditsPlanId = isSubscriptionPaidPlan(planId) ? planId : 'pro';
	const credits = getSubscriptionPlanAiCredits(plans, creditsPlanId, trial);

	const features = plans.features[planId] ?? plans.features.default;
	return features.map(f => substituteAiCredits(f, credits));
}

/**
 * What upgrading to the given plan gets you. The credit figure resolves against the PITCHED plan, not the
 * viewer's current one — these lists sell a specific tier, so Pro's bullet must always quote Pro's grant.
 */
export function getSubscriptionPlanUpgradeFeatures(plans: PlansContent, plan: 'pro' | 'advanced'): string[] {
	const credits = getSubscriptionPlanAiCredits(plans, plan, false);
	return plans.upgradeFeatures[plan].map(f => substituteAiCredits(f, credits));
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

/**
 * Which entitlement is currently active, collapsing the finer states: unverified, expired, and
 * reactivation-eligible all mean Pro isn't active. `undefined` when the state isn't known yet — callers
 * should treat that as "don't assert anything" rather than as unpaid.
 */
export function getSubscriptionEntitlement(
	state: SubscriptionState | undefined,
): 'unpaid' | 'trial' | 'paid' | undefined {
	switch (getSubscriptionStateString(state)) {
		case 'paid':
			return 'paid';
		case 'trial':
			return 'trial';
		case 'unknown':
			return undefined;
		default:
			return 'unpaid';
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
	_subscription: Optional<Subscription, 'state'>,
): asserts _subscription is Subscription {}

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
