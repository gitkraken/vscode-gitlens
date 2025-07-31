import type { AuthenticationSessionsChangeEvent, CancellationToken, Event } from 'vscode';
import { authentication, Disposable, env, EventEmitter, ProgressLocation, Uri, window } from 'vscode';
import { isWeb } from '@env/platform';
import type {
	CloudGitSelfManagedHostIntegrationIds,
	IntegrationIds,
	SupportedCloudIntegrationIds,
} from '../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../constants.integrations';
import type { Source } from '../../constants.telemetry';
import { sourceToContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { Account } from '../../git/models/author';
import type { IssueShape } from '../../git/models/issue';
import type { PullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { ResourceDescriptor } from '../../git/models/resourceDescriptor';
import type { RemoteProviderId } from '../../git/remotes/remoteProvider';
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
import type { GitHostIntegration } from './models/gitHostIntegration';
import type {
	Integration,
	IntegrationBase,
	IntegrationById,
	IntegrationKey,
	IntegrationResult,
} from './models/integration';
import type { IssuesIntegration } from './models/issuesIntegration';
import type { ProvidersApi } from './providers/providersApi';
import {
	convertRemoteProviderIdToIntegrationId,
	isCloudGitSelfManagedHostIntegrationId,
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
} from './utils/-webview/integration.utils';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

/** @internal Event emitted when an integration connection state changes  */
export interface IntegrationConnectionChangeEvent extends ConnectionStateChangeEvent {
	integration: IntegrationBase;
}

export class IntegrationService implements Disposable {
	get onDidChange(): Event<ConfiguredIntegrationsChangeEvent> {
		return this.configuredIntegrationService.onDidChange;
	}

	private readonly _onDidChangeConnectionState = new EventEmitter<ConnectionStateChangeEvent>();
	get onDidChangeConnectionState(): Event<ConnectionStateChangeEvent> {
		return this._onDidChangeConnectionState.event;
	}

	private readonly _connectedCache = new Set<string>();
	private readonly _disposable: Disposable;
	private _integrations = new Map<IntegrationKey, Integration>();
	private readonly _onDidChangeIntegrationConnection = new EventEmitter<IntegrationConnectionChangeEvent>();

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
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this._onDidChangeIntegrationConnection.event(this.onIntegrationConnectionChanged, this),
		);
	}

	dispose(): void {
		this._integrations.forEach(i => i.dispose());
		this._integrations.clear();
		this._disposable?.dispose();
	}

	@log()
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

	get(id: GitCloudHostIntegrationId): Promise<GitHostIntegration>;
	get(id: IssuesCloudHostIntegrationId): Promise<IssuesIntegration>;
	get(
		id: GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds,
		domain?: string,
	): Promise<GitHostIntegration | undefined>;
	get(id: GitSelfManagedHostIntegrationId, domain: string): Promise<GitHostIntegration | undefined>;
	get<T extends IntegrationIds>(id: T, domain?: string): Promise<IntegrationById<T> | undefined>;
	async get<T extends IntegrationIds>(id: T, domain?: string): Promise<IntegrationById<T> | undefined> {
		let integration = this.getCached(id, domain);
		if (integration == null) {
			switch (id) {
				case GitCloudHostIntegrationId.GitHub:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/github')
					).GitHubIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
					if (domain == null) {
						integration = this.findCachedById(id);
						// return immediately in order to not to cache it after the "switch" block:
						if (integration != null) return integration;

						const configured = this.getConfiguredLite(
							GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
						);
						if (configured.length) {
							const { domain: configuredDomain } = configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/github')
							).GitHubEnterpriseIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								this._onDidChangeIntegrationConnection,
								configuredDomain,
								id,
							) as GitHostIntegration as IntegrationById<T>;

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
						this._onDidChangeIntegrationConnection,
						domain,
						id,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitSelfManagedHostIntegrationId.GitHubEnterprise:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);

					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/github')
					).GitHubEnterpriseIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
						id,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitCloudHostIntegrationId.GitLab:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
					).GitLabIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
					if (domain == null) {
						integration = this.findCachedById(id);
						// return immediately in order to not to cache it after the "switch" block:
						if (integration != null) return integration;

						const configured = this.getConfiguredLite(
							GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
						);
						if (configured.length) {
							const { domain: configuredDomain } = configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
							).GitLabSelfHostedIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								this._onDidChangeIntegrationConnection,
								configuredDomain,
								id,
							) as GitHostIntegration as IntegrationById<T>;

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
						this._onDidChangeIntegrationConnection,
						domain,
						id,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);

					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab')
					).GitLabSelfHostedIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
						id,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitCloudHostIntegrationId.Bitbucket:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/bitbucket')
					).BitbucketIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitSelfManagedHostIntegrationId.BitbucketServer:
					if (domain == null) {
						integration = this.findCachedById(id);
						// return immediately in order to not to cache it after the "switch" block:
						if (integration != null) return integration;

						const configured = this.getConfiguredLite(GitSelfManagedHostIntegrationId.BitbucketServer);
						if (configured.length) {
							const { domain: configuredDomain } = configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/bitbucket-server')
							).BitbucketServerIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								this._onDidChangeIntegrationConnection,
								configuredDomain,
							) as GitHostIntegration as IntegrationById<T>;

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
						this._onDidChangeIntegrationConnection,
						domain,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitCloudHostIntegrationId.AzureDevOps:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps')
					).AzureDevOpsIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
					if (domain == null) {
						integration = this.findCachedById(id);
						// return immediately in order to not to cache it after the "switch" block:
						if (integration != null) return integration;

						const configured = this.getConfiguredLite(GitSelfManagedHostIntegrationId.AzureDevOpsServer);
						if (configured.length) {
							const { domain: configuredDomain } = configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps')
							).AzureDevOpsServerIntegration(
								this.container,
								this.authenticationService,
								this.getProvidersApi.bind(this),
								this._onDidChangeIntegrationConnection,
								configuredDomain,
							) as GitHostIntegration as IntegrationById<T>;

							// assign domain because it's part of caching key:
							domain = configuredDomain;
							break;
						}

						return undefined;
					}

					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps')
					).AzureDevOpsServerIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case IssuesCloudHostIntegrationId.Jira:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/jira')
					).JiraIntegration(
						this.container,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as IssuesIntegration as IntegrationById<T>;
					break;

				default:
					throw new Error(`Integration with '${id}' is not supported`);
			}

			this._integrations.set(this.getCacheKey(id, domain), integration);
		}

		return integration;
	}

	async getConfigured(): Promise<ConfiguredIntegrationDescriptor[]>;
	async getConfigured(
		id: GitCloudHostIntegrationId.GitHub,
		options: { cloud: false | undefined; domain?: never },
	): Promise<ConfiguredIntegrationDescriptor[]>;
	async getConfigured(
		id?: GitCloudHostIntegrationId.GitHub,
		options?: { cloud: false | undefined; domain?: never },
	): Promise<ConfiguredIntegrationDescriptor[]> {
		return this.configuredIntegrationService.getConfigured(id, options);
	}

	getConfiguredLite(
		id: GitCloudHostIntegrationId.GitHub,
		options: { cloud: true; domain?: never },
	): ConfiguredIntegrationDescriptor[];
	getConfiguredLite(
		id: Exclude<IntegrationIds, GitCloudHostIntegrationId.GitHub>,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[];
	getConfiguredLite(
		id: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[] {
		if (id === GitCloudHostIntegrationId.GitHub) {
			return this.configuredIntegrationService.getConfiguredLite(id, { cloud: true });
		}

		return this.configuredIntegrationService.getConfiguredLite(id, options);
	}

	@log<IntegrationService['getMyIssues']>({
		args: { 0: integrationIds => (integrationIds?.length ? integrationIds.join(',') : '<undefined>'), 1: false },
	})
	async getMyIssues(
		integrationIds?: (GitCloudHostIntegrationId | IssuesCloudHostIntegrationId | GitSelfManagedHostIntegrationId)[],
		options?: { openRepositoriesOnly?: boolean; cancellation?: CancellationToken },
	): Promise<IssueShape[] | undefined> {
		const integrations: Map<Integration, ResourceDescriptor[] | undefined> = new Map();
		const hostingIntegrationIds = integrationIds?.filter(
			id => id in GitCloudHostIntegrationId || id in GitSelfManagedHostIntegrationId,
		) as GitCloudHostIntegrationId[];
		const openRemotesByIntegrationId = new Map<IntegrationIds, ResourceDescriptor[]>();
		let hasOpenAzureRepository = false;
		for (const repository of this.container.git.openRepositories) {
			const remotes = await repository.git.remotes.getRemotes();
			for (const remote of remotes) {
				const remoteIntegration = await remote.getIntegration();
				if (remoteIntegration == null) continue;
				if (remoteIntegration.id === GitCloudHostIntegrationId.AzureDevOps) {
					hasOpenAzureRepository = true;
				}
				for (const integrationId of hostingIntegrationIds?.length
					? hostingIntegrationIds
					: [
							...Object.values(GitCloudHostIntegrationId),
							...Object.values(GitSelfManagedHostIntegrationId),
						]) {
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
					...Object.values(GitCloudHostIntegrationId),
					...Object.values(IssuesCloudHostIntegrationId),
					...Object.values(GitSelfManagedHostIntegrationId),
				]) {
			const integration = await this.get(integrationId);
			const isInvalidIntegration =
				(options?.openRepositoriesOnly &&
					integrationId !== GitCloudHostIntegrationId.AzureDevOps &&
					(isGitCloudHostIntegrationId(integrationId) || isGitSelfManagedHostIntegrationId(integrationId)) &&
					!openRemotesByIntegrationId.has(integrationId)) ||
				(integrationId === GitCloudHostIntegrationId.AzureDevOps && !hasOpenAzureRepository);
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

			const integration = await remote.getIntegration();
			return integration?.searchMyIssues(remote.provider.repoDesc);
		}

		const integrations = new Map<GitHostIntegration, ResourceDescriptor[]>();

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
		integrationIds: (GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds)[],
	): Promise<Map<GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds, Account>> {
		const accounts = new Map<GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds, Account>();
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
		integrationIds?: (GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds)[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const integrations: Map<GitHostIntegration, ResourceDescriptor[] | undefined> = new Map();
		for (const integrationId of integrationIds?.length
			? integrationIds
			: Object.values(GitCloudHostIntegrationId)) {
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
		integrations: Map<GitHostIntegration, ResourceDescriptor[] | undefined>,
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

			const integration = await remote.getIntegration();
			return integration?.searchMyPullRequests(remote.provider.repoDesc);
		}

		const integrations = new Map<GitHostIntegration, ResourceDescriptor[]>();

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

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	ignoreSSLErrors(integration: GitHostIntegration | { id: IntegrationIds; domain?: string }): boolean | 'force' {
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

	@log()
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
		return convertRemoteProviderIdToIntegrationId(remoteProviderId) != null;
	}

	private onAuthenticationSessionsChanged(e: AuthenticationSessionsChangeEvent) {
		for (const integration of this._integrations.values()) {
			if (e.provider.id === integration.authProvider.id) {
				integration.refresh();
			}
		}
	}

	private onIntegrationConnectionChanged(e: {
		integration: IntegrationBase;
		key: string;
		reason: 'connected' | 'disconnected';
	}): void {
		const { integration, key, reason } = e;

		if (reason === 'connected') {
			// Only fire events if the key is being connected for the first time
			if (this._connectedCache.has(key)) return;

			this._connectedCache.add(key);
		} else {
			// Probably shouldn't bother to fire the event if we don't already think we are connected, but better to be safe
			// if (!_connectedCache.has(key)) return;

			this._connectedCache.delete(key);
		}

		if (this.container.telemetry.enabled) {
			if (integration.type === 'git') {
				if (isSupportedCloudIntegrationId(integration.id)) {
					this.container.telemetry.sendEvent(
						`cloudIntegrations/hosting/${reason === 'connected' ? 'connected' : 'disconnected'}`,
						{
							'hostingProvider.provider': integration.id,
							'hostingProvider.key': key,
						},
					);
				} else {
					this.container.telemetry.sendEvent(
						`remoteProviders/${reason === 'connected' ? 'connected' : 'disconnected'}`,
						{
							'hostingProvider.provider': integration.id,
							'hostingProvider.key': key,

							// Deprecated
							'remoteProviders.key': key,
						},
					);
				}
			} else {
				this.container.telemetry.sendEvent(
					`cloudIntegrations/issue/${reason === 'connected' ? 'connected' : 'disconnected'}`,
					{
						'issueProvider.provider': integration.id,
						'issueProvider.key': key,
					},
				);
			}
		}

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: reason }), 250);
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		// When logging out, disconnect all connected cloud integrations
		if (e.current?.account == null) {
			void this.syncCloudIntegrations(false);
		}
	}

	private onUserCheckedIn(options?: { force?: boolean } | void) {
		void this.syncCloudIntegrations(Boolean(options?.force));
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

	private getCached<T extends IntegrationIds>(id: T, domain?: string): IntegrationById<T> | undefined {
		return this._integrations.get(this.getCacheKey(id, domain)) as IntegrationById<T> | undefined;
	}

	private getCacheKey(
		id: GitCloudHostIntegrationId | IssuesCloudHostIntegrationId | GitSelfManagedHostIntegrationId,
		domain?: string,
	): IntegrationKey {
		return isGitSelfManagedHostIntegrationId(id) ? (`${id}:${domain}` as const) : id;
	}

	private async *getSupportedCloudIntegrations(domainsById: Map<IntegrationIds, string>): AsyncIterable<Integration> {
		for (const id of getSupportedCloudIntegrationIds()) {
			if (isCloudGitSelfManagedHostIntegrationId(id) && !domainsById.has(id)) {
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

	private findCachedById<T extends IntegrationIds>(id: T): IntegrationById<T> | undefined {
		const key = this.getCacheKey(id, '');
		for (const [k, integration] of this._integrations) {
			if (k.startsWith(key)) {
				return integration as IntegrationById<T>;
			}
		}
		return undefined;
	}

	@gate()
	@debug()
	private async syncCloudIntegrations(forceConnect: boolean) {
		const scope = getLogScope();
		const connectedIntegrations = new Set<IntegrationIds>();
		const domainsById = new Map<IntegrationIds, string>();

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

		return connectedIntegrations;
	}
}
