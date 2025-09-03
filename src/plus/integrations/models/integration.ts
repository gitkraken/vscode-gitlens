/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { CancellationToken, Disposable, Event, MessageItem } from 'vscode';
import { EventEmitter, window } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../../autolinks/models/autolinks';
import type { IntegrationIds, IssuesCloudHostIntegrationId } from '../../../constants.integrations';
import { GitCloudHostIntegrationId } from '../../../constants.integrations';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { AuthenticationError, CancellationError, RequestClientError } from '../../../errors';
import type { Account } from '../../../git/models/author';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { PullRequest } from '../../../git/models/pullRequest';
import type { ResourceDescriptor } from '../../../git/models/resourceDescriptor';
import { showIntegrationDisconnectedTooManyFailedRequestsWarningMessage } from '../../../messages';
import { configuration } from '../../../system/-webview/configuration';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import { Logger } from '../../../system/logger';
import type { LogScope } from '../../../system/logger.scope';
import { getLogScope } from '../../../system/logger.scope';
import { isSubscriptionTrialOrPaidFromState } from '../../gk/utils/subscription.utils';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationSessionDescriptor,
} from '../authentication/integrationAuthenticationProvider';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService';
import type { ProviderAuthenticationSession } from '../authentication/models';
import type { IntegrationConnectionChangeEvent } from '../integrationService';
import type { ProvidersApi } from '../providers/providersApi';
import type { GitHostIntegration } from './gitHostIntegration';
import type { IssuesIntegration } from './issuesIntegration';

export type Integration = GitHostIntegration | IssuesIntegration;
export type IntegrationById<T extends IntegrationIds> = T extends IssuesCloudHostIntegrationId
	? IssuesIntegration
	: GitHostIntegration;
export type IntegrationType = 'git' | 'issues';

export type IntegrationKey<T extends IntegrationIds = IntegrationIds> = T extends
	| GitCloudHostIntegrationId
	| IssuesCloudHostIntegrationId
	? `${T}`
	: `${T}:${string}`;

export type IntegrationConnectedKey<T extends IntegrationIds = IntegrationIds> = `connected:${IntegrationKey<T>}`;

export type IntegrationResult<T> =
	| { value: T; duration?: number; error?: never }
	| { error: Error; duration?: number; value?: never }
	| undefined;

type SyncReqUsecase = Exclude<
	| 'getAccountForCommit'
	| 'getAccountForEmail'
	| 'getAccountForResource'
	| 'getCurrentAccount'
	| 'getDefaultBranch'
	| 'getIssue'
	| 'getIssueOrPullRequest'
	| 'getIssuesForProject'
	| 'getProjectsForResources'
	| 'getPullRequest'
	| 'getPullRequestForBranch'
	| 'getPullRequestForCommit'
	| 'getRepositoryMetadata'
	| 'getResourcesForUser'
	| 'mergePullRequest'
	| 'searchMyIssues'
	| 'searchMyPullRequests'
	| 'searchPullRequests',
	// excluding to show explicitly that we don't want to add 'all' key occasionally
	'all'
>;

export abstract class IntegrationBase<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> implements Disposable
{
	abstract readonly type: IntegrationType;

	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	constructor(
		protected readonly container: Container,
		protected readonly authenticationService: IntegrationAuthenticationService,
		protected readonly getProvidersApi: () => Promise<ProvidersApi>,
		private readonly didChangeConnection: EventEmitter<IntegrationConnectionChangeEvent>,
	) {}

	dispose(): void {
		this._onDidChange.dispose();
	}

