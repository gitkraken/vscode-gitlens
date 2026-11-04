// Public facade for `@gitlens/integrations`.
//
// External consumers should import from this entry point only, not from the
// package's internal subpaths, with one exception: the lightweight, token-scoped
// read API is a supported public subpath (`./lite.js`). It's kept out of this
// facade on purpose so importing the session-managed manager doesn't eagerly pull
// in every provider API client. The internal classes (IntegrationService,
// IntegrationAuthenticationService, etc.) are not part of the public API and
// may be refactored without semver bumps.

import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type {
	AccountProvider,
	ConfigProvider,
	HttpProvider,
	IntegrationCacheProvider,
	IntegrationServiceHooks,
	IntegrationStorageProvider,
	RepositoriesProvider,
} from './context.js';
import { createIntegrationService } from './integrationService.js';
import type { IntegrationManager } from './manager.js';
import type { IntegrationCacheDescriptor } from './models/publicIntegration.js';

export type { Autolink, AutolinkReference, DynamicAutolinkReference, RefSet } from '@gitlens/git/models/autolink.js';
export type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';

/** A cached provider value, which may still be resolving. */
export type IntegrationManagerCacheResult<T> = Promise<T | undefined> | T | undefined;

/** Produces an account value on a cache miss. */
export type IntegrationManagerCacheLoader<T> = (cacheable: CacheController) => {
	value: IntegrationManagerCacheResult<T>;
	expiresAt?: number;
};

/** The integration identity supplied to the consumer-owned account cache. */
export type IntegrationAccountCacheDescriptor = IntegrationCacheDescriptor;

/** Cache controls attached to a provider account lookup. */
export interface IntegrationManagerCacheOptions {
	readonly connectionId?: string;
	readonly etag?: string;
	readonly expiryOverride?: boolean | number;
	readonly expireOnError?: boolean;
}

/**
 * Optional consumer-owned cache for values reused by the public manager facade.
 *
 * Only `getCurrentAccount` is required. Each other lookup is optional: one the cache omits runs its loader on every
 * call, uncached. A cache that keys entries by integration should key them by the descriptor's `id` and `domain`,
 * and treat `maybeConnected` and `sessionFingerprint` as the entry's etag, so a reconnect or a token change misses.
 *
 * The manager calls each method on the cache object itself, so a class instance (methods on its prototype) works.
 */
