import type { Account } from '@gitlens/git/models/author.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
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
import type {
	ConfiguredIntegrationsChangeEvent,
	ConfiguredIntegrationService,
} from './authentication/configuredIntegrationService.js';
import type { IntegrationAuthenticationService } from './authentication/integrationAuthenticationService.js';
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
import type { AuthenticationSessionsChangeEvent, IntegrationServiceContext } from './context.js';
import type { GitHostIntegration } from './models/gitHostIntegration.js';
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
import { providersMetadata } from './providers/models.js';
import type { ProvidersApi } from './providers/providersApi.js';
import type { Source } from './telemetry.js';
import {
	convertRemoteProviderIdToIntegrationId,
	getIntegrationIdForRemote,
	isCloudGitSelfManagedHostIntegrationId,
	isGitCloudHostIntegrationId,
	isGitSelfManagedHostIntegrationId,
} from './utils/integration.utils.js';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

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
		args: integrationIds => ({ integrationIds: integrationIds?.length ? integrationIds.join(',') : '<undefined>' }),
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

	@debug({
		args: integrationIds => ({ integrationIds: integrationIds?.length ? integrationIds.join(',') : '<undefined>' }),
	})
	async getMyPullRequests(
		integrationIds?: (GitCloudHostIntegrationId | CloudGitSelfManagedHostIntegrationIds)[],
		cancellation?: AbortSignal,
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
		cancellation?: AbortSignal,
		silent?: boolean,
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const start = performance.now();

		const promises: Promise<IntegrationResult<PullRequest[] | undefined>>[] = [];
		for (const [integration, repos] of integrations) {
			if (integration == null) continue;

			promises.push(integration.searchMyPullRequests(repos, cancellation, silent));
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

	private _ignoreSSLErrors = new Map<string, boolean | 'force'>();
	ignoreSSLErrors(integration: GitHostIntegration | { id: IntegrationIds; domain?: string }): boolean | 'force' {
		if (this.ctx.http.isWeb) return false;

		let ignoreSSLErrors = this._ignoreSSLErrors.get(integration.id);
		if (ignoreSSLErrors === undefined) {
			const cfg = this.ctx.config
				.getRemoteConfigs()
				.find(remote => remote.type.toLowerCase() === integration.id && remote.domain === integration.domain);
			ignoreSSLErrors = cfg?.ignoreSSLErrors ?? false;
			this._ignoreSSLErrors.set(integration.id, ignoreSSLErrors);
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
			await this.reconcileCloudConnections(integrationId, connections);
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

function toProviderSession(
	id: IntegrationIds,
	connection: CloudIntegrationConnection & { id: string },
	session: { accessToken: string; expiresIn: number; scopes: string; type: CloudIntegrationConnection['type'] },
	host: string | undefined,
): ProviderAuthenticationSession {
	const expiresIn =
		session.expiresIn === 0 &&
		(id === GitCloudHostIntegrationId.GitHub || isCloudGitSelfManagedHostIntegrationId(id))
			? maxSmallIntegerV8
			: session.expiresIn;
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
	};
}