	abstract get authProvider(): IntegrationAuthenticationProviderDescriptor;
	abstract get id(): ID;
	protected abstract get key(): IntegrationKey<ID>;
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
		return isSubscriptionTrialOrPaidFromState(subscription.state);
	}

	autolinks():
		| (AutolinkReference | DynamicAutolinkReference)[]
		| Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		return [];
	}

	private get connectedKey(): IntegrationConnectedKey<ID> {
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
	getSession(
		source: Sources,
	): ProviderAuthenticationSession | Promise<ProviderAuthenticationSession | undefined> | undefined {
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

		this.resetRequestExceptionCount('all');
		this._session = null;

		if (connected) {
			// Don't store the disconnected flag if silently disconnecting or disconnecting this only for
			// this current VS Code session (will be re-connected on next restart)
			if (!options?.currentSessionOnly && !options?.silent) {
				void this.container.storage.storeWorkspace(this.connectedKey, false).catch();
			}

			this._onDidChange.fire();
			if (!options?.currentSessionOnly) {
				this.didChangeConnection?.fire({ integration: this, key: this.key, reason: 'disconnected' });
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

	refresh(): void {
		void this.ensureSession({ createIfNeeded: false });
	}

	private _syncRequestsPerFailedUsecase = new Set<SyncReqUsecase>();
	hasSessionSyncRequests(): boolean {
		return this._syncRequestsPerFailedUsecase.size > 0;
	}
	requestSessionSyncForUsecase(syncReqUsecase: SyncReqUsecase): void {
		this._syncRequestsPerFailedUsecase.add(syncReqUsecase);
	}
	private static readonly requestExceptionLimit = 5;
	private requestExceptionCount = 0;

	resetRequestExceptionCount(syncReqUsecase: SyncReqUsecase | 'all'): void {
		this.requestExceptionCount = 0;
		if (syncReqUsecase === 'all') {
			this._syncRequestsPerFailedUsecase.clear();
		} else {
			this._syncRequestsPerFailedUsecase.delete(syncReqUsecase);
		}
	}

	/**
	 * Resets request exceptions without resetting the amount of syncs
	 */
	smoothifyRequestExceptionCount(): void {
		// On resync we reset exception count only to avoid infinitive syncs on failure
		this.requestExceptionCount = 0;
	}

	async reset(): Promise<void> {
		await this.disconnect({ silent: true });
		await this.container.storage.deleteWorkspace(this.connectedKey);
	}

	private skippedNonCloudReported = false;
	@log()
	async syncCloudConnection(state: 'connected' | 'disconnected', forceSync: boolean): Promise<void> {
		if (this._session?.cloud === false) {
			if (this.id !== GitCloudHostIntegrationId.GitHub && !this.skippedNonCloudReported) {
				this.container.telemetry.sendEvent('cloudIntegrations/refreshConnection/skippedUnusualToken', {
					'integration.id': this.id,
					reason: 'skip-non-cloud',
					cloud: false,
				});
				this.skippedNonCloudReported = true;
			}
			return;
		}

		switch (state) {
			case 'connected': {
				const oldSession = this._session;
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
				const newSession = await this.ensureSession({ sync: forceSync });

				if (oldSession && newSession && newSession.accessToken !== oldSession.accessToken) {
					this.resetRequestExceptionCount('all');
				}

				break;
			}
			case 'disconnected':
				await this.disconnect({ silent: true });
				break;
		}
	}

	protected handleProviderException(
		syncReqUsecase: SyncReqUsecase,
		ex: Error,
		options?: { scope?: LogScope | undefined; silent?: boolean },
	): void {
		if (ex instanceof CancellationError) return;

		Logger.error(ex, options?.scope);

		if (ex instanceof AuthenticationError && this._session?.cloud) {
			if (!this.hasSessionSyncRequests()) {
				this.requestSessionSyncForUsecase(syncReqUsecase);
				this._session = {
					...this._session,
					expiresAt: new Date(Date.now() - 1),
				};
			} else {
				this.trackRequestException(options);
			}
		} else if (ex instanceof AuthenticationError || ex instanceof RequestClientError) {
			this.trackRequestException(options);
		}
	}

	private missingExpirityReported = false;
	@gate()
	protected async refreshSessionIfExpired(scope?: LogScope): Promise<void> {
		if (this._session?.expiresAt != null && this._session.expiresAt < new Date()) {
			// The current session is expired, so get the latest from the cloud and refresh if needed
			try {
				await this.syncCloudConnection('connected', true);
			} catch (ex) {
				Logger.error(ex, scope);
			}
		} else if (
			this._session?.expiresAt == null &&
			this.id !== GitCloudHostIntegrationId.GitHub &&
			!this.missingExpirityReported
		) {
			this.container.telemetry.sendEvent('cloudIntegrations/refreshConnection/skippedUnusualToken', {
				'integration.id': this.id,
				reason: 'missing-expiry',
				cloud: this._session?.cloud,
			});
			this.missingExpirityReported = true;
		}
	}

	@debug()
	trackRequestException(options?: { silent?: boolean }): void {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= IntegrationBase.requestExceptionLimit && this._session !== null) {
			if (!options?.silent) {
				void showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(this.name);
			}
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

			if (session?.expiresAt != null && session.expiresAt < new Date()) {
				session = null;
			}
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
		this.smoothifyRequestExceptionCount();

		if (session != null) {
			await this.container.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				this.didChangeConnection?.fire({ integration: this, key: this.key, reason: 'connected' });
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
	): Promise<IssueShape[] | undefined>;
	async searchMyIssues(
		resources?: ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined>;
	@debug()
	async searchMyIssues(
		resources?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const issues = await this.searchProviderMyIssues(
				this._session!,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount('searchMyIssues');
			return issues;
		} catch (ex) {
			this.handleProviderException('searchMyIssues', ex, { scope: scope });
			return undefined;
		}
	}

	protected abstract searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined>;

	@debug()
	async getLinkedIssueOrPullRequest(
		resource: T,
		link: { id: string; key: string },
		options?: { expiryOverride?: boolean | number; type?: IssueOrPullRequestType },
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const issueOrPR = this.container.cache.getIssueOrPullRequest(
			link.key,
			options?.type,
			resource,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderLinkedIssueOrPullRequest(
							this._session!,
							resource,
							link,
							options?.type,
						);
						this.resetRequestExceptionCount('getIssueOrPullRequest');
						return result;
					} catch (ex) {
						this.handleProviderException('getIssueOrPullRequest', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			options,
		);
		return issueOrPR;
	}

	protected abstract getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		resource: T,
		link: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
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

		await this.refreshSessionIfExpired(scope);

		const issue = this.container.cache.getIssue(
			id,
			resource,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderIssue(this._session!, resource, id);
						this.resetRequestExceptionCount('getIssue');
						return result;
					} catch (ex) {
						this.handleProviderException('getIssue', ex, { scope: scope });
						return undefined;
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

		await this.refreshSessionIfExpired(scope);

		const { expiryOverride, ...opts } = options ?? {};

		const currentAccount = await this.container.cache.getCurrentAccount(
			this,
			() => ({
				value: (async () => {
					try {
						const account = await this.getProviderCurrentAccount?.(this._session!, opts);
						this.resetRequestExceptionCount('getCurrentAccount');
						return account;
					} catch (ex) {
						this.handleProviderException('getCurrentAccount', ex, { scope: scope });
						return undefined;
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

		await this.refreshSessionIfExpired(scope);

		const pr = await this.container.cache.getPullRequest(id, resource, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderPullRequest?.(this._session!, resource, id);
					this.resetRequestExceptionCount('getPullRequest');
					return result;
				} catch (ex) {
					this.handleProviderException('getPullRequest', ex, { scope: scope });
					return undefined;
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
