import type { GitFeatures } from '@gitlens/git/features.js';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import type { StoredFeaturePreviewUsagePeriod } from './constants.storage.js';
import { proFeaturePreviewUsageDurationInDays } from './constants.subscription.js';
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
	| 'review-changes'
	| 'generate-create-cloudPatch'
	| 'generate-stashMessage'
	| 'generate-changelog'
	| 'generate-create-pullRequest'
	| 'generate-commits'
	| 'generate-commitMessage'
	| 'conflict-resolution'
	| 'generate-searchQuery';

export type AdvancedFeatures = never;

export type AIFeatures = ProAIFeatures;

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
		case 'review-changes':
		case 'generate-create-cloudPatch':
		case 'generate-stashMessage':
		case 'generate-changelog':
		case 'generate-create-pullRequest':
		case 'generate-commits':
		case 'generate-commitMessage':
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

const hoursInMs = 3600000;

/** The pre-continuous model wrote one-day windows (up to three, click-continued); those records don't
 *  convert — their holders get a fresh full window instead, so a legacy record reads as `eligible` and
 *  the next walled open overwrites it with a new one. Telling them apart needs no version field: only
 *  legacy windows are shorter than two days. */
function isLegacyPreviewUsage(usage: StoredFeaturePreviewUsagePeriod): boolean {
	return new Date(usage.expiresOn).getTime() - new Date(usage.startedOn).getTime() < 48 * hoursInMs;
}

/** One continuous window anchored on the start — the stored `expiresOn` only distinguishes record shapes */
export function getFeaturePreviewExpiry(preview: FeaturePreview): Date | undefined {
	const usage = preview?.usages[0];
	if (usage == null || isLegacyPreviewUsage(usage)) return undefined;

	return new Date(new Date(usage.startedOn).getTime() + 24 * proFeaturePreviewUsageDurationInDays * hoursInMs);
}

export function getFeaturePreviewStatus(preview: FeaturePreview): FeaturePreviewStatus {
	const usages = preview?.usages;
	if (!usages?.length || isLegacyPreviewUsage(usages[0])) return 'eligible';

	const now = Date.now();
	// A now before the start (clock rolled back past it) expires rather than extends the preview
	if (now >= new Date(usages[0].startedOn).getTime() && now < getFeaturePreviewExpiry(preview)!.getTime()) {
		return 'active';
	}

	return 'expired';
}
