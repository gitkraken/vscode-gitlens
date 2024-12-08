import type { GraphBranchesVisibility, ViewShowBranchComparison } from './config';
import type { AIProviders } from './constants.ai';
import type { IntegrationId } from './constants.integrations';
import type { TrackedUsage, TrackedUsageKeys } from './constants.telemetry';
import type { GroupableTreeViewTypes } from './constants.views';
import type { Environment } from './container';
import type { FeaturePreviews } from './features';
import type { Subscription } from './plus/gk/account/subscription';
import type { Integration } from './plus/integrations/integration';
import type { DeepLinkServiceState } from './uris/deepLinks/deepLink';

export type SecretKeys =
	| IntegrationAuthenticationKeys
	| `gitlens.${AIProviders}.key`
	| `gitlens.plus.auth:${Environment}`;

export type IntegrationAuthenticationKeys =
	| `gitlens.integration.auth:${IntegrationId}|${string}`
	| `gitlens.integration.auth.cloud:${IntegrationId}|${string}`;

export const enum SyncedStorageKeys {
	Version = 'gitlens:synced:version',
	PreReleaseVersion = 'gitlens:synced:preVersion',
}

export type DeprecatedGlobalStorage = {
	/** @deprecated use `confirm:ai:tos:${AIProviders}` */
	'confirm:sendToOpenAI': boolean;
	/** @deprecated */
	'home:actions:completed': ('dismissed:welcome' | 'opened:scm')[];
	/** @deprecated */
	'home:steps:completed': string[];
	/** @deprecated */
	'home:sections:dismissed': string[];
	/** @deprecated */
	'home:status:pinned': boolean;
	/** @deprecated */
	'home:banners:dismissed': string[];
	/** @deprecated */
	pendingWelcomeOnFocus: boolean;
	/** @deprecated */
	'plus:discountNotificationShown': boolean;
	/** @deprecated */
	'plus:migratedAuthentication': boolean;
	/** @deprecated */
	'plus:renewalDiscountNotificationShown': boolean;
	/** @deprecated */
	'views:layout': 'gitlens' | 'scm';
	/** @deprecated */
	'views:commitDetails:dismissed': 'sidebar'[];
	/** @deprecated */
	'views:welcome:visible': boolean;
} & {
	/** @deprecated */
	[key in `disallow:connection:${string}`]: any;
};

export type GlobalStorage = {
	avatars: [string, StoredAvatar][];
	repoVisibility: [string, StoredRepoVisibilityInfo][];
	'deepLinks:pending': StoredDeepLinkContext;
	pendingWhatsNewOnFocus: boolean;
	// Don't change this key name ('premium`) as its the stored subscription
	'premium:subscription': Stored<Subscription & { lastValidatedAt: number | undefined }>;
	'synced:version': string;
	// Keep the pre-release version separate from the released version
	'synced:preVersion': string;
	usages: Record<TrackedUsageKeys, TrackedUsage>;
	version: string;
	// Keep the pre-release version separate from the released version
	preVersion: string;
	'confirm:draft:storage': boolean;
	'home:sections:collapsed': string[];
	'home:walkthrough:dismissed': boolean;
	'launchpad:groups:collapsed': StoredLaunchpadGroup[];
	'launchpad:indicator:hasLoaded': boolean;
	'launchpad:indicator:hasInteracted': string;
	'launchpadView:groups:expanded': StoredLaunchpadGroup[];
	'graph:searchMode': StoredGraphSearchMode;
	'views:scm:grouped:welcome:dismissed': boolean;
} & { [key in `plus:preview:${FeaturePreviews}:usages`]: StoredFeaturePreviewUsagePeriod[] } & {
	[key in `confirm:ai:tos:${AIProviders}`]: boolean;
} & {
	[key in `provider:authentication:skip:${string}`]: boolean;
} & { [key in `gk:${string}:checkin`]: Stored<StoredGKCheckInResponse> } & {
	[key in `gk:${string}:organizations`]: Stored<StoredOrganization[]>;
} & { [key in `jira:${string}:organizations`]: Stored<StoredJiraOrganization[] | undefined> } & {
	[key in `jira:${string}:projects`]: Stored<StoredJiraProject[] | undefined>;
};

export type DeprecatedWorkspaceStorage = {
	/** @deprecated use `confirm:ai:tos:${AIProviders}` */
	'confirm:sendToOpenAI': boolean;
	/** @deprecated */
	'graph:banners:dismissed': Record<string, boolean>;
	/** @deprecated */
	'views:searchAndCompare:keepResults': boolean;
};

export type WorkspaceStorage = {
	assumeRepositoriesOnStartup?: boolean;
	'branch:comparisons': StoredBranchComparisons;
	'gitComandPalette:usage': StoredRecentUsage;
	gitPath: string;
	'graph:columns': Record<string, StoredGraphColumn>;
	'graph:filtersByRepo': Record<string, StoredGraphFilters>;
	'remote:default': string;
	'starred:branches': StoredStarred;
	'starred:repositories': StoredStarred;
	'views:commitDetails:autolinksExpanded': boolean;
	'views:commitDetails:pullRequestExpanded': boolean;
	'views:repositories:autoRefresh': boolean;
	'views:searchAndCompare:pinned': StoredSearchAndCompareItems;
	'views:scm:grouped:selected': GroupableTreeViewTypes;
} & { [key in `confirm:ai:tos:${AIProviders}`]: boolean } & {
	[key in `connected:${Integration['key']}`]: boolean;
};

