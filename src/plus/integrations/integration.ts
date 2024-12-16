import type { CancellationToken, Event, MessageItem } from 'vscode';
import { EventEmitter, window } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks';
import type { IntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../../constants.integrations';
import { HostingIntegrationId } from '../../constants.integrations';
import type { Sources } from '../../constants.telemetry';
import type { Container } from '../../container';
import { AuthenticationError, CancellationError, RequestClientError } from '../../errors';
import type { PagedResult } from '../../git/gitProvider';
import type { Account, UnidentifiedAuthor } from '../../git/models/author';
import type { DefaultBranch } from '../../git/models/defaultBranch';
import type { Issue, IssueOrPullRequest, SearchedIssue } from '../../git/models/issue';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	SearchedPullRequest,
} from '../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../git/models/repositoryMetadata';
import { showIntegrationDisconnectedTooManyFailedRequestsWarningMessage } from '../../messages';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { first } from '../../system/iterable';
import { Logger } from '../../system/logger';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import { configuration } from '../../system/vscode/configuration';
import { isSubscriptionStatePaidOrTrial } from '../gk/account/subscription';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationService,
	IntegrationAuthenticationSessionDescriptor,
} from './authentication/integrationAuthentication';
import type { ProviderAuthenticationSession } from './authentication/models';
import type {
	GetIssuesOptions,
	GetPullRequestsOptions,
	PagedProjectInput,
	PagedRepoInput,
	ProviderAccount,
	ProviderIssue,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
} from './providers/models';
import { IssueFilter, PagingMode, PullRequestFilter } from './providers/models';
import type { ProvidersApi } from './providers/providersApi';

export type IntegrationResult<T> =
	| { value: T; duration?: number; error?: never }
	| { error: Error; duration?: number; value?: never }
	| undefined;

export type SupportedIntegrationIds = IntegrationId;
export type SupportedHostingIntegrationIds = HostingIntegrationId;
export type SupportedIssueIntegrationIds = IssueIntegrationId;
export type SupportedSelfHostedIntegrationIds = SelfHostedIntegrationId;

export type Integration = IssueIntegration | HostingIntegration;
export type IntegrationKey =
	| `${SupportedHostingIntegrationIds}`
	| `${SupportedIssueIntegrationIds}`
	| `${SupportedSelfHostedIntegrationIds}:${string}`;
export type IntegrationKeyById<T extends SupportedIntegrationIds> = T extends SupportedIssueIntegrationIds
	? `${SupportedIssueIntegrationIds}`
	: T extends SupportedHostingIntegrationIds
	  ? `${SupportedHostingIntegrationIds}`
	  : `${SupportedSelfHostedIntegrationIds}:${string}`;
export type IntegrationType = 'issues' | 'hosting';

export type ResourceDescriptor = { key: string } & Record<string, unknown>;

export type IssueResourceDescriptor = ResourceDescriptor & {
	id: string;
	name: string;
};

export type RepositoryDescriptor = ResourceDescriptor & {
	owner: string;
	name: string;
};

export function isIssueResourceDescriptor(resource: ResourceDescriptor): resource is IssueResourceDescriptor {
	return (
		'key' in resource &&
		resource.key != null &&
		'id' in resource &&
		resource.id != null &&
		'name' in resource &&
		resource.name != null
	);
}

export function isRepositoryDescriptor(resource: ResourceDescriptor): resource is RepositoryDescriptor {
	return (
		'key' in resource &&
		resource.key != null &&
		'owner' in resource &&
		resource.owner != null &&
		'name' in resource &&
		resource.name != null
	);
}

export function isHostingIntegration(integration: Integration): integration is HostingIntegration {
	return integration.type === 'hosting';
}
export function isIssueIntegration(integration: Integration): integration is IssueIntegration {
	return integration.type === 'issues';
}

