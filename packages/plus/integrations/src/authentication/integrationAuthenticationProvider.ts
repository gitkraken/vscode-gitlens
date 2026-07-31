import { trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { IntegrationIds } from '../constants.js';
import type { Sources } from '../telemetry.js';
import { areDomainsOnSameHost } from '../utils/domain.utils.js';
import { isGitSelfManagedHostIntegrationId, isNonExpiringZeroTokenIntegrationId } from '../utils/integration.utils.js';
import type { ConfiguredIntegrationService } from './configuredIntegrationService.js';
import type { IntegrationAuthenticationService } from './integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from './models.js';
import { isSupportedCloudIntegrationId } from './models.js';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

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
	 * {@link ConfiguredIntegrationService.resolveConnectionId}).
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
 */
export type GetSessionOptions =
	| {
			createIfNeeded?: boolean;
			forceNewSession?: boolean;
			sync?: never;
			refreshRejectedToken?: boolean;
			source?: Sources;
	  }
	| {
			createIfNeeded?: never;
			forceNewSession?: never;
			sync: boolean;
			refreshRejectedToken?: boolean;
			source?: Sources;
	  };

/**
 * What {@link IntegrationAuthenticationProviderBase.getSession} passes down once it has decided the stored
 * session can't be served as-is. `refreshIfExpired` is its own conclusion, not a caller's option.
 */
type GetNewSessionOptions = GetSessionOptions & { refreshIfExpired?: boolean };

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

abstract class IntegrationAuthenticationProviderBase<
	ID extends IntegrationIds = IntegrationIds,
> implements IntegrationAuthenticationProvider {
	protected readonly disposables: Disposable[] = [];

	constructor(
		protected readonly authenticationService: IntegrationAuthenticationService,
		protected readonly configuredIntegrationService: ConfiguredIntegrationService,
	) {}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	private readonly _onDidChange = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	protected abstract get authProviderId(): ID;

	@trace()
	async deleteSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: { preserveConfigured?: boolean },
	): Promise<void> {
		const domain = isGitSelfManagedHostIntegrationId(this.authProviderId) ? descriptor?.domain : undefined;
		const configured = this.configuredIntegrationService.getConfigured(this.authProviderId, {
			domain: domain,
		});

		// Scope the descriptor to cloud so resolveConnectionId targets the cloud variant's id: this is a
		// cloud-only delete, and a mixed local+cloud connection whose local descriptor is primary would
		// otherwise resolve the local id and leave the cloud secret intact.
		await this.configuredIntegrationService.deleteStoredSessions(
			this.authProviderId,
			{ ...descriptor, cloud: true },
			true,
			{ preserveConfigured: options?.preserveConfigured ?? true },
		);

		if (configured?.length) {
			this.fireChange();
		}
	}

	@trace()
	async deleteAllSessions(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		// Self-managed providers group every host under one provider id, so scope the clear to this
		// descriptor's host when given; for cloud providers the domain stays undefined here, clearing every account.
		const domain = isGitSelfManagedHostIntegrationId(this.authProviderId) ? descriptor?.domain : undefined;
		const configured = this.configuredIntegrationService.getConfigured(this.authProviderId, {
			domain: domain,
		});

		await this.configuredIntegrationService.deleteAllStoredSessions(this.authProviderId, undefined, domain);

		if (configured?.length) {
			this.fireChange();
		}
	}

	@trace()
	async getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: GetSessionOptions,
	): Promise<ProviderAuthenticationSession | undefined> {
		let session;
		let previousToken;
		if (options?.forceNewSession) {
			// Cloud-only delete (see deleteSession): scope to cloud so the cloud variant's id is cleared even
			// when a mixed local+cloud connection's local descriptor is primary.
			await this.configuredIntegrationService.deleteStoredSessions(
				this.authProviderId,
				{ ...descriptor, cloud: true },
				true,
			);
		} else {
			session = await this.configuredIntegrationService.getStoredSession(
				this.authProviderId,
				options?.sync ? { ...descriptor, cloud: true } : descriptor,
			);
			previousToken = session?.accessToken;
		}

		const isExpiredSession = session?.expiresAt != null && new Date(session.expiresAt).getTime() < Date.now();
		// A rejected token has to re-resolve even when the stored session looks perfectly healthy: that is
		// the whole point — the provider refused it while its expiry still says valid. Without this the
		// stored session short-circuits here and the refresh below is never reached.
		const refreshRejectedToken = options?.refreshRejectedToken === true && session != null;
		if (session == null || isExpiredSession || refreshRejectedToken) {
			session = await this.getNewSession(descriptor, {
				...options,
				refreshIfExpired: isExpiredSession,
				refreshRejectedToken: refreshRejectedToken,
			});

			if (session != null) {
				await this.configuredIntegrationService.storeSession(this.authProviderId, session);
			}
		}

		if (previousToken !== session?.accessToken) {
			this.fireChange();
		}

		return session;
	}

	protected abstract getNewSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: GetNewSessionOptions,
	): Promise<ProviderAuthenticationSession | undefined>;

	protected fireChange(): void {
		queueMicrotask(() => this._onDidChange.fire());
	}
}

