import type { AuthenticationSession, CancellationToken, Disposable, Uri } from 'vscode';
import { authentication, CancellationTokenSource, window } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { Container } from '../../../container';
import { debug, log } from '../../../system/decorators/log';
import type { DeferredEventExecutor } from '../../../system/event';
import { promisifyDeferred } from '../../../system/event';
import { openUrl } from '../../../system/utils';
import type { ServerConnection } from '../../gk/serverConnection';
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

	protected getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	protected abstract createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { authorizeIfNeeded?: boolean },
	): Promise<ProviderAuthenticationSession | undefined>;

	@debug()
	async deleteSession(descriptor?: IntegrationAuthenticationSessionDescriptor) {
		const key = this.getSecretKey(this.getSessionId(descriptor));
		await this.container.storage.deleteSecret(key);
	}

	private getSecretKey(id: string): `gitlens.integration.auth:${IntegrationId}|${string}` {
		return `gitlens.integration.auth:${this.authProviderId}|${id}`;
	}

	private async createAndStoreSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
		const session = await this.createSession(descriptor);
		if (session == null) return undefined;

		const key = this.getSecretKey(this.getSessionId(descriptor));
		await this.container.storage.storeSecret(key, JSON.stringify(session));

		return session;
	}

	@debug()
	async getSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { createIfNeeded?: boolean; forceNewSession?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		const key = this.getSecretKey(this.getSessionId(descriptor));

		if (options?.forceNewSession) {
			await this.container.storage.deleteSecret(key);
		}

		let storedSession: StoredSession | undefined;
		try {
			const sessionJSON = await this.container.storage.getSecret(key);
			if (sessionJSON) {
				storedSession = JSON.parse(sessionJSON);
			}
		} catch (ex) {
			try {
				await this.container.storage.deleteSecret(key);
			} catch {}

			if (!options?.createIfNeeded) {
				throw ex;
			}
		}

		if (
			(options?.createIfNeeded && storedSession == null) ||
			(storedSession?.expiresAt != null && new Date(storedSession.expiresAt).getTime() < Date.now())
		) {
			return this.createAndStoreSession(descriptor);
		}

		return storedSession as ProviderAuthenticationSession | undefined;
	}
}

export abstract class LocalIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {}

export abstract class CloudIntegrationAuthenticationProvider<
	ID extends IntegrationId = IntegrationId,
> extends IntegrationAuthenticationProviderBase<ID> {
	protected async getBuiltInExistingSession(
		_?: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
		options?: { authorizeIfNeeded?: boolean },
	): Promise<ProviderAuthenticationSession | undefined> {
		const existingSession = await this.getBuiltInExistingSession(descriptor);
		if (existingSession != null) return existingSession;

		const cloudIntegrations = await this.container.cloudIntegrations;
		if (cloudIntegrations == null) return undefined;

		let session = await cloudIntegrations.getConnectionSession(this.authProviderId);

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

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

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
				case HostingIntegrationId.GitHub:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubAuthenticationProvider(this.container);
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
