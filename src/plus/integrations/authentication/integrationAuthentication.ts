import type { AuthenticationSession, CancellationToken, Disposable, Uri } from 'vscode';
import { authentication, CancellationTokenSource, window } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { SecretKeys } from '../../../constants';
import type { Container } from '../../../container';
import { debug, log } from '../../../system/decorators/log';
import type { DeferredEventExecutor } from '../../../system/event';
import { promisifyDeferred } from '../../../system/event';
import { openUrl } from '../../../system/utils';
import type { IntegrationId } from '../providers/models';
import {
	HostingIntegrationId,
	IssueIntegrationId,
	SelfHostedIntegrationId,
	supportedIntegrationIds,
} from '../providers/models';
import type { ProviderAuthenticationSession } from './models';

interface StoredSession {
	id: string;
	accessToken: string;
	account?: {
		label?: string;
		displayName?: string;
		id: string;
	};
	scopes: string[];
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

export interface IntegrationAuthenticationProvider {
	deleteSession(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void>;
	getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined>;
}

abstract class IntegrationAuthenticationProviderBase<ID extends IntegrationId = IntegrationId>
	implements IntegrationAuthenticationProvider
{
	constructor(protected readonly container: Container) {}

	protected abstract get authProviderId(): ID;

	protected abstract createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { authorizeIfNeeded?: boolean },
	): Promise<ProviderAuthenticationSession | undefined>;

	protected abstract deleteAllSecrets(sessionId: string): Promise<void>;

	protected abstract storeSession(sessionId: string, session: AuthenticationSession): Promise<void>;

	protected abstract restoreSession(options: {
		sessionId: string;
		ignoreErrors: boolean;
	}): Promise<StoredSession | undefined>;

	protected async deleteSecret(key: SecretKeys) {
		await this.container.storage.deleteSecret(key);
	}

	protected async writeSecret(key: SecretKeys, session: AuthenticationSession | StoredSession) {
		await this.container.storage.storeSecret(key, JSON.stringify(session));
	}

	protected async readSecret(key: SecretKeys, ignoreErrors: boolean): Promise<StoredSession | undefined> {
		let storedSession: StoredSession | undefined;
		try {
			const sessionJSON = await this.container.storage.getSecret(key);
			if (sessionJSON) {
				storedSession = JSON.parse(sessionJSON);
			}
		} catch (ex) {
			try {
				await this.deleteSecret(key);
			} catch {}

			if (ignoreErrors) {
				throw ex;
			}
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
		await this.deleteAllSecrets(sessionId);
	}

	@debug()
	async getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		const sessionId = this.getSessionId(descriptor);

		if (options?.forceNewSession) {
			await this.deleteAllSecrets(sessionId);
		}

		const storedSession = await this.restoreSession({
			sessionId: sessionId,
			ignoreErrors: !options?.createIfNeeded,
		});
		if (
			(options?.createIfNeeded && storedSession == null) ||
			(storedSession?.expiresAt != null && new Date(storedSession.expiresAt).getTime() < Date.now())
		) {
			const session = await this.createSession(descriptor);
			if (session != null) {
				await this.storeSession(sessionId, session);
			}
			return session;
		}

		return storedSession as ProviderAuthenticationSession | undefined;
	}
}

export abstract class LocalIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	protected async deleteAllSecrets(sessionId: string) {
		await this.deleteSecret(this.getLocalSecretKey(sessionId));
	}

	protected async storeSession(sessionId: string, session: AuthenticationSession) {
		await this.writeSecret(this.getLocalSecretKey(sessionId), session);
	}

	protected override async restoreSession({
		sessionId,
		ignoreErrors,
	}: {
		sessionId: string;
		ignoreErrors: boolean;
	}): Promise<StoredSession | undefined> {
		const key = this.getLocalSecretKey(sessionId);
		return this.readSecret(key, ignoreErrors);
	}
}

