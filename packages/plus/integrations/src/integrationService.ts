import type { Account } from '@gitlens/git/models/author.js';
import type { IssueSearchCriteria, IssueShape } from '@gitlens/git/models/issue.js';
import type {
	PullRequest,
	PullRequestSearchCriteria,
	PullRequestShape,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProviderId } from '@gitlens/git/models/remoteProvider.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
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
import type {
	CloudGitSelfManagedHostIntegrationIds,
	IntegrationIds,
	SupportedCloudIntegrationIds,
} from './constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from './constants.js';
import type {
	AuthenticationSessionsChangeEvent,
	IntegrationServiceContext,
	IntegrationsRemoteConfig,
} from './context.js';
import type {
	ClosedPullRequestSweepOptions,
	ListOrgsOptions,
	ListProjectsOptions,
	ProviderBroadenOrg,
	PullRequestSweepOptions,
} from './manager.js';
import type { GitHostIntegration, SearchMyPullRequestsOptions } from './models/gitHostIntegration.js';
import type {
	Integration,
	IntegrationBase,
	IntegrationById,
	IntegrationKey,
	IntegrationResult,
} from './models/integration.js';
import type { IssuesIntegration } from './models/issuesIntegration.js';
import type { ApiClients } from './providers/apiClients.js';
import { createApiClients } from './providers/apiClients.js';
import type { GitHubApi } from './providers/github/github.js';
import type {
	IssueFilter,
	IssueSorting,
	ProviderOrganization,
	ProviderReposInput,
	ProviderRepositoryShape,
	PullRequestFilter,
} from './providers/models.js';
import { providersMetadata } from './providers/models.js';
import type { ProvidersApi } from './providers/providersApi.js';
import { broadenIssues } from './reads/broaden.js';
import type { RepositoryResolutionContext } from './reads/context.js';
import type {
	IssueCountResult,
	IssueCountScope,
	PullRequestCountResult,
	PullRequestCountScope,
} from './reads/counts.js';
import { countIssues, countPullRequests } from './reads/counts.js';
import type { SupportedFilters } from './reads/filters.js';
import { getSupportedFilters } from './reads/filters.js';
import { listOrgs, listProjects, listRepos } from './reads/hierarchy.js';
import { listIssuesPage } from './reads/issues.js';
import { listIssueTrackerIssuesPage } from './reads/issueTracker.js';
import { listPullRequestsPage } from './reads/pullRequests.js';
import { resolveRepository } from './reads/resolveRepository.js';
import { searchIssuesPage } from './reads/searchIssues.js';
import { searchPullRequestsPage } from './reads/searchPullRequests.js';
import { sweepClosedPullRequests, sweepPullRequests } from './reads/sweeps.js';
import { noConnectionWarning } from './reads/warnings.js';
import type {
	ConnectionStateChangeEvent,
	ProviderBroadenResult,
	ProviderPagedResult,
	ProviderResult,
	ProviderSweepResult,
	ProviderWarning,
	ResolveRepositoryResult,
} from './results.js';
import type { Source } from './telemetry.js';
import { hostFromDomain } from './utils/domain.utils.js';
import {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationIdForRemote,
	isCloudGitSelfManagedHostIntegrationId,
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
	isNonExpiringZeroTokenIntegrationId,
	remoteProviderTypeForConfig,
	remoteProviderTypeForIntegration,
} from './utils/integration.utils.js';

/** @internal Event emitted when an integration connection state changes  */
export interface IntegrationConnectionChangeEvent extends ConnectionStateChangeEvent {
	integration: IntegrationBase;
}

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

