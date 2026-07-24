import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestShape, PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type { IssueResourceDescriptor, ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { RemoteProviderConfig } from '@gitlens/git/remotes/matcher.js';
import { createRemoteProviderMatcher } from '@gitlens/git/remotes/matcher.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import { fromDisposables } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { filterMap, flatten } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { CloudIntegrationService } from './authentication/cloudIntegrationService.js';
import type { ConfiguredIntegrationsChangeEvent } from './authentication/configuredIntegrationService.js';
import { ConfiguredIntegrationService } from './authentication/configuredIntegrationService.js';
import { IntegrationAuthenticationService } from './authentication/integrationAuthenticationService.js';
import type {
	CloudIntegrationConnection,
	ConfiguredIntegrationDescriptor,
	ProviderAuthenticationSession,
} from './authentication/models.js';
import {
	getSupportedCloudIntegrationIds,
	isSupportedCloudIntegrationId,
	toIntegrationId,
} from './authentication/models.js';
import { mergeAssessmentInto } from './collectionMetadata.js';
import type {
	CloudGitSelfManagedHostIntegrationIds,
	IntegrationIds,
	SupportedCloudIntegrationIds,
} from './constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	supportedOrderedCloudIntegrationIds,
	supportedOrderedCloudIssuesIntegrationIds,
} from './constants.js';
import type { AuthenticationSessionsChangeEvent, IntegrationServiceContext } from './context.js';
import { AuthenticationError, RequestNotFoundError } from './errors.js';
import type { GitHostIntegration, SearchMyPullRequestsOptions } from './models/gitHostIntegration.js';
import type {
	Integration,
	IntegrationBase,
	IntegrationById,
	IntegrationKey,
	IntegrationResult,
} from './models/integration.js';
import type { IssuesIntegration } from './models/issuesIntegration.js';
import { isIssuesIntegration } from './models/issuesIntegration.js';
import type { ApiClients } from './providers/apiClients.js';
import { createApiClients } from './providers/apiClients.js';
import type { GitHubApi } from './providers/github/github.js';
import type {
	ProviderOrganization,
	ProviderPullRequest,
	ProviderReposInput,
	ProviderRepository,
	ProviderRepositoryShape,
} from './providers/models.js';
import {
	fromProviderPullRequest,
	IssueFilter,
	PagingMode,
	providersMetadata,
	PullRequestFilter,
	toProviderRepositoryShape,
} from './providers/models.js';
import type { ProvidersApi } from './providers/providersApi.js';
import { mergeCollectionMetadata, parsePageCursor, toPageCursor } from './providers/utils/providerPaging.js';
import type {
	ConnectionStateChangeEvent,
	ProviderBroadenResult,
	ProviderPagedResult,
	ProviderPageInfo,
	ProviderResult,
	ProviderSweepResult,
	ProviderWarning,
	RepositoryIdentity,
	RepositoryResolution,
	ResolveRepositoryResult,
} from './results.js';
import { appendDedupedWarning, toProviderWarning } from './results.js';
import type { Source } from './telemetry.js';
import {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationIdForRemote,
	isCloudGitSelfManagedHostIntegrationId,
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
	isNonExpiringZeroTokenIntegrationId,
} from './utils/integration.utils.js';

/** @internal Event emitted when an integration connection state changes  */
export interface IntegrationConnectionChangeEvent extends ConnectionStateChangeEvent {
	integration: IntegrationBase;
}

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

export class IntegrationService implements Disposable {
	get onDidChange(): Event<ConfiguredIntegrationsChangeEvent> {
		return this.configuredIntegrationService.onDidChange;
	}

	private readonly _onDidChangeConnectionState = new Emitter<ConnectionStateChangeEvent>();
	get onDidChangeConnectionState(): Event<ConnectionStateChangeEvent> {
		return this._onDidChangeConnectionState.event;
	}

	private readonly _connectedCache = new Set<string>();
	private readonly _disposable: Disposable;
	private _integrations = new Map<IntegrationKey, Integration>();
	private readonly _onDidChangeIntegrationConnection = new Emitter<IntegrationConnectionChangeEvent>();
	private readonly _apiDisposables: Disposable[] = [];
	private _apis: ApiClients | undefined;

	/** The package-built, memoized per-provider API clients (was injected via the now-removed `ctx.apis`). */
	get apis(): ApiClients {
		return (this._apis ??= createApiClients(this.ctx, this._apiDisposables));
	}

	/** The shared `GitHubApi` instance — also consumed by the host's GitHub git provider (one instance). */
	get github(): Promise<GitHubApi | undefined> {
		return this.apis.github;
	}

	constructor(
		private readonly authenticationService: IntegrationAuthenticationService,
		private readonly configuredIntegrationService: ConfiguredIntegrationService,
		private readonly ctx: IntegrationServiceContext,
	) {
		this._disposable = fromDisposables(
			ctx.config.onDidChange(e => {
				if (e.remotes) {
					this._ignoreSSLErrors.clear();
				}
			}),
			ctx.account.onDidChangeSessions(this.onAuthenticationSessionsChanged, this),
			ctx.account.onDidCheckIn(this.onUserCheckedIn, this),
			ctx.account.onDidChange(this.onSubscriptionChanged, this),
			this._onDidChangeIntegrationConnection.event(this.onIntegrationConnectionChanged, this),
		);
	}

	dispose(): void {
		this._integrations.forEach(i => i.dispose());
		this._integrations.clear();
		this._disposable?.dispose();
		// The facade (`createIntegrationManager`) hands us sole ownership of these, so disposing the manager
		// must tear them down too — otherwise cached auth providers (+ their host session listeners) and the
		// configured-integrations emitter outlive the manager.
		this.authenticationService.dispose();
		this.configuredIntegrationService.dispose();
		this._onDidChangeConnectionState.dispose();
		this._onDidChangeIntegrationConnection.dispose();
		this._apiDisposables.forEach(d => d.dispose());
	}

