import type { RequiredSubscriptionPlans, Subscription } from './subscription';

export const enum Features {
	Stashes = 'stashes',
	Timeline = 'timeline',
	Worktrees = 'worktrees',
}

export type FeatureAccess =
	| { allowed: true; subscription: { current: Subscription; required?: undefined } }
	| { allowed: false; subscription: { current: Subscription; required?: RequiredSubscriptionPlans } };

export const enum PlusFeatures {
	Timeline = 'timeline',
	Worktrees = 'worktrees',
}