export abstract class IntegrationBase<
	ID extends SupportedIntegrationIds = SupportedIntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> {
	abstract readonly type: IntegrationType;

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	constructor(
		protected readonly container: Container,
		protected readonly authenticationService: IntegrationAuthenticationService,
		protected readonly getProvidersApi: () => Promise<ProvidersApi>,
	) {}

	abstract get authProvider(): IntegrationAuthenticationProviderDescriptor;
	abstract get id(): ID;
	protected abstract get key(): IntegrationKeyById<ID>;
	abstract get name(): string;
	abstract get domain(): string;

	get authProviderDescriptor(): IntegrationAuthenticationSessionDescriptor {
		return { domain: this.domain, scopes: this.authProvider.scopes };
	}

	get icon(): string {
		return this.id;
	}

	async access(): Promise<boolean> {
		const subscription = await this.container.subscription.getSubscription();
		return isSubscriptionStatePaidOrTrial(subscription.state);
	}

	autolinks():
		| (AutolinkReference | DynamicAutolinkReference)[]
		| Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		return [];
	}

	private get connectedKey(): `connected:${Integration['key']}` {
		return `connected:${this.key}`;
	}

	get maybeConnected(): boolean | undefined {
		return this._session === undefined ? undefined : this._session !== null;
	}

	get connectionExpired(): boolean | undefined {
		if (this._session?.expiresAt == null) return undefined;
		return new Date(this._session.expiresAt) < new Date();
	}

	protected _session: ProviderAuthenticationSession | null | undefined;
	getSession(source: Sources) {
		if (this._session === undefined) {
			return this.ensureSession({ createIfNeeded: false, source: source });
		}
		return this._session ?? undefined;
	}

	@log()
	async connect(source: Sources): Promise<boolean> {
		try {
			return Boolean(await this.ensureSession({ createIfNeeded: true, source: source }));
		} catch (_ex) {
			return false;
		}
	}

	protected providerOnConnect?(): void | Promise<void>;

	@gate()
	@log()
	async disconnect(options?: { silent?: boolean; currentSessionOnly?: boolean }): Promise<void> {
		if (options?.currentSessionOnly && this._session === null) return;

		const connected = this._session != null;

		let signOut = !options?.currentSessionOnly;

		if (connected && !options?.currentSessionOnly && !options?.silent) {
			const disable = { title: 'Disable' };
			const disableAndSignOut = { title: 'Disable & Sign Out' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };

			let result: MessageItem | undefined;
			if (this.authenticationService.supports(this.authProvider.id)) {
				result = await window.showWarningMessage(
					`Are you sure you want to disable the rich integration with ${this.name}?\n\nNote: signing out clears the saved authentication.`,
					{ modal: true },
					disable,
					disableAndSignOut,
					cancel,
				);
			} else {
				result = await window.showWarningMessage(
					`Are you sure you want to disable the rich integration with ${this.name}?`,
					{ modal: true },
					disable,
					cancel,
				);
			}

			if (result == null || result === cancel) return;

			signOut = result === disableAndSignOut;
		}

		if (signOut) {
			const authProvider = await this.authenticationService.get(this.authProvider.id);
			void authProvider.deleteSession(this.authProviderDescriptor);
		}

		this.resetRequestExceptionCount();
		this._session = null;

		if (connected) {
			// Don't store the disconnected flag if silently disconnecting or disconnecting this only for
			// this current VS Code session (will be re-connected on next restart)
			if (!options?.currentSessionOnly && !options?.silent) {
				void this.container.storage.storeWorkspace(this.connectedKey, false).catch();
			}

			this._onDidChange.fire();
			if (!options?.currentSessionOnly) {
				this.container.integrations.disconnected(this, this.key);
			}
		}

		await this.providerOnDisconnect?.();
	}

	protected providerOnDisconnect?(): void | Promise<void>;

	@log()
	async reauthenticate(): Promise<void> {
		if (this._session === undefined) return;

		this._session = undefined;
		void (await this.ensureSession({ createIfNeeded: true, forceNewSession: true }));
	}

	refresh() {
		void this.ensureSession({ createIfNeeded: false });
	}

	private requestExceptionCount = 0;

	resetRequestExceptionCount(): void {
		this.requestExceptionCount = 0;
	}

	async reset(): Promise<void> {
		await this.disconnect({ silent: true });
		await this.container.storage.deleteWorkspace(this.connectedKey);
	}

	@log()
	async syncCloudConnection(state: 'connected' | 'disconnected', forceSync: boolean): Promise<void> {
		if (this._session?.cloud === false) return;

		switch (state) {
			case 'connected':
				if (forceSync) {
					// Reset our stored session so that we get a new one from the cloud
					const authProvider = await this.authenticationService.get(this.authProvider.id);
					await authProvider.deleteSession(this.authProviderDescriptor);
					// Reset the session and clear our "stay disconnected" flag
					this._session = undefined;
					await this.container.storage.deleteWorkspace(this.connectedKey);
				} else {
					// Only sync if we're not connected and not disabled and don't have pending errors
					if (
						this._session != null ||
						this.requestExceptionCount > 0 ||
						this.container.storage.getWorkspace(this.connectedKey) === false
					) {
						return;
					}

					forceSync = true;
				}

				// sync option, rather than createIfNeeded, makes sure we don't call connectCloudIntegrations and open a gkdev window
				// if there was no session or some problem fetching/refreshing the existing session from the cloud api
				await this.ensureSession({ sync: forceSync });
				break;
			case 'disconnected':
				await this.disconnect({ silent: true });
				break;
		}
	}

	protected handleProviderException<T>(ex: Error, scope: LogScope | undefined, defaultValue: T): T {
		if (ex instanceof CancellationError) return defaultValue;

		Logger.error(ex, scope);

		if (ex instanceof AuthenticationError || ex instanceof RequestClientError) {
			this.trackRequestException();
		}
		return defaultValue;
	}

	@debug()
	trackRequestException(): void {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= 5 && this._session !== null) {
			void showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(this.name);
			void this.disconnect({ currentSessionOnly: true });
		}
	}

	@gate()
	@debug({ exit: true })
	async isConnected(): Promise<boolean> {
		return (await this.getSession('integrations')) != null;
	}

	@gate()
	private async ensureSession(
		options:
			| {
					createIfNeeded?: boolean;
					forceNewSession?: boolean;
					sync?: never;
					source?: Sources;
			  }
			| {
					createIfNeeded?: never;
					forceNewSession?: never;
					sync: boolean;
					source?: Sources;
			  },
	): Promise<ProviderAuthenticationSession | undefined> {
		const { createIfNeeded, forceNewSession, source, sync } = options;
		if (this._session != null) return this._session;
		if (!configuration.get('integrations.enabled')) return undefined;

		if (createIfNeeded || sync) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		} else if (this.container.storage.getWorkspace(this.connectedKey) === false) {
			return undefined;
		}

		let session: ProviderAuthenticationSession | undefined | null;
		try {
			const authProvider = await this.authenticationService.get(this.authProvider.id);
			session = await authProvider.getSession(
				this.authProviderDescriptor,
				sync
					? { sync: sync, source: source }
					: {
							createIfNeeded: createIfNeeded,
							forceNewSession: forceNewSession,
							source: source,
					  },
			);
		} catch (ex) {
			await this.container.storage.deleteWorkspace(this.connectedKey);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNeeded && !sync) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		}

		this._session = session ?? null;
		this.resetRequestExceptionCount();

		if (session != null) {
			await this.container.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				this.container.integrations.connected(this, this.key);
				void this.providerOnConnect?.();
			});
		}

		return session ?? undefined;
	}

	getIgnoreSSLErrors(): boolean | 'force' {
		return this.container.integrations.ignoreSSLErrors(this);
	}

	async searchMyIssues(
		resource?: ResourceDescriptor,
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined>;
	async searchMyIssues(
		resources?: ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined>;
	@debug()
	async searchMyIssues(
		resources?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issues = await this.searchProviderMyIssues(
				this._session!,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount();
			return issues;
		} catch (ex) {
			return this.handleProviderException<SearchedIssue[] | undefined>(ex, scope, undefined);
		}
	}

	protected abstract searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined>;

	@debug()
	async getIssueOrPullRequest(
		resource: T,
		id: string,
		options?: { expiryOverride?: boolean | number },
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const issueOrPR = this.container.cache.getIssueOrPullRequest(
			id,
			resource,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderIssueOrPullRequest(this._session!, resource, id);
						this.resetRequestExceptionCount();
						return result;
					} catch (ex) {
						return this.handleProviderException<IssueOrPullRequest | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			options,
		);
		return issueOrPR;
	}

	protected abstract getProviderIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		resource: T,
		id: string,
	): Promise<IssueOrPullRequest | undefined>;

	@debug()
	async getIssue(
		resource: T,
		id: string,
		options?: { expiryOverride?: boolean | number },
	): Promise<Issue | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const issue = this.container.cache.getIssue(
			id,
			resource,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderIssue(this._session!, resource, id);
						this.resetRequestExceptionCount();
						return result;
					} catch (ex) {
						return this.handleProviderException<Issue | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			options,
		);
		return issue;
	}

	protected abstract getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: T,
		id: string,
	): Promise<Issue | undefined>;

	async getCurrentAccount(options?: {
		avatarSize?: number;
		expiryOverride?: boolean | number;
	}): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const { expiryOverride, ...opts } = options ?? {};

		const currentAccount = await this.container.cache.getCurrentAccount(
			this,
			() => ({
				value: (async () => {
					try {
						const account = await this.getProviderCurrentAccount?.(this._session!, opts);
						this.resetRequestExceptionCount();
						return account;
					} catch (ex) {
						return this.handleProviderException<Account | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			{ expiryOverride: expiryOverride },
		);
		return currentAccount;
	}

	protected getProviderCurrentAccount?(
		session: ProviderAuthenticationSession,
		options?: { avatarSize?: number },
	): Promise<Account | undefined>;

	@debug()
	async getPullRequest(resource: T, id: string): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const pr = this.container.cache.getPullRequest(id, resource, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderPullRequest?.(this._session!, resource, id);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return pr;
	}

	protected getProviderPullRequest?(
		session: ProviderAuthenticationSession,
		resource: T,
		id: string,
	): Promise<PullRequest | undefined>;
}

export abstract class IssueIntegration<
	ID extends SupportedIntegrationIds = SupportedIntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'issues';

	@gate()
	@debug()
	async getAccountForResource(resource: T): Promise<Account | undefined> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const account = await this.getProviderAccountForResource(this._session!, resource);
			this.resetRequestExceptionCount();
			return account;
		} catch (ex) {
			return this.handleProviderException<Account | undefined>(ex, undefined, undefined);
		}
	}

	protected abstract getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		resource: T,
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getResourcesForUser(): Promise<T[] | undefined> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const resources = await this.getProviderResourcesForUser(this._session!);
			this.resetRequestExceptionCount();
			return resources;
		} catch (ex) {
			return this.handleProviderException<T[] | undefined>(ex, undefined, undefined);
		}
	}

	protected abstract getProviderResourcesForUser(session: ProviderAuthenticationSession): Promise<T[] | undefined>;

	@debug()
	async getProjectsForResources(resources: T[]): Promise<T[] | undefined> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const projects = await this.getProviderProjectsForResources(this._session!, resources);
			this.resetRequestExceptionCount();
			return projects;
		} catch (ex) {
			return this.handleProviderException<T[] | undefined>(ex, undefined, undefined);
		}
	}

	async getProjectsForUser(): Promise<T[] | undefined> {
		const resources = await this.getResourcesForUser();
		if (resources == null) return undefined;

		return this.getProjectsForResources(resources);
	}

	protected abstract getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: T[],
	): Promise<T[] | undefined>;

	@debug()
	async getIssuesForProject(
		project: T,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<SearchedIssue[] | undefined> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issues = await this.getProviderIssuesForProject(this._session!, project, options);
			this.resetRequestExceptionCount();
			return issues;
		} catch (ex) {
			return this.handleProviderException<SearchedIssue[] | undefined>(ex, undefined, undefined);
		}
	}

	protected abstract getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: T,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<SearchedIssue[] | undefined>;
}

