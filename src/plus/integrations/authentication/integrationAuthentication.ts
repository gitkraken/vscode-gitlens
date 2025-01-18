import type { CancellationToken, Disposable, Event, Uri } from 'vscode';
import { authentication, EventEmitter, window } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { IntegrationId } from '../../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import type { IntegrationAuthenticationKeys, StoredConfiguredIntegrationDescriptor } from '../../../constants.storage';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import type { DeferredEventExecutor } from '../../../system/event';
import { isSelfHostedIntegrationId, supportedIntegrationIds } from '../providers/models';
import type { ConfiguredIntegrationDescriptor, ProviderAuthenticationSession } from './models';
import { isSupportedCloudIntegrationId } from './models';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

interface StoredSession {
	id: string;
	accessToken: string;
	account?: {
		label?: string;
		displayName?: string;
		id: string;
	};
	scopes: string[];
	cloud?: boolean;
	expiresAt?: string;
}

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
	deleteSession(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void>;
	getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
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

	constructor(
		protected readonly container: Container,
		protected readonly authenticationService: IntegrationAuthenticationService,
	) {}

	dispose() {
		this.disposables.forEach(d => void d.dispose());
	}

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	protected abstract get authProviderId(): ID;

	protected abstract fetchOrCreateSession(
		storedSession: ProviderAuthenticationSession | undefined,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
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

	protected abstract deleteAllSecrets(sessionId: string): Promise<void>;

	protected abstract storeSession(sessionId: string, session: ProviderAuthenticationSession): Promise<void>;

	protected abstract restoreSession(sessionId: string): Promise<ProviderAuthenticationSession | undefined>;

	protected async deleteSecret(key: IntegrationAuthenticationKeys, sessionId: string) {
		await this.container.storage.deleteSecret(key);
		await this.authenticationService.removeConfigured({
			integrationId: this.authProviderId,
			domain: isSelfHostedIntegrationId(this.authProviderId) ? sessionId : undefined,
		});
	}

	protected async writeSecret(
		key: IntegrationAuthenticationKeys,
		session: ProviderAuthenticationSession | StoredSession,
	) {
		await this.container.storage.storeSecret(key, JSON.stringify(session));
		// TODO: we should add `domain` on to the session like we are doing with `cloud` to make it explicit
		await this.authenticationService.addConfigured({
			integrationId: this.authProviderId,
			domain: isSelfHostedIntegrationId(this.authProviderId) ? session.id : undefined,
			expiresAt: session.expiresAt,
			scopes: session.scopes.join(','),
			cloud: session.cloud ?? false,
		});
	}

	protected async readSecret(
		key: IntegrationAuthenticationKeys,
		sessionId: string,
	): Promise<StoredSession | undefined> {
		let storedSession: StoredSession | undefined;
		try {
			const sessionJSON = await this.container.storage.getSecret(key);
			if (sessionJSON) {
				storedSession = JSON.parse(sessionJSON);
				if (storedSession != null) {
					const configured = this.authenticationService.configured.get(this.authProviderId);
					const domain = isSelfHostedIntegrationId(this.authProviderId) ? storedSession.id : undefined;
					if (
						configured == null ||
						configured.length === 0 ||
						!configured.some(c => c.domain === domain && c.integrationId === this.authProviderId)
					) {
						await this.authenticationService.addConfigured({
							integrationId: this.authProviderId,
							domain: domain,
							expiresAt: storedSession.expiresAt,
							scopes: storedSession.scopes.join(','),
							cloud: storedSession.cloud ?? false,
						});
					}
				}
			}
		} catch (_ex) {
			try {
				await this.deleteSecret(key, sessionId);
			} catch {}
		}
		return storedSession;
	}

	protected getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	protected getLocalSecretKey(id: string): `gitlens.integration.auth:${IntegrationId}|${string}` {
		return `gitlens.integration.auth:${this.authProviderId}|${id}`;
	}

	@debug()
	async deleteSession(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		const sessionId = this.getSessionId(descriptor);
		const storedSession = await this.restoreSession(sessionId);
		await this.deleteAllSecrets(sessionId);
		if (storedSession != null) {
			this.fireDidChange();
		}
	}

	@debug()
	async getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?:
			| { createIfNeeded?: boolean; forceNewSession?: boolean; sync?: never; source?: Sources }
			| { createIfNeeded?: never; forceNewSession?: never; sync: boolean; source?: Sources },
	): Promise<ProviderAuthenticationSession | undefined> {
		const sessionId = this.getSessionId(descriptor);

		let session;
		let storedSession;
		if (options?.forceNewSession) {
			await this.deleteAllSecrets(sessionId);
		} else {
			storedSession = await this.restoreSession(sessionId);
			session = storedSession;
		}

		const isExpiredSession = session?.expiresAt != null && new Date(session.expiresAt).getTime() < Date.now();
		if (session == null || isExpiredSession) {
			session = await this.fetchOrCreateSession(storedSession, descriptor, {
				...options,
				refreshIfExpired: isExpiredSession,
			});

			if (session != null) {
				await this.storeSession(sessionId, session);
			}
		}

		this.fireIfChanged(storedSession, session);
		return session;
	}

	protected fireIfChanged(
		storedSession: ProviderAuthenticationSession | undefined,
		newSession: ProviderAuthenticationSession | undefined,
	) {
		if (storedSession?.accessToken === newSession?.accessToken) return;

		queueMicrotask(() => this._onDidChange.fire());
	}
	protected fireDidChange() {
		queueMicrotask(() => this._onDidChange.fire());
	}
}