export class CloudIntegrationAuthenticationProvider<
	ID extends IntegrationIds = IntegrationIds,
> extends IntegrationAuthenticationProviderBase<ID> {
	constructor(
		authenticationService: IntegrationAuthenticationService,
		configuredIntegrationService: ConfiguredIntegrationService,
		private readonly _authProviderId: ID,
	) {
		super(authenticationService, configuredIntegrationService);
	}

	protected get authProviderId(): ID {
		return this._authProviderId;
	}

	protected override async getNewSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: GetNewSessionOptions,
	): Promise<ProviderAuthenticationSession | undefined> {
		if (options?.forceNewSession) {
			if ((await this.disconnectCloudSession()) === 'failure') {
				return undefined;
			}

			void this.connectCloudSession(false, options?.source);
			return undefined;
		}

		// TODO: This is a stopgap to make sure we're not hammering the api on automatic calls to get the session.
		// Ultimately we want to timestamp calls to syncCloudIntegrations and use that to determine whether we should
		// make the call or not.
		// `refreshRejectedToken` joins the list for the same reason `refreshIfExpired` is on it: both mean the
		// session in hand is known-unusable, so skipping the cloud round trip would just re-serve it.
		let session =
			options?.refreshIfExpired ||
			options?.refreshRejectedToken ||
			options?.createIfNeeded ||
			options?.forceNewSession ||
			options?.sync
				? await this.getCloudSession(descriptor, { refreshRejectedToken: options?.refreshRejectedToken })
				: undefined;

		const shouldCreateSession = options?.createIfNeeded && session == null;
		if (shouldCreateSession) {
			const connected = await this.connectCloudSession(true, options?.source);
			if (!connected) return undefined;

			// This should get us the session we just created with connectCloudSession, because a syncCloudIntegrations run from
			// integration service should have resulted in it being created and stored by this provider
			session = await this.getSession(descriptor, { source: options?.source });
		}
		return session;
	}

	private connectCloudSession(skipIfConnected: boolean, source: Sources | undefined): Promise<boolean> {
		// Capture in a const so the type guard narrows it to `SupportedCloudIntegrationIds` (a getter
		// access wouldn't narrow), letting us call the service directly without a cast.
		const id = this.authProviderId;
		if (isSupportedCloudIntegrationId(id)) {
			return this.authenticationService.connectCloudIntegrations(
				{ integrationIds: [id], skipIfConnected: skipIfConnected, skipPreSync: true },
				{
					source: source ?? 'integrations',
					detail: {
						action: 'connect',
						integration: id,
					},
				},
			);
		}

		return Promise.resolve(false);
	}

	private async getCloudSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: { refreshRejectedToken?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		const loggedIn = (await this.authenticationService.ctx.account.getAccount()) != null;
		if (!loggedIn) return undefined;

		const cloudIntegrations = this.authenticationService.cloudIntegrations;
		// An unscoped descriptor (no explicit connectionId) would fetch the provider-global primary via
		// `v1/provider-tokens/<provider>`. For a self-managed provider spanning multiple hosts that primary
		// can belong to a different host, so a forced sync of host A would hydrate host B's token here (before
		// reconcile corrects storage). Scope to this host's own configured connection when we have one; fall
		// through to the provider-scoped path only when nothing is configured yet (legacy/first sync).
		const connectionId =
			descriptor.connectionId ??
			(isGitSelfManagedHostIntegrationId(this.authProviderId)
				? this.configuredIntegrationService.getConfiguredConnectionId(
						this.authProviderId,
						descriptor.domain,
						true,
					)
				: undefined);
		let session = await cloudIntegrations.getConnectionSession(this.authProviderId, undefined, connectionId);
		if (
			session != null &&
			isGitSelfManagedHostIntegrationId(this.authProviderId) &&
			!areDomainsOnSameHost(session.domain, descriptor.domain)
		) {
			return undefined;
		}

		// GitHub, the cloud self-managed hosts, and Trello return `expiresIn: 0` for a token that never
		// expires; left as 0 the session would be built with `expiresAt = now` and rejected as expired on the
		// next resolution. Map it to the maximum expiry so it isn't refreshed frequently.
		if (session?.expiresIn === 0 && isNonExpiringZeroTokenIntegrationId(this.authProviderId)) {
			session.expiresIn = maxSmallIntegerV8; // maximum expiration length
		}

		// `expiresIn < 60` is a PREDICTION that the token is about to lapse, and it is the only trigger the
		// refresh used to have. It cannot see a token the provider has already refused while the backend
		// still believes it is valid — a revoked grant, retired scopes, an app removed from the org — where
		// `expiresIn` stays high and the doomed token is re-sent on every read. `refreshRejectedToken` is
		// the observed counterpart: the caller saw the provider reject this exact token, so refresh it
		// regardless of what its expiry claims.
		if (session != null && (session.expiresIn < 60 || options?.refreshRejectedToken)) {
			session = await cloudIntegrations.getConnectionSession(
				this.authProviderId,
				session.accessToken,
				connectionId,
			);
			if (
				session != null &&
				isGitSelfManagedHostIntegrationId(this.authProviderId) &&
				!areDomainsOnSameHost(session.domain, descriptor.domain)
			) {
				return undefined;
			}
		}

		if (!session) return undefined;

		let sessionProtocol;
		// Only derive a protocol from a domain carrying an explicit scheme; a bare `host:port` (e.g. a
		// self-managed `ghe.example.com:8443`) parses the host as the protocol, corrupting the value.
		if (/^[a-z][a-z\d+\-.]*:\/\//i.test(session.domain)) {
			try {
				sessionProtocol = new URL(session.domain).protocol;
			} catch {
				sessionProtocol = undefined;
			}
		}

		return {
			// Prefer the backend's per-connection token id (multi-account); fall back to the resolved
			// primary/legacy connection id so existing single-connection storage keys are preserved.
			id: session.id ?? this.configuredIntegrationService.resolveConnectionId(this.authProviderId, descriptor),
			accessToken: session.accessToken,
			scopes: descriptor.scopes,
			account: {
				id: '',
				label: '',
			},
			cloud: true,
			type: session.type,
			expiresAt: new Date(session.expiresIn * 1000 + Date.now()),
			// Note: do not use the session's domain, because the format is different than in our model
			domain: descriptor.domain,
			protocol: sessionProtocol ?? undefined,
			// Carried for providers whose client needs an app key alongside the token (e.g. Trello).
			appKey: session.appKey,
		};
	}

	private async disconnectCloudSession(): Promise<'skip' | 'success' | 'failure'> {
		const loggedIn = (await this.authenticationService.ctx.account.getAccount()) != null;
		if (!loggedIn) return 'skip';

		const cloudIntegrations = this.authenticationService.cloudIntegrations;
		return (await cloudIntegrations.disconnect(this.authProviderId)) ? 'success' : 'failure';
	}
}
