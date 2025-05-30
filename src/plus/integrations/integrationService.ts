import type { AuthenticationSessionsChangeEvent, CancellationToken, Event } from 'vscode';
import { authentication, Disposable, EventEmitter } from 'vscode';
import { isWeb } from '@env/platform';
import type { Container } from '../../container';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { RemoteProvider, RemoteProviderId } from '../../git/remotes/remoteProvider';
import { configuration } from '../../system/configuration';
import { debug } from '../../system/decorators/log';
import { filterMap, flatten } from '../../system/iterable';
import type {
	HostingIntegration,
	Integration,
	IntegrationKey,
	IntegrationType,
	IssueIntegration,
	ResourceDescriptor,
	SupportedHostingIntegrationIds,
	SupportedIntegrationIds,
	SupportedIssueIntegrationIds,
	SupportedSelfHostedIntegrationIds,
} from './integration';
import {
	HostingIntegrationId,
	isSelfHostedIntegrationId,
	IssueIntegrationId,
	SelfHostedIntegrationId,
} from './providers/models';
import type { ProvidersApi } from './providers/providersApi';

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
	private _integrations = new Map<IntegrationKey, Integration>();

	constructor(private readonly container: Container) {
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
		for (const integration of this._integrations.values()) {
			if (e.provider.id === integration.authProvider.id) {
				integration.refresh();
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

	get(id: SupportedHostingIntegrationIds): Promise<HostingIntegration>;
	get(id: SupportedIssueIntegrationIds): Promise<IssueIntegration>;
	get(id: SupportedSelfHostedIntegrationIds, domain: string): Promise<HostingIntegration>;
	async get(
		id: SupportedHostingIntegrationIds | SupportedIssueIntegrationIds | SupportedSelfHostedIntegrationIds,
		domain?: string,
	): Promise<Integration> {
		let integration = this.getCached(id, domain);
		if (integration == null) {
			switch (id) {
				case HostingIntegrationId.GitHub:
					integration = new (
						await import(/* webpackChunkName: "github" */ './providers/github')
					).GitHubIntegration(this.container, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					integration = new (
						await import(/* webpackChunkName: "github" */ './providers/github')
					).GitHubEnterpriseIntegration(this.container, this.getProvidersApi.bind(this), domain);
					break;
				case HostingIntegrationId.GitLab:
					integration = new (
						await import(/* webpackChunkName: "gitlab" */ './providers/gitlab')
					).GitLabIntegration(this.container, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.GitLabSelfHosted:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					integration = new (
						await import(/* webpackChunkName: "gitlab" */ './providers/gitlab')
					).GitLabSelfHostedIntegration(this.container, this.getProvidersApi.bind(this), domain);
					break;
				case HostingIntegrationId.Bitbucket:
					integration = new (
						await import(/* webpackChunkName: "bitbucket" */ './providers/bitbucket')
					).BitbucketIntegration(this.container, this.getProvidersApi.bind(this));
					break;
				case HostingIntegrationId.AzureDevOps:
					integration = new (
						await import(/* webpackChunkName: "azdo" */ './providers/azureDevOps')
					).AzureDevOpsIntegration(this.container, this.getProvidersApi.bind(this));
					break;
				case IssueIntegrationId.Jira:
					integration = new (await import(/* webpackChunkName: "jira" */ './providers/jira')).JiraIntegration(
						this.container,
						this.getProvidersApi.bind(this),
					);
					break;
				default:
					throw new Error(`Integration with '${id}' is not supported`);
			}
			this._integrations.set(this.getCacheKey(id, domain), integration);
		}

		return integration;
	}

	private _providersApi: Promise<ProvidersApi> | undefined;
	private async getProvidersApi() {
		if (this._providersApi == null) {
			const container = this.container;
			async function load() {
				return new (
					await import(/* webpackChunkName: "integrations" */ './providers/providersApi')
				).ProvidersApi(container);
			}

			this._providersApi = load();
		}

		return this._providersApi;
	}

	getByRemote(remote: GitRemote): Promise<HostingIntegration | undefined> {
		if (remote?.provider == null) return Promise.resolve(undefined);

		return this.getByRemoteCore(remote as GitRemote<RemoteProvider>, this.get);
	}

	getByRemoteCached(remote: GitRemote): HostingIntegration | undefined {
		if (remote?.provider == null) return undefined;

		return this.getByRemoteCore(remote as GitRemote<RemoteProvider>, this.getCached);
	}

	private getByRemoteCore<F extends typeof this.get | typeof this.getCached>(
		remote: GitRemote<RemoteProvider>,
		getOrGetCached: F,
	): F extends typeof this.get ? Promise<HostingIntegration | undefined> : HostingIntegration | undefined {
		type RT = F extends typeof this.get ? Promise<HostingIntegration | undefined> : HostingIntegration | undefined;

		const get = getOrGetCached.bind(this);

		switch (remote.provider.id) {
			case 'azure-devops':
				return get(HostingIntegrationId.AzureDevOps) as RT;
			case 'bitbucket':
				return get(HostingIntegrationId.Bitbucket) as RT;
			case 'github':
				if (remote.provider.custom && remote.provider.domain != null) {
					return get(SelfHostedIntegrationId.GitHubEnterprise, remote.provider.domain) as RT;
				}
				return get(HostingIntegrationId.GitHub) as RT;
			case 'gitlab':
				if (remote.provider.custom && remote.provider.domain != null) {
					return get(SelfHostedIntegrationId.GitLabSelfHosted, remote.provider.domain) as RT;
				}
				return get(HostingIntegrationId.GitLab) as RT;
			case 'bitbucket-server':
			default:
				return (getOrGetCached === this.get ? Promise.resolve(undefined) : undefined) as RT;
		}
	}

	getConnected(type: 'issues'): IssueIntegration[];
	getConnected(type: 'hosting'): HostingIntegration[];
	getConnected(type: IntegrationType): Integration[] {
		return [...this._integrations.values()].filter(p => p.maybeConnected && p.type === type);
	}

	async getMyIssues(
		integrationIds?: HostingIntegrationId[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const integrations: Map<Integration, ResourceDescriptor[] | undefined> = new Map();
		for (const integrationId of integrationIds?.length ? integrationIds : Object.values(HostingIntegrationId)) {
			const integration = await this.get(integrationId);
			if (integration == null) continue;

			integrations.set(integration, undefined);
		}
		if (integrations.size === 0) return undefined;

		return this.getMyIssuesCore(integrations, cancellation);
	}

	private async getMyIssuesCore(
		integrations: Map<Integration, ResourceDescriptor[] | undefined>,
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const promises: Promise<SearchedIssue[] | undefined>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyIssues(repos, cancellation));
		}

		const results = await Promise.allSettled(promises);
		return [...flatten(filterMap(results, r => (r.status === 'fulfilled' ? r.value : undefined)))];
	}

	async getMyIssuesForRemotes(remote: GitRemote): Promise<SearchedIssue[] | undefined>;
	async getMyIssuesForRemotes(remotes: GitRemote[]): Promise<SearchedIssue[] | undefined>;
	@debug<IntegrationService['getMyIssuesForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyIssuesForRemotes(remoteOrRemotes: GitRemote | GitRemote[]): Promise<SearchedIssue[] | undefined> {
		if (!Array.isArray(remoteOrRemotes)) {
			remoteOrRemotes = [remoteOrRemotes];
		}

		if (!remoteOrRemotes.length) return undefined;
		if (remoteOrRemotes.length === 1) {
			const [remote] = remoteOrRemotes;
			if (remote?.provider == null) return undefined;

			const integration = await this.getByRemote(remote);
			return integration?.searchMyIssues(remote.provider.repoDesc);
		}

		const integrations = new Map<HostingIntegration, ResourceDescriptor[]>();

		for (const remote of remoteOrRemotes) {
			if (remote?.provider == null) continue;

			const integration = await remote.getIntegration();
			if (integration == null) continue;

			let repos = integrations.get(integration);
			if (repos == null) {
				repos = [];
				integrations.set(integration, repos);
			}
			repos.push(remote.provider.repoDesc);
		}

		return this.getMyIssuesCore(integrations);
	}

	async getMyPullRequests(
		integrationIds?: HostingIntegrationId[],
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined> {
		const integrations: Map<HostingIntegration, ResourceDescriptor[] | undefined> = new Map();
		for (const integrationId of integrationIds?.length ? integrationIds : Object.values(HostingIntegrationId)) {
			const integration = await this.get(integrationId);
			if (integration == null) continue;

			integrations.set(integration, undefined);
		}
		if (integrations.size === 0) return undefined;

		return this.getMyPullRequestsCore(integrations, cancellation);
	}

	private async getMyPullRequestsCore(
		integrations: Map<HostingIntegration, ResourceDescriptor[] | undefined>,
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined> {
		const promises: Promise<SearchedPullRequest[] | undefined>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyPullRequests(repos, cancellation));
		}

		const results = await Promise.allSettled(promises);
		return [...flatten(filterMap(results, r => (r.status === 'fulfilled' ? r.value : undefined)))];
	}

	async getMyPullRequestsForRemotes(remote: GitRemote): Promise<SearchedPullRequest[] | undefined>;
	async getMyPullRequestsForRemotes(remotes: GitRemote[]): Promise<SearchedPullRequest[] | undefined>;
	@debug<IntegrationService['getMyPullRequestsForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyPullRequestsForRemotes(
		remoteOrRemotes: GitRemote | GitRemote[],
	): Promise<SearchedPullRequest[] | undefined> {
		if (!Array.isArray(remoteOrRemotes)) {
			remoteOrRemotes = [remoteOrRemotes];
		}

		if (!remoteOrRemotes.length) return undefined;
		if (remoteOrRemotes.length === 1) {
			const [remote] = remoteOrRemotes;
			if (remote?.provider == null) return undefined;

			const provider = await this.getByRemote(remote);
			return provider?.searchMyPullRequests(remote.provider.repoDesc);
		}

		const integrations = new Map<HostingIntegration, ResourceDescriptor[]>();

		for (const remote of remoteOrRemotes) {
			if (remote?.provider == null) continue;

			const integration = await remote.getIntegration();
			if (integration == null) continue;

			let repos = integrations.get(integration);
			if (repos == null) {
				repos = [];
				integrations.set(integration, repos);
			}
			repos.push(remote.provider.repoDesc);
		}

		return this.getMyPullRequestsCore(integrations);
	}

	isMaybeConnected(remote: GitRemote): boolean {
		if (remote.provider?.id != null && this.supports(remote.provider.id)) {
			return this.getByRemoteCached(remote)?.maybeConnected ?? false;
		}
		return false;
	}

	supports(remoteId: RemoteProviderId): boolean {
		switch (remoteId) {
			case 'azure-devops':
			case 'bitbucket':
			case 'github':
			case 'gitlab':
				return true;
			case 'bitbucket-server':
			default:
				return false;
		}
	}

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	ignoreSSLErrors(
		integration: HostingIntegration | { id: SupportedIntegrationIds; domain?: string },
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

	private getCached(id: SupportedHostingIntegrationIds): HostingIntegration | undefined;
	private getCached(id: SupportedIssueIntegrationIds): IssueIntegration | undefined;
	private getCached(id: SupportedSelfHostedIntegrationIds, domain: string): HostingIntegration | undefined;
	private getCached(
		id: SupportedHostingIntegrationIds | SupportedIssueIntegrationIds | SupportedSelfHostedIntegrationIds,
		domain?: string,
	): Integration | undefined;
	private getCached(
		id: SupportedHostingIntegrationIds | SupportedIssueIntegrationIds | SupportedSelfHostedIntegrationIds,
		domain?: string,
	): Integration | undefined {
		return this._integrations.get(this.getCacheKey(id, domain));
	}

	private getCacheKey(
		id: SupportedHostingIntegrationIds | SupportedIssueIntegrationIds | SupportedSelfHostedIntegrationIds,
		domain?: string,
	): IntegrationKey {
		return isSelfHostedIntegrationId(id) ? (`${id}:${domain}` as const) : id;
	}
}
