import type { Disposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import type { IntegrationIds } from '../constants.js';
import type { Sources } from '../telemetry.js';
import type { ProviderAuthenticationSession } from './models.js';

export interface IntegrationAuthenticationProviderDescriptor {
	id: IntegrationIds;
	scopes: string[];
}

export interface IntegrationAuthenticationSessionDescriptor {
	domain: string;
	scopes: string[];
	/** When set, reads/deletes only the matching storage variant. */
	cloud?: boolean;
	/**
	 * Targets a specific connection when a provider has multiple accounts connected. When omitted,
	 * operations resolve to the provider's primary connection (see
	 * `ConfiguredIntegrationService.resolveConnectionId`).
	 */
	connectionId?: string;
	[key: string]: unknown;
}

/**
 * Options for {@link IntegrationAuthenticationProvider.getSession}. The two variants keep `sync` exclusive
 * with the interactive flags: a sync resolves whatever the cloud already has, so it must never open a connect
 * window.
 *
 * `refreshRejectedToken` marks the stored token as known-refused by the provider (an `AuthenticationError` on
 * a previous read), which forces a cloud `/refresh` even when the token's expiry still claims it is valid —
 * the case a purely time-based refresh cannot see. The refresh token itself never reaches the client: the GK
 * cloud performs the exchange server-side.
 *
 * `refetch` (sync only) fetches a fresh token instead of serving the stored one, WITHOUT deleting the stored one
 * first: it is replaced only once the fetch returns a session. A forced re-sync used to delete it up front, so a
 * fetch that failed transiently (a GK API 429 or 5xx) left the connection with no token at all, and every read
 * until the next good sync reported it as gone (gitkraken/kepler#3546).
 */
export type GetSessionOptions =
	| {
			createIfNeeded?: boolean;
			forceNewSession?: boolean;
			sync?: never;
			refetch?: never;
			refreshRejectedToken?: boolean;
			source?: Sources;
	  }
	| {
			createIfNeeded?: never;
			forceNewSession?: never;
			sync: boolean;
			refetch?: boolean;
			refreshRejectedToken?: boolean;
			source?: Sources;
	  };

export interface IntegrationAuthenticationProvider extends Disposable {
	/**
	 * Clears the stored secret for one connection only (never the whole provider). Unlike
	 * {@link deleteAllSessions}, this by default leaves the descriptor in `integrations:configured` — its
	 * primary caller is a forced re-sync, which needs `getConfigured()` to keep reporting the connection
	 * while a fresh session is fetched to replace the deleted secret. Implementers should not treat this as
	 * a full disconnect. Pass `preserveConfigured: false` to also drop the descriptor (e.g. when the
	 * re-sync's replacement fetch failed and the connection should no longer be reported as connected).
	 */
	deleteSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: { preserveConfigured?: boolean },
	): Promise<void>;
	deleteAllSessions(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void>;
	/**
	 * Resolves the session for `descriptor`, from storage when it is still usable and from the cloud
	 * otherwise. See {@link GetSessionOptions}.
	 */
	getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: GetSessionOptions,
	): Promise<ProviderAuthenticationSession | undefined>;
	get onDidChange(): Event<void>;
}
