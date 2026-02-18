import type { StoredFeaturePreviewUsagePeriod } from './constants.storage.js';
import { proFeaturePreviewUsageDurationInDays, proFeaturePreviewUsages } from './constants.subscription.js';
import type { RepositoryVisibility } from './git/gitProvider.js';
import type { RequiredSubscriptionPlanIds, Subscription } from './plus/gk/models/subscription.js';
import { capitalize } from './system/string.js';

// GitFeature's must start with `git:` to be recognized in all usages
export type GitFeatures =
	| 'git:for-each-ref:worktreePath'
	| 'git:ignoreRevsFile'
	| 'git:merge-tree'
	| 'git:merge-tree:write-tree'
	| 'git:push:force-if-includes'
	| 'git:rev-parse:end-of-options'
	| 'git:signing:ssh'
	| 'git:signing:x509'
	| 'git:stash:push:pathspecs'
	| 'git:stash:push:staged'
	| 'git:stash:push:stdin'
	| 'git:status:find-renames'
	| 'git:status:porcelain-v2'
	| 'git:worktrees';

type ExtractPrefix<T> = T extends `${infer Prefix}:${infer Rest}`
	? Rest extends `${infer SubPrefix}:${string}`
		? T | `${Prefix}:${SubPrefix}` | Prefix
		: T | Prefix
	: never;

export type GitFeatureOrPrefix = ExtractPrefix<GitFeatures>;
export type FilteredGitFeatures<T extends GitFeatureOrPrefix> = T extends GitFeatures
	? T
	: Extract<GitFeatures, T | `${T}:${string}`>;

export const gitMinimumVersion = '2.7.2';
export const gitFeaturesByVersion = new Map<GitFeatures, string>([
	['git:for-each-ref:worktreePath', '2.23'],
	['git:ignoreRevsFile', '2.23'],
	['git:merge-tree', '2.33'],
	['git:merge-tree:write-tree', '2.38'],
	['git:push:force-if-includes', '2.30.0'],
	['git:rev-parse:end-of-options', '2.30'],
	['git:signing:ssh', '2.34.0'],
	['git:signing:x509', '2.19.0'],
	['git:stash:push:pathspecs', '2.13.2'],
	['git:stash:push:staged', '2.35.0'],
	['git:stash:push:stdin', '2.30.0'],
	['git:status:find-renames', '2.18'],
	['git:status:porcelain-v2', '2.11'],
	['git:worktrees', '2.17.0'],
]);

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

export function isAdvancedFeature(feature: PlusFeatures): feature is AdvancedFeatures {
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
