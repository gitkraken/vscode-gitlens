// Public facade for `@gitlens/integrations`.
//
// External consumers should import from this entry point only, not from the
// package's internal subpaths. The internal classes (IntegrationService,
// IntegrationAuthenticationService, etc.) are not part of the public API and
// may be refactored without semver bumps.
//
// The GitLens host adapter ALSO consumes the package through this facade —
// see `src/container.ts` `integrations` getter. This is what proves the
// architecture is honest: GitLens is just one consumer of the package, with
// a richer runtime than an external consumer would supply.

import { CloudIntegrationService } from './authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from './authentication/configuredIntegrationService.js';
import { IntegrationAuthenticationService } from './authentication/integrationAuthenticationService.js';
import type { IntegrationServiceContext } from './context.js';
import { IntegrationService } from './integrationService.js';

/**
 * The public manager — what consumers get back from
 * {@link createIntegrationManager}. Identical shape to {@link IntegrationService}
 * for now (we may narrow this surface in a future major).
 */
export type IntegrationManager = IntegrationService;

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
	const configured = new ConfiguredIntegrationService(ctx);
	// The cloud token-exchange client is a pure package service (needs only `ctx`); construct it here
	// rather than round-tripping through a host hook.
	const cloud = new CloudIntegrationService(ctx);
	// Cloud auth providers need to (re)initiate the connect flow that lives on the service, but the
	// service is constructed after the auth service (it depends on it). Break the cycle here at the
	// composition root with a lazy, readonly accessor — preserving constructor injection while
	// keeping the flow in-package (no host round-trip).
	let service: IntegrationService;
	const auth = new IntegrationAuthenticationService(configured, ctx, () => service, cloud);
	service = new IntegrationService(auth, configured, ctx);
	// One-time cleanup of storage left behind by integration ids retired in the cloud-only refactor (the
	// local self-managed `github-enterprise`/`gitlab-self-hosted` providers). Best-effort and guarded so it
	// runs once; a no-op for consumers that never stored those ids.
	void purgeRetiredIntegrationStorage(ctx, configured);
	return service;
}

const retiredIntegrationsStorageKey = 'integrations:migrated:cloudOnly';
async function purgeRetiredIntegrationStorage(
	ctx: IntegrationServiceContext,
	configured: ConfiguredIntegrationService,
): Promise<void> {
	if (ctx.storage.get<boolean>(retiredIntegrationsStorageKey)) return;

	try {
		await configured.purgeStoredConfiguration(['github-enterprise', 'gitlab-self-hosted']);
		// Only mark the migration done once the purge fully succeeds. A partial/failed purge stays
		// un-flagged so it retries (idempotently) on the next startup, rather than orphaning the
		// retired-id config/secrets forever.
		await ctx.storage.store(retiredIntegrationsStorageKey, true);
	} catch {
		// Best-effort cleanup: swallow so the failure doesn't reject the fire-and-forget caller; the
		// unset flag guarantees a retry next startup.
	}
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
export type { ApiClients } from './providers/apiClients.js';
export type { Source } from './telemetry.js';
export type { IntegrationIds, SupportedCloudIntegrationIds } from './constants.js';
export type { ConnectionStateChangeEvent, IntegrationConnectionChangeEvent } from './integrationService.js';
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
	ProviderAuthenticationSession,
} from './authentication/models.js';

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
