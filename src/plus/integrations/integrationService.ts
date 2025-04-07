import type { AuthenticationSessionsChangeEvent, CancellationToken, Event } from 'vscode';
import { authentication, Disposable, env, EventEmitter, ProgressLocation, Uri, window } from 'vscode';
import { isWeb } from '@env/platform';
import type {
	CloudSelfHostedIntegrationId,
	IntegrationId,
	SupportedCloudIntegrationIds,
} from '../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../../constants.integrations';
import type { Source } from '../../constants.telemetry';
import { sourceToContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { Account } from '../../git/models/author';
import type { IssueShape } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { RemoteProvider, RemoteProviderId } from '../../git/remotes/remoteProvider';
import { configuration } from '../../system/-webview/configuration';
import { openUrl } from '../../system/-webview/vscode/uris';
import { gate } from '../../system/decorators/-webview/gate';
import { debug, log } from '../../system/decorators/log';
import { promisifyDeferred, take } from '../../system/event';
import { filterMap, flatten, join } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { SubscriptionChangeEvent } from '../gk/subscriptionService';
import type {
	ConfiguredIntegrationsChangeEvent,
	ConfiguredIntegrationService,
} from './authentication/configuredIntegrationService';
import type { IntegrationAuthenticationService } from './authentication/integrationAuthenticationService';
import type { ConfiguredIntegrationDescriptor } from './authentication/models';
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
	IssueIntegration,
	ResourceDescriptor,
	SupportedCloudSelfHostedIntegrationIds,
	SupportedHostingIntegrationIds,
	SupportedIntegrationIds,
	SupportedIssueIntegrationIds,
	SupportedSelfHostedIntegrationIds,
} from './integration';
import { isAzureCloudDomain } from './providers/azureDevOps';
import { isBitbucketCloudDomain } from './providers/bitbucket';
import {
	isCloudSelfHostedIntegrationId,
	isGitHubDotCom,
	isGitLabDotCom,
	isHostingIntegrationId,
	isSelfHostedIntegrationId,
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

	private readonly _onDidSyncCloudIntegrations = new EventEmitter<void>();
	get onDidSyncCloudIntegrations(): Event<void> {
		return this._onDidSyncCloudIntegrations.event;
	}

	get onDidChangeConfiguredIntegrations(): Event<ConfiguredIntegrationsChangeEvent> {
		return this.configuredIntegrationService.onDidChange;
	}

	private readonly _connectedCache = new Set<string>();
	private readonly _disposable: Disposable;
	private _integrations = new Map<IntegrationKey, Integration>();

	constructor(
		private readonly container: Container,
		private readonly authenticationService: IntegrationAuthenticationService,
		private readonly configuredIntegrationService: ConfiguredIntegrationService,
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

	dispose(): void {
		this._integrations.forEach(i => i.dispose());
		this._integrations.clear();
		this._disposable?.dispose();
	}

	@gate()
	@debug()
	private async syncCloudIntegrations(forceConnect: boolean) {
		const scope = getLogScope();
		const connectedIntegrations = new Set<IntegrationId>();
		const domainsById = new Map<IntegrationId, string>();

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
				if (p.domain?.length > 0) {
					try {
						const host = new URL(p.domain).host;
						domainsById.set(integrationId, host);
					} catch {
						Logger.warn(`Invalid domain for ${integrationId} integration: ${p.domain}. Ignoring.`, scope);
					}
				}
			});
		}

		for await (const integration of this.getSupportedCloudIntegrations(domainsById)) {
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

	private async *getSupportedCloudIntegrations(domainsById: Map<IntegrationId, string>): AsyncIterable<Integration> {
		for (const id of getSupportedCloudIntegrationIds()) {
			if (isCloudSelfHostedIntegrationId(id) && !domainsById.has(id)) {
				// Try getting whatever we have now because we will need to disconnect
				const integration = await this.get(id, undefined);
				if (integration != null) {
					yield integration;
				}
			} else {
				const integration = await this.get(id, domainsById.get(id));
				if (integration != null) {
					yield integration;
				}
			}
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

	async manageCloudIntegrations(source: Source | undefined): Promise<void> {
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
			if (!(await openUrl(this.container.urls.getGkDevUrl('settings/integrations', `token=${exchangeToken}`)))) {
				return;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			if (!(await openUrl(this.container.urls.getGkDevUrl('settings/integrations')))) {
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
				try {
					const integration = await this.get(integrationId);
					if (integration == null) continue;

					if (integration.maybeConnected ?? (await integration.isConnected())) {
						connectedIntegrations.add(integrationId);
					}
				} catch (ex) {
					Logger.log(
						`Failed to get integration ${integrationId} by its ID. Consider it as not-connected and ignore. Error message: ${ex.message}`,
						scope,
					);
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

			if (!(await openUrl(this.container.urls.getGkDevUrl('connect', query)))) {
				return false;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			if (!(await openUrl(this.container.urls.getGkDevUrl('connect', baseQuery)))) {
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
				if (integration == null) continue;

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

	async getConfigured(
		options?:
			| { id?: HostingIntegrationId | IssueIntegrationId; domain?: never; type?: 'cloud' | 'local' }
			| { id?: CloudSelfHostedIntegrationId | SelfHostedIntegrationId; domain?: string; type?: never },
	): Promise<ConfiguredIntegrationDescriptor[]> {
		return this.configuredIntegrationService.getConfigured(options);
	}

	get(id: SupportedHostingIntegrationIds): Promise<HostingIntegration>;
	get(id: SupportedIssueIntegrationIds): Promise<IssueIntegration>;
	get(
		id: SupportedHostingIntegrationIds | SupportedCloudSelfHostedIntegrationIds,
		domain?: string,
	): Promise<HostingIntegration | undefined>;
	get(id: SupportedSelfHostedIntegrationIds, domain: string): Promise<HostingIntegration | undefined>;
	get(id: SupportedIntegrationIds, domain?: string): Promise<Integration | undefined>;
	async get(
		id: SupportedHostingIntegrationIds | SupportedIssueIntegrationIds | SupportedSelfHostedIntegrationIds,
		domain?: string,
	): Promise<Integration | undefined> {
		let integration = this.getCached(id, domain);
		if (integration == null) {
			switch (id) {
				case HostingIntegrationId.GitHub:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/github')
					).GitHubIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.CloudGitHubEnterprise:
					if (domain == null) {
						integration = this.findCachedById(id);
						if (integration != null) {
							// return immediately in order to not to cache it after the "switch" block:
							return integration;
						}

						const existingConfigured = await this.getConfigured({
							id: SelfHostedIntegrationId.CloudGitHubEnterprise,
						});
						if (existingConfigured.length) {
							const { domain: configuredDomain } = existingConfigured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);
							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/github')
							).GitHubEnterpriseIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								configuredDomain,
								id,
							);
							// assign domain because it's part of caching key:
							domain = configuredDomain;
							break;
						}

						return undefined;
					}

					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/github')
					).GitHubEnterpriseIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						domain,
						id,
					);
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
						id,
					);
					break;
				case HostingIntegrationId.GitLab:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
					).GitLabIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.CloudGitLabSelfHosted:
					if (domain == null) {
						integration = this.findCachedById(id);
						if (integration != null) {
							// return immediately in order to not to cache it after the "switch" block:
							return integration;
						}

						const existingConfigured = await this.getConfigured({
							id: SelfHostedIntegrationId.CloudGitLabSelfHosted,
						});
						if (existingConfigured.length) {
							const { domain: configuredDomain } = existingConfigured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);
							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
							).GitLabSelfHostedIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								configuredDomain,
								id,
							);
							// assign domain because it's part of caching key:
							domain = configuredDomain;
							break;
						}

						return undefined;
					}

					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
					).GitLabSelfHostedIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						domain,
						id,
					);
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
						id,
					);
					break;
				case HostingIntegrationId.Bitbucket:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/bitbucket')
					).BitbucketIntegration(this.container, this.authenticationService, this.getProvidersApi.bind(this));
					break;
				case SelfHostedIntegrationId.BitbucketServer:
					if (domain == null) {
						integration = this.findCachedById(id);
						if (integration != null) {
							// return immediately in order to not to cache it after the "switch" block:
							return integration;
						}

						const existingConfigured = await this.getConfigured({
							id: SelfHostedIntegrationId.BitbucketServer,
						});
						if (existingConfigured.length) {
							const { domain: configuredDomain } = existingConfigured[0];
							if (configuredDomain == null) {
								throw new Error(`Domain is required for '${id}' integration`);
							}
							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/bitbucket-server')
							).BitbucketServerIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								configuredDomain,
							);
							// assign domain because it's part of caching key:
							domain = configuredDomain;
							break;
						}

						return undefined;
					}

					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/bitbucket-server')
					).BitbucketServerIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						domain,
					);
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
			case 'azure-devops':
				if (isAzureCloudDomain(remote.provider.domain)) {
					return get(HostingIntegrationId.AzureDevOps) as RT;
				}
				return (getOrGetCached === this.get ? Promise.resolve(undefined) : undefined) as RT;
			case 'bitbucket':
				if (isBitbucketCloudDomain(remote.provider.domain)) {
					return get(HostingIntegrationId.Bitbucket) as RT;
				}
				return (getOrGetCached === this.get ? Promise.resolve(undefined) : undefined) as RT;
			case 'bitbucket-server':
				if (!isBitbucketCloudDomain(remote.provider.domain)) {
					return get(SelfHostedIntegrationId.BitbucketServer) as RT;
				}
				return (getOrGetCached === this.get ? Promise.resolve(undefined) : undefined) as RT;
			case 'github':
				if (remote.provider.domain != null && !isGitHubDotCom(remote.provider.domain)) {
					return get(
						remote.provider.custom
							? SelfHostedIntegrationId.GitHubEnterprise
							: SelfHostedIntegrationId.CloudGitHubEnterprise,
						remote.provider.domain,
					) as RT;
				}
				return get(HostingIntegrationId.GitHub) as RT;
			case 'gitlab':
				if (remote.provider.domain != null && !isGitLabDotCom(remote.provider.domain)) {
					return get(
						remote.provider.custom
							? SelfHostedIntegrationId.GitLabSelfHosted
							: SelfHostedIntegrationId.CloudGitLabSelfHosted,
						remote.provider.domain,
					) as RT;
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
		integrationIds?: (
			| SupportedHostingIntegrationIds
			| SupportedIssueIntegrationIds
			| SupportedSelfHostedIntegrationIds
		)[],
		options?: { openRepositoriesOnly?: boolean; cancellation?: CancellationToken },
	): Promise<IssueShape[] | undefined> {
		const integrations: Map<Integration, ResourceDescriptor[] | undefined> = new Map();
		const hostingIntegrationIds = integrationIds?.filter(
			id => id in HostingIntegrationId || id in SelfHostedIntegrationId,
		) as SupportedHostingIntegrationIds[];
		const openRemotesByIntegrationId = new Map<IntegrationId, ResourceDescriptor[]>();
		let hasOpenAzureRepository = false;
		for (const repository of this.container.git.openRepositories) {
			const remotes = await repository.git.remotes().getRemotes();
			for (const remote of remotes) {
				const remoteIntegration = await remote.getIntegration();
				if (remoteIntegration == null) continue;
				if (remoteIntegration.id === HostingIntegrationId.AzureDevOps) {
					hasOpenAzureRepository = true;
				}
				for (const integrationId of hostingIntegrationIds?.length
					? hostingIntegrationIds
					: [...Object.values(HostingIntegrationId), ...Object.values(SelfHostedIntegrationId)]) {
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
			: [
					...Object.values(HostingIntegrationId),
					...Object.values(IssueIntegrationId),
					...Object.values(SelfHostedIntegrationId),
			  ]) {
			const integration = await this.get(integrationId);
			const isInvalidIntegration =
				(options?.openRepositoriesOnly &&
					integrationId !== HostingIntegrationId.AzureDevOps &&
					(isHostingIntegrationId(integrationId) || isSelfHostedIntegrationId(integrationId)) &&
					!openRemotesByIntegrationId.has(integrationId)) ||
				(integrationId === HostingIntegrationId.AzureDevOps && !hasOpenAzureRepository);
			if (integration == null || isInvalidIntegration) {
				continue;
			}

			integrations.set(
				integration,
				options?.openRepositoriesOnly && !isInvalidIntegration
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
	): Promise<IssueShape[] | undefined> {
		const promises: Promise<IssueShape[] | undefined>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyIssues(repos, cancellation));
		}

		const results = await Promise.allSettled(promises);
		return [...flatten(filterMap(results, r => (r.status === 'fulfilled' ? r.value : undefined)))];
	}

	async getMyIssuesForRemotes(remote: GitRemote): Promise<IssueShape[] | undefined>;
	async getMyIssuesForRemotes(remotes: GitRemote[]): Promise<IssueShape[] | undefined>;
	@debug<IntegrationService['getMyIssuesForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyIssuesForRemotes(remoteOrRemotes: GitRemote | GitRemote[]): Promise<IssueShape[] | undefined> {
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
	async getMyCurrentAccounts(
		integrationIds: (HostingIntegrationId | CloudSelfHostedIntegrationId)[],
	): Promise<Map<HostingIntegrationId | CloudSelfHostedIntegrationId, Account>> {
		const accounts = new Map<HostingIntegrationId | CloudSelfHostedIntegrationId, Account>();
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
		integrationIds?: (HostingIntegrationId | CloudSelfHostedIntegrationId)[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const integrations: Map<HostingIntegration, ResourceDescriptor[] | undefined> = new Map();
		for (const integrationId of integrationIds?.length ? integrationIds : Object.values(HostingIntegrationId)) {
			let integration;
			try {
				integration = await this.get(integrationId);
			} catch {}
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
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const start = Date.now();

		const promises: Promise<IntegrationResult<PullRequest[] | undefined>>[] = [];
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

	async getMyPullRequestsForRemotes(remote: GitRemote): Promise<IntegrationResult<PullRequest[] | undefined>>;
	async getMyPullRequestsForRemotes(remotes: GitRemote[]): Promise<IntegrationResult<PullRequest[] | undefined>>;
	@debug<IntegrationService['getMyPullRequestsForRemotes']>({
		args: { 0: (r: GitRemote | GitRemote[]) => (Array.isArray(r) ? r.map(rp => rp.name) : r.name) },
	})
	async getMyPullRequestsForRemotes(
		remoteOrRemotes: GitRemote | GitRemote[],
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
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

	isMaybeConnected(remote: GitRemote): boolean | undefined {
		if (remote.provider?.id != null && this.supports(remote.provider.id)) {
			return this.getByRemoteCached(remote)?.maybeConnected;
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

	private findCachedById(id: SupportedSelfHostedIntegrationIds): Integration | undefined {
		const key = this.getCacheKey(id, '');
		for (const [k, integration] of this._integrations) {
			if (k.startsWith(key)) {
				return integration;
			}
		}
		return undefined;
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
		case 'azure-devops':
			return HostingIntegrationId.AzureDevOps;
		case 'bitbucket':
			return HostingIntegrationId.Bitbucket;
		case 'github':
			return HostingIntegrationId.GitHub;
		case 'gitlab':
			return HostingIntegrationId.GitLab;
		case 'bitbucket-server':
			return SelfHostedIntegrationId.BitbucketServer;
		default:
			return undefined;
	}
}
