import type { GitFeatures } from '@gitlens/git/features.js';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import { capitalize } from '@gitlens/utils/string.js';
import type { StoredFeaturePreviewUsagePeriod } from './constants.storage.js';
import { proFeaturePreviewUsageDurationInDays, proFeaturePreviewUsages } from './constants.subscription.js';
import type { RequiredSubscriptionPlanIds, Subscription } from './plus/gk/models/subscription.js';

// Re-export Git feature types and constants from @gitlens/git
export type { FilteredGitFeatures, GitFeatureOrPrefix, GitFeatures } from '@gitlens/git/features.js';
export { gitFeaturesByVersion, gitMinimumVersion } from '@gitlens/git/features.js';

export type Features = 'stashes' | 'timeline' | GitFeatures;

export type FeatureAccess =
	| {
			allowed: true;
			subscription: { current: Subscription; required?: undefined };
			visibility?: RepositoryVisibility;
	  }
	| {
			allowed: false | 'mixed';
			subscription: { current: Subscription; required?: RequiredSubscriptionPlanIds };
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
			subscription: { current: Subscription; required?: RequiredSubscriptionPlanIds };
			visibility?: RepositoryVisibility;
	  };

export type PlusFeatures = ProFeatures | AdvancedFeatures;

export type ProFeatures =
	| 'timeline'
	| 'worktrees'
	| 'graph'
	| 'launchpad'
	| 'startReview'
	| 'startWork'
	| 'associateIssueWithBranch'
	| ProAIFeatures;
export type ProAIFeatures =
	| 'explain-changes'
	| 'generate-create-cloudPatch'
	| 'generate-create-codeSuggestion'
	| 'generate-stashMessage'
	| 'generate-changelog'
	| 'generate-create-pullRequest'
	| 'generate-commits'
	| 'generate-searchQuery';

export type AdvancedFeatures = never;

export type AIFeatures = 'generate-commitMessage' | ProAIFeatures;

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

export function isAdvancedFeature(_feature: PlusFeatures): _feature is AdvancedFeatures {
	return false;
}

export function isProFeatureOnAllRepos(feature: PlusFeatures): feature is ProFeatures {
	switch (feature) {
		case 'launchpad':
		case 'startReview':
		case 'startWork':
		case 'associateIssueWithBranch':
		case 'explain-changes':
		case 'generate-create-cloudPatch':
		case 'generate-create-codeSuggestion':
		case 'generate-stashMessage':
		case 'generate-changelog':
		case 'generate-create-pullRequest':
		case 'generate-commits':
		case 'generate-searchQuery':
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

	const remainingHours = (new Date(usages.at(-1)!.expiresOn).getTime() - Date.now()) / hoursInMs;

	if (
		usages.length <= proFeaturePreviewUsages &&
		remainingHours > 0 &&
		remainingHours < 24 * proFeaturePreviewUsageDurationInDays
	) {
		return 'active';
	}

	return 'expired';
}
