import { isWeb } from '@env/platform';
import type { AuthenticationSessionsChangeEvent, CancellationToken, Event } from 'vscode';
import { authentication, Disposable, env, EventEmitter, ProgressLocation, Uri, window } from 'vscode';
import type { IntegrationId, SupportedCloudIntegrationIds } from '../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../../constants.integrations';
import type { Source } from '../../constants.telemetry';
import { sourceToContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { Account } from '../../git/models/author';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { RemoteProvider, RemoteProviderId } from '../../git/remotes/remoteProvider';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { promisifyDeferred, take } from '../../system/event';
import { filter, filterMap, flatten, join } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { configuration } from '../../system/vscode/configuration';
import { openUrl } from '../../system/vscode/utils';
import type { SubscriptionChangeEvent } from '../gk/account/subscriptionService';
import type { IntegrationAuthenticationService } from './authentication/integrationAuthentication';
import {
	CloudIntegrationAuthenticationUriPathPrefix,
	getSupportedCloudIntegrationIds,
	isSupportedCloudIntegrationId,
	toCloudIntegrationType,
	toIntegrationId,
} from './authentication/models';
import type {
	HostingIntegration,
	Integration,
	IntegrationBase,
	IntegrationKey,
	IntegrationResult,
	IntegrationType,
	IssueIntegration,
	ResourceDescriptor,
	SupportedHostingIntegrationIds,
	SupportedIntegrationIds,
	SupportedIssueIntegrationIds,
	SupportedSelfHostedIntegrationIds,
} from './integration';
import { isHostingIntegrationId, isSelfHostedIntegrationId } from './providers/models';
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

	private readonly _onDidSyncCloudIntegrations = new EventEmitter<void>();
	get onDidSyncCloudIntegrations(): Event<void> {
		return this._onDidSyncCloudIntegrations.event;
	}

	private readonly _connectedCache = new Set<string>();
	private readonly _disposable: Disposable;
	private _integrations = new Map<IntegrationKey, Integration>();

	constructor(
		private readonly container: Container,
		private readonly authenticationService: IntegrationAuthenticationService,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this._ignoreSSLErrors.clear();
				}
			}),
			authentication.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
			container.subscription.onDidCheckIn(this.onUserCheckedIn, this),
			container.subscription.onDidChange(this.onDidChangeSubscription, this),
		);
	}

	dispose() {
		this._disposable?.dispose();
	}

	@gate()
	@debug()
	private async syncCloudIntegrations(forceConnect: boolean) {
		const connectedIntegrations = new Set<IntegrationId>();
		const loggedIn = await this.container.subscription.getAuthenticationSession();
		if (loggedIn) {
			const cloudIntegrations = await this.container.cloudIntegrations;
			const connections = await cloudIntegrations?.getConnections();
			if (connections == null) return;

			connections.map(p => {
				const integrationId = toIntegrationId[p.provider];
				// GKDev includes some integrations like "google" that we don't support
				if (integrationId == null) return;
				connectedIntegrations.add(toIntegrationId[p.provider]);
			});
		}

		for await (const integration of this.getSupportedCloudIntegrations()) {
			await integration.syncCloudConnection(
				connectedIntegrations.has(integration.id) ? 'connected' : 'disconnected',
				forceConnect,
			);
		}

		if (this.container.telemetry.enabled) {
			this.container.telemetry.setGlobalAttributes({
				'cloudIntegrations.connected.count': connectedIntegrations.size,
				'cloudIntegrations.connected.ids': join(connectedIntegrations.values(), ','),
			});
		}

		this._onDidSyncCloudIntegrations.fire();
		return connectedIntegrations;
	}

	private async *getSupportedCloudIntegrations() {
		for (const id of getSupportedCloudIntegrationIds()) {
			yield this.get(id);
		}
	}

	private onUserCheckedIn() {
		void this.syncCloudIntegrations(false);
	}

	private onDidChangeSubscription(e: SubscriptionChangeEvent) {
		// When logging out, disconnect all connected cloud integrations
		if (e.current?.account == null) {
			void this.syncCloudIntegrations(false);
		}
	}

	async manageCloudIntegrations(source: Source | undefined) {
		const scope = getLogScope();
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'cloudIntegrations/settingsOpened',
				{ 'integration.id': undefined },
				source,
			);
		}

		const account = (await this.container.subscription.getSubscription()).account;
		if (account == null) {
			if (!(await this.container.subscription.loginOrSignUp(true, source))) {
				return;
			}
		}

		try {
			const exchangeToken = await this.container.accountAuthentication.getExchangeToken();
			if (
				!(await openUrl(
					this.container
						.getGkDevUri('settings/integrations', `source=gitlens&token=${exchangeToken}`)
						.toString(true),
				))
			) {
				return;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			if (
				!(await openUrl(this.container.getGkDevUri('settings/integrations', 'source=gitlens').toString(true)))
			) {
				return;
			}
		}
		take(
			window.onDidChangeWindowState,
			2,
		)(async e => {
			if (e.focused) {
				const connected = await this.syncCloudIntegrations(true);
				if (this.container.telemetry.enabled) {
					this.container.telemetry.sendEvent(
						'cloudIntegrations/connected',
						{
							'integration.ids': undefined,
							'integration.connected.ids': connected ? join(connected.values(), ',') : undefined,
						},
						source,
					);
				}
			}
		});
	}

	async connectCloudIntegrations(
		connect?: { integrationIds: SupportedCloudIntegrationIds[]; skipIfConnected?: boolean; skipPreSync?: boolean },
		source?: Source,
	): Promise<boolean> {
		const scope = getLogScope();
		const integrationIds = connect?.integrationIds;
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'cloudIntegrations/connecting',
				{ 'integration.ids': integrationIds?.join(',') },
				source,
			);
		}

		let account = (await this.container.subscription.getSubscription()).account;
		const connectedIntegrations = new Set<string>();
		if (integrationIds?.length) {
			if (connect?.skipIfConnected && !connect?.skipPreSync) {
				await this.syncCloudIntegrations(true);
			}

			for (const integrationId of integrationIds) {
				const integration = await this.get(integrationId);
				if (integration.maybeConnected ?? (await integration.isConnected())) {
					connectedIntegrations.add(integrationId);
				}
			}

			if (connect?.skipIfConnected && connectedIntegrations.size === integrationIds.length) {
				return true;
			}
		}

		let query = 'source=gitlens';

		if (source?.source != null && sourceToContext[source.source] != null) {
			query += `&context=${sourceToContext[source.source]}`;
		}

		if (integrationIds != null) {
			const cloudIntegrationTypes = [];
			for (const integrationId of integrationIds) {
				const cloudIntegrationType = toCloudIntegrationType[integrationId];
				if (cloudIntegrationType == null) {
					Logger.error(
						undefined,
						scope,
						`Attempting to connect unsupported cloud integration type: ${integrationId}`,
					);
				} else {
					cloudIntegrationTypes.push(cloudIntegrationType);
				}
			}
			if (cloudIntegrationTypes.length > 0) {
				query += `&provider=${cloudIntegrationTypes.join(',')}`;
			}
		}

		const baseQuery = query;
		try {
			if (account != null) {
				const token = await this.container.accountAuthentication.getExchangeToken(
					CloudIntegrationAuthenticationUriPathPrefix,
				);

				query += `&token=${token}`;
			} else {
				const callbackUri = await env.asExternalUri(
					Uri.parse(
						`${env.uriScheme}://${this.container.context.extension.id}/${CloudIntegrationAuthenticationUriPathPrefix}`,
					),
				);
				query += `&redirect_uri=${encodeURIComponent(callbackUri.toString(true))}`;
			}

			if (!(await openUrl(this.container.getGkDevUri('connect', query).toString(true)))) {
				return false;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			if (!(await openUrl(this.container.getGkDevUri('connect', baseQuery).toString(true)))) {
				return false;
			}
		}

		const deferredCallback = promisifyDeferred<Uri, string | undefined>(
			this.container.uri.onDidReceiveCloudIntegrationAuthenticationUri,
			(uri: Uri, resolve) => {
				const queryParams: URLSearchParams = new URLSearchParams(uri.query);
				resolve(queryParams.get('code') ?? undefined);
			},
		);

		let code: string | undefined;
		try {
			code = await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'Connecting integrations...',
					cancellable: true,
				},
				(_, token) => {
					return Promise.race([
						deferredCallback.promise,
						new Promise<string | undefined>((_, reject) =>
							// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
							token.onCancellationRequested(() => reject('Cancelled')),
						),
						new Promise<string | undefined>((_, reject) => setTimeout(reject, 5 * 60 * 1000, 'Cancelled')),
					]);
				},
			);
		} catch {
			return false;
		} finally {
			deferredCallback.cancel();
		}

		if (account == null) {
			if (code == null) return false;
			await this.container.subscription.loginWithCode({ code: code }, source);
			account = (await this.container.subscription.getSubscription()).account;
			if (account == null) return false;
		}

		const connected = await this.syncCloudIntegrations(true);
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'cloudIntegrations/connected',
				{
					'integration.ids': integrationIds?.join(','),
					'integration.connected.ids': connected ? join(connected.values(), ',') : undefined,
				},
				source,
			);
		}

		if (integrationIds != null) {
			for (const integrationId of integrationIds) {
				const integration = await this.get(integrationId);
				const connected = integration.maybeConnected ?? (await integration.isConnected());
				if (connected && !connectedIntegrations.has(integrationId)) {
					return true;
				}
			}

			return false;
		}

		return true;
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		for (const integration of this._integrations.values()) {
			if (e.provider.id === integration.authProvider.id) {
				integration.refresh();
			}
		}
	}

	connected(integration: IntegrationBase, key: string): void {
		// Only fire events if the key is being connected for the first time
		if (this._connectedCache.has(key)) return;

		this._connectedCache.add(key);
		if (this.container.telemetry.enabled) {
			if (integration.type === 'hosting') {
				if (isSupportedCloudIntegrationId(integration.id)) {
					this.container.telemetry.sendEvent('cloudIntegrations/hosting/connected', {
						'hostingProvider.provider': integration.id,
						'hostingProvider.key': key,
					});
				} else {
					this.container.telemetry.sendEvent('remoteProviders/connected', {
						'hostingProvider.provider': integration.id,
						'hostingProvider.key': key,

						// Deprecated
						'remoteProviders.key': key,
					});
				}
			} else {
				this.container.telemetry.sendEvent('cloudIntegrations/issue/connected', {
					'issueProvider.provider': integration.id,
					'issueProvider.key': key,
				});
			}
		}

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: 'connected' }), 250);
	}

	disconnected(integration: IntegrationBase, key: string): void {
		// Probably shouldn't bother to fire the event if we don't already think we are connected, but better to be safe
		// if (!_connectedCache.has(key)) return;
		this._connectedCache.delete(key);
		if (this.container.telemetry.enabled) {
			if (integration.type === 'hosting') {
				if (isSupportedCloudIntegrationId(integration.id)) {
					this.container.telemetry.sendEvent('cloudIntegrations/hosting/disconnected', {
						'hostingProvider.provider': integration.id,
						'hostingProvider.key': key,
					});
				} else {
					this.container.telemetry.sendEvent('remoteProviders/disconnected', {
						'hostingProvider.provider': integration.id,
						'hostingProvider.key': key,

						// Deprecated
						'remoteProviders.key': key,
					});
				}
			} else {
				this.container.telemetry.sendEvent('cloudIntegrations/issue/disconnected', {
					'issueProvider.provider': integration.id,
					'issueProvider.key': key,
				});
			}
		}

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: 'disconnected' }), 250);
	}

	isConnected(key?: string): boolean {
		return key == null ? this._connectedCache.size !== 0 : this._connectedCache.has(key);
	}

	get(id: SupportedHostingIntegrationIds): Promise<HostingIntegration>;
	get(id: SupportedIssueIntegrationIds): Promise<IssueIntegration>;
	get(id: SupportedSelfHostedIntegrationIds, domain: string): Promise<HostingIntegration>;
	get(id: SupportedIntegrationIds, domain?: string): Promise<Integration>;
	async get(
		id: SupportedHostingIntegrationIds | SupportedIssueIntegrationIds | SupportedSelfHostedIntegrationIds,
		domain?: string,
	): Promise<Integration> {
		let integration = this.getCached(id, domain);
		if (integration == null) {
			switch (id) {
				case HostingIntegrationId.GitHub:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/github')
					).GitHubIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/github')
					).GitHubEnterpriseIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						domain,
					);
					break;
				case HostingIntegrationId.GitLab:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
					).GitLabIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.GitLabSelfHosted:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
					).GitLabSelfHostedIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						domain,
					);
					break;
				case HostingIntegrationId.Bitbucket:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/bitbucket')
					).BitbucketIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				case HostingIntegrationId.AzureDevOps:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps')
					).AzureDevOpsIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
					);
					break;
				case IssueIntegrationId.Jira:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/jira')
					).JiraIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				default:
					throw new Error(`Integration with '${id}' is not supported`);
			}
			this._integrations.set(this.getCacheKey(id, domain), integration);
		}

		return integration;
	}

	getLoaded(): Iterable<Integration>;
	getLoaded(type: 'issues'): Iterable<IssueIntegration>;
	getLoaded(type: 'hosting'): Iterable<HostingIntegration>;
	@log()
	getLoaded(type?: IntegrationType): Iterable<Integration> {
		if (type == null) return this._integrations.values();

		return filter(this._integrations.values(), i => i.type === type);
	}

	private _providersApi: Promise<ProvidersApi> | undefined;
	private async getProvidersApi() {
		if (this._providersApi == null) {
			const container = this.container;
			const authenticationService = this.authenticationService;
			async function load() {
				return new (
					await import(/* webpackChunkName: "integrations" */ './providers/providersApi')
				).ProvidersApi(container, authenticationService);
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
			// TODO: Uncomment when we support these integrations
			// case 'azure-devops':
			// 	return get(HostingIntegrationId.AzureDevOps) as RT;
			// case 'bitbucket':
			// 	return get(HostingIntegrationId.Bitbucket) as RT;
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
			default:
				return (getOrGetCached === this.get ? Promise.resolve(undefined) : undefined) as RT;
		}
	}

	@log<IntegrationService['getMyIssues']>({
		args: { 0: integrationIds => (integrationIds?.length ? integrationIds.join(',') : '<undefined>'), 1: false },
	})
	async getMyIssues(
		integrationIds?: (SupportedHostingIntegrationIds | SupportedIssueIntegrationIds)[],
		options?: { openRepositoriesOnly?: boolean; cancellation?: CancellationToken },
	): Promise<SearchedIssue[] | undefined> {
		const integrations: Map<Integration, ResourceDescriptor[] | undefined> = new Map();
		const hostingIntegrationIds = integrationIds?.filter(
			id => id in HostingIntegrationId,
		) as SupportedHostingIntegrationIds[];
		const openRemotesByIntegrationId = new Map<IntegrationId, ResourceDescriptor[]>();
		for (const repository of this.container.git.openRepositories) {
			const remotes = await repository.git.getRemotes();
			if (remotes.length === 0) continue;
			for (const remote of remotes) {
				const remoteIntegration = await remote.getIntegration();
				if (remoteIntegration == null) continue;
				for (const integrationId of hostingIntegrationIds?.length
					? hostingIntegrationIds
					: Object.values(HostingIntegrationId)) {
					if (
						remoteIntegration.id === integrationId &&
						remote.provider?.owner != null &&
						remote.provider?.repoName != null
					) {
						const descriptor = {
							key: `${remote.provider.owner}/${remote.provider.repoName}`,
							owner: remote.provider.owner,
							name: remote.provider.repoName,
						};
						if (openRemotesByIntegrationId.has(integrationId)) {
							openRemotesByIntegrationId.get(integrationId)?.push(descriptor);
						} else {
							openRemotesByIntegrationId.set(integrationId, [descriptor]);
						}
					}
				}
			}
		}
		for (const integrationId of integrationIds?.length
			? integrationIds
			: [...Object.values(HostingIntegrationId), ...Object.values(IssueIntegrationId)]) {
			const integration = await this.get(integrationId);
			if (
				integration == null ||
				(options?.openRepositoriesOnly &&
					isHostingIntegrationId(integrationId) &&
					!openRemotesByIntegrationId.has(integrationId))
			) {
				continue;
			}

			integrations.set(
				integration,
				options?.openRepositoriesOnly &&
					isHostingIntegrationId(integrationId) &&
					openRemotesByIntegrationId.has(integrationId)
					? openRemotesByIntegrationId.get(integrationId)
					: undefined,
			);
		}
		if (integrations.size === 0) return undefined;

		return this.getMyIssuesCore(integrations, options?.cancellation);
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

	@log<IntegrationService['getMyCurrentAccounts']>({
		args: { 0: integrationIds => (integrationIds?.length ? integrationIds.join(',') : '<undefined>') },
	})
	async getMyCurrentAccounts(integrationIds: HostingIntegrationId[]): Promise<Map<HostingIntegrationId, Account>> {
		const accounts = new Map<HostingIntegrationId, Account>();
		await Promise.allSettled(
			integrationIds.map(async integrationId => {
				const integration = await this.get(integrationId);
				if (integration == null) return;

				const account = await integration.getCurrentAccount();
				if (account) {
					accounts.set(integrationId, account);
				}
			}),
		);
		return accounts;
	}

	@log<IntegrationService['getMyPullRequests']>({
		args: { 0: integrationIds => (integrationIds?.length ? integrationIds.join(',') : '<undefined>'), 1: false },
	})
	async getMyPullRequests(
		integrationIds?: HostingIntegrationId[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>> {
		const integrations: Map<HostingIntegration, ResourceDescriptor[] | undefined> = new Map();
		for (const integrationId of integrationIds?.length ? integrationIds : Object.values(HostingIntegrationId)) {
			const integration = await this.get(integrationId);
			if (integration == null) continue;

			integrations.set(integration, undefined);
		}
		if (integrations.size === 0) return undefined;

		return this.getMyPullRequestsCore(integrations, cancellation, silent);
	}

	private async getMyPullRequestsCore(
		integrations: Map<HostingIntegration, ResourceDescriptor[] | undefined>,
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>> {
		const start = Date.now();

		const promises: Promise<IntegrationResult<SearchedPullRequest[] | undefined>>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyPullRequests(repos, cancellation, silent));
		}

		const results = await Promise.allSettled(promises);

		const errors = [
			...filterMap(results, r =>
				r.status === 'fulfilled' && r.value?.error != null ? r.value.error : undefined,
			),
		];
		if (errors.length) {
			return {
				error: errors.length === 1 ? errors[0] : new AggregateError(errors),
				duration: Date.now() - start,
			};
		}

		return {
			value: [
				...flatten(
					filterMap(results, r =>
						r.status === 'fulfilled' && r.value != null && r.value?.error == null
							? r.value.value
							: undefined,
					),
				),
			],
			duration: Date.now() - start,
		};
	}

	async getMyPullRequestsForRemotes(remote: GitRemote): Promise<IntegrationResult<SearchedPullRequest[] | undefined>>;
	async getMyPullRequestsForRemotes(
		remotes: GitRemote[],
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>>;
	@debug<IntegrationService['getMyPullRequestsForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyPullRequestsForRemotes(
		remoteOrRemotes: GitRemote | GitRemote[],
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>> {
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

	@log()
	async reset(): Promise<void> {
		for (const integration of this._integrations.values()) {
			await integration.reset();
		}

		await this.authenticationService.reset();
		await this.container.storage.deleteWithPrefix('provider:authentication:skip');
		queueMicrotask(() => void this.syncCloudIntegrations(true));
	}

	supports(remoteProviderId: RemoteProviderId): boolean {
		return remoteProviderIdToIntegrationId(remoteProviderId) != null;
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

export function remoteProviderIdToIntegrationId(
	remoteProviderId: RemoteProviderId,
): SupportedCloudIntegrationIds | undefined {
	switch (remoteProviderId) {
		// TODO: Uncomment when we support these integrations
		// case 'azure-devops':
		// 	return HostingIntegrationId.AzureDevOps;
		// case 'bitbucket':
		// 	return HostingIntegrationId.Bitbucket;
		case 'github':
			return HostingIntegrationId.GitHub;
		case 'gitlab':
			return HostingIntegrationId.GitLab;
		case 'bitbucket-server':
		default:
			return undefined;
	}
}
