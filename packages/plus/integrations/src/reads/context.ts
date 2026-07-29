import type { ConfiguredIntegrationDescriptor } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import type { Integration } from '../models/integration.js';
import type { ProviderWarning } from '../results.js';

/**
 * Everything the facade's provider reads need from the service that owns connection state — and nothing else.
 *
 * The reads (`listOrgs`, `listRepos`, the paged PR/issue reads, the sweeps, `broadenIssues`,
 * `resolveRepository`) are otherwise stateless: given a resolved integration they only transform provider
 * results into the neutral shapes consumers get. What they can't do themselves is decide WHICH integration
 * instance and which host a request addresses, because that depends on the configured connections, the
 * per-domain instance cache, and the auth sessions the service holds.
 *
 * Naming that boundary explicitly is the point of this type. It keeps the reads out of connection lifecycle —
 * they can't reach the instance cache, the connected-set, or the event emitters even by accident — and it makes
 * the coupling auditable: anything a read needs beyond these five operations is a signal that either the read is
 * doing connection management, or this contract genuinely has to grow.
 */
export interface ProviderReadContext {
	/**
	 * The integration instance a read should use, or `undefined` when the requested target doesn't resolve.
	 * Absorbs the domain resolution below, so a read never picks a host itself.
	 */
	getIntegrationForRead(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain?: string,
	): Promise<Integration | undefined>;

	/**
	 * The host to ATTRIBUTE a read's results and warnings to, once the integration is resolved. Distinct from
	 * {@link resolveDomainForRead}, which selects the instance: this one falls back to the resolved
	 * integration's own domain, so a warning always names the host the read actually reached.
	 */
	domainForRead(
		integration: Integration,
		id: IntegrationIds,
		connectionId: string | undefined,
		domain?: string,
	): string | undefined;

	/**
	 * The self-managed host a request SELECTS, from the configured connection or the caller's explicit domain.
	 * `undefined` for a cloud provider, which has only one host.
	 */
	resolveDomainForRead(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain: string | undefined,
	): string | undefined;

	/**
	 * Warnings for a read whose integration couldn't be resolved, distinguishing a broken explicit target
	 * (warning + `fetchFailed`) from a provider that simply isn't connected (silent empty).
	 */
	earlyReturnConnectionWarnings(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain?: string,
	): { warnings: ProviderWarning[]; fetchFailed: boolean };

	/** Forces a session refresh before a read when the caller asked for one. Best-effort; never throws. */
	forceRefreshIfRequested(
		integration: Integration,
		forceSync: boolean | undefined,
		connectionId: string | undefined,
	): Promise<void>;

	/** The configured connection descriptors, as `getConfigured` exposes them. */
	getConfigured(
		id?: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[];
}
