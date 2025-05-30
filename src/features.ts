import type { StoredFeaturePreviewUsagePeriod } from './constants.storage';
import { proFeaturePreviewUsageDurationInDays, proFeaturePreviewUsages } from './constants.subscription';
import type { RepositoryVisibility } from './git/gitProvider';
import type { RequiredSubscriptionPlans, Subscription } from './plus/gk/account/subscription';
import { capitalize } from './system/string';

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

export type FeaturePreviews = 'graph';
export const featurePreviews: FeaturePreviews[] = ['graph'];

export interface FeaturePreview {
	feature: FeaturePreviews;
	usages: StoredFeaturePreviewUsagePeriod[];
}

export function getFeaturePreviewLabel(feature: FeaturePreviews) {
	switch (feature) {
		case 'graph':
			return 'Commit Graph';
		default:
			return capitalize(feature);
	}
}

const hoursInMs = 3600000;

export function isFeaturePreviewActive(featurePreview?: FeaturePreview) {
	const usages = featurePreview?.usages;
	if (usages == null || usages.length === 0) return false;

	const remainingHours = (new Date(usages[usages.length - 1].expiresOn).getTime() - new Date().getTime()) / hoursInMs;
	return (
		usages.length <= proFeaturePreviewUsages &&
		remainingHours > 0 &&
		remainingHours < 24 * proFeaturePreviewUsageDurationInDays
	);
}

export function isFeaturePreviewExpired(featurePreview: FeaturePreview) {
	const usages = featurePreview.usages;
	if (usages == null || usages.length === 0) return false;

	const remainingHours = (new Date(usages[usages.length - 1].expiresOn).getTime() - new Date().getTime()) / hoursInMs;
	return (
		usages.length > proFeaturePreviewUsages ||
		(usages.length === proFeaturePreviewUsages && remainingHours <= 0) ||
		remainingHours >= 24 * proFeaturePreviewUsageDurationInDays
	);
}
