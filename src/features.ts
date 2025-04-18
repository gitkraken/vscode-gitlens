import type { StoredFeaturePreviewUsagePeriod } from './constants.storage';
import { proFeaturePreviewUsageDurationInDays, proFeaturePreviewUsages } from './constants.subscription';
import type { RepositoryVisibility } from './git/gitProvider';
import type { RequiredSubscriptionPlans, Subscription } from './plus/gk/models/subscription';
import { capitalize } from './system/string';

// GitFeature's must start with `git:` to be recognized in all usages
export type GitFeatures =
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

export const gitFeaturesByVersion = new Map<GitFeatures, string>([
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
export type AdvancedAIFeatures = 'generate-changelog' | 'generate-create-pullRequest';

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
