import type { Disposable, Event } from 'vscode';
import { authentication, EventEmitter } from 'vscode';
import type { IntegrationId } from '../../../constants.integrations';
import { HostingIntegrationId } from '../../../constants.integrations';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { debug } from '../../../system/decorators/log';
import { getBuiltInIntegrationSession } from '../../gk/utils/-webview/integrationAuthentication.utils';
import { isCloudSelfHostedIntegrationId, isSelfHostedIntegrationId } from '../providers/models';
import type { ConfiguredIntegrationService } from './configuredIntegrationService';
import type { IntegrationAuthenticationService } from './integrationAuthenticationService';
import type { ProviderAuthenticationSession } from './models';
import { isSupportedCloudIntegrationId } from './models';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

export interface IntegrationAuthenticationProviderDescriptor {
	id: IntegrationId;
	scopes: string[];
}

export interface IntegrationAuthenticationSessionDescriptor {
	domain: string;
	scopes: string[];
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

abstract class IntegrationAuthenticationProviderBase<ID extends IntegrationId = IntegrationId>
	implements IntegrationAuthenticationProvider
{
	protected readonly disposables: Disposable[] = [];

	protected readonly cloud: boolean = false;

	constructor(
		protected readonly container: Container,
		protected readonly authenticationService: IntegrationAuthenticationService,
		protected readonly configuredIntegrationService: ConfiguredIntegrationService,
	) {}

	dispose(): void {
		this.disposables.forEach(d => void d.dispose());
	}

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	protected abstract get authProviderId(): ID;

	@debug()
	async deleteSession(descriptor: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		const configured = await this.configuredIntegrationService.getConfigured({
			id: this.authProviderId,
			domain: isSelfHostedIntegrationId(this.authProviderId) ? descriptor?.domain : undefined,
			type: this.cloud ? 'cloud' : 'local',
		});

		await this.configuredIntegrationService.deleteStoredSessions(
			this.authProviderId,
			descriptor,
			this.cloud ? undefined : 'local',
		);
		if (configured != null && configured.length > 0) {
			this.fireDidChange();
		}
	}

	@debug()
	async deleteAllSessions(): Promise<void> {
		const configured = await this.configuredIntegrationService.getConfigured({
			id: this.authProviderId,
			type: this.cloud ? 'cloud' : 'local',
		});

		await this.configuredIntegrationService.deleteAllStoredSessions(
			this.authProviderId,
			this.cloud ? undefined : 'local',
		);
		if (configured != null && configured.length > 0) {
			this.fireDidChange();
		}
	}

	@debug()
	async getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?:
			| { createIfNeeded?: boolean; forceNewSession?: boolean; sync?: never; source?: Sources }
			| { createIfNeeded?: never; forceNewSession?: never; sync: boolean; source?: Sources },
	): Promise<ProviderAuthenticationSession | undefined> {
		let session;
		let previousToken;
		if (options?.forceNewSession) {
			await this.configuredIntegrationService.deleteStoredSessions(
				this.authProviderId,
				descriptor,
				// Cloud auth providers delete both types, while local only delete their own
				this.cloud ? undefined : 'local',
			);
		} else {
			session = await this.configuredIntegrationService.getStoredSession(
				this.authProviderId,
				descriptor,
				this.cloud ? 'cloud' : 'local',
			);
			previousToken = session?.accessToken;
		}

		const isExpiredSession = session?.expiresAt != null && new Date(session.expiresAt).getTime() < Date.now();
		if (session == null || isExpiredSession) {
			if (!this.cloud && (options?.createIfNeeded || options?.forceNewSession)) {
				session = await this.getNewSession(descriptor);
			} else if (this.cloud) {
				session = await this.getNewSession(descriptor, {
					...options,
					refreshIfExpired: isExpiredSession,
				});
			}

			if (session != null) {
				await this.configuredIntegrationService.storeSession(this.authProviderId, session);
			}
		}

		if (previousToken !== session?.accessToken) {
			this.fireDidChange();
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

	protected fireDidChange(): void {
		queueMicrotask(() => this._onDidChange.fire());
	}
}

export abstract class LocalIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	protected override async getNewSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		return this.createSession(descriptor);
	}

	protected abstract createSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined>;
}

export abstract class CloudIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	protected override readonly cloud: boolean = true;

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
			if (!(await this.disconnectCloudSession())) {
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

	private async connectCloudSession(skipIfConnected: boolean, source: Sources | undefined): Promise<boolean> {
		if (isSupportedCloudIntegrationId(this.authProviderId)) {
			return this.container.integrations.connectCloudIntegrations(
				{ integrationIds: [this.authProviderId], skipIfConnected: skipIfConnected, skipPreSync: true },
				{
					source: source ?? 'integrations',
					detail: {
						action: 'connect',
						integration: this.authProviderId,
					},
				},
			);
		}

		return false;
	}

	private async getCloudSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		const loggedIn = await this.container.subscription.getAuthenticationSession(false);
		if (!loggedIn) return undefined;

		const cloudIntegrations = await this.container.cloudIntegrations;
		if (cloudIntegrations == null) return undefined;

		let session = await cloudIntegrations.getConnectionSession(this.authProviderId);

		// Make an exception for GitHub and Cloud Self-Hosted integrations because they always return 0
		if (
			session?.expiresIn === 0 &&
			(this.authProviderId === HostingIntegrationId.GitHub || isCloudSelfHostedIntegrationId(this.authProviderId))
		) {
			// It never expires so don't refresh it frequently:
			session.expiresIn = maxSmallIntegerV8; // maximum expiration length
		}

		if (session != null && session.expiresIn < 60) {
			session = await cloudIntegrations.getConnectionSession(this.authProviderId, session.accessToken);
		}

		if (!session) return undefined;

		// TODO: Once we care about domains, we should try to match the domain here against ours, and if it fails, return undefined
		return {
			id: this.configuredIntegrationService.getSessionId(descriptor),
			accessToken: session.accessToken,
			scopes: descriptor.scopes,
			account: {
				id: '',
				label: '',
			},
			cloud: true,
			expiresAt: new Date(session.expiresIn * 1000 + Date.now()),
			// Note: do not use the session's domain, because the format is different than in our model
			domain: descriptor.domain,
		};
	}

	private async disconnectCloudSession(): Promise<boolean> {
		const loggedIn = await this.container.subscription.getAuthenticationSession(false);
		if (!loggedIn) return false;

		const cloudIntegrations = await this.container.cloudIntegrations;
		if (cloudIntegrations == null) return false;

		return cloudIntegrations.disconnect(this.authProviderId);
	}
}

export class BuiltInAuthenticationProvider extends LocalIntegrationAuthenticationProvider {
	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		configuredIntegrationService: ConfiguredIntegrationService,
		protected readonly authProviderId: IntegrationId,
	) {
		super(container, authenticationService, configuredIntegrationService);
		this.disposables.push(
			authentication.onDidChangeSessions(e => {
				if (e.provider.id === this.authProviderId) {
					this.fireDidChange();
				}
			}),
		);
	}

	protected override createSession(): Promise<ProviderAuthenticationSession | undefined> {
		throw new Error('Method `createSession` should never be used in BuiltInAuthenticationProvider');
	}

	@debug()
	override async getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		if (descriptor == null) return undefined;

		const { createIfNeeded, forceNewSession } = options ?? {};
		return getBuiltInIntegrationSession(
			this.container,
			this.authProviderId,
			descriptor,
			forceNewSession ? { forceNewSession: true } : createIfNeeded ? { createIfNeeded: true } : { silent: true },
		);
	}
}
