import type { RequiredSubscriptionPlans, Subscription } from './subscription';

// Keep the order of these stable for log correlation
export const enum Features {
	Stashes = 0,
	Timeline,
	Worktrees,
	Graph,
	LogBranchAndTagTips,
}

export type FeatureAccess =
	| { allowed: true; subscription: { current: Subscription; required?: undefined } }
	| { allowed: false; subscription: { current: Subscription; required?: RequiredSubscriptionPlans } };

// Keep the order of these stable for log correlation
export const enum PlusFeatures {
	Timeline = 0,
	Worktrees,
	Graph,
}
