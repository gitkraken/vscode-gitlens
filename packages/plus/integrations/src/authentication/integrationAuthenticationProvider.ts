import { trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { Sources } from '../telemetry.js';
import {
	isCloudGitSelfManagedHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
} from '../utils/integration.utils.js';
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
	/**
	 * Targets a specific connection when a provider has multiple accounts connected. When omitted,
	 * operations resolve to the provider's primary connection (see
	 * {@link ConfiguredIntegrationService.resolveConnectionId}).
	 */
	connectionId?: string;
	[key: string]: unknown;
}

export interface IntegrationAuthenticationProvider extends Disposable {
	deleteSession(descriptor: IntegrationAuthenticationSessionDescriptor): Promise<void>;
	deleteAllSessions(): Promise<void>;
	getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?:
			| { createIfNeeded?: boolean; forceNewSession?: boolean; sync?: never; source?: Sources }
			| { createIfNeeded?: never; forceNewSession?: never; sync: boolean; source?: Sources },
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
	async deleteSession(descriptor: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		const configured = this.configuredIntegrationService.getConfigured(this.authProviderId, {
			cloud: true,
			domain: isGitSelfManagedHostIntegrationId(this.authProviderId) ? descriptor?.domain : undefined,
		});

		await this.configuredIntegrationService.deleteStoredSessions(this.authProviderId, descriptor, undefined);

		if (configured?.length) {
			this.fireChange();
		}
	}

	@trace()
	async deleteAllSessions(): Promise<void> {
		const configured = this.configuredIntegrationService.getConfigured(this.authProviderId, {
			cloud: true,
		});

		await this.configuredIntegrationService.deleteAllStoredSessions(this.authProviderId, undefined);

		if (configured?.length) {
			this.fireChange();
		}
	}

	@trace()
	async getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?:
			| { createIfNeeded?: boolean; forceNewSession?: boolean; sync?: never; source?: Sources }
			| { createIfNeeded?: never; forceNewSession?: never; sync: boolean; source?: Sources },
	): Promise<ProviderAuthenticationSession | undefined> {
		let session;
		let previousToken;
		if (options?.forceNewSession) {
			await this.configuredIntegrationService.deleteStoredSessions(this.authProviderId, descriptor, undefined);
		} else {
			session = await this.configuredIntegrationService.getStoredSession(this.authProviderId, descriptor);
			previousToken = session?.accessToken;
		}

		const isExpiredSession = session?.expiresAt != null && new Date(session.expiresAt).getTime() < Date.now();
		if (session == null || isExpiredSession) {
			session = await this.getNewSession(descriptor, {
				...options,
				refreshIfExpired: isExpiredSession,
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
		options?:
			| {
					createIfNeeded?: boolean;
					forceNewSession?: boolean;
					sync?: never;
					refreshIfExpired?: boolean;
					source?: Sources;
			  }
			| {
					createIfNeeded?: never;
					forceNewSession?: never;
					sync: boolean;
					refreshIfExpired?: boolean;
					source?: Sources;
			  },
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
		options?:
			| {
					createIfNeeded?: boolean;
					forceNewSession?: boolean;
					sync?: never;
					refreshIfExpired?: boolean;
					source?: Sources;
			  }
			| {
					createIfNeeded?: never;
					forceNewSession?: never;
					sync: boolean;
					refreshIfExpired?: boolean;
					source?: Sources;
			  },
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
		let session =
			options?.refreshIfExpired || options?.createIfNeeded || options?.forceNewSession || options?.sync
				? await this.getCloudSession(descriptor)
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
	): Promise<ProviderAuthenticationSession | undefined> {
		const loggedIn = (await this.authenticationService.ctx.account.getAccount()) != null;
		if (!loggedIn) return undefined;

		const cloudIntegrations = this.authenticationService.cloudIntegrations;
		let session = await cloudIntegrations.getConnectionSession(
			this.authProviderId,
			undefined,
			descriptor.connectionId,
		);

		// Make an exception for GitHub and Cloud Self-Hosted integrations because they always return 0
		if (
			session?.expiresIn === 0 &&
			(this.authProviderId === GitCloudHostIntegrationId.GitHub ||
				isCloudGitSelfManagedHostIntegrationId(this.authProviderId))
		) {
			// It never expires so don't refresh it frequently:
			session.expiresIn = maxSmallIntegerV8; // maximum expiration length
		}

		if (session != null && session.expiresIn < 60) {
			session = await cloudIntegrations.getConnectionSession(
				this.authProviderId,
				session.accessToken,
				descriptor.connectionId,
			);
		}

		if (!session) return undefined;

		let sessionProtocol;
		try {
			sessionProtocol = new URL(session.domain).protocol;
		} catch {
			// If the domain is invalid, we can't use it to create a session
			sessionProtocol = undefined;
		}

		// TODO: Once we care about domains, we should try to match the domain here against ours, and if it fails, return undefined
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
		};
	}

	private async disconnectCloudSession(): Promise<'skip' | 'success' | 'failure'> {
		const loggedIn = (await this.authenticationService.ctx.account.getAccount()) != null;
		if (!loggedIn) return 'skip';

		const cloudIntegrations = this.authenticationService.cloudIntegrations;
		return (await cloudIntegrations.disconnect(this.authProviderId)) ? 'success' : 'failure';
	}
}
