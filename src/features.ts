import type { StoredFeaturePreviewUsagePeriod } from './constants.storage';
import { proFeaturePreviewUsageDurationInDays, proFeaturePreviewUsages } from './constants.subscription';
import type { RepositoryVisibility } from './git/gitProvider';
import type { RequiredSubscriptionPlans, Subscription } from './plus/gk/models/subscription';
import { capitalize } from './system/string';

export type Features = 'stashes' | 'timeline' | 'worktrees' | 'stashOnlyStaged' | 'forceIfIncludes';

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
export type ProAIFeatures =
	| 'explain-changes'
	| 'generate-create-cloudPatch'
	| 'generate-create-codeSuggestion'
	| 'generate-stashMessage';

export type AdvancedFeatures = AdvancedAIFeatures;
export type AdvancedAIFeatures = 'generate-changelog' | 'generate-create-pullRequest' | 'generate-rebase';

export type AIFeatures = 'generate-commitMessage' | ProAIFeatures | AdvancedAIFeatures;

export function isProFeature(feature: PlusFeatures): feature is ProFeatures {
	switch (feature) {
		case 'timeline':
		case 'worktrees':
		case 'graph':
			return true;
		default:
			return isProFeatureOnAllRepos(feature);
	}
}

export function isAdvancedFeature(feature: PlusFeatures): feature is AdvancedFeatures {
	switch (feature) {
		case 'generate-changelog':
		case 'generate-create-pullRequest':
			return true;
		default:
			return false;
	}
}

export function isProFeatureOnAllRepos(feature: PlusFeatures): feature is ProFeatures {
	switch (feature) {
		case 'launchpad':
		case 'startWork':
		case 'associateIssueWithBranch':
		case 'explain-changes':
		case 'generate-create-cloudPatch':
		case 'generate-create-codeSuggestion':
		case 'generate-stashMessage':
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