	@debug()
	async connectCloudIntegrations(
		connect?: { integrationIds: SupportedCloudIntegrationIds[]; skipIfConnected?: boolean; skipPreSync?: boolean },
		source?: Source,
	): Promise<boolean> {
		const scope = getScopedLogger();
		const integrationIds = connect?.integrationIds;
		this.ctx.hooks?.connection?.onStarted?.({ integrationIds: integrationIds }, source);

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
					scope?.warn(
						`Failed to get integration ${integrationId} by its ID. Consider it as not-connected and ignore. Error message: ${ex.message}`,
						scope,
					);
				}
			}

			if (connect?.skipIfConnected && connectedIntegrations.size === integrationIds.length) {
				return true;
			}
		}

		// The host owns the GK-Dev connect round-trip end-to-end (URL/query, exchange-token-vs-redirect,
		// open, await its OAuth callback, sign-in + redeem). The package only orchestrates state/sync/hooks.
		if (!(await this.ctx.account.connect({ integrationIds: integrationIds, source: source }))) {
			return false;
		}

		const connected = await this.syncCloudIntegrations(true);
		this.ctx.hooks?.connection?.onCompleted?.(
			{
				integrationIds: integrationIds,
				connectedIntegrationIds: connected != null ? [...connected.values()] : undefined,
			},
			source,
		);

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

	/**
	 * Starts the cloud connect flow without skipping an already-connected provider, allowing the host/GK Dev
	 * flow to add another account for that provider instead of treating the existing primary as sufficient.
	 * Returns whether a new connection was actually added (measured by a new cloud connection id appearing),
	 * since {@link connectCloudIntegrations} only reports provider-level success and can't detect a newly added
	 * secondary for an already-connected provider.
	 */
	async connectSecondary(id: SupportedCloudIntegrationIds, source?: Source): Promise<boolean> {
		const before = new Set(this.getConfigured(id, { cloud: true }).map(c => c.id));
		await this.connectCloudIntegrations({ integrationIds: [id], skipIfConnected: false }, source);
		return this.getConfigured(id, { cloud: true }).some(c => !before.has(c.id));
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
						await import(/* webpackChunkName: "integrations" */ './providers/github.js')
					).GitHubIntegration(
						this.ctx,
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

						const configured = this.getConfigured(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise);
						if (configured.length) {
							const { domain: configuredDomain } = configured.find(c => c.primary) ?? configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/github.js')
							).GitHubEnterpriseIntegration(
								this.ctx,
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
						await import(/* webpackChunkName: "integrations" */ './providers/github.js')
					).GitHubEnterpriseIntegration(
						this.ctx,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitCloudHostIntegrationId.GitLab:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab.js')
					).GitLabIntegration(
						this.ctx,
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

						const configured = this.getConfigured(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted);
						if (configured.length) {
							const { domain: configuredDomain } = configured.find(c => c.primary) ?? configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/gitlab.js')
							).GitLabSelfHostedIntegration(
								this.ctx,
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
						await import(/* webpackChunkName: "integrations" */ './providers/gitlab.js')
					).GitLabSelfHostedIntegration(
						this.ctx,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitCloudHostIntegrationId.Bitbucket:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/bitbucket.js')
					).BitbucketIntegration(
						this.ctx,
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

						const configured = this.getConfigured(GitSelfManagedHostIntegrationId.BitbucketServer);
						if (configured.length) {
							const { domain: configuredDomain } = configured.find(c => c.primary) ?? configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/bitbucket-server.js')
							).BitbucketServerIntegration(
								this.ctx,
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
						await import(/* webpackChunkName: "integrations" */ './providers/bitbucket-server.js')
					).BitbucketServerIntegration(
						this.ctx,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case GitCloudHostIntegrationId.AzureDevOps:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps.js')
					).AzureDevOpsIntegration(
						this.ctx,
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

						const configured = this.getConfigured(GitSelfManagedHostIntegrationId.AzureDevOpsServer);
						if (configured.length) {
							const { domain: configuredDomain } = configured.find(c => c.primary) ?? configured[0];
							if (configuredDomain == null) throw new Error(`Domain is required for '${id}' integration`);

							integration = new (
								await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps.js')
							).AzureDevOpsServerIntegration(
								this.ctx,
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
						await import(/* webpackChunkName: "integrations" */ './providers/azureDevOps.js')
					).AzureDevOpsServerIntegration(
						this.ctx,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
						domain,
					) as GitHostIntegration as IntegrationById<T>;
					break;

				case IssuesCloudHostIntegrationId.Jira:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/jira.js')
					).JiraIntegration(
						this.ctx,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as IssuesIntegration as IntegrationById<T>;
					break;

				case IssuesCloudHostIntegrationId.Linear:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/linear.js')
					).LinearIntegration(
						this.ctx,
						this.authenticationService,
						this.getProvidersApi.bind(this),
						this._onDidChangeIntegrationConnection,
					) as IssuesIntegration as IntegrationById<T>;
					break;

				case IssuesCloudHostIntegrationId.Trello:
					integration = new (
						await import(/* webpackChunkName: "integrations" */ './providers/trello.js')
					).TrelloIntegration(
						this.ctx,
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

	getConfigured(
		id?: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[] {
		return this.configuredIntegrationService.getConfigured(id, options);
	}

	/**
	 * Returns the connected integration for a `GitRemote`, if any.
	 * Internal counterpart to the host's `getRemoteIntegration(remote)` helper.
	 */
	async getByRemote(remote: GitRemote): Promise<GitHostIntegration | undefined> {
		if (remote?.provider == null) return undefined;

		const integrationId = getIntegrationIdForRemote(remote.provider);
		if (integrationId == null) return undefined;

		const integration = await this.get(integrationId, remote.provider?.domain);
		return integration?.type === 'git' ? integration : undefined;
	}

	@debug({
		args: integrationIds => ({ integrationIds: integrationIds?.length ? integrationIds.join(',') : '<undefined>' }),
	})
	async getMyIssues(
		integrationIds?: (GitCloudHostIntegrationId | IssuesCloudHostIntegrationId | GitSelfManagedHostIntegrationId)[],
		options?: { openRepositoriesOnly?: boolean; cancellation?: AbortSignal },
	): Promise<IssueShape[] | undefined> {
		const integrations: Map<Integration, ResourceDescriptor[] | undefined> = new Map();
		const hostingIntegrationIds = integrationIds?.filter(
			id => id in GitCloudHostIntegrationId || id in GitSelfManagedHostIntegrationId,
		) as GitCloudHostIntegrationId[];
		const openRemotesByIntegrationId = new Map<IntegrationIds, ResourceDescriptor[]>();
		let hasOpenAzureRepository = false;
		for (const remote of await this.ctx.repositories.getOpenRemotes()) {
			const remoteIntegration = await this.getByRemote(remote);
			if (remoteIntegration == null) continue;

			if (remoteIntegration.id === GitCloudHostIntegrationId.AzureDevOps) {
				hasOpenAzureRepository = true;
			}
			for (const integrationId of hostingIntegrationIds?.length
				? hostingIntegrationIds
				: [...Object.values(GitCloudHostIntegrationId), ...Object.values(GitSelfManagedHostIntegrationId)]) {
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
		cancellation?: AbortSignal,
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
	@trace({
		args: (remoteOrRemotes: GitRemote | GitRemote[]) => ({
			remoteOrRemotes: Array.isArray(remoteOrRemotes) ? remoteOrRemotes.map(rp => rp.name) : remoteOrRemotes.name,
		}),
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

		const integrations = new Map<GitHostIntegration, ResourceDescriptor[]>();

		for (const remote of remoteOrRemotes) {
			if (remote?.provider == null) continue;

			const integration = await this.getByRemote(remote);
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

	@debug({
		args: (integrationIds, connectionId) => ({
			integrationIds: integrationIds?.length ? integrationIds.join(',') : '<undefined>',
			connectionId: connectionId ?? '<primary>',
		}),
	})
	async getMyCurrentAccounts(
		integrationIds: (GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds)[],
		connectionId?: string,
	): Promise<Map<GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds, Account>> {
		const accounts = new Map<GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds, Account>();
		await Promise.allSettled(
			integrationIds.map(async integrationId => {
				const integration = await this.getIntegrationForRead(integrationId, connectionId);
				if (integration == null) return;

				const account = await integration.getCurrentAccount({ connectionId: connectionId });
				if (account) {
					accounts.set(integrationId, account);
				}
			}),
		);
		return accounts;
	}

	@debug({
		args: integrationIds => ({ integrationIds: integrationIds?.length ? integrationIds.join(',') : '<undefined>' }),
	})
	async getMyPullRequests(
		integrationIds?: (GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds)[],
		cancellation?: AbortSignal,
		silent?: boolean,
		options?: SearchMyPullRequestsOptions,
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

		return this.getMyPullRequestsCore(integrations, cancellation, silent, options);
	}

	private async getMyPullRequestsCore(
		integrations: Map<GitHostIntegration, ResourceDescriptor[] | undefined>,
		cancellation?: AbortSignal,
		silent?: boolean,
		options?: SearchMyPullRequestsOptions,
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const start = performance.now();

		const promises: Promise<IntegrationResult<PullRequest[] | undefined>>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyPullRequests(repos, cancellation, silent, undefined, undefined, options));
		}

		const results = await Promise.allSettled(promises);
		const successfulResults = [
			...flatten(
				filterMap(results, r =>
					r.status === 'fulfilled' && r.value?.value != null ? r.value.value : undefined,
				),
			),
		];
		const errors = [
			...filterMap(results, r =>
				r.status === 'fulfilled' && r.value?.error != null ? r.value.error : undefined,
			),
		];

		const error =
			errors.length === 0
				? undefined
				: errors.length === 1
					? errors[0]
					: new AggregateError(errors, 'Failed to get some pull requests');

		return {
			value: successfulResults,
			error: error,
			duration: performance.now() - start,
		};
	}

	async getMyPullRequestsForRemotes(remote: GitRemote): Promise<IntegrationResult<PullRequest[] | undefined>>;
	async getMyPullRequestsForRemotes(remotes: GitRemote[]): Promise<IntegrationResult<PullRequest[] | undefined>>;
	@trace({
		args: (remoteOrRemotes: GitRemote | GitRemote[]) => ({
			remoteOrRemotes: Array.isArray(remoteOrRemotes) ? remoteOrRemotes.map(rp => rp.name) : remoteOrRemotes.name,
		}),
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

			const integration = await this.getByRemote(remote);
			return integration?.searchMyPullRequests(remote.provider.repoDesc);
		}

		const integrations = new Map<GitHostIntegration, ResourceDescriptor[]>();

		for (const remote of remoteOrRemotes) {
			if (remote?.provider == null) continue;

			const integration = await this.getByRemote(remote);
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

	// #region ProviderBackend surface (#5438)
	//
	// Generic discovery (orgs/projects/repos) and page-oriented reads that Kepler's ProviderBackend
	// adapter maps to its own DTOs. All results are neutral (`ProviderResult`/`ProviderPagedResult`) and
	// carry per-provider warnings recovered from the read cores, so a single provider's auth/rate-limit
	// failure degrades to a warning instead of failing the whole call. The reads are repo-scoped (they
	// compose the git-host `*Result` cores); account-scoped fan-out is the adapter's responsibility.

	/**
	 * Runs a result-returning read and captures failure as a neutral {@link ProviderWarning} rather than
	 * letting it throw or silently vanish. Handles both a returned `{ error }` (the read cores' contract)
	 * and a hard throw; a soft warning (`{ value, error }`) yields the value *and* a warning.
	 */
	private async runCaptured<T>(
		id: IntegrationIds,
		domain: string | undefined,
		connectionId: string | undefined,
		fn: () => Promise<IntegrationResult<T>>,
	): Promise<{ value?: T; warning?: ProviderWarning }> {
		try {
			const result = await fn();
			if (result == null) {
				// The read core returns undefined only when it couldn't resolve a session. For a per-connection
				// read (`connectionId` supplied) that means the requested connection is gone — deleted or its auth
				// is invalid — which must not be reported as an empty account. The primary path (no connectionId)
				// legitimately yields nothing when the provider isn't connected, so leave it as an empty result.
				return connectionId != null ? { warning: this.noConnectionWarning(id, domain, connectionId) } : {};
			}
			if (result.error != null) {
				return { value: result.value, warning: toProviderWarning(id, domain, connectionId, result.error) };
			}
			return { value: result.value };
		} catch (ex) {
			return { warning: toProviderWarning(id, domain, connectionId, ex) };
		}
	}

	/**
	 * Builds a `no-connection` warning for a per-connection read that resolved neither a session nor an
	 * error: the requested `connectionId` no longer resolves (deleted, or its authentication is invalid).
	 * Consumers use this to tell a truly empty account apart from a broken connection.
	 */
	private noConnectionWarning(
		id: IntegrationIds,
		domain: string | undefined,
		connectionId?: string,
	): ProviderWarning {
		return {
			providerId: id,
			domain: domain,
			connectionId: connectionId,
			message:
				connectionId != null
					? `Connection '${connectionId}' for '${id}' could not be resolved (deleted or invalid authentication).`
					: `No active connection for '${id}' could be resolved.`,
			kind: 'no-connection',
			isAuth: false,
		};
	}

	/**
	 * Builds a warning for a drain that stopped short of completeness (hit a page backstop, or a single-page
	 * read that couldn't confirm it drained everything). `truncated`/`allPages` already carry this on the
	 * result, but consumers that only inspect `warnings` would otherwise see no signal the read is partial.
	 */
	private truncationWarning(
		id: IntegrationIds,
		domain: string | undefined,
		connectionId: string | undefined,
		readKind: 'Pull request' | 'Issue',
	): ProviderWarning {
		return {
			providerId: id,
			domain: domain,
			connectionId: connectionId,
			message: `${readKind} read for '${id}' was truncated (a page backstop was reached); results may be incomplete.`,
			kind: 'other',
			isAuth: false,
		};
	}

	/**
	 * Warnings for an early-returning read where the integration couldn't be resolved. When a specific
	 * `connectionId` was requested (and the provider is a git host), a missing integration means that
	 * connection is gone/invalid — surface a `no-connection` warning + `fetchFailed` so the caller can tell
	 * it apart from a truly empty account. Without a `connectionId` (or for an issue tracker on a git-host
	 * read), it's simply not connected, which stays a silent empty result.
	 */
	private earlyReturnConnectionWarnings(
		id: IntegrationIds,
		connectionId: string | undefined,
	): { warnings: ProviderWarning[]; fetchFailed: boolean } {
		if (connectionId == null) return { warnings: [], fetchFailed: false };

		const domain = this.getConfiguredConnectionDomain(id, connectionId);
		return { warnings: [this.noConnectionWarning(id, domain, connectionId)], fetchFailed: true };
	}

	/**
	 * Narrows a caller-provided PR filter set to what the provider actually supports (via its metadata), so
	 * an unsupported filter never trips the read core's "Unsupported filters" guard.
	 *
	 * Returns `{ filters }` (possibly undefined when none were requested — an unfiltered read is intended),
	 * plus `unsupported: true` when the caller DID request filters but the provider supports none of them. In
	 * that case the caller must NOT silently fall through to an unfiltered fetch-all (which would return every
	 * PR instead of the user's); it should skip the read and surface a warning.
	 *
	 * Genuine "my pull requests" self-scoping is delivered by the account-wide path
	 * ({@link GitHostIntegration.getMyPullRequestsForUserResult}); this helper only governs the optional
	 * repo-scoped narrowing.
	 */
	private resolvePullRequestFilters(
		id: IntegrationIds,
		filters: PullRequestFilter[] | undefined,
	): { filters?: PullRequestFilter[]; unsupported: boolean } {
		if (filters == null || filters.length === 0) return { unsupported: false };

		const supported = providersMetadata[id]?.supportedPullRequestFilters;
		if (supported == null || filters.some(f => !supported.includes(f))) return { unsupported: true };

		return { filters: filters, unsupported: false };
	}

	/** Warning for a repo-scoped PR read whose requested filters the provider supports none of. */
	private unsupportedFiltersWarning(
		id: IntegrationIds,
		domain: string | undefined,
		connectionId: string | undefined,
	): ProviderWarning {
		return {
			providerId: id,
			domain: domain,
			connectionId: connectionId,
			message: `The requested pull request filters are not supported by '${id}'; skipped to avoid returning unfiltered results.`,
			kind: 'other',
			isAuth: false,
		};
	}

	/** Warning for a git host that doesn't expose issues on this surface (e.g. Bitbucket, deprecated in favor of Jira). */
	private issuesUnsupportedWarning(
		id: IntegrationIds,
		domain: string | undefined,
		connectionId: string | undefined,
	): ProviderWarning {
		return {
			providerId: id,
			domain: domain,
			connectionId: connectionId,
			message: `Issues are not supported by '${id}'; use a dedicated issue integration (e.g. Jira) instead.`,
			kind: 'other',
			isAuth: false,
		};
	}

	/** Encodes a 1-based page number as the opaque cursor the provider paging layer understands. */
	private pageToCursor(page: number | undefined): string | undefined {
		if (page == null || page <= 1) return undefined;
		return JSON.stringify({ value: page, type: 'page' });
	}

	/**
	 * Normalizes a `PagedResult.paging` into the page-oriented shape Kepler consumes: `page`, `hasMore`,
	 * and an opaque `cursor` retained only for cursor-only hosts (where jumping straight to page N isn't
	 * possible, so the caller threads the cursor back instead).
	 */
	private toProviderPageInfo(
		itemsPerPage: number,
		paging: { more?: boolean; cursor?: string; page?: number; pageSize?: number; truncated?: boolean } | undefined,
	): { page: ProviderPageInfo; hasMore: boolean; cursor?: string; truncated: boolean } {
		let cursor: string | undefined;
		let cursorPage: number | undefined;
		const raw = paging?.cursor;
		if (raw != null && raw !== '{}') {
			try {
				const parsed = JSON.parse(raw) as { type?: string; cursors?: unknown; page?: number };
				// Retain opaque cursor strings for cursor-only hosts, per-repo/project cursor bundles for
				// PagingMode.Repo/Project reads, AND page/offset cursors. The latter matters for reads with no
				// caller-visible page param to increment — e.g. Bitbucket Server's account-wide PR read threads
				// its next `start` offset as a `type:'page'` cursor; dropping it left the caller with
				// `hasMore:true` and nothing to continue with. A page cursor is a valid opaque continuation, so
				// threading it back is always safe even where a page number is also reported.
				if (parsed.type === 'cursor' || parsed.type === 'page' || Array.isArray(parsed.cursors)) {
					cursor = raw;
					// Per-repo/project cursor bundles also carry the current page number so the facade can report the
					// real page when the consumer continues using only the cursor.
					if (Array.isArray(parsed.cursors) && parsed.page != null) {
						cursorPage = parsed.page;
					}
				}
			} catch {}
		}
		// Only echo a page number the provider actually honored. Numbered-page hosts report their own
		// `paging.page`; cursor-only hosts (e.g. GitHub PR search) report none and ignore a synthesized
		// page-number cursor — returning their first page — so echoing the requested `page` would mislabel
		// page 1 as page N. Report page 1 in that case rather than the unapplied request. Per-repo/project
		// bundles may carry the page explicitly in the cursor.
		const currentPage = paging?.page ?? cursorPage ?? 1;
		return {
			page: {
				currentPage: Math.max(1, currentPage),
				itemsPerPage: paging?.pageSize ?? itemsPerPage,
			},
			hasMore: paging?.more ?? false,
			cursor: cursor,
			// A single-page provider read that couldn't confirm completeness carries `paging.truncated`;
			// surface it so callers can flag `page.truncated` instead of publishing a partial read as complete.
			truncated: paging?.truncated ?? false,
		};
	}

	private getBroadenIssuesCursor(
		cursor: string | undefined,
		org: { providerId: IntegrationIds; name: string; connectionId?: string },
		page: number,
		orgCount: number,
	): string | undefined {
		if (orgCount === 1) {
			return cursor ?? this.pageToCursor(page);
		}

		if (cursor != null) {
			try {
				const parsed = JSON.parse(cursor) as {
					cursors?: { providerId?: IntegrationIds; org?: string; connectionId?: string; cursor?: string }[];
				};
				// Key by connectionId too: two accounts on the same provider can share an org name, and without
				// it account A's cursor would be applied to account B (or both exhausted together).
				const match = parsed.cursors?.find(
					c => c.providerId === org.providerId && c.org === org.name && c.connectionId === org.connectionId,
				)?.cursor;
				if (match != null) {
					return match;
				}
			} catch {}
		}

		return this.pageToCursor(page);
	}

	/**
	 * Whether a prior round already drained this org (multi-org fan-out only). Once an org runs out of pages
	 * while another org keeps paging, the composite cursor records it as exhausted so the next round skips it
	 * instead of re-issuing a page-1 read — which cursor-only providers (having no page-number cursor to
	 * honor) would answer with their first page again, duplicating results.
	 */
	private isBroadenIssuesOrgExhausted(
		cursor: string | undefined,
		org: { providerId: IntegrationIds; name: string; connectionId?: string },
		orgCount: number,
	): boolean {
		if (orgCount === 1 || cursor == null) return false;

		try {
			const parsed = JSON.parse(cursor) as {
				exhausted?: { providerId?: IntegrationIds; org?: string; connectionId?: string }[];
			};
			// Match connectionId too, so exhausting account A's org doesn't skip account B's same-named org.
			return (
				parsed.exhausted?.some(
					e => e.providerId === org.providerId && e.org === org.name && e.connectionId === org.connectionId,
				) ?? false
			);
		} catch {
			return false;
		}
	}

	private toBroadenIssuesCursor(
		cursors: { providerId: IntegrationIds; org: string; connectionId?: string; cursor: string }[],
		exhausted: { providerId: IntegrationIds; org: string; connectionId?: string }[],
		orgCount: number,
	): string | undefined {
		if (cursors.length === 0) return undefined;
		if (orgCount === 1) return cursors[0].cursor;

		// Carry the exhausted orgs alongside the still-active cursors so the next round can skip them (see
		// isBroadenIssuesOrgExhausted). Only meaningful while at least one org still has more to read.
		return JSON.stringify({ cursors: cursors, exhausted: exhausted });
	}

	/**
	 * Maps an issue-tracker resource descriptor to the unified {@link ProviderOrganization} org shape.
	 * The base `ResourceDescriptor` only guarantees `key`, so read `id`/`name` off the concrete
	 * `IssueResourceDescriptor` (falling back through `id`, then `key`) and synthesize `url` when absent,
	 * rather than widening the shared `ProviderOrganization.url` to optional.
	 */
	private resourceToOrg(
		providerId: IntegrationIds,
		resource: ResourceDescriptor,
		org?: string,
	): ProviderOrganization {
		const typed = resource as IssueResourceDescriptor & { url?: string };
		return {
			id: typed.id ?? resource.key,
			providerId: providerId,
			name: this.resourceLabel(resource),
			...(org != null ? { org: org } : {}),
			url: typed.url ?? '',
		};
	}

	private resourceLabel(resource: ResourceDescriptor): string {
		const typed = resource as IssueResourceDescriptor;
		return typed.name ?? typed.id ?? resource.key;
	}

	private orgForProject(
		providerId: IntegrationIds,
		project: ResourceDescriptor,
		resources: ResourceDescriptor[],
	): string | undefined {
		if (providerId === IssuesCloudHostIntegrationId.Trello) return undefined;

		const typedProject = project as IssueResourceDescriptor & { resourceId?: string };
		const parentMatch = [typedProject.resourceId, typedProject.id, project.key]
			.filter((value): value is string => value != null)
			.map(candidate => resources.find(resource => this.resourceMatchesOrg(resource, candidate)))
			.find((resource): resource is ResourceDescriptor => resource != null);

		return parentMatch != null
			? this.resourceLabel(parentMatch)
			: resources.length === 1
				? this.resourceLabel(resources[0])
				: undefined;
	}

	private withProviderContext(providerId: IntegrationIds, item: ProviderOrganization): ProviderOrganization {
		return {
			...item,
			providerId: providerId,
			...(item.org != null ? { org: item.org } : {}),
		};
	}

	private resourceMatchesOrg(resource: ResourceDescriptor, org: string): boolean {
		const typed = resource as IssueResourceDescriptor;
		return resource.key === org || typed.id === org || typed.name === org;
	}

	private domainForRead(
		integration: Integration,
		id: IntegrationIds,
		connectionId: string | undefined,
	): string | undefined {
		return connectionId != null ? this.getConfiguredConnectionDomain(id, connectionId) : integration.domain;
	}

	/**
	 * Resolves the right integration instance for a read, honoring `connectionId` for self-managed hosts where
	 * the instance is domain-specific. Cloud providers have a single instance, so `connectionId` falls back to
	 * the primary integration.
	 */
	private async getIntegrationForRead(
		id: IntegrationIds,
		connectionId: string | undefined,
	): Promise<Integration | undefined> {
		const domain = connectionId != null ? this.getConfiguredConnectionDomain(id, connectionId) : undefined;
		try {
			return await this.get(id, domain);
		} catch {
			return undefined;
		}
	}

	private async getCurrentAccountId(
		integration: GitHostIntegration,
		connectionId: string | undefined,
	): Promise<string | undefined> {
		try {
			return (await integration.getCurrentAccount({ connectionId: connectionId }))?.id;
		} catch {
			// Authorship is optional enrichment; don't turn a successful PR read into a failure if identity lookup fails.
			return undefined;
		}
	}

	/**
	 * Forces a real session refresh before a read when `forceSync` is set, so the read consumes a freshly
	 * exchanged token rather than a possibly-stale cached one. Both paths refresh, by different mechanisms: a
	 * per-connection (`connectionId`) read syncs that specific connection's session directly through the auth
	 * provider (the integration's primary-only sync path would never reach a secondary account), while a
	 * primary read syncs via the integration's own cloud-connection machinery.
	 * Best-effort — a failed sync is swallowed so the read still proceeds (and surfaces its own warning).
	 */
	private async forceRefreshIfRequested(
		integration: Integration,
		forceSync: boolean | undefined,
		connectionId: string | undefined,
	): Promise<void> {
		if (forceSync !== true) return;

		try {
			if (connectionId != null) {
				// Refresh the specific connection's session directly; the primary-only sync path below would not
				// reach a secondary account. `cloud: true` is required for multi-account backend connections.
				const authProvider = await this.authenticationService.get(integration.authProvider.id);
				await authProvider?.getSession(
					{ ...integration.authProviderDescriptor, connectionId: connectionId, cloud: true },
					{ sync: true },
				);
			} else {
				await integration.syncCloudConnection('connected', true);
			}
		} catch {}
	}

	/**
	 * Lists the orgs/workspaces/groups (and issue-tracker resources) visible to the user, unified into
	 * {@link ProviderOrganization}. Scoped to `providerId` when given, otherwise fanned out over every
	 * supported provider. `connectionId` only makes sense with a single `providerId`.
	 */
	async listOrgs(options?: {
		providerId?: IntegrationIds;
		connectionId?: string;
	}): Promise<ProviderResult<ProviderOrganization>> {
		const ids = options?.providerId != null ? [options.providerId] : supportedOrderedCloudIntegrationIds;
		const singleProvider = ids.length === 1;
		const connectionId = singleProvider ? options?.connectionId : undefined;

		const results = await Promise.all(
			ids.map(async id => {
				const integration = await this.getIntegrationForRead(id, connectionId);
				if (integration == null) {
					// A specifically requested connection that can't be resolved is a broken connection, not a
					// provider with no orgs — surface it (warning + fetchFailed) instead of dropping the id
					// silently, so a caller can tell it apart from an account that genuinely has no orgs.
					const early = this.earlyReturnConnectionWarnings(id, connectionId);
					return {
						items: [] as ProviderOrganization[],
						warnings: early.warnings,
						fetchFailed: early.fetchFailed,
					};
				}

				const items: ProviderOrganization[] = [];
				const warnings: ProviderWarning[] = [];
				let fetchFailed = false;
				const domain = this.domainForRead(integration, id, connectionId);
				if (isIssuesIntegration(integration)) {
					// Issue trackers expose "resources" (Jira sites, Linear orgs, …) as their org analogue.
					const { value: resources, warning } = await this.runCaptured(id, domain, connectionId, () =>
						integration.getResourcesForUserResult(connectionId),
					);
					if (resources != null) {
						items.push(...resources.map(r => this.resourceToOrg(id, r)));
					}
					if (warning != null) {
						warnings.push(warning);
						// A warning with no value is a hard read failure, not an empty account.
						if (resources == null) {
							fetchFailed = true;
						}
					}
				} else if (!integration.supportsOrganizationDiscovery) {
					// The provider registers no org-discovery hook (e.g. Bitbucket Data Center). Report it as
					// explicitly unsupported rather than contributing a silent empty list that a caller can't
					// tell apart from "this account has no orgs".
					fetchFailed = true;
					warnings.push({
						providerId: id,
						domain: domain,
						connectionId: connectionId,
						message: `Organization discovery is not supported by '${id}'.`,
						kind: 'other',
						isAuth: false,
					});
				} else {
					const { value, warning } = await this.runCaptured(id, domain, connectionId, () =>
						integration.getOrganizationsForUserResult(connectionId),
					);
					if (value != null) {
						items.push(...value.values.map(org => this.withProviderContext(id, org)));
						if (value.truncated) {
							warnings.push({
								providerId: id,
								domain: domain,
								connectionId: connectionId,
								message:
									'Organization listing was truncated before the upstream results were exhausted.',
								kind: 'other',
								isAuth: false,
							});
						}

						if (mergeAssessmentInto(warnings, id, domain, connectionId, value.metadata).fetchFailed) {
							fetchFailed = true;
						}
					}
					if (warning != null) {
						warnings.push(warning);
						if (value == null) {
							fetchFailed = true;
						}
					}
				}

				return { items: items, warnings: warnings, fetchFailed: fetchFailed };
			}),
		);

		const items: ProviderOrganization[] = [];
		const warnings: ProviderWarning[] = [];
		let fetchFailed = false;
		for (const result of results) {
			if (result == null) {
				continue;
			}

			items.push(...result.items);
			// Dedupe across the multi-provider fan-out (matches listProjects): a warning that repeats verbatim
			// across scopes — e.g. the same account surfaced under two ids — shouldn't be reported twice.
			for (const w of result.warnings) {
				appendDedupedWarning(warnings, w);
			}
			if (result.fetchFailed) {
				fetchFailed = true;
			}
		}
		return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
	}

	/**
	 * Lists the projects visible to the user, unified into the {@link ProviderOrganization}
	 * `{ providerId, id, name, org?, url }` shape. Covers issue-tracker providers (Jira/Linear, which expose
	 * projects under their resources) *and* git hosts that have a project tier (Azure DevOps, whose repos are
	 * org + project scoped). Scoped to `providerId` when given, else fanned out over both the supported issue
	 * trackers and Azure DevOps. Providers with no project tier (GitHub, GitLab, Bitbucket) contribute nothing.
	 */
	async listProjects(options?: {
		providerId?: IntegrationIds;
		org?: string;
		connectionId?: string;
	}): Promise<ProviderResult<ProviderOrganization>> {
		const ids =
			options?.providerId != null
				? [options.providerId]
				: [
						...supportedOrderedCloudIssuesIntegrationIds,
						GitCloudHostIntegrationId.AzureDevOps,
						GitSelfManagedHostIntegrationId.AzureDevOpsServer,
					];
		const singleProvider = ids.length === 1;
		const connectionId = singleProvider ? options?.connectionId : undefined;

		const results = await Promise.all(
			ids.map(async id => {
				const integration = await this.getIntegrationForRead(id, connectionId);
				if (integration == null) {
					// A requested connection that can't be resolved is a broken connection, not a provider with
					// no projects — surface it (warning + fetchFailed) instead of dropping the id silently.
					const early = this.earlyReturnConnectionWarnings(id, connectionId);
					return {
						items: [] as ProviderOrganization[],
						warnings: early.warnings,
						fetchFailed: early.fetchFailed,
					};
				}

				const items: ProviderOrganization[] = [];
				const warnings: ProviderWarning[] = [];
				let fetchFailed = false;
				const domain = this.domainForRead(integration, id, connectionId);
				const org = options?.org;

				// Git hosts with a project tier (Azure DevOps) read projects through their own hierarchy hook,
				// scoped to `org` when given. Non-Azure git hosts have no project tier and return undefined.
				if (!isIssuesIntegration(integration)) {
					const { value: projects, warning } = await this.runCaptured(id, domain, connectionId, () =>
						integration.getProjectsForOrgResult(org, connectionId),
					);
					if (warning != null) {
						warnings.push(warning);
						if (projects == null) {
							fetchFailed = true;
						}
					}
					if (projects != null) {
						items.push(...projects.values.map(project => this.withProviderContext(id, project)));

						if (mergeAssessmentInto(warnings, id, domain, connectionId, projects.metadata).fetchFailed) {
							fetchFailed = true;
						}
					}
					return { items: items, warnings: warnings, fetchFailed: fetchFailed };
				}

				const { value: resources, warning: resourcesWarning } = await this.runCaptured(
					id,
					domain,
					connectionId,
					() => integration.getResourcesForUserResult(connectionId),
				);
				if (resourcesWarning != null) {
					warnings.push(resourcesWarning);
					if (resources == null) {
						fetchFailed = true;
					}
				}

				const scopedResources =
					org != null ? resources?.filter(resource => this.resourceMatchesOrg(resource, org)) : resources;
				if (scopedResources != null && scopedResources.length !== 0) {
					const { value: projects, warning: projectsWarning } = await this.runCaptured(
						id,
						domain,
						connectionId,
						() => integration.getProjectsForResourcesWithMetadataResult(scopedResources, connectionId),
					);
					if (projectsWarning != null) {
						warnings.push(projectsWarning);
						if (projects == null) {
							fetchFailed = true;
						}
					}
					if (projects != null) {
						items.push(
							...projects.values.map(project =>
								this.resourceToOrg(id, project, this.orgForProject(id, project, scopedResources)),
							),
						);
					}
					if (mergeAssessmentInto(warnings, id, domain, connectionId, projects?.metadata).fetchFailed) {
						fetchFailed = true;
					}
				}

				return { items: items, warnings: warnings, fetchFailed: fetchFailed };
			}),
		);

		const items: ProviderOrganization[] = [];
		const warnings: ProviderWarning[] = [];
		let fetchFailed = false;
		for (const result of results) {
			if (result == null) {
				continue;
			}

			items.push(...result.items);
			for (const w of result.warnings) {
				appendDedupedWarning(warnings, w);
			}
			if (result.fetchFailed) {
				fetchFailed = true;
			}
		}
		return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
	}

	/**
	 * Lists repositories under an org for a git-host provider, one page at a time. Pass `page` (1-based)
	 * to advance; the returned `cursor` is only meaningful for cursor-only hosts.
	 */
	async listRepos(options: {
		providerId: IntegrationIds;
		/**
		 * Org/workspace/group to scope to. Omitted = the account-wide, user-affiliated walk (the org-less
		 * `gk provider repos <provider>` equivalent) for hosts with a native user-repos read (GitHub, GitLab);
		 * hosts without one (Bitbucket, Azure DevOps) report the org-less read as unsupported so the caller
		 * fans out per org instead.
		 */
		org?: string;
		project?: string;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
	}): Promise<ProviderPagedResult<ProviderRepositoryShape>> {
		const page = Math.max(1, options.page ?? 1);
		const integration = await this.getIntegrationForRead(options.providerId, options.connectionId);
		if (integration == null || isIssuesIntegration(integration)) {
			// A supplied connectionId that no longer resolves is a broken connection, not an empty account —
			// surface a no-connection warning + fetchFailed rather than a silent empty page.
			const early = this.earlyReturnConnectionWarnings(options.providerId, options.connectionId);
			return {
				items: [],
				warnings: early.warnings,
				page: { currentPage: page, itemsPerPage: 0 },
				hasMore: false,
				fetchFailed: early.fetchFailed || undefined,
			};
		}

		const domain = this.domainForRead(integration, options.providerId, options.connectionId);

		const accountWide = options.org == null;
		const supported = accountWide
			? integration.supportsUserRepositoryDiscovery
			: integration.supportsRepositoryDiscovery;
		if (!supported) {
			// No matching repo-discovery hook — org-scoped (e.g. Bitbucket Data Center) or account-wide (e.g.
			// Bitbucket/Azure, whose repos can only be walked per workspace/org). Report unsupported rather than
			// a silent empty page indistinguishable from "no repos"; for the account-wide case the caller should
			// fan out per org from listOrgs instead.
			return {
				items: [],
				warnings: [
					{
						providerId: options.providerId,
						domain: domain,
						connectionId: options.connectionId,
						message: accountWide
							? `Account-wide repository discovery is not supported by '${options.providerId}'; list repositories per org instead.`
							: `Repository discovery is not supported by '${options.providerId}'.`,
						kind: 'other',
						isAuth: false,
					},
				],
				page: { currentPage: page, itemsPerPage: 0 },
				hasMore: false,
				fetchFailed: true,
			};
		}

		const org = options.org;
		const cursor = options.cursor ?? this.pageToCursor(page);
		const { value, warning } = await this.runCaptured(options.providerId, domain, options.connectionId, () =>
			org == null
				? integration.getRepositoriesForUserResult({
						cursor: cursor,
						connectionId: options.connectionId,
					})
				: integration.getRepositoriesForOrgResult(org, {
						project: options.project,
						cursor: cursor,
						connectionId: options.connectionId,
					}),
		);

		const items = value?.values ?? [];
		const warnings = warning != null ? [warning] : [];
		// The repos read core is cursor-only and can't accept a page size, so don't echo the requested
		// `itemsPerPage` as if it were applied — report what the provider returned (its own pageSize when
		// available, else the actual item count).
		const paged = this.toProviderPageInfo(items.length, value?.paging);
		// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
		// them to any captured thrown-error warning without discarding the partial result's items.
		const assessment = mergeAssessmentInto(
			warnings,
			options.providerId,
			domain,
			options.connectionId,
			value?.metadata,
		);
		// The org-hierarchy read can stop at a defensive backstop with more repos unlisted and NO cursor to
		// resume (top-level `truncated`, or `paging.truncated` on a single-page read). Surface that as a
		// terminal `page.truncated` signal, NOT as `hasMore`: `hasMore` without a `cursor` would invite a
		// consumer to request the "next page" and get the same aggregate back forever. `hasMore` stays true
		// only when the provider gave a real resumable cursor. Metadata incompleteness is an independent source
		// of the same signal.
		const truncated = (value?.truncated ?? false) || (value?.paging?.truncated ?? false) || assessment.truncated;
		// Numbered-page hosts that don't echo `currentPage` may still be advanced by the requested `page` (initial
		// read) or by the cursor the caller threaded back. Cursor-only hosts expose a real opaque cursor, in which
		// case the provider's page-less first page is reported as page 1; don't echo an unapplied `page` there.
		const currentPage =
			paged.page.currentPage > 1
				? paged.page.currentPage
				: paged.cursor != null
					? 1
					: (parsePageCursor(options.cursor) ?? page);
		// Continuation: prefer a real provider cursor; else, for a numbered-page host that signalled more but
		// gave no cursor, synthesize the next page so the caller has something resumable to advance with.
		const cursorOut = paged.cursor ?? (paged.hasMore ? this.pageToCursor(currentPage + 1) : undefined);
		return {
			// Normalize the raw provider-apis repos to the GitLens-owned shape at the surface boundary.
			items: items.map(toProviderRepositoryShape),
			warnings: warnings,
			page: { ...paged.page, currentPage: currentPage, truncated: truncated || undefined },
			hasMore: paged.hasMore,
			cursor: cursorOut,
			fetchFailed: assessment.fetchFailed || (warning != null && value == null) || undefined,
		};
	}

	/**
	 * Reads one page of pull requests for the given git-host provider. With `repos`, reads those repos'
	 * PRs (translating `page` ↔ the provider's opaque cursor) and applies `filters` if given. With no
	 * `repos`, reads the current user's PRs account-wide (already user-scoped and cursor-continued), walking
	 * opaque cursors internally when only `page` is supplied; `filters`/`pageSize` don't narrow that path.
	 */
	async listPullRequestsPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		states?: PullRequestStateFilter[];
		/**
		 * PR filters to narrow a repo-scoped read to the current user (e.g. `[Author, Assignee,
		 * ReviewRequested]`). Narrowed to what the provider supports. On the account-wide (no-repos) path the
		 * read is already user-scoped, so these don't narrow it — except `ReviewRequested`, which opts into the
		 * review-requested slice on backends whose native account-wide query returns authored PRs only (see
		 * {@link GitHostIntegration.getMyPullRequestsForUserResult}).
		 */
		filters?: PullRequestFilter[];
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
	}): Promise<ProviderPagedResult<PullRequestShape>> {
		const page = Math.max(1, options.page ?? 1);
		const integration = await this.getIntegrationForRead(options.providerId, options.connectionId);
		if (integration == null || isIssuesIntegration(integration)) {
			// A supplied connectionId that no longer resolves is a broken connection, not an empty account —
			// surface a no-connection warning + fetchFailed rather than a silent empty page.
			const early = this.earlyReturnConnectionWarnings(options.providerId, options.connectionId);
			return {
				items: [],
				warnings: early.warnings,
				page: { currentPage: page, itemsPerPage: 0 },
				hasMore: false,
				fetchFailed: early.fetchFailed || undefined,
			};
		}

		await this.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

		const domain = this.domainForRead(integration, options.providerId, options.connectionId);
		// With no repos this is an account-wide "my PRs" read; the repo-scoped core rejects an empty `repos`
		// input, so route to the account-wide, inherently user-scoped core instead (see drainPullRequests).
		// That path is cursor-based and already user-scoped, so `pageSize` doesn't apply there and `filters`
		// don't narrow it (only `ReviewRequested` toggles the opt-in reviewer slice below). A page-only request
		// is handled by walking opaque continuations below. Do NOT synthesize a page-number cursor for it: the
		// underlying query (e.g. GitHub `involves:`) ignores a page number and returns its first page.
		const accountWide = (options.repos?.length ?? 0) === 0;
		const cursor = accountWide ? options.cursor : (options.cursor ?? this.pageToCursor(page));

		// Resolve repo-scoped filters up front so an unsupported set is caught before the read: falling through
		// unfiltered would return every PR in the repos rather than the user's.
		const resolvedFilters = accountWide
			? { unsupported: false as boolean, filters: undefined }
			: this.resolvePullRequestFilters(options.providerId, options.filters);
		if (resolvedFilters.unsupported) {
			return {
				items: [],
				warnings: [this.unsupportedFiltersWarning(options.providerId, domain, options.connectionId)],
				page: { currentPage: page, itemsPerPage: 0 },
				hasMore: false,
				fetchFailed: true,
			};
		}

		// The account-wide read is inherently user-scoped, so repo-scoped `filters` don't narrow it — but the
		// review-requested slice is opt-in on backends whose native account-wide query returns authored PRs only
		// (Bitbucket fans out per-repo for it). Honor `PullRequestFilter.ReviewRequested` as that opt-in so a
		// caller pays the fan-out cost only when it deliberately asks for review-requested PRs.
		const includeReviewRequested = accountWide
			? (options.filters?.includes(PullRequestFilter.ReviewRequested) ?? false)
			: false;
		const { value, warning } = await this.runCaptured(options.providerId, domain, options.connectionId, () =>
			accountWide
				? integration.getMyPullRequestsForUserResult(
						{ state: options.states, cursor: cursor, includeReviewRequested: includeReviewRequested },
						options.connectionId,
					)
				: integration.getMyPullRequestsForReposResult(
						options.repos ?? [],
						// Forward `page`/`pageSize` alongside the cursor so PagingMode.Repo hosts (GitLab, Bitbucket,
						// Azure), whose per-repo cursor path ignores a synthesized page-number cursor, still honor the
						// requested page and page size instead of always returning page 1. `filters` scopes the read to
						// the current user (the core resolves the account for these), so it returns the user's PRs.
						{
							state: options.states,
							filters: resolvedFilters.filters,
							cursor: cursor,
							page: options.page,
							pageSize: options.itemsPerPage,
						},
						options.connectionId,
					),
		);

		let items = value?.values ?? [];
		// Cursor-only account-wide reads start at page 1; a page-only request is advanced through opaque
		// continuations below. Repo-scoped reads report the requested page unless the provider reports its own.
		let paged = this.toProviderPageInfo(items.length, value?.paging);
		let allMetadata = value?.metadata;
		// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
		// them to any captured thrown-error warning without discarding the partial result's items.
		const warnings = warning != null ? [warning] : [];
		let pageFetchFailed = warning != null && value == null;

		// Cursor-only reads ignore a synthesized page-number cursor. When the caller explicitly asks for page N
		// without supplying a continuation cursor, drain through the opaque cursors so the returned `currentPage`
		// actually reflects N instead of misreporting page 1. Keep only the last successfully-read page's items
		// while still merging warnings/metadata across the drained prefix; returning pages 1..N as "page N" would
		// duplicate items for normal paged consumers.
		if (
			(accountWide || providersMetadata[options.providerId]?.pullRequestsPagingMode === PagingMode.Repos) &&
			options.page != null &&
			options.page > 1 &&
			options.cursor == null &&
			paged.page.currentPage === 1
		) {
			let currentCursor: string | undefined = paged.hasMore ? paged.cursor : undefined;
			let currentPage = 1;
			let currentHasMore: boolean = paged.hasMore && currentCursor != null && currentCursor !== '{}';
			let currentTruncated: boolean = paged.truncated;
			if (pageFetchFailed) {
				items = [];
				currentPage = page;
				currentCursor = undefined;
				currentHasMore = false;
			}
			const fetchNext = (cursor: string) =>
				this.runCaptured(options.providerId, domain, options.connectionId, () =>
					accountWide
						? integration.getMyPullRequestsForUserResult(
								{
									state: options.states,
									cursor: cursor,
									includeReviewRequested: includeReviewRequested,
								},
								options.connectionId,
							)
						: integration.getMyPullRequestsForReposResult(
								options.repos ?? [],
								{
									state: options.states,
									filters: resolvedFilters.filters,
									cursor: cursor,
									pageSize: options.itemsPerPage,
								},
								options.connectionId,
							),
				);
			while (currentPage < options.page && currentHasMore && currentCursor != null && currentCursor !== '{}') {
				const { value: nextValue, warning: nextWarning } = await fetchNext(currentCursor);
				if (nextWarning != null) {
					warnings.push(nextWarning);
				}

				if (nextValue == null) {
					pageFetchFailed = true;
					items = [];
					currentPage = page;
					currentCursor = undefined;
					currentHasMore = false;
					break;
				}

				const nextItems = nextValue.values;
				items = nextItems;
				allMetadata = mergeCollectionMetadata(allMetadata, nextValue.metadata);
				const nextPaged = this.toProviderPageInfo(options.itemsPerPage ?? nextItems.length, nextValue.paging);
				currentPage++;
				currentTruncated = currentTruncated || nextPaged.truncated;
				const nextCursor = nextPaged.cursor;
				if (nextCursor == null || nextCursor === currentCursor || nextCursor === '{}') {
					// Provider didn't advance the cursor; stop to avoid an infinite loop.
					currentCursor = undefined;
					currentHasMore = false;
					break;
				}

				currentCursor = nextCursor;
				currentHasMore = nextPaged.hasMore;
			}

			if (currentPage < options.page) {
				// The requested page is beyond the terminal cursor. Returning the last available page would
				// duplicate data and misrepresent it as page N.
				items = [];
				currentPage = page;
				currentCursor = undefined;
				currentHasMore = false;
			}

			paged = {
				page: { currentPage: currentPage, itemsPerPage: options.itemsPerPage ?? items.length },
				hasMore: currentHasMore,
				cursor: currentCursor,
				truncated: currentTruncated,
			};
		}

		const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, allMetadata);
		// A single-page provider read that couldn't confirm completeness sets `paging.truncated`; surface it
		// as a terminal `page.truncated` (not `hasMore`, which has no cursor to advance) so the caller knows
		// the page may be incomplete. Metadata incompleteness is an independent source of the same signal.
		const truncated = paged.truncated || assessment.truncated;
		if (truncated && warnings.length === 0) {
			warnings.push(this.truncationWarning(options.providerId, domain, options.connectionId, 'Pull request'));
		}
		const currentAccountId = items.some(pr => pr.author != null)
			? await this.getCurrentAccountId(integration, options.connectionId)
			: undefined;
		return {
			// Normalize the raw provider-apis PRs to the GitLens-owned shape at the surface boundary.
			items: items.map(pr => fromProviderPullRequest(pr, integration, { currentAccountId: currentAccountId })),
			warnings: warnings,
			page: { ...paged.page, truncated: truncated || undefined },
			hasMore: paged.hasMore,
			cursor: paged.cursor,
			// A metadata failure means items are incomplete even when the read didn't throw; a thrown error with
			// no recovered value is the pre-existing failure case.
			fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
		};
	}

	/**
	 * Reads one page of the user's issues for the given git-host provider. Returns the normalized
	 * {@link IssueShape} (uniform with {@link listIssueTrackerIssuesPage}). With `repos`, reads those repos'
	 * issues (translating `page` ↔ the provider's opaque cursor) and maps the raw provider issues to shapes.
	 * With no `repos`, reads the current user's issues account-wide — the repo-scoped core rejects an empty
	 * `repos` input for GitHub/Bitbucket/Azure, so route to the account-wide `searchMyIssues` core instead
	 * (which is already user-scoped and returns shapes; cursor-capable providers remain pageable).
	 */
	async listIssuesPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
	}): Promise<ProviderPagedResult<IssueShape>> {
		const page = Math.max(1, options.page ?? 1);
		const integration = await this.getIntegrationForRead(options.providerId, options.connectionId);
		if (integration == null || isIssuesIntegration(integration)) {
			// A supplied connectionId that no longer resolves is a broken connection, not an empty account —
			// surface a no-connection warning + fetchFailed rather than a silent empty page.
			const early = this.earlyReturnConnectionWarnings(options.providerId, options.connectionId);
			return {
				items: [],
				warnings: early.warnings,
				page: { currentPage: page, itemsPerPage: 0 },
				hasMore: false,
				fetchFailed: early.fetchFailed || undefined,
			};
		}

		await this.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

		const domain = this.domainForRead(integration, options.providerId, options.connectionId);

		// A git host whose issue tracker is deprecated (Bitbucket, superseded by dedicated issue integrations)
		// reports issues as explicitly unsupported rather than serving a partial/legacy source or a silent empty.
		if (!integration.supportsIssues) {
			return {
				items: [],
				warnings: [this.issuesUnsupportedWarning(options.providerId, domain, options.connectionId)],
				page: { currentPage: page, itemsPerPage: 0 },
				hasMore: false,
				fetchFailed: true,
			};
		}

		const accountWide = (options.repos?.length ?? 0) === 0;

		if (accountWide) {
			if (
				options.includeAllAssignees === true &&
				(options.providerId === GitCloudHostIntegrationId.GitHub ||
					options.providerId === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise)
			) {
				return {
					items: [],
					warnings: [
						{
							providerId: options.providerId,
							domain: domain,
							connectionId: options.connectionId,
							message:
								'`includeAllAssignees` is not supported for account-wide GitHub issue reads; scope the read to repositories instead.',
							kind: 'other',
							isAuth: false,
						},
					],
					page: { currentPage: 1, itemsPerPage: 0 },
					hasMore: false,
					fetchFailed: true,
				};
			}

			// The repo-scoped core rejects empty repos (GitHub/Bitbucket/Azure); read the account-wide,
			// already-user-scoped core instead. GitHub exposes a composite cursor across its authored,
			// assigned, and mentioned searches. Walk it internally when the caller supplies only page N.
			const readAccountWidePage = (cursor: string | undefined) =>
				this.runCaptured(options.providerId, domain, options.connectionId, () =>
					integration.searchMyIssuesWithTruncationResult(undefined, undefined, options.connectionId, {
						includeAllAssignees: options.includeAllAssignees,
						cursor: cursor,
					}),
				);
			const first = await readAccountWidePage(options.cursor);
			let value = first.value;
			const warnings = first.warning != null ? [first.warning] : [];
			let allMetadata = value?.metadata;
			let pageFetchFailed = first.warning != null && value == null;
			let currentPage = value?.page ?? 1;
			let currentTruncated = value?.truncated ?? false;
			let requestedPageMissing = false;
			if (options.cursor == null && page > 1 && value != null) {
				while (currentPage < page && value.hasMore && value.cursor != null) {
					const next = await readAccountWidePage(value.cursor);
					if (next.warning != null) {
						appendDedupedWarning(warnings, next.warning);
					}
					if (next.value == null) {
						pageFetchFailed = pageFetchFailed || next.warning != null;
						value = undefined;
						requestedPageMissing = true;
						break;
					}

					value = next.value;
					allMetadata = mergeCollectionMetadata(allMetadata, value.metadata);
					currentTruncated = currentTruncated || value.truncated;
					currentPage = value.page ?? currentPage + 1;
				}

				// A numbered page beyond the provider's terminal cursor is genuinely empty. Never return or
				// relabel the last available page as the requested one.
				if (currentPage < page) {
					requestedPageMissing = true;
				}
			} else if (options.cursor == null && page > 1) {
				requestedPageMissing = true;
			}

			// GitHub, GitLab, and Azure implement an account-wide issue search; a provider that doesn't (Bitbucket
			// exposes no issues at all, and `supportsIssues` already short-circuits it above) returns `undefined`
			// with no error. Surface that as an explicit unsupported warning + fetchFailed rather than a silent
			// empty success — the caller must fall back (e.g. broadenIssues over repos).
			if (value == null && warnings.length === 0) {
				return {
					items: [],
					warnings: [
						{
							providerId: options.providerId,
							domain: domain,
							connectionId: options.connectionId,
							message: `Account-wide issue search is not supported by '${options.providerId}'; scope the read to repositories instead.`,
							kind: 'other',
							isAuth: false,
						},
					],
					page: { currentPage: 1, itemsPerPage: 0 },
					hasMore: false,
					fetchFailed: true,
				};
			}

			const items = requestedPageMissing ? [] : (value?.values ?? []);
			// Fold in structured per-scope failures from the account-wide fan-out (e.g. Azure across projects):
			// scope-aware warnings + `fetchFailed` when a scope failed, without discarding the successful items.
			const assessment = mergeAssessmentInto(
				warnings,
				options.providerId,
				domain,
				options.connectionId,
				allMetadata,
			);
			// An account-wide search that couldn't confirm completeness (a provider cap with no cursor, or a
			// per-scope backstop/failure) is incomplete and can't be paged; report it as truncated (+ a
			// provider-neutral warning, unless a structured failure already explains it) rather than a complete
			// list. Don't hard-code GitHub's "100 per category" cap here — Azure reaches this via a per-project
			// backstop, and other providers may cap differently.
			const truncated = currentTruncated || assessment.truncated;
			if (truncated && warnings.length === 0) {
				warnings.push({
					providerId: options.providerId,
					domain: domain,
					connectionId: options.connectionId,
					message: `Account-wide issue search for '${options.providerId}' was truncated; results may be incomplete.`,
					kind: 'other',
					isAuth: false,
				});
			}
			return {
				items: items,
				warnings: warnings,
				page: {
					currentPage: requestedPageMissing ? page : (value?.page ?? (options.cursor != null ? page : 1)),
					itemsPerPage: items.length,
					truncated: truncated || undefined,
				},
				hasMore: requestedPageMissing ? false : (value?.hasMore ?? false),
				cursor: requestedPageMissing ? undefined : value?.cursor,
				fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
			};
		}

		const cursor = options.cursor ?? this.pageToCursor(page);
		const { value, warning } = await this.runCaptured(options.providerId, domain, options.connectionId, () =>
			// The shapes seam returns normalized IssueShape (and lets a provider whose only issue client already
			// yields shapes — Bitbucket — serve this path without a raw ProviderIssue round-trip).
			integration.getMyIssuesForReposAsShapesResult(
				options.repos ?? [],
				// Forward `page`/`pageSize` alongside the cursor so PagingMode.Repo/Project hosts honor the
				// requested page and page size rather than ignoring a synthesized page-number cursor.
				{
					filters: options.filters,
					includeAllAssignees: options.includeAllAssignees,
					cursor: cursor,
					page: options.page,
					pageSize: options.itemsPerPage,
				},
				options.connectionId,
			),
		);

		let items = value?.values ?? [];
		const warnings = warning != null ? [warning] : [];
		let pageFetchFailed = warning != null && value == null;
		let paged = this.toProviderPageInfo(options.itemsPerPage ?? items.length, value?.paging);
		let allMetadata = value?.metadata;

		// Cursor-only repo-scoped hosts (e.g. GitHub) ignore a synthesized page-number cursor. When the caller
		// explicitly asks for page N without supplying a continuation cursor, drain through the opaque cursors so
		// the returned `currentPage` actually reflects N instead of misreporting page 1. Keep only the last
		// successfully-read page's items while still merging warnings/metadata across the drained prefix; returning
		// pages 1..N as "page N" would duplicate items for normal paged consumers.
		if (
			providersMetadata[options.providerId]?.issuesPagingMode === PagingMode.Repos &&
			options.page != null &&
			options.page > 1 &&
			options.cursor == null &&
			paged.page.currentPage === 1
		) {
			let currentCursor: string | undefined = paged.hasMore ? paged.cursor : undefined;
			let currentPage = 1;
			let currentHasMore: boolean = paged.hasMore && currentCursor != null && currentCursor !== '{}';
			let currentTruncated: boolean = paged.truncated;
			if (pageFetchFailed) {
				items = [];
				currentPage = page;
				currentCursor = undefined;
				currentHasMore = false;
			}
			const fetchNext = (cursor: string) =>
				this.runCaptured(options.providerId, domain, options.connectionId, () =>
					integration.getMyIssuesForReposAsShapesResult(
						options.repos ?? [],
						{
							filters: options.filters,
							includeAllAssignees: options.includeAllAssignees,
							cursor: cursor,
							pageSize: options.itemsPerPage,
						},
						options.connectionId,
					),
				);
			while (currentPage < options.page && currentHasMore && currentCursor != null && currentCursor !== '{}') {
				const { value: nextValue, warning: nextWarning } = await fetchNext(currentCursor);
				if (nextWarning != null) {
					warnings.push(nextWarning);
				}

				if (nextValue == null) {
					pageFetchFailed = true;
					items = [];
					currentPage = page;
					currentCursor = undefined;
					currentHasMore = false;
					break;
				}

				const nextItems = nextValue.values;
				items = nextItems;
				allMetadata = mergeCollectionMetadata(allMetadata, nextValue.metadata);
				const nextPaged = this.toProviderPageInfo(options.itemsPerPage ?? nextItems.length, nextValue.paging);
				currentPage++;
				const nextCursor = nextPaged.cursor;
				if (nextCursor == null || nextCursor === currentCursor || nextCursor === '{}') {
					currentHasMore = false;
					break;
				}

				currentCursor = nextCursor;
				currentHasMore = nextPaged.hasMore;
				currentTruncated = nextPaged.truncated;
			}

			paged = {
				page: { currentPage: currentPage, itemsPerPage: options.itemsPerPage ?? items.length },
				hasMore: currentHasMore,
				cursor: currentCursor,
				truncated: currentTruncated,
			};
		}

		// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
		// them to any captured thrown-error warning without discarding the partial result's items.
		const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, allMetadata);
		// A provider read that couldn't confirm completeness (e.g. Bitbucket's single-page repo issue read
		// that dropped a repo) sets `paging.truncated`; surface it as a terminal `page.truncated` so a partial
		// page isn't published as complete. Metadata incompleteness is an independent source of the same signal.
		const truncated = paged.truncated || assessment.truncated;
		if (truncated && warnings.length === 0) {
			warnings.push(this.truncationWarning(options.providerId, domain, options.connectionId, 'Issue'));
		}
		return {
			items: items,
			warnings: warnings,
			page: { ...paged.page, truncated: truncated || undefined },
			hasMore: paged.hasMore,
			cursor: paged.cursor,
			fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
		};
	}

	/**
	 * Reads the user's issues from an issue-tracker provider (Jira/Linear/Trello), whose issues live under
	 * resource → project (not repos), so they can't go through {@link listIssuesPage} (git-host, repo-scoped).
	 * Returns the normalized {@link IssueShape} these providers produce, aggregated across the projects of the
	 * given `org` (or every visible resource/project when omitted). `includeAllAssignees` drops the
	 * "assigned to me" scoping so unassigned issues are included. Best-effort: a per-step failure becomes a
	 * warning without failing the whole read.
	 *
	 * Paginated by project: these providers have no single cross-project issue cursor, so a page is a bounded
	 * window of projects (each drained by its own read). Pagination is opt-in — a caller that supplies none of
	 * `page`/`cursor`/`itemsPerPage` reads every matched project in one page (`hasMore: false`), preserving the
	 * "aggregate everything" contract for callers that don't page. When any of those is supplied, the read is
	 * windowed to `itemsPerPage` projects (default 20) advanced 1-based via `page`/`cursor`, with `hasMore`/
	 * `cursor` carrying the next window. Note: a project's own read has an internal page backstop (see the
	 * per-provider drains); if a single project exceeds it, its extra issues can't be paged from here, but that
	 * incompleteness IS surfaced as `page.truncated` (Jira/Linear report the backstop hit) rather than passed
	 * off as a complete read.
	 */
	async listIssueTrackerIssuesPage(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		forceSync?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
	}): Promise<ProviderPagedResult<IssueShape>> {
		// Pagination is opt-in: only window the projects when the caller actually asked to page. A caller that
		// passes none of page/cursor/itemsPerPage keeps the "aggregate every matched project" contract, so an
		// existing consumer that doesn't inspect `hasMore` never silently loses projects past a default window.
		const paginated = options.page != null || options.cursor != null || options.itemsPerPage != null;
		// Resolve the requested 1-based page from an explicit `page` or the opaque page cursor (either may be
		// supplied; the cursor wins so a threaded continuation isn't clobbered).
		// Floor both so a fractional input can't produce a fractional slice bound (slice tolerates it, but the
		// intent is integer pages/windows).
		const page = Math.max(1, Math.trunc(parsePageCursor(options.cursor) ?? options.page ?? 1));
		const projectsPerPage = Math.max(1, Math.trunc(options.itemsPerPage ?? 20));

		const items: IssueShape[] = [];
		const warnings: ProviderWarning[] = [];
		const emptyPage = (fetchFailed?: boolean, truncated?: boolean): ProviderPagedResult<IssueShape> => ({
			items: items,
			warnings: warnings,
			page: { currentPage: page, itemsPerPage: items.length, truncated: truncated || undefined },
			hasMore: false,
			fetchFailed: fetchFailed || undefined,
		});

		const integration = await this.getIntegrationForRead(options.providerId, options.connectionId);
		if (integration == null || !isIssuesIntegration(integration)) {
			// A supplied connectionId that no longer resolves is a broken connection, not an empty account.
			const early = this.earlyReturnConnectionWarnings(options.providerId, options.connectionId);
			warnings.push(...early.warnings);
			return emptyPage(early.fetchFailed);
		}

		const domain = this.domainForRead(integration, options.providerId, options.connectionId);

		await this.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

		const { value: resources, warning: resourcesWarning } = await this.runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() => integration.getResourcesForUserResult(options.connectionId),
		);
		if (resourcesWarning != null) {
			warnings.push(resourcesWarning);
		}
		if (resources == null || resources.length === 0) {
			return emptyPage(resourcesWarning != null && resources == null);
		}

		const scopedResources =
			options.org != null ? resources.filter(r => this.resourceMatchesOrg(r, options.org!)) : resources;
		if (scopedResources.length === 0) {
			return emptyPage();
		}

		const { value: projectsResult, warning: projectsWarning } = await this.runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() => integration.getProjectsForResourcesWithMetadataResult(scopedResources, options.connectionId),
		);
		if (projectsWarning != null) {
			warnings.push(projectsWarning);
		}
		// Partial project discovery: continue with the resources that succeeded, but surface per-resource
		// failures as warnings and remember to mark the page fetchFailed so the caller knows some issues may be
		// missing. `projectDiscoveryFailed`/`projectDiscoveryTruncated` are OR-ed into the page's
		// fetchFailed/truncated at every return below (a truncated-but-not-failed discovery, e.g. a paging
		// backstop, still means the project set is incomplete).
		const projectDiscoveryAssessment = mergeAssessmentInto(
			warnings,
			options.providerId,
			domain,
			options.connectionId,
			projectsResult?.metadata,
		);
		const projectDiscoveryFailed = projectDiscoveryAssessment.fetchFailed;
		const projectDiscoveryTruncated = projectDiscoveryAssessment.truncated;
		const projects = projectsResult?.values;
		if (projects == null || projects.length === 0) {
			return emptyPage(
				(projectsWarning != null && projectsResult == null) || projectDiscoveryFailed,
				projectDiscoveryTruncated,
			);
		}

		const matchedProjects =
			options.project != null ? projects.filter(p => this.resourceMatchesOrg(p, options.project!)) : projects;

		// Validate the requested filters against what this provider supports (e.g. Linear/Trello support only
		// Assignee). An unsupported filter must not silently degrade — Linear/Trello ignore the requested type
		// and apply Assignee regardless — so warn + fetchFailed instead of returning a differently-scoped set.
		if (options.filters?.length) {
			const supported = providersMetadata[options.providerId]?.supportedIssueFilters;
			const allSupported = supported != null && options.filters.every(f => supported.includes(f));
			if (!allSupported) {
				warnings.push({
					providerId: options.providerId,
					domain: domain,
					connectionId: options.connectionId,
					message: `One or more requested issue filters are not supported by '${options.providerId}'.`,
					kind: 'other',
					isAuth: false,
				});
				return emptyPage(true);
			}
		}

		// `includeAllAssignees` drops the user scope, but a user-relative filter (Author/Mention) is meaningless
		// without a user. Passing both to the provider degrades silently: Jira, seeing no user, falls through to
		// an unscoped project fetch and returns EVERY issue instead of the requested author's/mentions. Reject
		// the incompatible combination up front rather than publishing a differently-scoped set as the result.
		if (options.includeAllAssignees === true && options.filters?.some(f => f !== IssueFilter.Assignee)) {
			warnings.push({
				providerId: options.providerId,
				domain: domain,
				connectionId: options.connectionId,
				message: `\`includeAllAssignees\` cannot be combined with an author/mention filter for '${options.providerId}' (those filters require a user scope).`,
				kind: 'other',
				isAuth: false,
			});
			return emptyPage(true);
		}

		const resourceIdForProject = (project: ResourceDescriptor): string | undefined => {
			const issueProject = project as { id?: string; key: string; resourceId?: string };
			return issueProject.resourceId ?? issueProject.id ?? issueProject.key;
		};
		const labelForResource = (resource: ResourceDescriptor): string => {
			const issueResource = resource as { id?: string; key: string; name?: string };
			return issueResource.name ?? issueResource.id ?? issueResource.key;
		};

		// Scope to the current user's assigned issues unless the caller broadens to all assignees. Resolve the
		// handle from each resource's own account (multi-account safe), capturing any error so its kind
		// (e.g. auth) is preserved rather than collapsed to a generic warning.
		let usersByResourceId: Map<string, string> | undefined;
		let accountLookupFailed = false;
		if (options.includeAllAssignees !== true) {
			usersByResourceId = new Map<string, string>();
			const accounts = await Promise.all(
				scopedResources.map(async resource => ({
					resource: resource,
					...(await this.runCaptured(options.providerId, domain, options.connectionId, () =>
						integration.getAccountForResourceResult(resource, options.connectionId),
					)),
				})),
			);

			for (const { resource, value: account, warning: accountWarning } of accounts) {
				const user = account?.username ?? account?.name ?? undefined;
				if (user != null) {
					usersByResourceId.set(resourceIdForProject(resource) ?? resource.key, user);
					continue;
				}

				warnings.push(
					accountWarning ?? {
						providerId: options.providerId,
						domain: domain,
						connectionId: options.connectionId,
						message: `Could not resolve the current user for '${labelForResource(resource)}'; skipping that resource to avoid returning issues assigned to others.`,
						kind: 'other',
						isAuth: false,
					},
				);
				accountLookupFailed = true;
			}
		}

		const fallbackUserForUnscopedProject =
			usersByResourceId?.size === 1 ? usersByResourceId.values().next().value : undefined;
		const userForProject = (project: ResourceDescriptor): string | undefined => {
			const resourceId = resourceIdForProject(project);
			if (resourceId != null) {
				const user = usersByResourceId?.get(resourceId);
				if (user != null) {
					return user;
				}
			}

			// Some providers/tests return project descriptors without their parent resource id. When we have only
			// one scoped resource, re-use that sole resolved user rather than silently dropping every project.
			return fallbackUserForUnscopedProject;
		};

		const scopedProjectsWithUsers =
			usersByResourceId != null
				? matchedProjects.filter(project => {
						return userForProject(project) != null;
					})
				: matchedProjects;

		// Page at project granularity when paginating: this window of projects for the requested page.
		// `moreProjectWindows` drives `hasMore`/`cursor` below (per-project internal caps are not observable
		// here — see the docstring). When not paginating, the window is every matched project that can be read
		// without broadening the user scope.
		const windowStart = paginated ? (page - 1) * projectsPerPage : 0;
		const scopedProjects = paginated
			? scopedProjectsWithUsers.slice(windowStart, windowStart + projectsPerPage)
			: scopedProjectsWithUsers;
		const moreProjectWindows = paginated && scopedProjectsWithUsers.length > windowStart + projectsPerPage;
		if (scopedProjects.length === 0) {
			// The discovered projects didn't intersect the requested filter/window, or every matching resource
			// failed user resolution. If discovery or account lookup was partial, the empty result is not a
			// proven-empty account — carry `fetchFailed` so the caller knows issues may be missing.
			return emptyPage(projectDiscoveryFailed || accountLookupFailed, projectDiscoveryTruncated);
		}

		const perProject = await Promise.all(
			scopedProjects.map(project =>
				this.runCaptured(options.providerId, domain, options.connectionId, () =>
					integration.getIssuesForProjectWithTruncationResult(
						project,
						{
							user: userForProject(project),
							filters: options.filters,
						},
						options.connectionId,
					),
				),
			),
		);

		// Partial project discovery means some projects' issues are missing from this page; propagate it so the
		// page reports fetchFailed even when every discovered project's own read succeeded.
		let fetchFailed = projectDiscoveryFailed || accountLookupFailed;
		// A project whose internal page-drain hit its backstop (Jira/Linear cap at maxPagesPerRequest) reports
		// `truncated`; surface it as `page.truncated` so a windowed read isn't published as having drained each
		// project completely.
		let projectTruncated = projectDiscoveryTruncated;
		let drainMetadata: CollectionMetadata | undefined;
		for (const { value: result, warning } of perProject) {
			if (warning != null) {
				warnings.push(warning);
			}
			// A thrown/unsupported read (e.g. Linear not-implemented) surfaces as a warning with no value;
			// mark the aggregate as fetchFailed so an empty result isn't mistaken for "no issues".
			if (warning != null && result == null) {
				fetchFailed = true;
			}
			if (result != null) {
				items.push(...result.values);
				if (result.truncated) {
					projectTruncated = true;
				}
				if (result.metadata != null) {
					drainMetadata = mergeCollectionMetadata(drainMetadata, result.metadata);
				}
			}
		}

		const drainAssessment = mergeAssessmentInto(
			warnings,
			options.providerId,
			domain,
			options.connectionId,
			drainMetadata,
		);
		fetchFailed = fetchFailed || drainAssessment.fetchFailed;
		projectTruncated = projectTruncated || drainAssessment.truncated;

		// A per-project read that returned data but couldn't confirm completeness (e.g. Trello's provider-native
		// cap) sets `truncated` without a structured failure. Add one provider-neutral incompleteness warning so
		// the caller sees the truncation, but only when no warning already explains it (avoid duplicate noise).
		if (projectTruncated && warnings.length === 0) {
			warnings.push({
				providerId: options.providerId,
				domain: domain,
				connectionId: options.connectionId,
				message: 'Some issues were omitted; the provider returned an incomplete result.',
				kind: 'other',
				isAuth: false,
			});
		}

		return {
			items: items,
			warnings: warnings,
			page: { currentPage: page, itemsPerPage: items.length, truncated: projectTruncated || undefined },
			hasMore: moreProjectWindows,
			// Thread the next project window as a page cursor so the caller can advance; omitted when done.
			cursor: moreProjectWindows ? toPageCursor(page + 1) : undefined,
			fetchFailed: fetchFailed || undefined,
		};
	}

	/**
	 * Drains every page of the user's pull requests for one git-host integration, threading the opaque
	 * next-cursor the provider returns (so it works for both page- and cursor-based hosts). Stops at
	 * `maxPages` (marking `truncated`) or on a hard read failure (marking `fetchFailed`), keeping the
	 * pages fetched so far. A soft warning (`{ value, error }`) is recorded but the drain continues.
	 */
	private async drainPullRequests(
		integration: GitHostIntegration,
		id: IntegrationIds,
		domain: string | undefined,
		repos: ProviderReposInput,
		state: PullRequestStateFilter[] | undefined,
		filters: PullRequestFilter[] | undefined,
		connectionId: string | undefined,
		maxPages: number,
		attributeUnavailableProvider: boolean,
	): Promise<{
		items: ProviderPullRequest[];
		warnings: ProviderWarning[];
		fetchFailed: boolean;
		truncated: boolean;
		failedProvider: boolean;
	}> {
		const items: ProviderPullRequest[] = [];
		const warnings: ProviderWarning[] = [];
		let cursor: string | undefined;
		let page = 0;
		// SDK metadata failures across pages mean the collection is incomplete even when no page threw; carry
		// this through the terminal returns instead of resetting it to false at the last page.
		let fetchFailed = false;

		// With no repos this is an account-wide "my PRs" sweep. The repo-scoped core rejects an empty `repos`
		// input (`isRepoIdsInput([])` is true → "Unsupported input"), so read the account-wide, inherently
		// user-scoped core instead; `filters` don't narrow it (the provider query is already user-scoped), but
		// `ReviewRequested` opts into the reviewer slice on backends whose native account-wide read is
		// authored-only (Bitbucket fans out per-repo for it), so honor it as that opt-in.
		const accountWide = repos.length === 0;
		const includeReviewRequested = accountWide
			? (filters?.includes(PullRequestFilter.ReviewRequested) ?? false)
			: false;

		for (;;) {
			page++;
			// Snapshot the mutable loop cursor so the read closure doesn't capture a later-reassigned value.
			const pageCursor = cursor;
			const { value, warning } = await this.runCaptured(id, domain, connectionId, () =>
				accountWide
					? integration.getMyPullRequestsForUserResult(
							{ state: state, cursor: pageCursor, includeReviewRequested: includeReviewRequested },
							connectionId,
						)
					: integration.getMyPullRequestsForReposResult(
							repos,
							{ state: state, filters: filters, cursor: pageCursor },
							connectionId,
						),
			);
			if (warning != null) {
				appendDedupedWarning(warnings, warning);
			}
			if (value == null) {
				const unavailable = warning == null && attributeUnavailableProvider;
				if (unavailable) {
					appendDedupedWarning(warnings, this.noConnectionWarning(id, domain, connectionId));
				}
				// `warning` set → a hard read failure (incomplete items); otherwise not connected / no session.
				return {
					items: items,
					warnings: warnings,
					fetchFailed: fetchFailed || warning != null || unavailable,
					truncated: false,
					// Only a top-level first-page rejection means the provider itself failed. A later-page or
					// per-scope failure still yielded a usable provider slice and stays represented separately.
					failedProvider: page === 1 && (warning != null || unavailable),
				};
			}

			items.push(...value.values);

			// Assess this page's SDK metadata: append scope-aware warnings (deduped across pages), and remember
			// whether a structured failure or incompleteness occurred.
			const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, value.metadata);
			fetchFailed = fetchFailed || assessment.fetchFailed;

			if (!(value.paging?.more ?? false)) {
				// A read that can't confirm completeness (single-page provider reads with no `hasNextPage`)
				// sets `paging.truncated`; propagate it (and any top-level `truncated` and SDK incompleteness)
				// so the sweep doesn't claim an all-pages result.
				const truncated =
					(value as { truncated?: boolean }).truncated ??
					value.paging?.truncated ??
					assessment.truncated ??
					false;
				// Only emit the generic truncation warning when the assessment didn't already add a warning for the
				// truncation (structured failures or the generic incompleteness warning). Adding it unconditionally
				// duplicates the same failure signal.
				if (truncated && !assessment.truncated) {
					appendDedupedWarning(warnings, this.truncationWarning(id, domain, connectionId, 'Pull request'));
				}
				return {
					items: items,
					warnings: warnings,
					fetchFailed: fetchFailed,
					truncated: truncated,
					failedProvider: false,
				};
			}
			if (page >= maxPages) {
				appendDedupedWarning(warnings, this.truncationWarning(id, domain, connectionId, 'Pull request'));
				return {
					items: items,
					warnings: warnings,
					fetchFailed: fetchFailed,
					truncated: true,
					failedProvider: false,
				};
			}

			const nextCursor = value.paging?.cursor;
			if (nextCursor == null || nextCursor === '{}') {
				// Provider says there is more but didn't return a usable cursor; stop rather than refetch the same page.
				appendDedupedWarning(warnings, this.truncationWarning(id, domain, connectionId, 'Pull request'));
				return {
					items: items,
					warnings: warnings,
					fetchFailed: fetchFailed,
					truncated: true,
					failedProvider: false,
				};
			}

			cursor = nextCursor;
		}
	}

	/**
	 * Drains every page of repositories under an org for one git-host integration, threading the opaque
	 * next-cursor the provider returns. Stops at `maxPages` (marking `truncated`) or on a hard read failure
	 * (marking `fetchFailed`), keeping the pages fetched so far.
	 */
	private async drainRepositories(
		integration: GitHostIntegration,
		id: IntegrationIds,
		domain: string | undefined,
		org: string,
		project: string | undefined,
		connectionId: string | undefined,
		maxPages: number,
	): Promise<{
		repos: ProviderRepository[];
		warnings: ProviderWarning[];
		fetchFailed: boolean;
		truncated: boolean;
	}> {
		const repos: ProviderRepository[] = [];
		const warnings: ProviderWarning[] = [];
		let fetchFailed = false;
		let metadataTruncated = false;
		let cursor: string | undefined;
		let page = 0;

		for (;;) {
			page++;
			const pageCursor = cursor;
			const { value, warning } = await this.runCaptured(id, domain, connectionId, () =>
				integration.getRepositoriesForOrgResult(org, {
					project: project,
					cursor: pageCursor,
					connectionId: connectionId,
				}),
			);
			if (warning != null) {
				warnings.push(warning);
			}
			if (value == null) {
				return {
					repos: repos,
					warnings: warnings,
					fetchFailed: fetchFailed || warning != null,
					truncated: metadataTruncated,
				};
			}

			repos.push(...value.values);
			const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, value.metadata);
			fetchFailed = fetchFailed || assessment.fetchFailed;
			metadataTruncated = metadataTruncated || assessment.truncated;
			if (!(value.paging?.more ?? false)) {
				// Honor both the top-level `ProviderHierarchyResult.truncated` (the org-hierarchy backstop hit
				// its own page cap) and `paging.truncated` (a single-page read that couldn't confirm it was
				// complete); either means repos may be missing and this org isn't fully drained.
				return {
					repos: repos,
					warnings: warnings,
					fetchFailed: fetchFailed,
					truncated: (value.truncated ?? value.paging?.truncated ?? false) || metadataTruncated,
				};
			}
			if (page >= maxPages) {
				return { repos: repos, warnings: warnings, fetchFailed: fetchFailed, truncated: true };
			}

			const nextCursor = value.paging?.cursor;
			if (nextCursor == null || nextCursor === '{}') {
				// Provider says there is more but didn't return a usable cursor; stop rather than refetch the same page.
				return { repos: repos, warnings: warnings, fetchFailed: fetchFailed, truncated: true };
			}

			cursor = nextCursor;
		}
	}

	/**
	 * Sweeps the user's pull requests across providers by draining every page (an "all-pages" read),
	 * returning the neutral sweep result with per-provider warnings. `truncated` is set when a provider
	 * hit `maxPages` with more still available; `fetchFailed` when a drain aborted on a read error.
	 * `connectionId` is honored only when `providerIds` resolves to a single provider (otherwise ambiguous).
	 */
	async sweepPullRequests(options?: {
		repos?: ProviderReposInput;
		providerIds?: IntegrationIds[];
		state?: PullRequestStateFilter[];
		/** PR filters to apply; omit for the user-scoped default (see {@link listPullRequestsPage}). */
		filters?: PullRequestFilter[];
		forceSync?: boolean;
		connectionId?: string;
		maxPages?: number;
	}): Promise<ProviderSweepResult<PullRequestShape>> {
		const ids = options?.providerIds ?? supportedOrderedCloudIntegrationIds;
		const attributeUnavailableProviders = options?.providerIds != null;
		const singleProvider = ids.length === 1;
		const maxPages = options?.maxPages ?? 100;
		const repos = options?.repos ?? [];

		const results = await Promise.all(
			ids.map(async id => {
				const connectionId = singleProvider ? options?.connectionId : undefined;
				const integration = await this.getIntegrationForRead(id, connectionId);
				if (integration == null) {
					// A requested connection that can't be resolved is a broken connection — surface it as a
					// warning + fetchFailed rather than dropping the provider's slice silently.
					const early = this.earlyReturnConnectionWarnings(id, connectionId);
					if (early.warnings.length === 0 && !attributeUnavailableProviders) return undefined;
					return {
						items: [] as PullRequestShape[],
						warnings:
							early.warnings.length !== 0
								? early.warnings
								: [this.noConnectionWarning(id, undefined, connectionId)],
						fetchFailed: true,
						truncated: false,
						providerId: id,
						failedProvider: true,
					};
				}
				if (isIssuesIntegration(integration)) return undefined;

				await this.forceRefreshIfRequested(integration, options?.forceSync, connectionId);

				const domain = this.domainForRead(integration, id, connectionId);
				// Resolve filters per provider so each drains only the user's PRs (default) using the filters
				// that provider supports — a single shared set could be unsupported by one of them. Only relevant
				// on the repo-scoped path; the account-wide drain (empty repos) ignores filters.
				const resolved = this.resolvePullRequestFilters(id, options?.filters);
				if (resolved.unsupported && repos.length > 0) {
					// Don't drain unfiltered (would return every PR); report a warning and contribute nothing.
					return {
						items: [] as PullRequestShape[],
						warnings: [this.unsupportedFiltersWarning(id, domain, connectionId)],
						fetchFailed: true,
						truncated: false,
						providerId: id,
						failedProvider: true,
					};
				}

				const drain = await this.drainPullRequests(
					integration,
					id,
					domain,
					repos,
					options?.state,
					resolved.filters,
					connectionId,
					maxPages,
					attributeUnavailableProviders,
				);
				const currentAccountId = drain.items.some(pr => pr.author != null)
					? await this.getCurrentAccountId(integration, connectionId)
					: undefined;
				// Normalize the raw provider-apis PRs to the GitLens-owned shape here, where the per-provider
				// `integration` (the mapper's provider reference) is in scope; the aggregation below only sees drains.
				return {
					...drain,
					items: drain.items.map(pr =>
						fromProviderPullRequest(pr, integration, { currentAccountId: currentAccountId }),
					),
					providerId: id,
				};
			}),
		);

		const items: PullRequestShape[] = [];
		const warnings: ProviderWarning[] = [];
		const failedProviderIds = new Set<IntegrationIds>();
		let fetchFailed = false;
		let truncated = false;
		for (const drain of results) {
			if (drain == null) {
				continue;
			}

			items.push(...drain.items);
			for (const w of drain.warnings) {
				appendDedupedWarning(warnings, w);
			}
			if (drain.fetchFailed) {
				fetchFailed = true;
			}
			if (drain.failedProvider) {
				failedProviderIds.add(drain.providerId);
			}
			if (drain.truncated) {
				truncated = true;
			}
		}

		return {
			items: items,
			warnings: warnings,
			// `allPages` asserts completeness — it must be false when any provider truncated (a single-page
			// account-wide read that couldn't confirm it drained everything) OR a drain aborted on a read
			// failure (its slice is incomplete). Either way the sweep did not read every page.
			page: {
				currentPage: 1,
				itemsPerPage: items.length,
				allPages: !truncated && !fetchFailed,
				truncated: truncated || undefined,
			},
			// A sweep drains every page itself and exposes no cursor to resume — so `hasMore` must be false even
			// when the read was incomplete. Terminal incompleteness is expressed through `page.truncated` +
			// `allPages: false` + warnings; setting `hasMore: true` here would make a consumer that drains while
			// `hasMore` re-run the identical sweep forever with no cursor to advance.
			hasMore: false,
			fetchFailed: fetchFailed || undefined,
			failedProviderIds: [...failedProviderIds],
		};
	}

	/**
	 * Closed/merged counterpart of {@link sweepPullRequests}, feeding Kepler's Kanban "done" column. Applies
	 * the native cross-provider state filter (`Closed` + `Merged`) so it works beyond GitHub.
	 */
	async sweepClosedPullRequests(options?: {
		repos?: ProviderReposInput;
		providerIds?: IntegrationIds[];
		filters?: PullRequestFilter[];
		forceSync?: boolean;
		connectionId?: string;
		maxPages?: number;
	}): Promise<ProviderSweepResult<PullRequestShape>> {
		return this.sweepPullRequests({
			...options,
			state: ['closed', 'merged'],
		});
	}

	/**
	 * Broadens the user's issues by fanning out over the supplied orgs: for each org it lists the org's
	 * repositories, then reads that org's issues. A per-org failure becomes a warning without failing the
	 * whole fan-out. `broadenedProviderIds` lists the distinct providers whose issue read resolved (even
	 * if every issue duplicated a baseline), and `fanOutCount` is the number of org work items spawned.
	 * Each org may carry its own `connectionId` to target a specific account (the fan-out spans providers, so
	 * the connection is scoped per org rather than globally).
	 */
	async broadenIssues(options: {
		orgs: { providerId: IntegrationIds; name: string; connectionId?: string }[];
		page?: number;
		cursor?: string;
		forceSync?: boolean;
	}): Promise<ProviderBroadenResult<IssueShape>> {
		const page = Math.max(1, Math.trunc(options.page ?? 1));

		// Kepler's existing contract persists only a page number. When no opaque continuation was supplied,
		// advance through prior pages internally so cursor-only providers still return the requested page.
		// Each recursive call below carries a cursor, so it bypasses this block and performs exactly one round.
		if (options.cursor == null && page > 1) {
			let cursor: string | undefined;
			let previous: ProviderBroadenResult<IssueShape> | undefined;
			const traversalWarnings: ProviderWarning[] = [];
			const broadenedProviderIds = new Set<IntegrationIds>();
			let traversalFetchFailed = false;
			let traversalTruncated = false;
			for (let currentPage = 1; currentPage < page; currentPage++) {
				previous = await this.broadenIssues({
					...options,
					page: currentPage,
					cursor: cursor,
					// A forced refresh belongs to the logical read, not every cursor-advancement round.
					forceSync: currentPage === 1 ? options.forceSync : false,
				});
				for (const warning of previous.warnings) {
					appendDedupedWarning(traversalWarnings, warning);
				}
				for (const providerId of previous.broadenedProviderIds) {
					broadenedProviderIds.add(providerId);
				}
				traversalFetchFailed ||= previous.fetchFailed === true;
				traversalTruncated ||= previous.page.truncated === true;
				if (!previous.hasMore || previous.cursor == null) {
					return {
						items: [],
						warnings: traversalWarnings,
						page: {
							currentPage: page,
							itemsPerPage: 0,
							truncated: traversalTruncated || undefined,
						},
						hasMore: false,
						fetchFailed: traversalFetchFailed || undefined,
						broadenedProviderIds: [...broadenedProviderIds],
						fanOutCount: options.orgs.length,
					};
				}

				cursor = previous.cursor;
			}

			const requested = await this.broadenIssues({ ...options, page: page, cursor: cursor, forceSync: false });
			for (const warning of requested.warnings) {
				appendDedupedWarning(traversalWarnings, warning);
			}
			for (const providerId of requested.broadenedProviderIds) {
				broadenedProviderIds.add(providerId);
			}
			return {
				...requested,
				warnings: traversalWarnings,
				page: {
					...requested.page,
					truncated: traversalTruncated || requested.page.truncated === true || undefined,
				},
				fetchFailed: traversalFetchFailed || requested.fetchFailed === true || undefined,
				broadenedProviderIds: [...broadenedProviderIds],
			};
		}

		const results = await Promise.all(
			options.orgs.map(async org => {
				const connectionId = org.connectionId;
				const integration = await this.getIntegrationForRead(org.providerId, connectionId);
				if (integration == null) {
					// A requested connection that can't be resolved is a broken connection — surface it as a
					// warning + fetchFailed rather than dropping the org silently.
					const early = this.earlyReturnConnectionWarnings(org.providerId, connectionId);
					if (early.warnings.length === 0) return undefined;
					return {
						items: [] as IssueShape[],
						warnings: early.warnings,
						broadenedProviderIds: [] as IntegrationIds[],
						providerId: org.providerId,
						org: org.name,
						connectionId: connectionId,
						nextCursor: undefined,
						hasMore: false,
						exhausted: false,
						fetchFailed: true,
						truncated: false,
					};
				}
				if (isIssuesIntegration(integration)) return undefined;

				// A git host whose issue tracker is deprecated (Bitbucket) exposes no issues here — surface a
				// warning + fetchFailed and skip it (no repo drain), so broadening never serves a legacy source.
				if (!integration.supportsIssues) {
					return {
						items: [] as IssueShape[],
						warnings: [
							this.issuesUnsupportedWarning(
								org.providerId,
								this.domainForRead(integration, org.providerId, connectionId),
								connectionId,
							),
						],
						broadenedProviderIds: [] as IntegrationIds[],
						providerId: org.providerId,
						org: org.name,
						connectionId: connectionId,
						nextCursor: undefined,
						hasMore: false,
						exhausted: false,
						fetchFailed: true,
						truncated: false,
					};
				}

				// An org a prior round already drained must not be re-read: cursor-only providers would answer a
				// fresh page-1 request with their first page again, duplicating issues across rounds. Skip it
				// before any work (including the repo drain) and keep it marked exhausted so it stays skipped
				// for the rest of the fan-out.
				if (this.isBroadenIssuesOrgExhausted(options.cursor, org, options.orgs.length)) {
					return {
						items: [],
						warnings: [] as ProviderWarning[],
						broadenedProviderIds: [] as IntegrationIds[],
						providerId: org.providerId,
						org: org.name,
						connectionId: connectionId,
						nextCursor: undefined,
						hasMore: false,
						exhausted: true,
						fetchFailed: false,
						truncated: false,
					};
				}

				await this.forceRefreshIfRequested(integration, options.forceSync, connectionId);

				const domain = this.domainForRead(integration, org.providerId, connectionId);
				const reposDrain = await this.drainRepositories(
					integration,
					org.providerId,
					domain,
					org.name,
					undefined,
					connectionId,
					100,
				);
				const warnings: ProviderWarning[] = [...reposDrain.warnings];
				const fetchFailed = reposDrain.fetchFailed;
				const truncated = reposDrain.truncated;

				const repos: ProviderReposInput = reposDrain.repos.map(r => ({ ...r }));
				if (repos.length === 0) {
					return {
						items: [],
						warnings: warnings,
						broadenedProviderIds: [] as IntegrationIds[],
						providerId: org.providerId,
						org: org.name,
						connectionId: connectionId,
						nextCursor: undefined,
						hasMore: false,
						exhausted: false,
						fetchFailed: fetchFailed,
						truncated: truncated,
					};
				}

				// Broaden = "all visible": drop the assigned-to-me filter so unassigned issues are included.
				const cursor = this.getBroadenIssuesCursor(options.cursor, org, page, options.orgs.length);
				const issuesCaptured = await this.runCaptured(org.providerId, domain, connectionId, () =>
					// Normalized shapes seam (uniform with listIssuesPage; serves Bitbucket via its override).
					integration.getMyIssuesForReposAsShapesResult(
						repos,
						{
							includeAllAssignees: true,
							cursor: cursor,
						},
						connectionId,
					),
				);
				if (issuesCaptured.warning != null) {
					warnings.push(issuesCaptured.warning);
				}
				const issuesAssessment = mergeAssessmentInto(
					warnings,
					org.providerId,
					domain,
					connectionId,
					issuesCaptured.value?.metadata,
				);
				const issuesFetchFailed =
					issuesAssessment.fetchFailed || (issuesCaptured.warning != null && issuesCaptured.value == null);
				const items: IssueShape[] = [];
				let hasMore = false;
				let nextCursor: string | undefined;
				// Carry a truncation signal from the issue read too: a provider that couldn't confirm it drained
				// a repo (`paging.truncated`) means this org's issues may be incomplete, on top of any repo-drain
				// truncation already captured above.
				let issuesTruncated = false;
				if (issuesCaptured.value != null) {
					items.push(...issuesCaptured.value.values);
					const paged = this.toProviderPageInfo(
						issuesCaptured.value.values.length,
						issuesCaptured.value.paging,
					);
					hasMore = paged.hasMore;
					nextCursor = paged.cursor;
					issuesTruncated = paged.truncated || issuesAssessment.truncated;
				}

				return {
					items: items,
					warnings: warnings,
					broadenedProviderIds: issuesCaptured.value != null ? [org.providerId] : ([] as IntegrationIds[]),
					providerId: org.providerId,
					org: org.name,
					connectionId: connectionId,
					nextCursor: nextCursor,
					hasMore: hasMore,
					// Exhausted once a successful read reports no more pages — recorded in the cursor so later
					// rounds skip it while other orgs keep paging.
					exhausted: issuesCaptured.value != null && !hasMore,
					fetchFailed: fetchFailed || issuesFetchFailed,
					truncated: truncated || issuesTruncated,
				};
			}),
		);

		const items: IssueShape[] = [];
		const warnings: ProviderWarning[] = [];
		const broadenedProviderIds = new Set<IntegrationIds>();
		const cursors: { providerId: IntegrationIds; org: string; connectionId?: string; cursor: string }[] = [];
		const exhausted: { providerId: IntegrationIds; org: string; connectionId?: string }[] = [];
		let hasMore = false;
		let fetchFailed = false;
		let truncated = false;
		for (const result of results) {
			if (result == null) {
				continue;
			}

			items.push(...result.items);
			warnings.push(...result.warnings);
			for (const id of result.broadenedProviderIds) {
				broadenedProviderIds.add(id);
			}
			if (result.nextCursor != null) {
				cursors.push({
					providerId: result.providerId,
					org: result.org,
					connectionId: result.connectionId,
					cursor: result.nextCursor,
				});
			}
			if (result.exhausted) {
				exhausted.push({ providerId: result.providerId, org: result.org, connectionId: result.connectionId });
			}
			if (result.hasMore) {
				hasMore = true;
			}
			if (result.fetchFailed) {
				fetchFailed = true;
			}
			if (result.truncated) {
				truncated = true;
			}
		}

		const cursor = this.toBroadenIssuesCursor(cursors, exhausted, options.orgs.length);
		return {
			items: items,
			warnings: warnings,
			page: { currentPage: page, itemsPerPage: items.length, truncated: truncated || undefined },
			// `hasMore` promises a resumable continuation, so it must be true ONLY when a real cursor was
			// produced. Repo-drain truncation (a backstop hit with no persisted repo cursor) can't be resumed —
			// re-invoking would re-drain the same repos and repeat issues — so it is surfaced as the terminal
			// `page.truncated` incompleteness signal instead of `hasMore`, matching listRepos. Guard `hasMore`
			// against a missing cursor so we never advertise a continuation the caller can't make.
			hasMore: hasMore && cursor != null,
			cursor: cursor,
			fetchFailed: fetchFailed || undefined,
			broadenedProviderIds: [...broadenedProviderIds],
			fanOutCount: options.orgs.length,
		};
	}

	/** Maps an integration id to the git-remote provider type used by the remote-URL matcher. */
	private remoteProviderTypeForIntegration(id: IntegrationIds): RemoteProviderId | undefined {
		switch (id) {
			case GitCloudHostIntegrationId.GitHub:
			case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
				return 'github';
			case GitCloudHostIntegrationId.GitLab:
			case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
				return 'gitlab';
			case GitCloudHostIntegrationId.Bitbucket:
				return 'bitbucket';
			case GitSelfManagedHostIntegrationId.BitbucketServer:
				return 'bitbucket-server';
			case GitCloudHostIntegrationId.AzureDevOps:
			case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
				return 'azure-devops';
			default:
				return undefined;
		}
	}

	/** Normalizes a host remote-config `type` string (e.g. `'GitHub'`) to a git-remote provider type. */
	private remoteProviderTypeForConfig(type: string): RemoteProviderId | undefined {
		switch (type.toLowerCase()) {
			case 'github':
				return 'github';
			case 'gitlab':
				return 'gitlab';
			case 'bitbucket':
				return 'bitbucket';
			case 'bitbucket-server':
			case 'bitbucketserver':
				return 'bitbucket-server';
			case 'azuredevops':
			case 'azure-devops':
				return 'azure-devops';
			case 'gitea':
				return 'gitea';
			case 'gerrit':
				return 'gerrit';
			default:
				return undefined;
		}
	}

	/**
	 * Resolves a repository from a remote URL to its provider identity, using core-gitlens' remote matcher
	 * plus the provider's `getRepo` (the equivalent of `gk repo resolve`). Supports every provider whose
	 * client exposes `getRepo`. Per-request outcomes preserve the distinctions Kepler needs for its
	 * canonicalization policy; `cliUnsupported` remains false because this resolver operation is available.
	 */
	async resolveRepository(options: {
		providerId?: IntegrationIds;
		remoteUrl: string;
		host?: string;
		connectionId?: string;
	}): Promise<ResolveRepositoryResult> {
		const result = (status: RepositoryResolution['status']): ResolveRepositoryResult => ({
			resolution: { status: status },
			cliUnsupported: false,
		});

		const [scheme, parsedDomain, path] = parseGitRemoteUrl(options.remoteUrl);

		// Matcher configs: host remote configs (self-managed/custom domains) plus a synthetic entry for an
		// explicit providerId + host, so a custom domain still maps to the right provider for path parsing.
		const configs: RemoteProviderConfig[] = [];
		for (const cfg of this.ctx.config.getRemoteConfigs()) {
			const type = this.remoteProviderTypeForConfig(cfg.type);
			if (type == null) continue;

			// Forward both domain- and regex-based custom remotes (carrying any protocol override), so a
			// regex-configured host resolves instead of falling through to `unsupported`.
			if (cfg.domain) {
				configs.push({ type: type, domain: cfg.domain, protocol: cfg.protocol });
			} else if (cfg.regex) {
				configs.push({ type: type, regex: cfg.regex, protocol: cfg.protocol });
			}
		}
		if (options.providerId != null) {
			const type = this.remoteProviderTypeForIntegration(options.providerId);
			const domain = options.host ?? parsedDomain;
			if (type != null && domain) {
				// The synthetic exact-domain entry is unshifted to the front, so it wins the match over the
				// user's own config for the same host. Carry that config's protocol override across (matched by
				// domain or regex, mirroring `ignoreSSLErrors`) so a self-managed host configured for a custom
				// protocol — e.g. plain `http` — isn't silently downgraded to the provider default here.
				const lowerDomain = domain.toLowerCase();
				const protocol = configs.find(c => {
					if (c.type !== type) return false;
					if (c.domain != null) return c.domain.toLowerCase() === lowerDomain;

					// Truthy (not just non-null): an empty regex would compile to a match-everything pattern.
					if (c.regex) {
						try {
							return new RegExp(c.regex, 'i').test(lowerDomain);
						} catch {
							return false;
						}
					}

					return false;
				})?.protocol;
				configs.unshift({ type: type, domain: domain, protocol: protocol });
			}
		}

		const matcherDomain = options.host ?? parsedDomain;
		const provider = createRemoteProviderMatcher(configs)(options.remoteUrl, matcherDomain, path, scheme);
		if (provider == null) return result('invalid-remote-url');

		let id = options.providerId ?? getIntegrationIdForRemote(provider);
		// Custom Azure DevOps Server domains matched via getRemoteConfigs return undefined from
		// getIntegrationIdForRemote because the provider is marked custom; map them to the server id so the
		// unsupported check below is explicit and consistent.
		if (id == null && provider.id === 'azure-devops' && provider.custom) {
			id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		}
		if (id == null) return result('unsupported-provider');

		// Azure DevOps Server is not supported by the shared provider-api getRepo routing; only the cloud Azure
		// DevOps implementation handles project-scoped repo lookups. Resolving a server URL here would call the
		// wrong backend and fail silently or misleadingly.
		if (id === GitSelfManagedHostIntegrationId.AzureDevOpsServer) return result('unsupported-provider');

		const owner = provider.owner;
		const name = provider.repoName;
		if (owner == null || name == null) return result('invalid-remote-url');

		// When pinning to a specific connection on a self-managed host, the connection's configured domain must
		// match the host parsed from the URL. Otherwise we'd resolve `owner/repo` against a different host's
		// account — and if that host happens to have the same owner/repo, return a confidently wrong identity.
		if (options.connectionId != null && isGitSelfManagedHostIntegrationId(id)) {
			// Normalize BOTH sides before comparing: the stored connection domain is usually a full URL
			// (`https://git.example.com`), while `urlHost` is already a bare host. Comparing the raw stored
			// value against the normalized host would fail on scheme/trailing-slash alone and wrongly reject a
			// correctly-configured connection as `no-connection`.
			const connectionHost = hostFromDomain(this.getConfiguredConnectionDomain(id, options.connectionId));
			const urlHost = hostFromDomain(provider.domain);
			if (connectionHost != null && urlHost != null && connectionHost !== urlHost) {
				return result('host-mismatch');
			}
		}

		let integration: Integration | undefined;
		try {
			// When a specific connection is requested, resolve the instance by the connection's configured
			// domain (as `getIntegrationForRead` does): `resolveReadSession` looks the session up against the
			// instance's domain-scoped descriptor, so selecting the instance by the URL domain could miss the
			// session and degrade to `no-connection`.
			integration =
				options.connectionId != null
					? await this.getIntegrationForRead(id, options.connectionId)
					: await this.get(id, provider.domain);
		} catch {
			integration = undefined;
		}
		if (integration == null) {
			return result('unauthorized');
		}
		// Issue trackers have no `getRepo` client; a git host without `getRepoFn` leaves `getRepoInfo`
		// undefined. Either way this provider can't resolve repositories.
		if (isIssuesIntegration(integration) || integration.getRepoInfo == null) {
			return result('unsupported-provider');
		}

		// Azure repos are org + project scoped; the remote provider exposes project as `providerDesc.repoDomain`.
		const project = provider.id === 'azure-devops' ? provider.providerDesc?.repoDomain : undefined;
		const domain = provider.domain;

		try {
			const repo = await integration.getRepoInfo({
				owner: owner,
				name: name,
				project: project,
				connectionId: options.connectionId,
			});
			if (repo == null) {
				// `getRepoInfo` returns undefined only when no session could be resolved (not connected, or the
				// requested connection is gone) — a real 404 throws below. So this is a connection gap.
				return result('unauthorized');
			}

			// Prefer the provider's canonical namespace/name (GitHub's REST/GraphQL lookup follows the 301
			// rename redirect, so a stale old name resolves to the new canonical identity), falling back to the
			// parsed remote when the response omits them. `renamed` is a case-insensitive compare of input vs
			// canonical, mirroring gkcli's `EqualFold`, so hosts that merely echo the input casing (e.g.
			// Bitbucket Server/Azure) don't get spuriously flagged.
			const canonicalOwner = repo.namespace || owner;
			const canonicalName = repo.name || name;
			const renamed =
				canonicalOwner.toLowerCase() !== owner.toLowerCase() ||
				canonicalName.toLowerCase() !== name.toLowerCase();

			const identity: RepositoryIdentity = {
				providerId: id,
				domain: domain,
				owner: canonicalOwner,
				name: canonicalName,
				project: project,
				remoteUrl: options.remoteUrl,
				renamed: renamed,
			};
			return { resolution: { status: 'resolved', identity: identity }, cliUnsupported: false };
		} catch (ex) {
			// Order matters: 404 throws RequestNotFoundError (not `undefined`), so check not-found before auth
			// and before the generic 5xx/unknown bucket — never classify a 401/403 as not-found.
			let resolution: RepositoryResolution;
			if (ex instanceof RequestNotFoundError) {
				resolution = { status: 'not-found' };
			} else if (ex instanceof AuthenticationError) {
				resolution = {
					status: 'unauthorized',
					warning: toProviderWarning(id, domain, options.connectionId, ex),
				};
			} else {
				resolution = {
					status: 'undetermined',
					warning: toProviderWarning(id, domain, options.connectionId, ex),
				};
			}
			return { resolution: resolution, cliUnsupported: false };
		}
	}

	// #endregion ProviderBackend surface (#5438)

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	ignoreSSLErrors(integration: GitHostIntegration | { id: IntegrationIds; domain?: string }): boolean | 'force' {
		if (this.ctx.http.isWeb) return false;

		// Key by id + domain: the config lookup is domain-scoped, so a value computed for one self-managed
		// domain must not be reused for another domain of the same provider.
		const cacheKey = `${integration.id}:${integration.domain ?? ''}`;
		let ignoreSSLErrors = this._ignoreSSLErrors.get(cacheKey);
		if (ignoreSSLErrors === undefined) {
			// Normalize both sides to a RemoteProviderId before comparing: a lowercased config type
			// (e.g. `AzureDevOps` → `azuredevops`, `BitbucketServer` → `bitbucketserver`) does not equal the
			// integration id (`azureDevOps`, `bitbucket-server`), so a plain `toLowerCase()` compare misses them.
			const integrationRemoteType = this.remoteProviderTypeForIntegration(integration.id);
			const cfg = this.ctx.config.getRemoteConfigs().find(remote => {
				if (integration.domain == null || integrationRemoteType == null) return false;
				if (this.remoteProviderTypeForConfig(remote.type) !== integrationRemoteType) return false;
				// Match domain- and regex-based remotes alike, so `ignoreSSLErrors` applies to a regex-configured
				// self-managed host too (mirrors the matcher's own regex handling).
				if (remote.domain != null) return remote.domain === integration.domain;

				// Truthy (not just non-null): an empty regex would compile to a match-everything pattern.
				if (remote.regex) {
					try {
						return new RegExp(remote.regex, 'i').test(integration.domain);
					} catch {
						return false;
					}
				}
				return false;
			});
			ignoreSSLErrors = cfg?.ignoreSSLErrors ?? false;
			this._ignoreSSLErrors.set(cacheKey, ignoreSSLErrors);
		}

		return ignoreSSLErrors;
	}

	@debug()
	async manageCloudIntegrations(source: Source | undefined): Promise<void> {
		this.ctx.hooks?.connection?.onManaged?.(source);

		// The host owns the GK-Dev manage interaction (sign-in if needed, open settings, wait for the user
		// to return); it resolves `true` once they're back, then we re-sync + report.
		if (!(await this.ctx.account.openManagement(source))) return;

		const connected = await this.syncCloudIntegrations(true);
		this.ctx.hooks?.connection?.onCompleted?.(
			{
				integrationIds: undefined,
				connectedIntegrationIds: connected != null ? [...connected.values()] : undefined,
			},
			source,
		);
	}

	@debug()
	async reset(): Promise<void> {
		for (const integration of this._integrations.values()) {
			await integration.reset();
		}

		await this.authenticationService.reset();
		await this.ctx.storage.deleteWithPrefix('provider:authentication:skip');
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

		const connected = reason === 'connected';
		if (integration.type === 'git') {
			this.ctx.hooks?.connection?.onStateChanged?.({
				id: integration.id,
				key: key,
				connected: connected,
				kind: isSupportedCloudIntegrationId(integration.id) ? 'hosting' : 'remote',
			});
		} else {
			this.ctx.hooks?.connection?.onStateChanged?.({
				id: integration.id,
				key: key,
				connected: connected,
				kind: 'issue',
			});
		}

		setTimeout(() => this._onDidChangeConnectionState.fire({ key: key, reason: reason }), 250);
	}

	private async onSubscriptionChanged() {
		// When the account goes away, disconnect all connected cloud integrations. Mirrors the host's
		// historical `account == null` check (the host forwards `onDidChange` without a payload).
		if ((await this.ctx.account.getAccount()) == null) {
			void this.syncCloudIntegrations(false);
		}
	}

	private onUserCheckedIn(e?: { force?: boolean }) {
		void this.syncCloudIntegrations(Boolean(e?.force));
	}

	private _providersApi: Promise<ProvidersApi> | undefined;
	private async getProvidersApi() {
		if (this._providersApi == null) {
			const authenticationService = this.authenticationService;
			async function load() {
				return new (
					await import(/* webpackChunkName: "integrations" */ './providers/providersApi.js')
				).ProvidersApi(authenticationService);
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

	private async *getSupportedCloudIntegrations(
		domainsById: Map<IntegrationIds, Set<string>>,
	): AsyncIterable<Integration> {
		for (const id of getSupportedCloudIntegrationIds()) {
			if (isCloudGitSelfManagedHostIntegrationId(id)) {
				const domains = new Set(domainsById.get(id) ?? []);
				for (const domain of this.configuredIntegrationService
					.getConfigured(id, { cloud: true })
					.map(c => c.domain)
					.filter((domain): domain is string => domain != null && domain.length > 0)) {
					domains.add(domain);
				}

				if (domains.size !== 0) {
					for (const domain of domains) {
						const integration = await this.get(id, domain);
						if (integration != null) {
							yield integration;
						}
					}

					continue;
				}

				// Try getting whatever we have now because we will need to disconnect.
				const integration = await this.get(id, undefined);
				if (integration != null) {
					yield integration;
				}

				continue;
			}

			const integration = await this.get(id);
			if (integration != null) {
				yield integration;
			}
		}
	}

	private getCloudConnectionState(
		integration: Integration,
		connectedIntegrations: Set<IntegrationIds>,
		domainsById: Map<IntegrationIds, Set<string>>,
	): 'connected' | 'disconnected' {
		if (isCloudGitSelfManagedHostIntegrationId(integration.id)) {
			return domainsById.get(integration.id)?.has(integration.domain) ? 'connected' : 'disconnected';
		}

		return connectedIntegrations.has(integration.id) ? 'connected' : 'disconnected';
	}

	private findCachedById<T extends IntegrationIds>(id: T): IntegrationById<T> | undefined {
		const cached = this._integrations.get(id as IntegrationKey);
		if (cached != null) return cached as IntegrationById<T>;

		const key = `${id}:`;
		for (const [k, integration] of this._integrations) {
			if (k.startsWith(key)) {
				return integration as IntegrationById<T>;
			}
		}
		return undefined;
	}

	private getCachedForDomain<T extends IntegrationIds>(id: T, domain?: string): IntegrationById<T> | undefined {
		return isGitSelfManagedHostIntegrationId(id) ? this.getCached(id, domain) : this.findCachedById(id);
	}

	private getConfiguredConnectionDomain(id: IntegrationIds, connectionId: string): string | undefined {
		if (!isGitSelfManagedHostIntegrationId(id)) return undefined;
		return this.configuredIntegrationService.getConfigured(id).find(c => c.id === connectionId)?.domain;
	}

	private getCloudPrimaryConnectionIdsByDomain(id: IntegrationIds): Map<string | undefined, string> {
		const primaryByDomain = new Map<string | undefined, string>();
		const fallbackByDomain = new Map<string | undefined, string>();

		for (const descriptor of this.configuredIntegrationService.getConfigured(id, { cloud: true })) {
			const domain = isGitSelfManagedHostIntegrationId(id) ? descriptor.domain : undefined;
			if (!fallbackByDomain.has(domain)) {
				fallbackByDomain.set(domain, descriptor.id);
			}
			if (descriptor.primary && !primaryByDomain.has(domain)) {
				primaryByDomain.set(domain, descriptor.id);
			}
		}

		for (const [domain, connectionId] of fallbackByDomain) {
			if (!primaryByDomain.has(domain)) {
				primaryByDomain.set(domain, connectionId);
			}
		}

		return primaryByDomain;
	}

	@gate()
	@trace()
	private async syncCloudIntegrations(forceConnect: boolean) {
		const scope = getScopedLogger();
		const connectedIntegrations = new Set<IntegrationIds>();
		const domainsById = new Map<IntegrationIds, Set<string>>();
		const connectionsById = new Map<IntegrationIds, CloudIntegrationConnection[]>();

		const loggedIn = (await this.ctx.account.getAccount()) != null;
		if (loggedIn) {
			const connections = await this.authenticationService.cloudIntegrations.getConnections();
			if (connections == null) return;

			for (const p of connections) {
				const integrationId = toIntegrationId[p.provider];
				// GKDev includes some integrations like "google" that we don't support
				if (integrationId == null) continue;

				connectedIntegrations.add(integrationId);

				const list = connectionsById.get(integrationId);
				if (list != null) {
					list.push(p);
				} else {
					connectionsById.set(integrationId, [p]);
				}

				if (p.domain?.length > 0) {
					const host = hostFromDomain(p.domain);
					if (host != null) {
						let domains = domainsById.get(integrationId);
						if (domains == null) {
							domains = new Set<string>();
							domainsById.set(integrationId, domains);
						}
						domains.add(host);
					} else {
						scope?.warn(`Invalid domain for ${integrationId} integration: ${p.domain}. Ignoring.`);
					}
				}
			}
		}

		for await (const integration of this.getSupportedCloudIntegrations(domainsById)) {
			await integration.syncCloudConnection(
				this.getCloudConnectionState(integration, connectedIntegrations, domainsById),
				forceConnect,
			);
		}

		// Persist every account when the backend advertises per-connection identity (multi-account). This
		// is a strict no-op for backends that return a single, id-less connection per provider.
		for (const [integrationId, connections] of connectionsById) {
			await this.reconcileCloudConnections(integrationId, connections, forceConnect);
		}

		this.ctx.hooks?.connection?.onConnectedChanged?.({
			integrationIds: [...connectedIntegrations.values()],
		});

		return connectedIntegrations;
	}

	/**
	 * Whether the user has locally disconnected this provider/host. Mirrors the integration model's
	 * `connected:${key}` workspace flag (key = id for cloud, `${id}:${domain}` for self-managed), which is
	 * set to `false` on a local disconnect and cleared on (re)connect.
	 */
	private isLocallyDisconnected(id: IntegrationIds, host: string | undefined): boolean {
		const key = isGitSelfManagedHostIntegrationId(id) ? `connected:${id}:${host ?? ''}` : `connected:${id}`;
		return this.ctx.storage.getWorkspace<boolean>(key) === false;
	}

	/**
	 * Reconciles the locally stored connections for a provider with what the backend reports, so that
	 * multiple accounts on the same provider coexist. Only engages when the backend provides
	 * per-connection ids; otherwise the single-connection flow above already handled the primary.
	 */
	private async reconcileCloudConnections(
		id: IntegrationIds,
		connections: CloudIntegrationConnection[],
		forceConnect: boolean,
	): Promise<void> {
		const scope = getScopedLogger();

		const identified = connections.filter((c): c is CloudIntegrationConnection & { id: string } => c.id != null);
		if (identified.length === 0) return;

		// Capture the effective primary before any mutation (sync store, prune-driven promotion, or the
		// backend primary selection below) so we can tell whether it actually changed. The prune step can
		// promote a secondary to primary via removeConfigured, so sampling this after pruning would miss it.
		const primaryBefore = this.getCloudPrimaryConnectionIdsByDomain(id);

		const cloudIntegrations = this.authenticationService.cloudIntegrations;

		// Fetch + store each connection's session so getConfigured() reflects every account.
		const syncedIds = new Set<string>();
		const syncEligibleIds = new Set<string>();
		const syncedPrimaryIdsByDomain = new Map<string | undefined, string>();
		// Snapshot existing cloud descriptors by id once, so the per-connection account-name lookup below is
		// O(1) instead of re-filtering the whole configured list each iteration (O(n²) with multi-account).
		// Each backend connection id is processed once, so reading the pre-loop snapshot is sufficient.
		const existingById = new Map(
			this.configuredIntegrationService.getConfigured(id, { cloud: true }).map(c => [c.id, c]),
		);
		for (const connection of identified) {
			// The wire `domain` is usually a full URL, though cloud providers can return a bare host.
			// Self-managed integrations are keyed/constructed by host.
			const host = hostFromDomain(connection.domain);

			// Self-managed connections are keyed by host, so an unparseable/empty domain would store the
			// session and descriptor under an empty host — producing ambiguous keys (`connected:<id>:`) that
			// break later resolution and local-disconnect checks. Skip such a connection rather than corrupt
			// state; cloud providers key off their canonical domain and are unaffected.
			if (isGitSelfManagedHostIntegrationId(id) && !host) {
				scope?.warn(`Skipping connection '${connection.id}' for ${id}: unresolved host from domain`);
				continue;
			}

			// Don't resurrect a connection the user disconnected locally: a host "disconnect" only clears
			// local state (the backend still lists the token), so without this the next non-forced sync would
			// re-store the secret/config. A forced reconnect clears this flag (in the sync loop above) before
			// reconcile runs, so it proceeds normally.
			if (this.isLocallyDisconnected(id, host)) continue;

			syncEligibleIds.add(connection.id);

			// On a routine (non-forced) check-in, skip the token fetch + secret write for a connection we
			// already have stored and that hasn't expired: nothing to refresh, so avoid the extra GK API
			// traffic and secret churn. Still treat it as synced (so it doesn't trip the prune guard) and
			// record its primary below. Forced syncs, new connections, and expired tokens fall through and
			// fetch as before.
			const cached = existingById.get(connection.id);
			if (!forceConnect && cached != null && !isDescriptorExpired(cached)) {
				syncedIds.add(connection.id);
				if (connection.primary) {
					const domain = isGitSelfManagedHostIntegrationId(id) ? host : undefined;
					if (!syncedPrimaryIdsByDomain.has(domain)) {
						syncedPrimaryIdsByDomain.set(domain, connection.id);
					}
				}
				continue;
			}

			try {
				const session = await cloudIntegrations.getConnectionSession(id, undefined, connection.id);
				if (session == null) continue;

				let providerSession = toProviderSession(id, connection, session, host);

				// Resolve a human-readable account handle with the same precedence as the gk CLI:
				// (1) the value the backend put on the connection, (2) a previously-resolved name cached in
				// our configured store (keyed by connection id), (3) a live provider-API lookup. This keeps
				// provider round-trips to the first sight of a connection; degrade to undefined on failure.
				const existing = existingById.get(connection.id);
				const accountName =
					normalizeAccountName(connection.accountName) ??
					normalizeAccountName(existing?.accountName) ??
					(await this.resolveAccountName(id, host, providerSession));
				if (accountName != null) {
					providerSession = {
						...providerSession,
						account: { ...providerSession.account, label: accountName },
					};
				}

				await this.configuredIntegrationService.storeSession(id, providerSession);
				syncedIds.add(connection.id);
				if (connection.primary) {
					const domain = isGitSelfManagedHostIntegrationId(id) ? host : undefined;
					if (!syncedPrimaryIdsByDomain.has(domain)) {
						syncedPrimaryIdsByDomain.set(domain, connection.id);
					}
				}
			} catch (ex) {
				scope?.warn(
					`Failed to sync connection '${connection.id}' for ${id}: ${ex instanceof Error ? ex.message : String(ex)}`,
				);
			}
		}

		// Prune stored cloud connections that no longer exist on the backend — but only when every backend
		// connection that should sync did sync this cycle. Otherwise a transient token fetch failure would
		// delete a still-valid connection with no replacement (e.g. a legacy single connection during the
		// backend id rollout); defer pruning to a later clean cycle. Deliberately skipped connections (local
		// disconnects or invalid self-managed hosts) don't block pruning of unrelated stale descriptors.
		// Scope deletes to cloud so a local PAT sharing the id survives.
		const prunedDomains = new Set<string | undefined>();
		if ([...syncEligibleIds].every(connectionId => syncedIds.has(connectionId))) {
			const liveIds = new Set(identified.map(c => c.id));
			for (const descriptor of this.configuredIntegrationService.getConfigured(id, { cloud: true })) {
				if (!liveIds.has(descriptor.id)) {
					prunedDomains.add(isGitSelfManagedHostIntegrationId(id) ? descriptor.domain : undefined);
					await this.configuredIntegrationService.deleteConnection(id, descriptor.id, true);
				}
			}
		}

		// Apply the backend's primary selection, then refresh any warm model only when the effective primary
		// actually changed (vs the pre-reconcile value captured above). switchConnection() drops the in-memory
		// session and fires change events, so calling it on every check-in (when the primary is unchanged)
		// causes needless churn for multi-account providers. Self-managed providers can have one primary per
		// host, so apply and refresh by host scope rather than by provider id alone.
		for (const connectionId of syncedPrimaryIdsByDomain.values()) {
			await this.configuredIntegrationService.setPrimaryConnection(id, connectionId);
		}
		const primaryAfter = this.getCloudPrimaryConnectionIdsByDomain(id);
		const domains = new Set<string | undefined>(primaryBefore.keys());
		for (const domain of primaryAfter.keys()) {
			domains.add(domain);
		}
		for (const domain of prunedDomains) {
			domains.add(domain);
		}
		for (const domain of domains) {
			if (primaryBefore.get(domain) === primaryAfter.get(domain) && !prunedDomains.has(domain)) continue;

			this.getCachedForDomain(id, domain)?.switchConnection();
		}
	}

	/**
	 * Switches the default connection for a provider to `connectionId` (its backend token id). Performs
	 * the server-side primary switch first, then mirrors it locally and refreshes any warm model. Throws
	 * if the backend switch fails so the caller can surface it (local state stays untouched).
	 */
	async setPrimaryConnection(id: IntegrationIds, connectionId: string): Promise<void> {
		const domain = this.getConfiguredConnectionDomain(id, connectionId);
		if (!(await this.authenticationService.cloudIntegrations.setPrimaryConnection(id, connectionId))) {
			throw new Error(`Failed to set primary connection '${connectionId}' for '${id}'`);
		}

		await this.configuredIntegrationService.setPrimaryConnection(id, connectionId);
		this.getCachedForDomain(id, domain)?.switchConnection();
	}

	/**
	 * Removes a single connection for a provider by its backend token id. The backend removes the
	 * connection (auto-promoting a secondary to primary when the removed one was primary); we then mirror
	 * that locally and refresh any warm model. Unlike {@link IntegrationBase.disconnect}, this targets one
	 * account. This always talks to the cloud backend, so the local mirror defaults to cloud-scoped too —
	 * pass `cloud: false` only if a caller genuinely needs to also drop a local PAT sharing the same id.
	 * Throws if the backend delete fails so the caller can surface it (local state stays untouched).
	 */
	async deleteConnection(id: IntegrationIds, connectionId: string, cloud: boolean = true): Promise<void> {
		const domain = this.getConfiguredConnectionDomain(id, connectionId);
		if (!(await this.authenticationService.cloudIntegrations.disconnectConnection(id, connectionId))) {
			throw new Error(`Failed to delete connection '${connectionId}' for '${id}'`);
		}

		await this.configuredIntegrationService.deleteConnection(id, connectionId, cloud);
		this.getCachedForDomain(id, domain)?.switchConnection();
	}

	/**
	 * Resolves a human-readable account handle (e.g. the GitHub login) for a connection by asking the
	 * provider API with that connection's token. The token backend doesn't expose it. Routes through the
	 * integration model so the correct provider API base URL (incl. self-managed domains) and auth type
	 * are used. Best-effort: returns undefined on any failure so callers degrade gracefully.
	 */
	private async resolveAccountName(
		id: IntegrationIds,
		host: string | undefined,
		session: ProviderAuthenticationSession,
	): Promise<string | undefined> {
		const scope = getScopedLogger();
		try {
			// Route through the integration so the correct provider API base URL (incl. the self-managed
			// host) and auth type are used. Cloud providers ignore the host.
			const integration = await this.get(id, host);
			const account = await integration?.getProviderAccountForSession(session);
			return account?.username ?? account?.name ?? undefined;
		} catch (ex) {
			scope?.warn(`Failed to resolve account name for '${id}': ${ex instanceof Error ? ex.message : String(ex)}`);
			return undefined;
		}
	}

	/**
	 * Forces a refresh of connected cloud integrations from the backend (equivalent to a "--sync" list),
	 * reconciling local state (multi-account connections, primary flags, account names) so a subsequent
	 * {@link getConfigured} reflects the latest server-side connections. Intended for consumers that need
	 * an up-to-date connection list on demand.
	 */
	async refreshConnections(): Promise<void> {
		await this.syncCloudIntegrations(true);
	}
}

/** Internal factory used by the GitLens host and integration tests that need the full service surface. */
export function createIntegrationService(ctx: IntegrationServiceContext): IntegrationService {
	const configured = new ConfiguredIntegrationService(ctx);
	const cloud = new CloudIntegrationService(ctx);
	let service: IntegrationService;
	const auth = new IntegrationAuthenticationService(configured, ctx, () => service, cloud);
	service = new IntegrationService(auth, configured, ctx);
	void purgeRetiredIntegrationStorage(ctx, configured);
	return service;
}

const retiredIntegrationsStorageKey = 'integrations:migrated:cloudOnly';
async function purgeRetiredIntegrationStorage(
	ctx: IntegrationServiceContext,
	configured: ConfiguredIntegrationService,
): Promise<void> {
	if (ctx.storage.get<boolean>(retiredIntegrationsStorageKey)) return;

	try {
		await configured.purgeStoredConfiguration(['github-enterprise', 'gitlab-self-hosted']);
		await ctx.storage.store(retiredIntegrationsStorageKey, true);
	} catch {
		// Best-effort cleanup retries on the next startup while the migration flag remains unset.
	}
}

/** Extracts the host from a backend connection domain (URL or bare host); undefined when unparseable/empty. */
function hostFromDomain(domain: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value) return undefined;

	if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) {
		try {
			return new URL(value).host || undefined;
		} catch {
			return undefined;
		}
	}

	try {
		return new URL(`https://${value}`).host || undefined;
	} catch {
		return undefined;
	}
}

function protocolFromDomain(domain: string | undefined): string | undefined {
	const value = domain?.trim();
	if (!value) return undefined;
	if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) return undefined;

	try {
		return new URL(value).protocol || undefined;
	} catch {
		return undefined;
	}
}

