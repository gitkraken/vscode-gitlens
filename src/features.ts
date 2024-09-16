import type { RepositoryVisibility } from './git/gitProvider';
import type { RequiredSubscriptionPlans, Subscription } from './plus/gk/account/subscription';

export const enum Features {
	Stashes = 'stashes',
	Timeline = 'timeline',
	Worktrees = 'worktrees',
	StashOnlyStaged = 'stashOnlyStaged',
	ForceIfIncludes = 'forceIfIncludes',
}

export type FeatureAccess =
	| {
			allowed: true;
			subscription: { current: Subscription; required?: undefined };
			visibility?: RepositoryVisibility;
	  }
	| {
			allowed: false | 'mixed';
			subscription: { current: Subscription; required?: RequiredSubscriptionPlans };
			visibility?: RepositoryVisibility;
	  };

export type RepoFeatureAccess =
	| {
			allowed: true;
			subscription: { current: Subscription; required?: undefined };
			visibility?: RepositoryVisibility;
	  }
	| {
			allowed: false;
			subscription: { current: Subscription; required?: RequiredSubscriptionPlans };
			visibility?: RepositoryVisibility;
	  };

export const enum PlusFeatures {
	Timeline = 'timeline',
	Worktrees = 'worktrees',
	Graph = 'graph',
	Launchpad = 'launchpad',
}
