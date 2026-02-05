import type { GraphBranchesVisibility, ViewShowBranchComparison } from './config.js';
import type { AIProviders } from './constants.ai.js';
import type { IntegrationIds } from './constants.integrations.js';
import type { SubscriptionState } from './constants.subscription.js';
import type { TrackedUsage, TrackedUsageKeys } from './constants.telemetry.js';
import type { GroupableTreeViewTypes, TreeViewTypes } from './constants.views.js';
import type { Environment } from './container.js';
import type { FeaturePreviews } from './features.js';
import type { GitRevisionRangeNotation } from './git/models/revision.js';
import type { OrganizationSettings } from './plus/gk/models/organization.js';
import type { PaidSubscriptionPlanIds, Subscription } from './plus/gk/models/subscription.js';
import type { IntegrationConnectedKey } from './plus/integrations/models/integration.js';
import type { DeepLinkServiceState } from './uris/deepLinks/deepLink.js';

export type SecretKeys =
	| IntegrationAuthenticationKeys
	| `gitlens.${AIProviders}.key`
	| `gitlens.plus.auth:${Environment}`
	| 'deepLinks:pending';

export type IntegrationAuthenticationKeys =
	| `gitlens.integration.auth:${IntegrationIds}|${string}`
	| `gitlens.integration.auth.cloud:${IntegrationIds}|${string}`;

export const enum SyncedStorageKeys {
	Version = 'gitlens:synced:version',
	PreReleaseVersion = 'gitlens:synced:preVersion',
}

export type DeprecatedGlobalStorage = {
	/** @deprecated */
	'confirm:ai:generateRebase': boolean;
	/** @deprecated use `confirm:ai:tos` */
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
} & {
	/** @deprecated use `confirm:ai:tos` */
	[key in `confirm:ai:tos:${AIProviders}`]: boolean;
};

interface GlobalStorageCore {
	avatars: [string, StoredAvatar][];
	'confirm:ai:generateCommits': boolean;
	'confirm:ai:tos': boolean;
	repoVisibility: [string, StoredRepoVisibilityInfo][];
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
	'product:config': Stored<StoredProductConfig>;
	'confirm:draft:storage': boolean;
	// Value based on `currentOnboardingVersion` in composer's protocol
	'composer:onboarding:dismissed': string;
	'composer:onboarding:stepReached': number;
	'home:sections:collapsed': string[];
	'home:walkthrough:dismissed': boolean;
	'mcp:banner:dismissed': boolean;
	'launchpad:groups:collapsed': StoredLaunchpadGroup[];
	'launchpad:indicator:hasLoaded': boolean;
	'launchpad:indicator:hasInteracted': string;
	'launchpadView:groups:expanded': StoredLaunchpadGroup[];
	'graph:searchMode': StoredGraphSearchMode;
	'graph:useNaturalLanguageSearch': boolean;
	'views:scm:grouped:welcome:dismissed': boolean;
	'integrations:configured': StoredIntegrationConfigurations;
}

type GlobalStorageDynamic = Record<`plus:preview:${FeaturePreviews}:usages`, StoredFeaturePreviewUsagePeriod[]> &
	Record<
		`plus:organization:${string}:settings`,
		Stored<(OrganizationSettings & { lastValidatedAt: number }) | undefined>
	> &
	Record<`provider:authentication:skip:${string}`, boolean> &
	Record<`gk:promo:${string}:ai:allAccess:dismissed`, boolean> &
	Record<`gk:promo:${string}:ai:allAccess:notified`, boolean> &
	Record<`gk:${string}:checkin`, Stored<StoredGKCheckInResponse>> &
	Record<`gk:${string}:organizations`, Stored<StoredOrganization[]>> &
	Record<`jira:${string}:organizations`, Stored<StoredJiraOrganization[] | undefined>> &
	Record<`jira:${string}:projects`, Stored<StoredJiraProject[] | undefined>> &
	Record<`azure:${string}:account`, Stored<StoredAzureAccount | undefined>> &
	Record<`azure:${string}:organizations`, Stored<StoredAzureOrganization[] | undefined>> &
	Record<`azure:${string}:projects`, Stored<StoredAzureProject[] | undefined>> &
	Record<`bitbucket:${string}:account`, Stored<StoredBitbucketAccount | undefined>> &
	Record<`bitbucket:${string}:workspaces`, Stored<StoredBitbucketWorkspace[] | undefined>> &
	Record<`bitbucket-server:${string}:account`, Stored<StoredBitbucketAccount | undefined>>;

export type GlobalStorage = GlobalStorageCore & GlobalStorageDynamic;

/**
 * Storage keys that contain environment-specific data (e.g., file paths, install status).
 * These are automatically scoped by platform and remote info to avoid conflicts when
 * globalState is shared across local/remote environments (Windows, WSL, containers, SSH).
 *
 * Use `storage.getScoped()` / `storage.storeScoped()` / `storage.deleteScoped()` for these keys.
 */
