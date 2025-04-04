import type { StoredFeaturePreviewUsagePeriod } from './constants.storage';
import { proFeaturePreviewUsageDurationInDays, proFeaturePreviewUsages } from './constants.subscription';
import type { RepositoryVisibility } from './git/gitProvider';
import type { RequiredSubscriptionPlans, Subscription } from './plus/gk/models/subscription';
import { capitalize } from './system/string';

// GitFeature's must start with `git:` to be recognized in all usages
export type GitFeature =
	| 'git:for-each-ref:worktreePath'
	| 'git:ignoreRevsFile'
	| 'git:merge-tree'
	| 'git:push:force-if-includes'
	| 'git:rev-parse:end-of-options'
	| 'git:stash:push:pathspecs'
	| 'git:stash:push:staged'
	| 'git:stash:push:stdin'
	| 'git:status:find-renames'
	| 'git:status:porcelain-v2'
	| 'git:worktrees'
	| 'git:worktrees:delete'
	| 'git:worktrees:list';

export const gitFeaturesByVersion = new Map<GitFeature, string>([
	['git:for-each-ref:worktreePath', '2.23'],
	['git:ignoreRevsFile', '2.23'],
	['git:merge-tree', '2.33'],
	['git:push:force-if-includes', '2.30.0'],
	['git:rev-parse:end-of-options', '2.30'],
	['git:stash:push:pathspecs', '2.13.2'],
	['git:stash:push:staged', '2.35.0'],
	['git:stash:push:stdin', '2.30.0'],
	['git:status:find-renames', '2.18'],
	['git:status:porcelain-v2', '2.11'],
	['git:worktrees', '2.17.0'],
	['git:worktrees:delete', '2.17.0'],
	['git:worktrees:list', '2.7.6'],
]);

export type Features = 'stashes' | 'timeline' | GitFeature;

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

export type PlusFeatures = ProFeatures | AdvancedFeatures;

export type ProFeatures =
	| 'timeline'
	| 'worktrees'
	| 'graph'
	| 'launchpad'
	| 'startWork'
	| 'associateIssueWithBranch'
	| ProAIFeatures;
export type ProAIFeatures = 'explainCommit' | 'generateCreateDraft' | 'generateStashMessage';

export type AdvancedFeatures = AdvancedAIFeatures;
export type AdvancedAIFeatures = 'generateChangelog' | 'generateCreatePullRequest';

export type AIFeatures = ProAIFeatures | AdvancedAIFeatures;

export function isAdvancedFeature(feature: PlusFeatures): feature is AdvancedFeatures {
	switch (feature) {
		case 'generateChangelog':
		case 'generateCreatePullRequest':
			return true;
		default:
			return false;
	}
}

export type FeaturePreviews = 'graph';
export const featurePreviews: FeaturePreviews[] = ['graph'];

export type FeaturePreviewStatus = 'eligible' | 'active' | 'expired';

export interface FeaturePreview {
	feature: FeaturePreviews;
	usages: StoredFeaturePreviewUsagePeriod[];
}

export function getFeaturePreviewLabel(feature: FeaturePreviews): string {
	switch (feature) {
		case 'graph':
			return 'Commit Graph';
		default:
			return capitalize(feature);
	}
}

const hoursInMs = 3600000;

export function getFeaturePreviewStatus(preview: FeaturePreview): FeaturePreviewStatus {
	const usages = preview?.usages;
	if (!usages?.length) return 'eligible';

	const remainingHours = (new Date(usages[usages.length - 1].expiresOn).getTime() - new Date().getTime()) / hoursInMs;

	if (
		usages.length <= proFeaturePreviewUsages &&
		remainingHours > 0 &&
		remainingHours < 24 * proFeaturePreviewUsageDurationInDays
	) {
		return 'active';
	}

	return 'expired';
}