export abstract class LocalIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	protected override async deleteAllSecrets(sessionId: string) {
		await this.deleteSecret(this.getLocalSecretKey(sessionId), sessionId);
	}

	protected override async storeSession(sessionId: string, session: ProviderAuthenticationSession) {
		await this.writeSecret(this.getLocalSecretKey(sessionId), session);
	}

	protected override async restoreSession(sessionId: string): Promise<ProviderAuthenticationSession | undefined> {
		const key = this.getLocalSecretKey(sessionId);
		return convertStoredSessionToSession(await this.readSecret(key, sessionId), false);
	}

	protected abstract createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined>;

	protected override async fetchOrCreateSession(
		storedSession: ProviderAuthenticationSession | undefined,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean; source?: Sources },
	) {
		if (!options?.createIfNeeded && !options?.forceNewSession) return storedSession;

		return this.createSession(descriptor);
	}
}

export abstract class CloudIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	private getCloudSecretKey(id: string): `gitlens.integration.auth.cloud:${IntegrationId}|${string}` {
		return `gitlens.integration.auth.cloud:${this.authProviderId}|${id}`;
	}

	protected override async deleteAllSecrets(sessionId: string) {
		await Promise.allSettled([
			this.deleteSecret(this.getLocalSecretKey(sessionId), sessionId),
			this.deleteSecret(this.getCloudSecretKey(sessionId), sessionId),
		]);
	}

	protected override async storeSession(sessionId: string, session: ProviderAuthenticationSession) {
		await this.writeSecret(this.getCloudSecretKey(sessionId), session);
	}

	/**
	 * This method gets the session from the storage and returns it.
	 * Howewer, if a cloud session is stored with a local key, it will be renamed and saved in the storage with the cloud key.
	 */
	protected override async restoreSession(sessionId: string): Promise<ProviderAuthenticationSession | undefined> {
		let cloudIfMissing = false;
		// At first we try to restore a token with the local key
		let session = await this.readSecret(this.getLocalSecretKey(sessionId), sessionId);
		if (session != null) {
			// Check the `expiresAt` field
			// If it has an expiresAt property and the key is the old type, then it's a cloud session,
			// so delete it from the local key and
			// store with the "cloud" type key, and then use that one.
			// Otherwise it's a local session under the local key, so just return it.
			if (session.expiresAt != null) {
				cloudIfMissing = true;
				await Promise.allSettled([
					this.deleteSecret(this.getLocalSecretKey(sessionId), session.id),
					this.writeSecret(this.getCloudSecretKey(sessionId), session),
				]);
			}
		}

		// If no local session we try to restore a session with the cloud key
		if (session == null) {
			cloudIfMissing = true;
			session = await this.readSecret(this.getCloudSecretKey(sessionId), sessionId);
		}

		return convertStoredSessionToSession(session, cloudIfMissing);
	}

	protected override async fetchOrCreateSession(
		_storedSession: ProviderAuthenticationSession | undefined,
		descriptor?: IntegrationAuthenticationSessionDescriptor,
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
			if (!(await this.disconnectSession())) {
				return undefined;
			}

			void this.connectCloudIntegration(false, options?.source);
			return undefined;
		}
		// TODO: This is a stopgap to make sure we're not hammering the api on automatic calls to get the session.
		// Ultimately we want to timestamp calls to syncCloudIntegrations and use that to determine whether we should
		// make the call or not.
		let session =
			options?.refreshIfExpired || options?.createIfNeeded || options?.forceNewSession || options?.sync
				? await this.fetchSession(descriptor)
				: undefined;

		if (shouldCreateSession(session, options)) {
			const connected = await this.connectCloudIntegration(true, options?.source);
			if (!connected) return undefined;
			session = await this.getSession(descriptor, { source: options?.source });
		}
		return session;
	}

	private async connectCloudIntegration(skipIfConnected: boolean, source: Sources | undefined): Promise<boolean> {
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

	private async fetchSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		const loggedIn = await this.container.subscription.getAuthenticationSession(false);
		if (!loggedIn) return undefined;

		const cloudIntegrations = await this.container.cloudIntegrations;
		if (cloudIntegrations == null) return undefined;

		let session = await cloudIntegrations.getConnectionSession(this.authProviderId);

		// Make an exception for GitHub because they always return 0
		if (
			session?.expiresIn === 0 &&
			(this.authProviderId === HostingIntegrationId.GitHub ||
				this.authProviderId === SelfHostedIntegrationId.CloudGitHubEnterprise ||
				// Note: added GitLab self managed here because the cloud token is always a PAT, and the api does not know when it expires, nor can it refresh it
				this.authProviderId === SelfHostedIntegrationId.CloudGitLabSelfHosted)
		) {
			// It never expires so don't refresh it frequently:
			session.expiresIn = maxSmallIntegerV8; // maximum expiration length
		}

		if (session != null && session.expiresIn < 60) {
			session = await cloudIntegrations.getConnectionSession(this.authProviderId, session.accessToken);
		}

		if (!session) return undefined;

		return {
			id: this.getSessionId(descriptor),
			accessToken: session.accessToken,
			scopes: descriptor?.scopes ?? [],
			account: {
				id: '',
				label: '',
			},
			cloud: true,
			expiresAt: new Date(session.expiresIn * 1000 + Date.now()),
		};
	}

	private async disconnectSession(): Promise<boolean> {
		const loggedIn = await this.container.subscription.getAuthenticationSession(false);
		if (!loggedIn) return false;

		const cloudIntegrations = await this.container.cloudIntegrations;
		if (cloudIntegrations == null) return false;

		return cloudIntegrations.disconnect(this.authProviderId);
	}

	private async openCompletionInput(cancellationToken: CancellationToken) {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		try {
			if (cancellationToken.isCancellationRequested) return;

			await new Promise<string | undefined>(resolve => {
				disposables.push(
					cancellationToken.onCancellationRequested(() => input.hide()),
					input.onDidHide(() => resolve(undefined)),
					input.onDidAccept(() => resolve(undefined)),
				);

				input.title = this.getCompletionInputTitle();
				input.placeholder = 'Please enter the provided authorization code';
				input.prompt = '';

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}
	}

	protected abstract getCompletionInputTitle(): string;

	private getUriHandlerDeferredExecutor(): DeferredEventExecutor<Uri, string> {
		return (uri: Uri, resolve, reject) => {
			const queryParams: URLSearchParams = new URLSearchParams(uri.query);
			const provider = queryParams.get('provider');
			if (provider !== this.authProviderId) {
				reject('Invalid provider');
				return;
			}

			resolve(uri.toString(true));
		};
	}
}

class BuiltInAuthenticationProvider extends LocalIntegrationAuthenticationProvider {
	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		protected readonly authProviderId: IntegrationId,
	) {
		super(container, authenticationService);
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
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		if (descriptor == null) return undefined;

		const { createIfNeeded, forceNewSession } = options ?? {};
		return wrapForForcedInsecureSSL(
			this.container.integrations.ignoreSSLErrors({ id: this.authProviderId, domain: descriptor?.domain }),
			async () => {
				const session = await authentication.getSession(this.authProviderId, descriptor.scopes, {
					createIfNone: forceNewSession ? undefined : createIfNeeded,
					silent: !createIfNeeded && !forceNewSession ? true : undefined,
					forceNewSession: forceNewSession ? true : undefined,
				});
				if (session == null) return undefined;

				return {
					...session,
					cloud: false,
				};
			},
		);
	}
}

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationId, IntegrationAuthenticationProvider>();
	private _configured?: Map<IntegrationId, ConfiguredIntegrationDescriptor[]>;

	constructor(private readonly container: Container) {}

	dispose() {
		this.providers.forEach(p => void p.dispose());
		this.providers.clear();
	}

	get configured(): Map<IntegrationId, ConfiguredIntegrationDescriptor[]> {
		if (this._configured == null) {
			this._configured = new Map();
			const storedConfigured = this.container.storage.get('integrations:configured');
			for (const [id, configured] of Object.entries(storedConfigured ?? {})) {
				if (configured == null) continue;
				const descriptors = configured.map(d => ({
					...d,
					expiresAt: d.expiresAt ? new Date(d.expiresAt) : undefined,
				}));
				this._configured.set(id as IntegrationId, descriptors);
			}
		}

		return this._configured;
	}

	private async storeConfigured() {
		// We need to convert the map to a record to store
		const configured: Record<string, StoredConfiguredIntegrationDescriptor[]> = {};
		for (const [id, descriptors] of this.configured) {
			configured[id] = descriptors.map(d => ({
				...d,
				expiresAt: d.expiresAt
					? d.expiresAt instanceof Date
						? d.expiresAt.toISOString()
						: d.expiresAt
					: undefined,
			}));
		}

		await this.container.storage.store('integrations:configured', configured);
	}

	async addConfigured(descriptor: ConfiguredIntegrationDescriptor) {
		const descriptors = this.configured.get(descriptor.integrationId) ?? [];
		// Only add if one does not exist
		if (descriptors.some(d => d.domain === descriptor.domain && d.integrationId === descriptor.integrationId)) {
			return;
		}
		descriptors.push(descriptor);
		this.configured.set(descriptor.integrationId, descriptors);
		await this.storeConfigured();
	}

	async removeConfigured(descriptor: Pick<ConfiguredIntegrationDescriptor, 'integrationId' | 'domain'>) {
		const descriptors = this.configured.get(descriptor.integrationId);
		if (descriptors == null) return;
		const index = descriptors.findIndex(
			d => d.domain === descriptor.domain && d.integrationId === descriptor.integrationId,
		);
		if (index === -1) return;

		descriptors.splice(index, 1);
		this.configured.set(descriptor.integrationId, descriptors);

		await this.storeConfigured();
	}

	async get(providerId: IntegrationId): Promise<IntegrationAuthenticationProvider> {
		return this.ensureProvider(providerId);
	}

	@log()
	async reset() {
		// TODO: This really isn't ideal, since it will only work for "cloud" providers as we won't have any more specific descriptors
		await Promise.allSettled(
			supportedIntegrationIds.map(async providerId => (await this.ensureProvider(providerId)).deleteSession()),
		);
	}

	supports(providerId: string): boolean {
		switch (providerId) {
			case HostingIntegrationId.AzureDevOps:
			case HostingIntegrationId.Bitbucket:
			case SelfHostedIntegrationId.GitHubEnterprise:
			case HostingIntegrationId.GitLab:
			case SelfHostedIntegrationId.GitLabSelfHosted:
			case IssueIntegrationId.Jira:
				return true;
			case HostingIntegrationId.GitHub:
				return isSupportedCloudIntegrationId(HostingIntegrationId.GitHub);
			default:
				return false;
		}
	}

	@gate()
	private async ensureProvider(providerId: IntegrationId): Promise<IntegrationAuthenticationProvider> {
		let provider = this.providers.get(providerId);
		if (provider == null) {
			switch (providerId) {
				case HostingIntegrationId.AzureDevOps:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './azureDevOps')
					).AzureDevOpsAuthenticationProvider(this.container, this);
					break;
				case HostingIntegrationId.Bitbucket:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket')
					).BitbucketAuthenticationProvider(this.container, this);
					break;
				case HostingIntegrationId.GitHub:
					provider = isSupportedCloudIntegrationId(HostingIntegrationId.GitHub)
						? new (
								await import(/* webpackChunkName: "integrations" */ './github')
						  ).GitHubAuthenticationProvider(this.container, this)
						: new BuiltInAuthenticationProvider(this.container, this, providerId);

					break;
				case SelfHostedIntegrationId.CloudGitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseCloudAuthenticationProvider(this.container, this);
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseAuthenticationProvider(this.container, this);
					break;
				case HostingIntegrationId.GitLab:
					provider = isSupportedCloudIntegrationId(HostingIntegrationId.GitLab)
						? new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
						  ).GitLabCloudAuthenticationProvider(this.container, this)
						: new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
						  ).GitLabLocalAuthenticationProvider(this.container, this, HostingIntegrationId.GitLab);
					break;
				case SelfHostedIntegrationId.CloudGitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabSelfHostedCloudAuthenticationProvider(this.container, this);
					break;
				case SelfHostedIntegrationId.GitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabLocalAuthenticationProvider(this.container, this, SelfHostedIntegrationId.GitLabSelfHosted);
					break;
				case IssueIntegrationId.Jira:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './jira')
					).JiraAuthenticationProvider(this.container, this);
					break;
				default:
					provider = new BuiltInAuthenticationProvider(this.container, this, providerId);
			}
			this.providers.set(providerId, provider);
		}

		return provider;
	}
}

function convertStoredSessionToSession(
	storedSession: StoredSession,
	cloudIfMissing: boolean,
): ProviderAuthenticationSession;
function convertStoredSessionToSession(
	storedSession: StoredSession | undefined,
	cloudIfMissing: boolean,
): ProviderAuthenticationSession | undefined;
function convertStoredSessionToSession(
	storedSession: StoredSession | undefined,
	cloudIfMissing: boolean,
): ProviderAuthenticationSession | undefined {
	if (storedSession == null) return undefined;

	return {
		id: storedSession.id,
		accessToken: storedSession.accessToken,
		account: {
			id: storedSession.account?.id ?? '',
			label: storedSession.account?.label ?? '',
		},
		scopes: storedSession.scopes,
		cloud: storedSession.cloud ?? cloudIfMissing,
		expiresAt: storedSession.expiresAt ? new Date(storedSession.expiresAt) : undefined,
	};
}

function shouldCreateSession(
	storedSession: ProviderAuthenticationSession | undefined,
	options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
) {
	return options?.createIfNeeded && storedSession == null;
}
