import type { AuthenticationSessionsChangeEvent, Event } from 'vscode';
import { authentication, Disposable, EventEmitter } from 'vscode';
import { isWeb } from '@env/platform';
import type { Container } from '../../container';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { RemoteProviderId } from '../../git/remotes/remoteProvider';
import { configuration } from '../../system/configuration';
import { debug } from '../../system/decorators/log';
import type { ProviderIntegration, ProviderKey, SupportedProviderIds } from './providerIntegration';
import { AzureDevOpsIntegration } from './providers/azureDevOps';
import { BitbucketIntegration } from './providers/bitbucket';
import { GitHubEnterpriseIntegration, GitHubIntegration } from './providers/github';
import { GitLabIntegration, GitLabSelfHostedIntegration } from './providers/gitlab';
import { ProviderId } from './providers/models';
import { ProvidersApi } from './providers/providersApi';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

export class IntegrationService implements Disposable {
	private readonly _onDidChangeConnectionState = new EventEmitter<ConnectionStateChangeEvent>();
	get onDidChangeConnectionState(): Event<ConnectionStateChangeEvent> {
		return this._onDidChangeConnectionState.event;
	}

	private readonly _connectedCache = new Set<string>();
	private readonly _disposable: Disposable;
	private _integrations = new Map<ProviderKey, ProviderIntegration>();
	private _providersApi: ProvidersApi;