export abstract class CloudIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	protected async getBuiltInExistingSession(
		_?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		return Promise.resolve(undefined);
	}

	private getCloudSecretKey(id: string): `gitlens.integration.auth.cloud:${IntegrationId}|${string}` {
		return `gitlens.integration.auth.cloud:${this.authProviderId}|${id}`;
	}

	public async deleteCloudSession(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		const key = this.getCloudSecretKey(this.getSessionId(descriptor));
		await this.deleteSecret(key);
	}

	protected async deleteAllSecrets(sessionId: string) {
		await Promise.all([
			this.deleteSecret(this.getLocalSecretKey(sessionId)),
			this.deleteSecret(this.getCloudSecretKey(sessionId)),
		]);
	}

	protected override async storeSession(sessionId: string, session: AuthenticationSession) {
		await this.writeSecret(this.getCloudSecretKey(sessionId), session);
	}

	/**
	 * This method gets the session from the storage and returns it.
	 * Howewer, if a cloud session is stored with a local key, it will be renamed and saved in the storage with the cloud key.
	 */
	protected override async restoreSession({
		sessionId,
		ignoreErrors,
	}: {
		sessionId: string;
		ignoreErrors: boolean;
	}): Promise<StoredSession | undefined> {
		// At first we try to restore the cloud session
		let session = await this.readSecret(this.getCloudSecretKey(sessionId), ignoreErrors);
		if (session != null) return session;

		// If no cloud session, we check whether we have a token with the local key
		session = await this.readSecret(this.getLocalSecretKey(sessionId), ignoreErrors);
		if (session != null) {
			// Check the `expiresAt` field
			// If it has an expiresAt property and the key is the old type, then it's a cloud session,
			// so delete it from the local key and
			// store with the "cloud" type key, and then use that one
			//
			if (session.expiresAt != null) {
				await Promise.all([
					this.deleteSecret(this.getLocalSecretKey(sessionId)),
					this.writeSecret(this.getCloudSecretKey(sessionId), session),
				]);
				return session;
			}
			// Otherwise, it is rather unexpected, so I'm deleting it and returning undefined,
			// This lets us drop local GitHub sessions that were incorrectly saved during testing the intermitent version of this change.
			return undefined;
			// However, I'm also thingking about using it rather than deleting:
			// return session;
		}

		return undefined;
	}

	public override async getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		const session = await super.getSession(descriptor, options);
		if (session != null) return session;

		// by default getBuiltInExistingSession returns undefined
		// but specific providers can override it to return a session (e.g. GitHub)
		return this.getBuiltInExistingSession(descriptor);
	}

	protected override async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { authorizeIfNeeded?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		const loggedIn = await this.container.subscription.getAuthenticationSession(false);
		if (!loggedIn) return undefined;

		const cloudIntegrations = await this.container.cloudIntegrations;
		if (cloudIntegrations == null) return undefined;

		let session = await cloudIntegrations.getConnectionSession(this.authProviderId);

		// Make an exception for GitHub because they always return 0
		if (session?.expiresIn === 0 && this.authProviderId === HostingIntegrationId.GitHub) {
			// It never expires so don't refresh it frequently:
			session.expiresIn = 31536000; // 1 year
		}

		if (session != null && session.expiresIn < 60) {
			session = await cloudIntegrations.getConnectionSession(this.authProviderId, session.accessToken);
		}

		if (!session && options?.authorizeIfNeeded) {
			const authorizeUrl = (await cloudIntegrations.authorize(this.authProviderId))?.url;

			if (!authorizeUrl) return undefined;

			void (await openUrl(authorizeUrl));

			const cancellation = new CancellationTokenSource();
			const deferredCallback = promisifyDeferred(
				this.container.uri.onDidReceiveCloudIntegrationAuthenticationUri,
				this.getUriHandlerDeferredExecutor(),
			);

			try {
				await Promise.race([
					deferredCallback.promise,
					this.openCompletionInput(cancellation.token),
					new Promise<string>((_, reject) =>
						// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
						cancellation.token.onCancellationRequested(() => reject('Cancelled')),
					),
					new Promise<string>((_, reject) => setTimeout(reject, 120000, 'Cancelled')),
				]);
				session = await cloudIntegrations.getConnectionSession(this.authProviderId);
			} catch {
				session = undefined;
			} finally {
				cancellation.cancel();
				cancellation.dispose();
				deferredCallback.cancel();
			}
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
			expiresAt: new Date(session.expiresIn * 1000 + Date.now()),
		};
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
		protected readonly authProviderId: IntegrationId,
	) {
		super(container);
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
			() =>
				authentication.getSession(this.authProviderId, descriptor.scopes, {
					createIfNone: forceNewSession ? undefined : createIfNeeded,
					silent: !createIfNeeded && !forceNewSession ? true : undefined,
					forceNewSession: forceNewSession ? true : undefined,
				}),
		);
	}
}

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationId, IntegrationAuthenticationProvider>();

	constructor(private readonly container: Container) {}

	dispose() {
		this.providers.clear();
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
			default:
				return false;
		}
	}

	private async ensureProvider(providerId: IntegrationId): Promise<IntegrationAuthenticationProvider> {
		let provider = this.providers.get(providerId);
		if (provider == null) {
			switch (providerId) {
				case HostingIntegrationId.AzureDevOps:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './azureDevOps')
					).AzureDevOpsAuthenticationProvider(this.container);
					break;
				case HostingIntegrationId.Bitbucket:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket')
					).BitbucketAuthenticationProvider(this.container);
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseAuthenticationProvider(this.container);
					break;
				case HostingIntegrationId.GitLab:
				case SelfHostedIntegrationId.GitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabAuthenticationProvider(this.container, providerId);
					break;
				case IssueIntegrationId.Jira:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './jira')
					).JiraAuthenticationProvider(this.container);
					break;
				default:
					provider = new BuiltInAuthenticationProvider(this.container, providerId);
			}
			this.providers.set(providerId, provider);
		}

		return provider;
	}
}