export interface IntegrationManagerCacheProvider {
	getCurrentAccount(
		integration: IntegrationAccountCacheDescriptor,
		cacheable: IntegrationManagerCacheLoader<Account>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<Account>;
	getRepositoryMetadata?(
		repo: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<RepositoryMetadata>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<RepositoryMetadata>;
	getRepositoryDefaultBranch?(
		repo: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<DefaultBranch>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<DefaultBranch>;
	getPullRequestForSha?(
		sha: string,
		repo: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<PullRequest>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<PullRequest>;
	getPullRequestForBranch?(
		branch: string,
		repo: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<PullRequest>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<PullRequest>;
	getPullRequest?(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<PullRequest>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<PullRequest>;
	getIssueOrPullRequest?(
		id: string,
		type: IssueOrPullRequestType | undefined,
		resource: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<IssueOrPullRequest>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<IssueOrPullRequest>;
	getIssue?(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationCacheDescriptor | undefined,
		cacheable: IntegrationManagerCacheLoader<Issue>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<Issue>;
	/** Evicts every cached pull request (a merge can change pull requests no caller can name). */
	deletePullRequests?(): void;
}

function loadUncached<T>(loader: IntegrationManagerCacheLoader<T>): IntegrationManagerCacheResult<T> {
	return loader(new CacheController()).value;
}

/**
 * What a consumer cache is handed in place of the integration itself. The getters read through to the integration
 * when the cache reads them, as reading the integration did, without handing a consumer the class.
 */
function toCacheDescriptor(integration: IntegrationCacheDescriptor): IntegrationCacheDescriptor;
function toCacheDescriptor(integration: IntegrationCacheDescriptor | undefined): IntegrationCacheDescriptor | undefined;
function toCacheDescriptor(
	integration: IntegrationCacheDescriptor | undefined,
): IntegrationCacheDescriptor | undefined {
	if (integration == null) return undefined;

	return {
		id: integration.id,
		domain: integration.domain,
		get maybeConnected() {
			return integration.maybeConnected;
		},
		get sessionFingerprint() {
			return integration.sessionFingerprint;
		},
	};
}

const uncachedIntegrationCacheProvider: IntegrationCacheProvider = {
	getRepositoryMetadata: (_repo, _integration, loader) => loadUncached(loader),
	getRepositoryDefaultBranch: (_repo, _integration, loader) => loadUncached(loader),
	getPullRequestForSha: (_sha, _repo, _integration, loader) => loadUncached(loader),
	getPullRequestForBranch: (_branch, _repo, _integration, loader) => loadUncached(loader),
	getPullRequest: (_id, _resource, _integration, loader) => loadUncached(loader),
	getIssueOrPullRequest: (_id, _type, _resource, _integration, loader) => loadUncached(loader),
	getIssue: (_id, _resource, _integration, loader) => loadUncached(loader),
	getCurrentAccount: (_integration, loader) => loadUncached(loader),
	// Nothing is cached, so there is nothing to evict.
	deletePullRequests: () => {},
};

/**
 * Adapts the consumer's cache to the internal one: each lookup the consumer supplies is called on `cache` itself (never
 * spread or detached, which would lose a class instance's prototype methods and `this`), and every other lookup runs
 * uncached.
 */
function toIntegrationCacheProvider(cache: IntegrationManagerCacheProvider | undefined): IntegrationCacheProvider {
	if (cache == null) return uncachedIntegrationCacheProvider;

	return {
		getRepositoryMetadata: (repo, integration, loader, options) =>
			cache.getRepositoryMetadata != null
				? cache.getRepositoryMetadata(repo, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getRepositoryDefaultBranch: (repo, integration, loader, options) =>
			cache.getRepositoryDefaultBranch != null
				? cache.getRepositoryDefaultBranch(repo, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getPullRequestForSha: (sha, repo, integration, loader, options) =>
			cache.getPullRequestForSha != null
				? cache.getPullRequestForSha(sha, repo, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getPullRequestForBranch: (branch, repo, integration, loader, options) =>
			cache.getPullRequestForBranch != null
				? cache.getPullRequestForBranch(branch, repo, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getPullRequest: (id, resource, integration, loader, options) =>
			cache.getPullRequest != null
				? cache.getPullRequest(id, resource, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getIssueOrPullRequest: (id, type, resource, integration, loader, options) =>
			cache.getIssueOrPullRequest != null
				? cache.getIssueOrPullRequest(id, type, resource, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getIssue: (id, resource, integration, loader, options) =>
			cache.getIssue != null
				? cache.getIssue(id, resource, toCacheDescriptor(integration), loader, options)
				: loadUncached(loader),
		getCurrentAccount: (integration, loader, options) =>
			cache.getCurrentAccount(toCacheDescriptor(integration), loader, options),
		deletePullRequests: () => cache.deletePullRequests?.(),
	};
}

/**
 * Consumer-facing runtime for {@link createIntegrationManager}.
 *
 * External consumers may omit `cache`; reads then execute their loaders directly without cross-call caching.
 * The extension host's broader integration context remains private to the implementation.
 */
export interface IntegrationManagerContext {
	readonly storage: IntegrationStorageProvider;
	readonly account: AccountProvider;
	readonly config: ConfigProvider;
	readonly http: HttpProvider;
	readonly cache?: IntegrationManagerCacheProvider;
	readonly repositories: RepositoriesProvider;
	readonly hooks?: IntegrationServiceHooks;
}

export type {
	ClosedPullRequestSweepOptions,
	GetAutolinkReferencesOptions,
	IntegrationManager,
	ListLinearProjectsOptions,
	ListOrgsOptions,
	ListProjectsOptions,
	// Every option shape a caller has to BUILD is exported, not just the ones the manager returns:
	// `manager.js` is not a public subpath, so a type omitted here can't be named by a consumer at all
	// (`broadenIssues`' `orgs` needed `ProviderBroadenOrg` and had to be re-declared downstream).
	ProviderBroadenOrg,
	ProviderRepositoriesInput,
	ProviderRepositoryInput,
	ProviderSweepTarget,
	ProviderSweepTargetEvent,
	PullRequestSweepOptions,
} from './manager.js';

/**
 * Construct an `@gitlens/integrations` manager bound to the supplied runtime.
 *
 * The runtime is the **single** cross-boundary contract — anything the
 * package needs (HTTP, storage, cache, auth, subscription, telemetry, UI,
 * configuration, environment) flows through it. The package never imports
 * `vscode`, `Container`, or any consumer-internal types.
 *
 * The returned manager owns its internal services; dispose it (or its
 * containing scope) to release every cached integration plus the runtime's
 * own VS Code subscriptions.
 */
export function createIntegrationManager(ctx: IntegrationManagerContext): IntegrationManager {
	return createIntegrationService({
		...ctx,
		cache: toIntegrationCacheProvider(ctx.cache),
	});
}

// Re-exports for the public API surface.
export type {
	AccountProvider,
	AuthenticationSessionsChangeEvent,
	ConfigChangeEvent,
	ConfigProvider,
	RepositoriesProvider,
	HttpProvider,
	IntegrationsRemoteConfig,
	IntegrationServiceHooks,
	IntegrationStorageProvider,
} from './context.js';
export type { Source, Sources } from './telemetry.js';
export type { IntegrationIds, SupportedCloudIntegrationIds } from './constants.js';
export type { ConfiguredIntegrationsChangeEvent } from './authentication/configuredIntegrationService.js';

// Authentication contract — what `IntegrationServiceHooks.createAuthenticationProvider`
// implementers return. Consumers can plug in any auth strategy (manual token,
// OAuth, host-managed) by returning an object implementing this interface from
// the hook.
export type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationSessionDescriptor,
} from './authentication/integrationAuthenticationProvider.js';
export type {
	AuthenticationSessionLike,
	CloudIntegrationAuthType,
	CloudIntegrationConnection,
	CloudIntegrationType,
	ConfiguredIntegrationDescriptor,
	ProviderAuthenticationSession,
} from './authentication/models.js';
// Provider-id mapping helpers for consumers bridging their own provider ids to `IntegrationIds`
// (e.g. mapping multi-account connections from `getConfigured` back to a provider) and vice versa.
export { toCloudIntegrationType, toIntegrationId } from './authentication/models.js';
// Domain normalization is part of connection selection and repository resolution; consumers should use the
// same implementation rather than importing an internal utility subpath or maintaining a divergent copy.
export { areDomainsOnSameHost, hostFromDomain } from './utils/domain.utils.js';

// Convenience: wrap a static access token (env var, CLI flag, secret manager)
// as an `IntegrationAuthenticationProvider`. For OAuth/refresh flows, implement
// the interface directly — this helper is for non-interactive consumers only.
export {
	createManualTokenAuthProvider,
	type ManualTokenAuthProviderOptions,
} from './authentication/manualTokenProvider.js';

export {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
	isIntegrationId,
	isSupportedCloudIntegrationId,
} from './constants.js';

// Neutral pagination + warning result types the Kepler ProviderBackend adapter maps to its own DTOs.
// These carry no `@gitkraken/provider-apis` types, so consumers depend only on `@gitkraken/core-gitlens`.
export type {
	ConnectionStateChangeEvent,
	ProviderBroadenResult,
	ProviderPagedResult,
	ProviderPageInfo,
	ProviderResult,
	ProviderSweepResult,
	ProviderSweepTargetRef,
	ProviderWarning,
	ProviderWarningCause,
	ProviderWarningCauseReason,
	ProviderWarningKind,
	ProviderWarningOmission,
	ProviderWarningOmissionKind,
	ProviderWarningOmissionRecovery,
	ProviderWarningOmissionScope,
	ProviderWarningScope,
	ProviderWarningSelector,
	ProviderWarningUnreadableItems,
	ProviderLinearProjectShape,
	ProviderOrganization,
	ProviderRepositoryShape,
	RepositoryIdentity,
	RepositoryResolution,
	RepositoryResolutionStatus,
	ResolveRepositoryResult,
} from './results.js';
// Runtime enums — re-exported as values (not `export type`) so consumers can read their members.
export { IssueFilter, PullRequestFilter } from './providerFilters.js';
// The filtered issue search's criteria model and the capability table that says which of it a provider honors.
// String unions and plain interfaces, so a consumer builds criteria without importing an internal subpath.
export type { IssueSearchCapabilities, IssueSearchCriteria, IssueSearchRelationship } from './providerFilters.js';
// Account-wide pull-request search criteria and the per-provider capability table.
export type { PullRequestSearchCapabilities, PullRequestSearchCriteria } from './providerFilters.js';
// The count-only issue and pull-request probes' input and result shapes.
export type { IssueCountResult, IssueCountScope, PullRequestCountResult, PullRequestCountScope } from './results.js';
export type { IssueBatchResult, IssueBatchTarget } from './results.js';
export type { PullRequestBatchResult, PullRequestBatchTarget } from './results.js';
export type { IssueEtagInclude, PullRequestEtagInclude } from './reads/etag.js';
export type { PullRequestBranchResult, PullRequestBranchTarget } from './results.js';
// The current-account read's result, and the account shape every identity-bearing read already returns.
export type { CurrentAccountResult } from './results.js';
export type { Account } from '@gitlens/git/models/author.js';
// Cross-provider PR/issue state filters (string unions in the git models).
export type { PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
export type { IssueStateFilter } from '@gitlens/git/models/issue.js';
// Which read produced a row, and which of its fields that read fetched.
export type { PullRequestProjection } from '@gitlens/git/models/pullRequest.js';
export type { IssueProjection } from '@gitlens/git/models/issue.js';
export type { FieldPresence, IssueFieldGroup, PullRequestFieldGroup } from './fieldPresence.js';
export { getIssueFieldPresence, getPullRequestFieldPresence } from './fieldPresence.js';

// Interface-only views of the integrations the manager hands out (`get`, `getIntegrationsForAccountWideRead`), named
// after the internal classes they view, and the types their members take and return. The classes stay internal; see
// `models/publicIntegration.ts`.
export type {
	GitHostIntegration,
	Integration,
	IntegrationById,
	IntegrationCacheDescriptor,
	IntegrationConnectedKey,
	IntegrationCredential,
	IntegrationResult,
	IntegrationType,
	IssuesIntegration,
	MyPullRequestsForReposOptions,
	SearchMyPullRequestsOptions,
	SearchPullRequestsOptions,
} from './models/publicIntegration.js';
// Guards over the views. `isIntegration` replaces an `instanceof` check against the internal base class.
export { isGitHostIntegration, isIntegration, isIssuesIntegration } from './models/publicIntegration.js';
export {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationConnectedKey,
	getIntegrationIdForRemote,
	isCloudGitSelfManagedHostIntegrationId,
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
	isIssuesHostIntegrationId,
	isSelfManagedHostIntegrationId,
} from './utils/integration.utils.js';
export { getSingleConfiguredDomain } from './utils/domain.utils.js';
export { getAzureRepositoryIdentity } from './providers/azure/azure.utils.js';
export { isAzureProviderId } from './providers/providerErrors.js';

// Provider metadata (names, domains, icons, capabilities) and the per-provider feature checks built on it.
export type { ProviderMetadata } from './providers/metadata.js';
export { providersMetadata, supportsCodeSuggest } from './providers/metadata.js';

// Token fingerprints, for logging and error reporting without the token itself.
export type { TokenInfo } from './authentication/models.js';
export { toTokenInfo, toTokenWithInfo } from './authentication/models.js';

// Entity identifiers: the neutral codec Launchpad (pins/snoozes), drafts and branch-issue associations key by.
export type {
	EntityIdentifier,
	EntityIdentifierFields,
	EntityIdentifierInput,
	GitConfigEntityIdentifier,
	PullRequestEntityIdentifierInput,
} from './providers/utils.js';
// Runtime consts (and their same-named value unions) for building identifiers without string literals.
export {
	EntityIdentifierProviderType,
	EntityType,
	EntityVersion,
	decodeEntityIdentifier,
	decodeEntityIdentifiersFromGitConfig,
	encodeEntityIdentifier,
	encodeIssueOrPullRequestForGitConfig,
	getEntityIdentifierInput,
	getIssueFromGitConfigEntityIdentifier,
	getIssueOwner,
	getProviderIdFromEntityIdentifier,
} from './providers/utils.js';

export { isMaybeGitLabPullRequestUrl, splitOwnerAndRepo } from './providers/gitlab/gitlab.utils.js';

// Actionable pull requests: Launchpad's categorization, over neutral copies of the provider-apis shapes it reads.
export type {
	ActionablePullRequest,
	ActionablePullRequestAccount,
	ActionablePullRequestCategory,
	ActionablePullRequestEnrichedItem,
	ActionablePullRequestEnrichedItems,
	ActionablePullRequestFields,
	ActionablePullRequestInput,
} from './models/actionablePullRequest.js';
export {
	ActionablePullRequestBuildStatusState,
	ActionablePullRequestReviewState,
} from './models/actionablePullRequest.js';
export { getActionablePullRequests, toActionablePullRequestInput } from './providers/actionablePullRequests.js';
