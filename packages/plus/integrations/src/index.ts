// Public facade for `@gitlens/integrations`.
//
// External consumers should import from this entry point only, not from the
// package's internal subpaths, with one exception: the lightweight, token-scoped
// read API is a supported public subpath (`./lite.js`). It's kept out of this
// facade on purpose so importing the session-managed manager doesn't eagerly pull
// in every provider API client. The internal classes (IntegrationService,
// IntegrationAuthenticationService, etc.) are not part of the public API and
// may be refactored without semver bumps.

import type { IntegrationServiceContext } from './context.js';
import { createIntegrationService } from './integrationService.js';
import type { IntegrationManager } from './manager.js';

export type { IntegrationManager, ProviderRepositoriesInput, ProviderRepositoryInput } from './manager.js';

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
export function createIntegrationManager(ctx: IntegrationServiceContext): IntegrationManager {
	return createIntegrationService(ctx);
}

// Re-exports for the public API surface.
export type {
	AccountProvider,
	AuthenticationSessionsChangeEvent,
	IntegrationCacheProvider,
	ConfigChangeEvent,
	ConfigProvider,
	RepositoriesProvider,
	HttpProvider,
	IntegrationServiceContext,
	IntegrationServiceHooks,
	IntegrationStorageProvider,
} from './context.js';
export type { Source } from './telemetry.js';
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