export class IntegrationService implements Disposable, RepositoryResolutionContext {
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
		// Normalize to a bare host before anything keys off it. Callers pass a self-managed domain in both shapes
		// — a full URL from a stored session/descriptor, a bare host from `hostFromDomain` — and the cache key is
		// `${id}:${domain}`, so the same host arriving in two shapes would build two instances (and two
		// "primaries") for one host.
		if (isGitSelfManagedHostIntegrationId(id)) {
			domain = hostFromDomain(domain) ?? domain;
		}

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
	 * The filters this provider's reads accept — part of the public {@link IntegrationManager} contract, so it
	 * stays a method here even though it needs no instance state; see {@link getSupportedFilters} for the
	 * capability table itself and why a consumer should intersect against it before reading.
	 */
	getSupportedFilters(providerId: IntegrationIds): SupportedFilters {
		return getSupportedFilters(providerId);
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
	): Promise<IntegrationResult<IssueShape[] | undefined>> {
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
	): Promise<IntegrationResult<IssueShape[] | undefined>> {
		const start = performance.now();

		const promises: Promise<IntegrationResult<IssueShape[] | undefined>>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyIssuesResult(repos, cancellation));
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
					: new AggregateError(errors, 'Failed to get some issues');

		return {
			value: successfulResults,
			error: error,
			duration: performance.now() - start,
		};
	}

	async getMyIssuesForRemotes(remote: GitRemote): Promise<IntegrationResult<IssueShape[] | undefined>>;
	async getMyIssuesForRemotes(remotes: GitRemote[]): Promise<IntegrationResult<IssueShape[] | undefined>>;
	@trace({
		args: (remoteOrRemotes: GitRemote | GitRemote[]) => ({
			remoteOrRemotes: Array.isArray(remoteOrRemotes) ? remoteOrRemotes.map(rp => rp.name) : remoteOrRemotes.name,
		}),
	})
	async getMyIssuesForRemotes(
		remoteOrRemotes: GitRemote | GitRemote[],
	): Promise<IntegrationResult<IssueShape[] | undefined>> {
		if (!Array.isArray(remoteOrRemotes)) {
			remoteOrRemotes = [remoteOrRemotes];
		}

		if (!remoteOrRemotes.length) return undefined;
		if (remoteOrRemotes.length === 1) {
			const [remote] = remoteOrRemotes;
			if (remote?.provider == null) return undefined;

			const integration = await this.getByRemote(remote);
			return integration?.searchMyIssuesResult(remote.provider.repoDesc);
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
	 * Warnings for an early-returning read where the integration couldn't be resolved. When a specific
	 * `connectionId` or self-managed `domain` was requested, a missing integration means that target is
	 * unavailable — surface a `no-connection` warning + `fetchFailed` so the caller can tell it apart from
	 * a truly empty account. Without an explicit target, it's simply not connected, which stays a silent
	 * empty result.
	 */
	earlyReturnConnectionWarnings(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain?: string,
	): { warnings: ProviderWarning[]; fetchFailed: boolean } {
		const requestedDomain = isGitSelfManagedHostIntegrationId(id) ? domain : undefined;
		const invalidDomain = this.isEmptyExplicitSelector(domain);
		if (connectionId == null && requestedDomain == null && !invalidDomain) {
			return { warnings: [], fetchFailed: false };
		}

		const resolvedDomain = invalidDomain
			? domain?.trim()
			: this.resolveDomainForRead(id, connectionId, requestedDomain);
		return { warnings: [noConnectionWarning(id, resolvedDomain, connectionId)], fetchFailed: true };
	}

	private isEmptyExplicitSelector(value: string | undefined): boolean {
		return value?.trim().length === 0;
	}

	domainForRead(
		integration: Integration,
		id: IntegrationIds,
		connectionId: string | undefined,
		domain?: string,
	): string | undefined {
		if (!isGitSelfManagedHostIntegrationId(id)) {
			return connectionId != null ? this.getConfiguredConnectionDomain(id, connectionId) : integration.domain;
		}

		return this.resolveDomainForRead(id, connectionId, domain) ?? integration.domain;
	}

	/**
	 * Resolves the right integration instance for a read. A configured connection domain takes precedence over
	 * an explicit fallback domain; the latter lets external/manual authentication providers address a
	 * self-managed host without persisting `ConfiguredIntegrationService` state.
	 */
	async getIntegrationForRead(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain?: string,
	): Promise<Integration | undefined> {
		// Empty explicit selectors are invalid targets, not an instruction to fall back to the primary
		// connection. Keep this at the common read boundary so every public surface behaves consistently.
		if (this.isEmptyExplicitSelector(connectionId) || this.isEmptyExplicitSelector(domain)) return undefined;

		const resolvedDomain = this.resolveDomainForRead(id, connectionId, domain);
		try {
			return await this.get(id, resolvedDomain);
		} catch {
			return undefined;
		}
	}

	resolveDomainForRead(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain: string | undefined,
	): string | undefined {
		if (!isGitSelfManagedHostIntegrationId(id)) return undefined;

		return (
			(connectionId != null ? this.getConfiguredConnectionDomain(id, connectionId) : undefined) ??
			hostFromDomain(domain) ??
			// With no explicit target, pin the primary configured host rather than leaving the domain undefined:
			// `get(id, undefined)` falls back to `findCachedById`, which returns the FIRST entry by Map insertion
			// order. With two hosts of the same provider that makes the instance depend on which host happened to
			// be constructed first, so orgs/repos could come from one host and PRs from another in the same UI.
			this.primaryConfiguredDomain(id)
		);
	}

	/** The primary configured host for a self-managed provider (first configured when none is flagged primary). */
	private primaryConfiguredDomain(id: IntegrationIds): string | undefined {
		const configured = this.getConfigured(id);
		return (configured.find(c => c.primary) ?? configured[0])?.domain;
	}

	/**
	 * Forces a real session refresh before a read when `forceSync` is set, so the read consumes a freshly
	 * exchanged token rather than a possibly-stale cached one. Both paths refresh, by different mechanisms: a
	 * per-connection (`connectionId`) read syncs that specific connection's session directly through the auth
	 * provider (the integration's primary-only sync path would never reach a secondary account), while a
	 * primary read syncs via the integration's own cloud-connection machinery.
	 * Best-effort — a failed sync is swallowed so the read still proceeds (and surfaces its own warning).
	 */
	async forceRefreshIfRequested(
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
				const descriptor = { ...integration.authProviderDescriptor, connectionId: connectionId, cloud: true };
				await authProvider?.deleteSession(descriptor);
				await authProvider?.getSession(descriptor, { sync: true });
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
	async listOrgs(options?: ListOrgsOptions): Promise<ProviderResult<ProviderOrganization>> {
		return listOrgs(this, options);
	}

	/**
	 * Lists the projects visible to the user, unified into the {@link ProviderOrganization}
	 * `{ providerId, id, name, org?, url }` shape. Covers issue-tracker providers (Jira/Linear, which expose
	 * projects under their resources) *and* git hosts that have a project tier (Azure DevOps, whose repos are
	 * org + project scoped). Scoped to `providerId` when given, else fanned out over both the supported issue
	 * trackers and Azure DevOps. Providers with no project tier (GitHub, GitLab, Bitbucket) contribute nothing.
	 */
	async listProjects(options?: ListProjectsOptions): Promise<ProviderResult<ProviderOrganization>> {
		return listProjects(this, options);
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
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderPagedResult<ProviderRepositoryShape>> {
		return listRepos(this, options);
	}

	/**
	 * Reads one page of the user's pull requests for the given git-host provider. With `repos`, reads those
	 * repos' PRs (translating `page` ↔ the provider's opaque cursor) and maps the raw provider PRs to
	 * {@link PullRequestShape}. With no `repos`, reads the current user's PRs account-wide — the
	 * repo-scoped core rejects an empty `repos` input for GitHub/Bitbucket/Azure, so route to the
	 * account-wide `searchMyPullRequests` core instead (which is already user-scoped and returns shapes).
	 */
	async listPullRequestsPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		states?: PullRequestStateFilter[];
		/**
		 * PR relationship filters (e.g. `[Author, Assignee, ReviewRequested]`). On repo-scoped reads members
		 * combine as provider query constraints (normally an intersection); on account-wide reads they form an
		 * exact OR union. The whole set is validated against the selected path's capability.
		 */
		filters?: PullRequestFilter[];
		/**
		 * Account-wide only: include review-requested PRs when the provider's native "my PRs" query omits them.
		 * This extends the provider-native result; it is not a narrowing filter.
		 */
		includeReviewRequested?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain when no configured connection supplies one. The value must come
		 * from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderPagedResult<PullRequestShape>> {
		return listPullRequestsPage(this, options);
	}

	/** See {@link IntegrationManager.searchPullRequestsPage}. */
	async searchPullRequestsPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		org?: string;
		criteria?: PullRequestSearchCriteria;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		domain?: string;
	}): Promise<ProviderPagedResult<PullRequestShape>> {
		return searchPullRequestsPage(this, options);
	}

	async listIssuesPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		/** Narrows the account-wide read to one org/account. Requires a host with a project layer (Azure). */
		org?: string;
		/** Narrows the account-wide read to one project. Requires a host with a project layer (Azure). */
		project?: string;
		/**
		 * Narrows to the requested relationship(s). On the account-wide path this replaces the provider's own
		 * definition of "my issues" (GitHub/GHE: authored ∪ assigned ∪ mentioned; Azure: assigned ∪ authored;
		 * GitLab: assigned-to-me), so `[Assignee]` yields `assignee:@me` everywhere it's expressible. A set the
		 * provider can't express server-side is refused whole (warning + `fetchFailed`), never widened — check
		 * {@link IntegrationService.getSupportedFilters} first to avoid that path.
		 */
		filters?: IssueFilter[];
		/** Broadens the read to every assignee. Contradicts `filters`; passing both is refused. */
		includeAllAssignees?: boolean;
		/**
		 * How to order the page, as `field:direction`. Omitted orders most-recently-updated-first wherever the
		 * provider can express it. Validated against `getSupportedFilters().issueSorts` on the repo-scoped path and
		 * `.issueSortsAccountWide` on the account-wide one, and refused rather than downgraded; a key no normalized
		 * issue carries is additionally refused for a page spanning several repositories/projects, which is a merge.
		 */
		sort?: IssueSorting;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderPagedResult<IssueShape>> {
		return listIssuesPage(this, options);
	}

	/**
	 * Issues matching structured criteria over a repository/org scope, with no forced relationship to the current
	 * user — see {@link IntegrationManager.searchIssuesPage} for the contract (mandatory scope, guaranteed
	 * most-recently-updated-first ordering, and the result-ceiling omission that carries the total match count).
	 */
	async searchIssuesPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		org?: string;
		criteria?: IssueSearchCriteria;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderPagedResult<IssueShape>> {
		return searchIssuesPage(this, options);
	}

	/**
	 * How many issues match each scope, without fetching any — see {@link IntegrationManager.countIssues} for the
	 * cost model, the per-scope isolation rules, and why `count: undefined` must not be rendered as zero.
	 */
	async countIssues(options: {
		providerId: IntegrationIds;
		scopes: readonly IssueCountScope[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderResult<IssueCountResult>> {
		return countIssues(this, options);
	}

	/**
	 * How many pull requests match each scope, without fetching any — the PR twin of {@link countIssues}. See
	 * {@link IntegrationManager.countPullRequests} for the cost model, the per-scope isolation rules, and why
	 * `count: undefined` must not be rendered as zero.
	 */
	async countPullRequests(options: {
		providerId: IntegrationIds;
		scopes: readonly PullRequestCountScope[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderResult<PullRequestCountResult>> {
		return countPullRequests(this, options);
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
	 *
	 * Takes no `domain`, unlike the git-host reads: every issue-tracker provider is cloud-only
	 * ({@link IssuesCloudHostIntegrationId}), so there is no self-managed host to address.
	 */
	async listIssueTrackerIssuesPage(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		/**
		 * How to order the issues, as `field:direction`. Validated against `getSupportedFilters().issueSorts`, which
		 * is where a tracker reports; a key no normalized issue carries is refused for a multi-project page.
		 */
		sort?: IssueSorting;
		forceSync?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		connectionId?: string;
	}): Promise<ProviderPagedResult<IssueShape>> {
		return listIssueTrackerIssuesPage(this, options);
	}
	/**
	 * Sweeps the user's pull requests across providers by draining every page (an "all-pages" read),
	 * returning the neutral sweep result with per-provider warnings. `truncated` is set when a provider
	 * hit `maxPages` with more still available; `fetchFailed` when a drain aborted on a read error.
	 * `targets` selects a connection/domain independently for each provider. The legacy `connectionId` is
	 * honored only when `providerIds` resolves to a single provider (otherwise ambiguous).
	 */
	async sweepPullRequests(options?: PullRequestSweepOptions): Promise<ProviderSweepResult<PullRequestShape>> {
		return sweepPullRequests(this, options);
	}

	/**
	 * Closed/merged counterpart of {@link sweepPullRequests}, feeding Kepler's Kanban "done" column. Applies
	 * the native cross-provider state filter (`Closed` + `Merged`) so it works beyond GitHub.
	 */
	async sweepClosedPullRequests(
		options?: ClosedPullRequestSweepOptions,
	): Promise<ProviderSweepResult<PullRequestShape>> {
		return sweepClosedPullRequests(this, options);
	}

	/**
	 * Broadens the user's issues by fanning out over the supplied orgs: for each org it lists the org's
	 * repositories, then reads that org's issues. A per-org failure becomes a warning without failing the
	 * whole fan-out. `broadenedProviderIds` lists the distinct providers whose issue read resolved (even
	 * if every issue duplicated a baseline). `failedProviderIds` identifies providers with no usable org;
	 * `incompleteProviderIds` identifies providers with both a usable org and a failed/truncated sibling.
	 * `fanOutCount` is the number of org work items spawned.
	 * Each org may carry its own `connectionId` (and, for a self-managed host with no configured connection, its
	 * own `domain`) to target a specific account — the fan-out spans providers, so the target is scoped per org
	 * rather than globally.
	 */
	async broadenIssues(options: {
		orgs: ProviderBroadenOrg[];
		page?: number;
		cursor?: string;
		forceSync?: boolean;
	}): Promise<ProviderBroadenResult<IssueShape>> {
		return broadenIssues(this, options);
	}

	/**
	 * Resolves a repository from a remote URL to its provider identity, using core-gitlens' remote matcher
	 * plus the provider's `getRepo` (the equivalent of `gk repo resolve`). Supports every provider whose
	 * client exposes `getRepo`. Per-request outcomes preserve the distinctions consumers need for their
	 * canonicalization policy.
	 */
	async resolveRepository(options: {
		providerId?: IntegrationIds;
		remoteUrl: string;
		host?: string;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain used to select the integration instance. Used only when the requested
		 * connection has no configured domain; it must come from the trusted authentication configuration, not
		 * repository or remote data.
		 */
		domain?: string;
	}): Promise<ResolveRepositoryResult> {
		return resolveRepository(this, options);
	}

	/** {@link RepositoryResolutionContext} seam: the user's `remotes` configs, for the remote matcher. */
	getRemoteConfigs(): readonly IntegrationsRemoteConfig[] {
		return this.ctx.config.getRemoteConfigs();
	}

	/** {@link RepositoryResolutionContext} seam: instance lookup by host, for the cloud-host resolution branch. */
	getIntegrationForDomain(id: IntegrationIds, domain: string | undefined): Promise<Integration | undefined> {
		return this.get(id, domain);
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
			const integrationRemoteType = remoteProviderTypeForIntegration(integration.id);
			const cfg = this.ctx.config.getRemoteConfigs().find(remote => {
				if (integration.domain == null || integrationRemoteType == null) return false;
				if (remoteProviderTypeForConfig(remote.type) !== integrationRemoteType) return false;
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

			// Never keep a rejected promise cached: a single failure (a module-resolution error, a transient
			// construction failure) would otherwise poison every `ProvidersApi` read for the lifetime of the
			// service, so consumers get instant empty results with no way to recover short of a restart.
			const loading = (this._providersApi = load());
			void loading.catch(() => {
				// Only clear our own attempt, so a newer load already in flight isn't dropped
				if (this._providersApi === loading) {
					this._providersApi = undefined;
				}
			});
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
					domains.add(hostFromDomain(domain) ?? domain);
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
			const host = hostFromDomain(integration.domain) ?? integration.domain;
			return domainsById.get(integration.id)?.has(host) ? 'connected' : 'disconnected';
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

	private getConfiguredCloudConnection(id: IntegrationIds, connectionId: string): ConfiguredIntegrationDescriptor {
		const connection = this.configuredIntegrationService
			.getConfigured(id, { cloud: true })
			.find(c => c.id === connectionId);
		if (connection == null) {
			throw new Error(`Connection '${connectionId}' is not configured for '${id}'`);
		}
		return connection;
	}

	private getConfiguredConnectionDomain(id: IntegrationIds, connectionId: string): string | undefined {
		if (!isGitSelfManagedHostIntegrationId(id)) return undefined;
		return this.configuredIntegrationService.getConfigured(id).find(c => c.id === connectionId)?.domain;
	}

	private getCloudPrimaryConnectionIdsByDomain(id: IntegrationIds): Map<string | undefined, string> {
		const primaryByDomain = new Map<string | undefined, string>();
		const fallbackByDomain = new Map<string | undefined, string>();

		for (const descriptor of this.configuredIntegrationService.getConfigured(id, { cloud: true })) {
			const domain = isGitSelfManagedHostIntegrationId(id)
				? (hostFromDomain(descriptor.domain) ?? descriptor.domain)
				: undefined;
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
	private async syncCloudIntegrations(forceConnect: boolean): Promise<Set<IntegrationIds> | undefined> {
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

		// Concurrent, not serial: each `syncCloudConnection` is a cloud round trip (a forced sync deletes the
		// stored session and refetches it), so a serial loop pays the SUM of every provider's latency on a
		// path that gates EVERY provider read. `reconcileCloudConnections` below is already `Promise.all`.
		//
		// Safe because every shared mutable path is already serialized, which is why this can be a plain
		// fan-out rather than needing per-provider grouping:
		// - `ensureProvider` is `@gate()`d on `providerId`, so the two integrations a multi-host
		//   self-managed id yields (one per domain, see `getSupportedCloudIntegrations`) share one
		//   in-flight construction instead of racing to `providers.set`.
		// - `ensureSession` is `@gate()`d per integration instance.
		// - `addOrUpdateConfigured`/`removeConfigured` mutate `configured` in a synchronous critical
		//   section (no `await` between read and `set`), and `storeConfigured` has its own write queue.
		// - Secrets and the `connected:` workspace flags are keyed by integration id + domain.
		const integrations: Integration[] = [];
		for await (const integration of this.getSupportedCloudIntegrations(domainsById)) {
			integrations.push(integration);
		}
		await Promise.all(
			integrations.map(integration =>
				integration.syncCloudConnection(
					this.getCloudConnectionState(integration, connectedIntegrations, domainsById),
					forceConnect,
				),
			),
		);

		// Persist every account when the backend advertises per-connection identity (multi-account). This
		// is a strict no-op for backends that return a single, id-less connection per provider.
		await Promise.all(
			Array.from(connectionsById, ([integrationId, connections]) =>
				this.reconcileCloudConnections(integrationId, connections, forceConnect),
			),
		);

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
		const preparedConnections = await Promise.all(
			identified.map(async connection => {
				// The wire `domain` is usually a full URL, though cloud providers can return a bare host.
				// Self-managed integrations are keyed/constructed by host.
				const host = hostFromDomain(connection.domain);

				// Self-managed connections are keyed by host, so an unparseable/empty domain would store the
				// session and descriptor under an empty host — producing ambiguous keys (`connected:<id>:`) that
				// break later resolution and local-disconnect checks. Skip such a connection rather than corrupt
				// state; cloud providers key off their canonical domain and are unaffected.
				if (isGitSelfManagedHostIntegrationId(id) && !host) {
					scope?.warn(`Skipping connection '${connection.id}' for ${id}: unresolved host from domain`);
					return undefined;
				}

				// Don't resurrect a connection the user disconnected locally: a host "disconnect" only clears
				// local state (the backend still lists the token), so without this the next non-forced sync would
				// re-store the secret/config. A forced reconnect clears this flag (in the sync loop above) before
				// reconcile runs, so it proceeds normally.
				if (this.isLocallyDisconnected(id, host)) return undefined;

				syncEligibleIds.add(connection.id);

				// On a routine (non-forced) check-in, skip the token fetch + secret write for a connection we
				// already have stored and that hasn't expired: nothing to refresh, so avoid the extra GK API
				// traffic and secret churn. Still treat it as synced (so it doesn't trip the prune guard) and
				// record its primary below. Forced syncs, new connections, and expired tokens fall through and
				// fetch as before.
				const cached = existingById.get(connection.id);
				if (!forceConnect && cached != null && !isDescriptorExpired(cached)) {
					return { kind: 'cached' as const, connection: connection, host: host };
				}

				try {
					const session = await cloudIntegrations.getConnectionSession(id, undefined, connection.id);
					if (session == null) return undefined;

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

					return {
						kind: 'fetched' as const,
						connection: connection,
						host: host,
						providerSession: providerSession,
					};
				} catch (ex) {
					scope?.warn(
						`Failed to sync connection '${connection.id}' for ${id}: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
					return undefined;
				}
			}),
		);

		// The remote work above is independent, but session persistence remains ordered because storage
		// implementations may update a shared configured-connections collection with read-modify-write.
		for (const prepared of preparedConnections) {
			if (prepared == null) continue;

			if (prepared.kind === 'fetched') {
				await this.configuredIntegrationService.storeSession(id, prepared.providerSession);
			}

			syncedIds.add(prepared.connection.id);
			if (prepared.connection.primary) {
				const domain = isGitSelfManagedHostIntegrationId(id) ? prepared.host : undefined;
				if (!syncedPrimaryIdsByDomain.has(domain)) {
					syncedPrimaryIdsByDomain.set(domain, prepared.connection.id);
				}
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
		const connection = this.getConfiguredCloudConnection(id, connectionId);
		if (!(await this.authenticationService.cloudIntegrations.setPrimaryConnection(id, connectionId))) {
			throw new Error(`Failed to set primary connection '${connectionId}' for '${id}'`);
		}

		await this.configuredIntegrationService.setPrimaryConnection(id, connectionId);
		this.getCachedForDomain(id, connection.domain)?.switchConnection();
	}

	/**
	 * Removes a single connection for a provider by its backend token id. The backend removes the
	 * connection (auto-promoting a secondary to primary when the removed one was primary); we then mirror
	 * that locally and refresh any warm model. Unlike {@link IntegrationBase.disconnect}, this targets one
	 * account. This always talks to the cloud backend, so the local mirror is cloud-scoped and preserves any
	 * local PAT that happens to share the same id.
	 * Throws if the backend delete fails so the caller can surface it (local state stays untouched).
	 */
	async deleteConnection(id: IntegrationIds, connectionId: string): Promise<void> {
		const connection = this.getConfiguredCloudConnection(id, connectionId);
		if (!(await this.authenticationService.cloudIntegrations.disconnectConnection(id, connectionId))) {
			throw new Error(`Failed to delete connection '${connectionId}' for '${id}'`);
		}

		await this.configuredIntegrationService.deleteConnection(id, connectionId, true);
		this.getCachedForDomain(id, connection.domain)?.switchConnection();
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
	 * an up-to-date connection list on demand. Rejects when the authoritative backend connection list cannot
	 * be read, so callers never mistake stale local state for a successful refresh.
	 */
	async refreshConnections(): Promise<void> {
		const connected = await this.syncCloudIntegrations(true);
		if (connected == null) {
			throw new Error('Failed to refresh provider connections');
		}
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