export abstract class HostingIntegration<
	ID extends SupportedIntegrationIds = SupportedIntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'hosting';

	@gate()
	@debug()
	async getAccountForEmail(
		repo: T,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForEmail(this._session!, repo, email, options);
			this.resetRequestExceptionCount();
			return author;
		} catch (ex) {
			return this.handleProviderException<Account | undefined>(ex, scope, undefined);
		}
	}

	protected abstract getProviderAccountForEmail(
		session: ProviderAuthenticationSession,
		repo: T,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getAccountForCommit(
		repo: T,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForCommit(this._session!, repo, ref, options);
			this.resetRequestExceptionCount();
			return author;
		} catch (ex) {
			return this.handleProviderException<Account | undefined>(ex, scope, undefined);
		}
	}

	protected abstract getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: T,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined>;

	@debug()
	async getDefaultBranch(
		repo: T,
		options?: { cancellation?: CancellationToken; expiryOverride?: boolean | number },
	): Promise<DefaultBranch | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const defaultBranch = this.container.cache.getRepositoryDefaultBranch(
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderDefaultBranch(this._session!, repo, options?.cancellation);
						this.resetRequestExceptionCount();
						return result;
					} catch (ex) {
						return this.handleProviderException<DefaultBranch | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return defaultBranch;
	}

	protected abstract getProviderDefaultBranch(
		{ accessToken }: ProviderAuthenticationSession,
		repo: T,
		cancellation?: CancellationToken,
	): Promise<DefaultBranch | undefined>;

	@debug()
	async getRepositoryMetadata(
		repo: T,
		options?: { cancellation?: CancellationToken; expiryOverride?: boolean | number },
	): Promise<RepositoryMetadata | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const metadata = this.container.cache.getRepositoryMetadata(
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderRepositoryMetadata(
							this._session!,
							repo,
							options?.cancellation,
						);
						this.resetRequestExceptionCount();
						return result;
					} catch (ex) {
						return this.handleProviderException<RepositoryMetadata | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return metadata;
	}

	protected abstract getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: T,
		cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined>;

	async mergePullRequest(
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return false;

		try {
			const result = await this.mergeProviderPullRequest(this._session!, pr, options);
			this.resetRequestExceptionCount();
			return result;
		} catch (ex) {
			return this.handleProviderException<boolean>(ex, scope, false);
		}
	}

	protected abstract mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean>;

	@debug()
	async getPullRequestForBranch(
		repo: T,
		branch: string,
		options?: {
			avatarSize?: number;
			expiryOverride?: boolean | number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const { expiryOverride, ...opts } = options ?? {};

		const pr = this.container.cache.getPullRequestForBranch(
			branch,
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequestForBranch(this._session!, repo, branch, opts);
						this.resetRequestExceptionCount();
						return result;
					} catch (ex) {
						return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			{ expiryOverride: expiryOverride },
		);
		return pr;
	}

	protected abstract getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: T,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined>;

	@debug()
	async getPullRequestForCommit(
		repo: T,
		ref: string,
		options?: { expiryOverride?: boolean | number },
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const pr = this.container.cache.getPullRequestForSha(
			ref,
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequestForCommit(this._session!, repo, ref);
						this.resetRequestExceptionCount();
						return result;
					} catch (ex) {
						return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
					}
				})(),
			}),
			options,
		);
		return pr;
	}

	protected abstract getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: T,
		ref: string,
	): Promise<PullRequest | undefined>;

	async getMyIssuesForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: IssueFilter[];
			cursor?: string;
			customUrl?: string;
		},
	): Promise<PagedResult<ProviderIssue> | undefined> {
		const providerId = this.authProvider.id;
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const api = await this.getProvidersApi();
		if (
			providerId !== HostingIntegrationId.GitLab &&
			(api.isRepoIdsInput(reposOrRepoIds) ||
				(providerId === HostingIntegrationId.AzureDevOps &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			Logger.warn(`Unsupported input for provider ${providerId}`, 'getIssuesForRepos');
			return undefined;
		}

		let getIssuesOptions: GetIssuesOptions | undefined;
		if (providerId === HostingIntegrationId.AzureDevOps) {
			const organizations = new Set<string>();
			const projects = new Set<string>();
			for (const repo of reposOrRepoIds as ProviderRepoInput[]) {
				organizations.add(repo.namespace);
				projects.add(repo.project!);
			}

			if (organizations.size > 1) {
				Logger.warn(`Multiple organizations not supported for provider ${providerId}`, 'getIssuesForRepos');
				return undefined;
			} else if (organizations.size === 0) {
				Logger.warn(`No organizations found for provider ${providerId}`, 'getIssuesForRepos');
				return undefined;
			}

			const organization: string = first(organizations.values())!;

			if (options?.filters != null) {
				if (!api.providerSupportsIssueFilters(providerId, options.filters)) {
					Logger.warn(`Unsupported filters for provider ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				let userAccount: ProviderAccount | undefined;
				try {
					userAccount = await api.getCurrentUserForInstance(providerId, organization);
				} catch (ex) {
					Logger.error(ex, 'getIssuesForRepos');
					return undefined;
				}

				if (userAccount == null) {
					Logger.warn(`Unable to get current user for ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				const userFilterProperty = userAccount.name;

				if (userFilterProperty == null) {
					Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				getIssuesOptions = {
					authorLogin: options.filters.includes(IssueFilter.Author) ? userFilterProperty : undefined,
					assigneeLogins: options.filters.includes(IssueFilter.Assignee) ? [userFilterProperty] : undefined,
					mentionLogin: options.filters.includes(IssueFilter.Mention) ? userFilterProperty : undefined,
				};
			}

			const cursorInfo = JSON.parse(options?.cursor ?? '{}');
			const cursors: PagedProjectInput[] = cursorInfo.cursors ?? [];
			let projectInputs: PagedProjectInput[] = Array.from(projects.values()).map(project => ({
				namespace: organization,
				project: project,
				cursor: undefined,
			}));
			if (cursors.length > 0) {
				projectInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedProjectInput[] } = { cursors: [] };
				let hasMore = false;
				const data: ProviderIssue[] = [];
				await Promise.all(
					projectInputs.map(async projectInput => {
						const results = await api.getIssuesForAzureProject(
							projectInput.namespace,
							projectInput.project,
							{
								...getIssuesOptions,
								cursor: projectInput.cursor,
							},
						);
						data.push(...results.values);
						if (results.paging?.more) {
							hasMore = true;
							cursor.cursors.push({
								namespace: projectInput.namespace,
								project: projectInput.project,
								cursor: results.paging.cursor,
							});
						}
					}),
				);

				return {
					values: data,
					paging: {
						more: hasMore,
						cursor: JSON.stringify(cursor),
					},
				};
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return undefined;
			}
		}
		if (options?.filters != null) {
			let userAccount: ProviderAccount | undefined;
			try {
				userAccount = await api.getCurrentUser(providerId);
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return undefined;
			}

			if (userAccount == null) {
				Logger.warn(`Unable to get current user for ${providerId}`, 'getIssuesForRepos');
				return undefined;
			}

			const userFilterProperty = userAccount.username;
			if (userFilterProperty == null) {
				Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getIssuesForRepos');
				return undefined;
			}

			getIssuesOptions = {
				authorLogin: options.filters.includes(IssueFilter.Author) ? userFilterProperty : undefined,
				assigneeLogins: options.filters.includes(IssueFilter.Assignee) ? [userFilterProperty] : undefined,
				mentionLogin: options.filters.includes(IssueFilter.Mention) ? userFilterProperty : undefined,
			};
		}

		if (api.getProviderIssuesPagingMode(providerId) === PagingMode.Repo && !api.isRepoIdsInput(reposOrRepoIds)) {
			const cursorInfo = JSON.parse(options?.cursor ?? '{}');
			const cursors: PagedRepoInput[] = cursorInfo.cursors ?? [];
			let repoInputs: PagedRepoInput[] = reposOrRepoIds.map(repo => ({ repo: repo, cursor: undefined }));
			if (cursors.length > 0) {
				repoInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedRepoInput[] } = { cursors: [] };
				let hasMore = false;
				const data: ProviderIssue[] = [];
				await Promise.all(
					repoInputs.map(async repoInput => {
						const results = await api.getIssuesForRepo(providerId, repoInput.repo, {
							...getIssuesOptions,
							cursor: repoInput.cursor,
							baseUrl: options?.customUrl,
						});
						data.push(...results.values);
						if (results.paging?.more) {
							hasMore = true;
							cursor.cursors.push({ repo: repoInput.repo, cursor: results.paging.cursor });
						}
					}),
				);

				return {
					values: data,
					paging: {
						more: hasMore,
						cursor: JSON.stringify(cursor),
					},
				};
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return undefined;
			}
		}

		try {
			return await api.getIssuesForRepos(providerId, reposOrRepoIds, {
				...getIssuesOptions,
				cursor: options?.cursor,
				baseUrl: options?.customUrl,
			});
		} catch (ex) {
			Logger.error(ex, 'getIssuesForRepos');
			return undefined;
		}
	}

	async getMyPullRequestsForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: PullRequestFilter[];
			cursor?: string;
			customUrl?: string;
		},
	): Promise<PagedResult<ProviderPullRequest> | undefined> {
		const providerId = this.authProvider.id;
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const api = await this.getProvidersApi();
		if (
			providerId !== HostingIntegrationId.GitLab &&
			(api.isRepoIdsInput(reposOrRepoIds) ||
				(providerId === HostingIntegrationId.AzureDevOps &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			Logger.warn(`Unsupported input for provider ${providerId}`);
			return undefined;
		}

		let getPullRequestsOptions: GetPullRequestsOptions | undefined;
		if (options?.filters != null) {
			if (!api.providerSupportsPullRequestFilters(providerId, options.filters)) {
				Logger.warn(`Unsupported filters for provider ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			let userAccount: ProviderAccount | undefined;
			if (providerId === HostingIntegrationId.AzureDevOps) {
				const organizations = new Set<string>();
				for (const repo of reposOrRepoIds as ProviderRepoInput[]) {
					organizations.add(repo.namespace);
				}

				if (organizations.size > 1) {
					Logger.warn(
						`Multiple organizations not supported for provider ${providerId}`,
						'getPullRequestsForRepos',
					);
					return undefined;
				} else if (organizations.size === 0) {
					Logger.warn(`No organizations found for provider ${providerId}`, 'getPullRequestsForRepos');
					return undefined;
				}

				const organization: string = first(organizations.values())!;
				try {
					userAccount = await api.getCurrentUserForInstance(providerId, organization);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return undefined;
				}
			} else {
				try {
					userAccount = await api.getCurrentUser(providerId);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return undefined;
				}
			}

			if (userAccount == null) {
				Logger.warn(`Unable to get current user for ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			let userFilterProperty: string | null;
			switch (providerId) {
				case HostingIntegrationId.Bitbucket:
				case HostingIntegrationId.AzureDevOps:
					userFilterProperty = userAccount.id;
					break;
				default:
					userFilterProperty = userAccount.username;
					break;
			}

			if (userFilterProperty == null) {
				Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			getPullRequestsOptions = {
				authorLogin: options.filters.includes(PullRequestFilter.Author) ? userFilterProperty : undefined,
				assigneeLogins: options.filters.includes(PullRequestFilter.Assignee) ? [userFilterProperty] : undefined,
				reviewRequestedLogin: options.filters.includes(PullRequestFilter.ReviewRequested)
					? userFilterProperty
					: undefined,
				mentionLogin: options.filters.includes(PullRequestFilter.Mention) ? userFilterProperty : undefined,
			};
		}

		if (
			api.getProviderPullRequestsPagingMode(providerId) === PagingMode.Repo &&
			!api.isRepoIdsInput(reposOrRepoIds)
		) {
			const cursorInfo = JSON.parse(options?.cursor ?? '{}');
			const cursors: PagedRepoInput[] = cursorInfo.cursors ?? [];
			let repoInputs: PagedRepoInput[] = reposOrRepoIds.map(repo => ({ repo: repo, cursor: undefined }));
			if (cursors.length > 0) {
				repoInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedRepoInput[] } = { cursors: [] };
				let hasMore = false;
				const data: ProviderPullRequest[] = [];
				await Promise.all(
					repoInputs.map(async repoInput => {
						const results = await api.getPullRequestsForRepo(providerId, repoInput.repo, {
							...getPullRequestsOptions,
							cursor: repoInput.cursor,
							baseUrl: options?.customUrl,
						});
						data.push(...results.values);
						if (results.paging?.more) {
							hasMore = true;
							cursor.cursors.push({ repo: repoInput.repo, cursor: results.paging.cursor });
						}
					}),
				);

				return {
					values: data,
					paging: {
						more: hasMore,
						cursor: JSON.stringify(cursor),
					},
				};
			} catch (ex) {
				Logger.error(ex, 'getPullRequestsForRepos');
				return undefined;
			}
		}

		try {
			return await api.getPullRequestsForRepos(providerId, reposOrRepoIds, {
				...getPullRequestsOptions,
				cursor: options?.cursor,
				baseUrl: options?.customUrl,
			});
		} catch (ex) {
			Logger.error(ex, 'getPullRequestsForRepos');
			return undefined;
		}
	}

	async searchMyPullRequests(
		repo?: T,
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>>;
	async searchMyPullRequests(
		repos?: T[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>>;
	@debug()
	async searchMyPullRequests(
		repos?: T | T[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<SearchedPullRequest[] | undefined>> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const start = Date.now();
		try {
			const pullRequests = await this.searchProviderMyPullRequests(
				this._session!,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
				silent,
			);
			return { value: pullRequests, duration: Date.now() - start };
		} catch (ex) {
			Logger.error(ex, scope);
			return { error: ex, duration: Date.now() - start };
		}
	}

	protected abstract searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: T[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<SearchedPullRequest[] | undefined>;

	async searchPullRequests(
		searchQuery: string,
		repo?: T,
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined>;
	async searchPullRequests(
		searchQuery: string,
		repos?: T[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined>;
	@debug()
	async searchPullRequests(
		searchQuery: string,
		repos?: T | T[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const prs = await this.searchProviderPullRequests?.(
				this._session!,
				searchQuery,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount();
			return prs;
		} catch (ex) {
			return this.handleProviderException<PullRequest[] | undefined>(ex, scope, undefined);
		}
	}

	protected searchProviderPullRequests?(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: T[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined>;
}