function normalizeAccountName(accountName: string | undefined): string | undefined {
	const value = accountName?.trim();
	return value ? value : undefined;
}

/**
 * Whether a stored connection descriptor's token has expired. A missing `expiresAt` is treated as
 * not-expired (non-expiring/legacy tokens, e.g. GitHub and self-managed cloud, carry no meaningful
 * expiry), matching the session-expiry checks elsewhere.
 */
function isDescriptorExpired(descriptor: ConfiguredIntegrationDescriptor): boolean {
	if (descriptor.expiresAt == null) return false;
	return new Date(descriptor.expiresAt).getTime() < Date.now();
}

function toProviderSession(
	id: IntegrationIds,
	connection: CloudIntegrationConnection & { id: string },
	session: {
		accessToken: string;
		expiresIn: number;
		scopes: string;
		type: CloudIntegrationConnection['type'];
		appKey?: string;
	},
	host: string | undefined,
): ProviderAuthenticationSession {
	// GitHub, the cloud self-managed hosts, and Trello return `expiresIn: 0` for a non-expiring token; left
	// as 0 the session's `expiresAt` would be `now` and rejected as expired on the next read. Map it to the
	// maximum expiry (mirrors the auth provider's own guard).
	const expiresIn =
		session.expiresIn === 0 && isNonExpiringZeroTokenIntegrationId(id) ? maxSmallIntegerV8 : session.expiresIn;
	const protocol = protocolFromDomain(connection.domain);

	return {
		id: connection.id,
		accessToken: session.accessToken,
		account: { id: '', label: '' },
		scopes: session.scopes ? session.scopes.split(',') : [],
		cloud: true,
		type: session.type,
		expiresAt: new Date(expiresIn * 1000 + Date.now()),
		// Self-managed connections are keyed by their host; cloud providers use the canonical domain.
		domain: isGitSelfManagedHostIntegrationId(id) ? (host ?? '') : (providersMetadata[id]?.domain ?? ''),
		...(protocol != null ? { protocol: protocol } : {}),
		// Carried for providers whose client needs an app key alongside the token (e.g. Trello).
		...(session.appKey != null ? { appKey: session.appKey } : {}),
	};
}