export interface GlobalScopedStorage {
	'gk:cli:install': StoredGkCLIInstallInfo;
	'gk:cli:corePath': string;
	'gk:cli:path': string;
}

export interface StoredGkCLIInstallInfo {
	status: 'attempted' | 'unsupported' | 'completed';
	attempts: number;
	version?: string;
}

export type StoredIntegrationConfigurations = Record<
	IntegrationIds,
	StoredConfiguredIntegrationDescriptor[] | undefined
>;

export interface StoredConfiguredIntegrationDescriptor {
	cloud: boolean;
	integrationId: IntegrationIds;
	domain?: string;
	expiresAt?: string;
	scopes: string;
}

export interface StoredProductConfig {
	promos: StoredPromo[];
}

export interface StoredPromo {
	key: string;
	code?: string;
	plan?: PaidSubscriptionPlanIds;
	states?: SubscriptionState[];
	locations?: ('account' | 'badge' | 'gate' | 'home')[];
	expiresOn?: number;
	startsOn?: number;
	percentile?: number;
}

export type DeprecatedWorkspaceStorage = {
	/** @deprecated use `confirm:ai:tos` */
	'confirm:sendToOpenAI': boolean;
	/** @deprecated */
	'graph:banners:dismissed': Record<string, boolean>;
	/** @deprecated */
	'views:searchAndCompare:keepResults': boolean;
} & {
	/** @deprecated use `confirm:ai:tos` */
	[key in `confirm:ai:tos:${AIProviders}`]: boolean;
};

interface WorkspaceStorageCore {
	assumeRepositoriesOnStartup?: boolean;
	'branch:comparisons': StoredBranchComparisons;
	'confirm:ai:tos': boolean;
	'gitComandPalette:usage': StoredRecentUsage;
	gitPath: string;
	'graph:columns': Record<string, StoredGraphColumn>;
	'graph:filtersByRepo': Record<string, StoredGraphFilters>;
	'remote:default': string;
	'starred:branches': StoredStarred;
	'starred:repositories': StoredStarred;
	'views:commitDetails:pullRequestExpanded': boolean;
	'views:repositories:autoRefresh': boolean;
	'views:searchAndCompare:pinned': StoredSearchAndCompareItems;
	'views:scm:grouped:selected': GroupableTreeViewTypes;
}

/**
 * Repository filter values:
 * - `undefined` or `'all'` - show all repositories (new code should set `'all'`)
 * - `'exclude-worktrees'` - show all except linked worktrees (worktrees whose main repo is also open)
 * - `string[]` - show only the specified repository IDs
 */
export type RepositoryFilterValue = 'all' | 'exclude-worktrees' | string[] | undefined;

type WorkspaceStorageDynamic = Record<IntegrationConnectedKey, boolean> &
	Record<`views:${TreeViewTypes}:repositoryFilter`, RepositoryFilterValue> &
	Record<`graph:searchHistory:${string}`, StoredGraphSearchHistory[]>;

export type WorkspaceStorage = WorkspaceStorageCore & WorkspaceStorageDynamic;

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
	| 'gitlens-advanced'
	| 'gitlens-teams'
	| 'gitlens-hosted-enterprise'
	| 'gitlens-self-hosted-enterprise'
	| 'gitlens-standalone-enterprise'
	| 'bundle-pro'
	| 'bundle-advanced'
	| 'bundle-teams'
	| 'bundle-hosted-enterprise'
	| 'bundle-self-hosted-enterprise'
	| 'bundle-standalone-enterprise'
	| 'gitkraken_v1-pro'
	| 'gitkraken_v1-advanced'
	| 'gitkraken_v1-teams'
	| 'gitkraken_v1-hosted-enterprise'
	| 'gitkraken_v1-self-hosted-enterprise'
	| 'gitkraken_v1-standalone-enterprise'
	| 'gitkraken-v1-pro'
	| 'gitkraken-v1-advanced'
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

export interface StoredAzureAccount {
	id: string;
	name: string | undefined;
	username: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
}

export interface StoredAzureOrganization {
	key: string;
	id: string;
	name: string;
}

export interface StoredAzureProject {
	key: string;
	id: string;
	name: string;
	resourceId: string;
	resourceName: string;
}

export interface StoredBitbucketAccount {
	id: string;
	name: string | undefined;
	username: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
}

export interface StoredBitbucketWorkspace {
	key: string;
	id: string;
	name: string;
	slug: string;
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
	notation: GitRevisionRangeNotation | undefined;
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
	prData?: string | undefined;
	issueData?: string | undefined;
	instructions?: string | undefined;
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

export type StoredGraphSearchHistory = {
	query: string;
	matchAll: boolean | undefined;
	matchCase: boolean | undefined;
	matchRegex: boolean | undefined;
	matchWholeWord: boolean | undefined;
	naturalLanguage: boolean | undefined;
	/** For NL queries, store the last known structured form to show in history */
	nlStructuredQuery?: string;
};

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
	notation?: GitRevisionRangeNotation;

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
	matchWholeWord?: boolean;
	naturalLanguage?: boolean | { query: string; processedQuery?: string };
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