export interface Stored<T, SchemaVersion extends number = 1> {
	v: SchemaVersion;
	data: T;
	timestamp?: number;
}

export type StoredGKLicenses = Partial<Record<StoredGKLicenseType, StoredGKLicense>>;

export interface StoredGKCheckInResponse {
	user: StoredGKUser;
	licenses: {
		paidLicenses: StoredGKLicenses;
		effectiveLicenses: StoredGKLicenses;
	};
}

export interface StoredGKUser {
	id: string;
	name: string;
	email: string;
	status: 'activated' | 'pending';
	createdDate: string;
	firstGitLensCheckIn?: string;
}

export interface StoredGKLicense {
	latestStatus: 'active' | 'canceled' | 'cancelled' | 'expired' | 'in_trial' | 'non_renewing' | 'trial';
	latestStartDate: string;
	latestEndDate: string;
	organizationId: string | undefined;
	reactivationCount?: number;
}

export type StoredGKLicenseType =
	| 'gitlens-pro'
	| 'gitlens-teams'
	| 'gitlens-hosted-enterprise'
	| 'gitlens-self-hosted-enterprise'
	| 'gitlens-standalone-enterprise'
	| 'bundle-pro'
	| 'bundle-teams'
	| 'bundle-hosted-enterprise'
	| 'bundle-self-hosted-enterprise'
	| 'bundle-standalone-enterprise'
	| 'gitkraken_v1-pro'
	| 'gitkraken_v1-teams'
	| 'gitkraken_v1-hosted-enterprise'
	| 'gitkraken_v1-self-hosted-enterprise'
	| 'gitkraken_v1-standalone-enterprise'
	| 'gitkraken-v1-pro'
	| 'gitkraken-v1-teams'
	| 'gitkraken-v1-hosted-enterprise'
	| 'gitkraken-v1-self-hosted-enterprise'
	| 'gitkraken-v1-standalone-enterprise';

export interface StoredOrganization {
	id: string;
	name: string;
	role: 'owner' | 'admin' | 'billing' | 'user';
}

export interface StoredJiraOrganization {
	key: string;
	id: string;
	name: string;
	url: string;
	avatarUrl: string;
}

export interface StoredJiraProject {
	key: string;
	id: string;
	name: string;
	resourceId: string;
}

export interface StoredAvatar {
	uri: string;
	timestamp: number;
}

export type StoredRepositoryVisibility = 'private' | 'public' | 'local';

export interface StoredRepoVisibilityInfo {
	visibility: StoredRepositoryVisibility;
	timestamp: number;
	remotesHash?: string;
}

export interface StoredBranchComparison {
	ref: string;
	label?: string;
	notation: '..' | '...' | undefined;
	type: Exclude<ViewShowBranchComparison, false> | undefined;
	checkedFiles?: string[];
}

export type StoredBranchComparisons = Record<string, string | StoredBranchComparison>;

export interface StoredDeepLinkContext {
	url?: string | undefined;
	repoPath?: string | undefined;
	targetSha?: string | undefined;
	secondaryTargetSha?: string | undefined;
	useProgress?: boolean | undefined;
	state?: DeepLinkServiceState | undefined;
}

export interface StoredGraphColumn {
	isHidden?: boolean;
	mode?: string;
	width?: number;
}

export type StoredGraphExcludeTypes = 'remotes' | 'stashes' | 'tags';

export interface StoredGraphFilters {
	branchesVisibility?: GraphBranchesVisibility;
	includeOnlyRefs?: Record<string, StoredGraphIncludeOnlyRef>;
	excludeRefs?: Record<string, StoredGraphExcludedRef>;
	excludeTypes?: Record<StoredGraphExcludeTypes, boolean>;
}

export type StoredGraphRefType = 'head' | 'remote' | 'tag';

export type StoredGraphSearchMode = 'normal' | 'filter';

export interface StoredGraphExcludedRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredGraphIncludeOnlyRef {
	id: string;
	type: StoredGraphRefType;
	name: string;
	owner?: string;
}

export interface StoredNamedRef {
	label?: string;
	ref: string;
}

export interface StoredComparison {
	type: 'comparison';
	timestamp: number;
	path: string;
	ref1: StoredNamedRef;
	ref2: StoredNamedRef;
	notation?: '..' | '...';

	checkedFiles?: string[];
}

export interface StoredSearch {
	type: 'search';
	timestamp: number;
	path: string;
	labels: {
		label: string;
		queryLabel:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  };
	};
	search: StoredSearchQuery;
}

export interface StoredSearchQuery {
	pattern: string;
	matchAll?: boolean;
	matchCase?: boolean;
	matchRegex?: boolean;
}

export type StoredSearchAndCompareItem = StoredComparison | StoredSearch;
export type StoredSearchAndCompareItems = Record<string, StoredSearchAndCompareItem>;
export type StoredStarred = Record<string, boolean>;
export type StoredRecentUsage = Record<string, number>;

export type StoredLaunchpadGroup =
	| 'current-branch'
	| 'pinned'
	| 'mergeable'
	| 'blocked'
	| 'follow-up'
	| 'needs-review'
	| 'waiting-for-review'
	| 'draft'
	| 'other'
	| 'snoozed';

export interface StoredFeaturePreviewUsagePeriod {
	startedOn: string;
	expiresOn: string;
}