	constructor(private readonly container: Container) {
		this._providersApi = new ProvidersApi(container);

		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this._ignoreSSLErrors.clear();
				}
			}),
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
		);
	}

	dispose() {
		this._disposable?.dispose();
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		for (const provider of this._integrations.values()) {
			if (e.provider.id === provider.authProvider.id) {
				provider.refresh();
			}
		}
	}

	connected(key: string): void {
		// Only fire events if the key is being connected for the first time
		if (this._connectedCache.has(key)) return;

		this._connectedCache.add(key);
		this.container.telemetry.sendEvent('remoteProviders/connected', { 'remoteProviders.key': key });

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: 'connected' }), 250);
	}

	disconnected(key: string): void {
		// Probably shouldn't bother to fire the event if we don't already think we are connected, but better to be safe
		// if (!_connectedCache.has(key)) return;
		this._connectedCache.delete(key);
		this.container.telemetry.sendEvent('remoteProviders/disconnected', { 'remoteProviders.key': key });

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: 'disconnected' }), 250);
	}

	isConnected(key?: string): boolean {
		return key == null ? this._connectedCache.size !== 0 : this._connectedCache.has(key);
	}

	get(id: SupportedProviderIds, domain?: string): ProviderIntegration {
		const key: ProviderKey = `${id}|${domain}`;
		let provider = this._integrations.get(key);
		if (provider == null) {
			switch (id) {
				case ProviderId.GitHub:
					provider = new GitHubIntegration(this.container, this._providersApi);
					break;
				case ProviderId.GitHubEnterprise:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitHubEnterpriseIntegration(this.container, this._providersApi, domain);
					break;
				case ProviderId.GitLab:
					provider = new GitLabIntegration(this.container, this._providersApi);
					break;
				case ProviderId.GitLabSelfHosted:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitLabSelfHostedIntegration(this.container, this._providersApi, domain);
					break;
				case ProviderId.Bitbucket:
					provider = new BitbucketIntegration(this.container, this._providersApi);
					break;
				case ProviderId.AzureDevOps:
					provider = new AzureDevOpsIntegration(this.container, this._providersApi);
					break;
				default:
					throw new Error(`Provider '${id}' is not supported`);
			}
			this._integrations.set(key, provider);
		}

		return provider;
	}

	getByRemote(remote: GitRemote): ProviderIntegration | undefined {
		if (remote?.provider == null) return undefined;

		const id = convertRemoteIdToProviderId(remote.provider.id);
		return id != null ? this.get(id, remote.domain) : undefined;
	}

	async getMyIssues(remote: GitRemote): Promise<SearchedIssue[] | undefined>;
	async getMyIssues(remotes: GitRemote[]): Promise<SearchedIssue[] | undefined>;
	@debug<IntegrationService['getMyIssues']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyIssues(remoteOrRemotes: GitRemote | GitRemote[]): Promise<SearchedIssue[] | undefined> {
		if (Array.isArray(remoteOrRemotes)) {
			const remotesByProviderId = new Map<RemoteProviderId, GitRemote[]>();
			for (const remote of remoteOrRemotes) {
				if (remote?.provider == null) continue;

				let remotes = remotesByProviderId.get(remote.provider.id);
				if (remotes == null) {
					remotes = [];
					remotesByProviderId.set(remote.provider.id, remotes);
				}
				remotes.push(remote);
			}

			const promises: Promise<SearchedIssue[] | undefined>[] = [];
			for (const [remoteProviderId, remotes] of remotesByProviderId) {
				const providerId = convertRemoteIdToProviderId(remoteProviderId);
				if (providerId == null) continue;
				const provider = this.get(providerId);
				promises.push(provider.searchMyIssues(remotes.map(r => r.provider!.repoDesc)));
			}

			return (await Promise.all(promises)).filter(r => r != null).flat() as SearchedIssue[];
		}

		if (remoteOrRemotes?.provider == null) return undefined;

		const provider = this.getByRemote(remoteOrRemotes);
		return provider?.searchMyIssues(remoteOrRemotes.provider.repoDesc);
	}

	async getMyPullRequests(remote: GitRemote): Promise<SearchedPullRequest[] | undefined>;
	async getMyPullRequests(remotes: GitRemote[]): Promise<SearchedPullRequest[] | undefined>;
	@debug<IntegrationService['getMyPullRequests']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyPullRequests(remoteOrRemotes: GitRemote | GitRemote[]): Promise<SearchedPullRequest[] | undefined> {
		if (Array.isArray(remoteOrRemotes)) {
			const remotesByProviderId = new Map<RemoteProviderId, GitRemote[]>();
			for (const remote of remoteOrRemotes) {
				if (remote?.provider == null) continue;

				let remotes = remotesByProviderId.get(remote.provider.id);
				if (remotes == null) {
					remotes = [];
					remotesByProviderId.set(remote.provider.id, remotes);
				}
				remotes.push(remote);
			}

			const promises: Promise<SearchedPullRequest[] | undefined>[] = [];
			for (const [remoteProviderId, remotes] of remotesByProviderId) {
				const providerId = convertRemoteIdToProviderId(remoteProviderId);
				if (providerId == null) continue;
				const provider = this.get(providerId);
				promises.push(provider.searchMyPullRequests(remotes.map(r => r.provider!.repoDesc)));
			}

			return (await Promise.all(promises)).filter(r => r != null).flat() as SearchedPullRequest[];
		}

		if (remoteOrRemotes?.provider == null) return undefined;

		const provider = this.getByRemote(remoteOrRemotes);
		return provider?.searchMyPullRequests(remoteOrRemotes.provider.repoDesc);
	}

	supports(remoteId: RemoteProviderId): boolean {
		return convertRemoteIdToProviderId(remoteId) != null;
	}

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	ignoreSSLErrors(
		integration: ProviderIntegration | { id: SupportedProviderIds; domain: string },
	): boolean | 'force' {
		if (isWeb) return false;

		let ignoreSSLErrors = this._ignoreSSLErrors.get(integration.id);
		if (ignoreSSLErrors === undefined) {
			const cfg = configuration
				.get('remotes')
				?.find(remote => remote.type.toLowerCase() === integration.id && remote.domain === integration.domain);
			ignoreSSLErrors = cfg?.ignoreSSLErrors ?? false;
			this._ignoreSSLErrors.set(integration.id, ignoreSSLErrors);
		}

		return ignoreSSLErrors;
	}
}

function convertRemoteIdToProviderId(remoteId: RemoteProviderId): SupportedProviderIds | undefined {
	switch (remoteId) {
		case 'azure-devops':
			return ProviderId.AzureDevOps;
		case 'bitbucket':
		case 'bitbucket-server':
			return ProviderId.Bitbucket;
		case 'github':
			return ProviderId.GitHub;
		case 'gitlab':
			return ProviderId.GitLab;
		default:
			return undefined;
	}
}
