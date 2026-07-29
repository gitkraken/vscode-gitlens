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
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type { IntegrationIds } from './constants.js';
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

/** A cached provider value, which may still be resolving. */
export type IntegrationManagerCacheResult<T> = Promise<T | undefined> | T | undefined;

/** Produces an account value on a cache miss. */
export type IntegrationManagerCacheLoader<T> = (cacheable: CacheController) => {
	value: IntegrationManagerCacheResult<T>;
	expiresAt?: number;
};

/** Stable integration identity supplied to the consumer-owned account cache. */
export interface IntegrationAccountCacheDescriptor {
	readonly id: IntegrationIds;
	readonly domain?: string;
}

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
 * The manager only needs cross-call caching for provider identity lookups. Other caches used by the GitLens
 * extension host are implementation details and deliberately stay out of this contract.
 */
export interface IntegrationManagerCacheProvider {
	getCurrentAccount(
		integration: IntegrationAccountCacheDescriptor,
		cacheable: IntegrationManagerCacheLoader<Account>,
		options?: IntegrationManagerCacheOptions,
	): IntegrationManagerCacheResult<Account>;
}

function loadUncached<T>(loader: IntegrationManagerCacheLoader<T>): IntegrationManagerCacheResult<T> {
	return loader(new CacheController()).value;
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
};

function toIntegrationCacheProvider(cache: IntegrationManagerCacheProvider | undefined): IntegrationCacheProvider {
	if (cache == null) return uncachedIntegrationCacheProvider;

	return {
		...uncachedIntegrationCacheProvider,
		getCurrentAccount: (integration, loader, options) =>
			cache.getCurrentAccount({ id: integration.id, domain: integration.domain }, loader, options),
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
	IntegrationManager,
	ListOrgsOptions,
	ListProjectsOptions,
	// Every option shape a caller has to BUILD is exported, not just the ones the manager returns:
	// `manager.js` is not a public subpath, so a type omitted here can't be named by a consumer at all
	// (`broadenIssues`' `orgs` needed `ProviderBroadenOrg` and had to be re-declared downstream).
	ProviderBroadenOrg,
	ProviderRepositoriesInput,
	ProviderRepositoryInput,
	ProviderSweepTarget,
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
	ProviderWarning,
	ProviderWarningKind,
	ProviderOrganization,
	ProviderRepositoryShape,
	RepositoryIdentity,
	RepositoryResolution,
	RepositoryResolutionStatus,
	ResolveRepositoryResult,
} from './results.js';
// Runtime enums — re-exported as values (not `export type`) so consumers can read their members.
export { IssueFilter, PullRequestFilter } from './providerFilters.js';
// Cross-provider PR/issue state filters (string unions in the git models).
export type { PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
export type { IssueStateFilter } from '@gitlens/git/models/issue.js';
