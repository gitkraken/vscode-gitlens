import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationSessionDescriptor,
} from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds, IssuesCloudHostIntegrationId } from '../constants.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { AuthenticationError, RequestClientError } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import type { Sources } from '../telemetry.js';
import type { GitHostIntegration } from './gitHostIntegration.js';
import type { IssuesIntegration } from './issuesIntegration.js';

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
	| { value: T; duration?: number; error?: Error }
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
	| 'getIssuesForRepos'
	| 'getMyPullRequestsForUser'
	| 'getOrganizationsForUser'
	| 'getProjectsForOrg'
	| 'getProjectsForResources'
	| 'getPullRequest'
	| 'getRepositoriesForOrg'
	| 'getPullRequestForBranch'
	| 'getPullRequestForCommit'
	| 'getPullRequestsForRepos'
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
> implements Disposable {
	abstract readonly type: IntegrationType;

	private readonly _onDidChange = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	constructor(
		protected readonly ctx: IntegrationServiceContext,
		protected readonly authenticationService: IntegrationAuthenticationService,
		protected readonly getProvidersApi: () => Promise<ProvidersApi>,
		private readonly didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
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

	access(): Promise<boolean> {
		return this.ctx.account.isTrialOrPaid();
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

	/** Hash of the current session's access token. Changes on any token change (account switch or refresh). */
	private _sessionFingerprint: { session: ProviderAuthenticationSession; hash: string } | undefined;
	get sessionFingerprint(): string | undefined {
		if (this._session == null) return undefined;

		if (this._sessionFingerprint?.session !== this._session) {
			this._sessionFingerprint = { session: this._session, hash: fnv1aHash64(this._session.accessToken) };
		}
		return this._sessionFingerprint.hash;
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

	/**
	 * Resolves the session to read as, for a per-connection (multi-account) read. When `connectionId` is
	 * omitted this is the integration's primary session, resolved exactly like the existing read flow
	 * (ensure-connected + refresh-if-expired). When set, it resolves THAT connection's session directly
	 * from the auth provider — refreshing it if expired — WITHOUT disturbing the cached primary
	 * `_session`. Returns undefined when the requested session can't be resolved (e.g. the connection is
	 * gone or the provider isn't connected), so callers degrade to "no results".
	 */
	protected async resolveReadSession(
		connectionId: string | undefined,
		scope: ScopedLogger | undefined,
		source?: Sources,
	): Promise<ProviderAuthenticationSession | undefined> {
		if (
			this.ctx.config.isIntegrationsEnabled?.() === false ||
			this.ctx.storage.getWorkspace(this.connectedKey) === false
		) {
			return undefined;
		}

		// A truthy connectionId targets a specific account; an empty string is not a real target, so it falls
		// through to the primary path below.
		if (connectionId) {
			// Degrade to "no results" on failure, matching the primary path (whose ensureSession/
			// refreshSessionIfExpired swallow errors) so read methods keep their never-throws contract.
			try {
				const authProvider = await this.authenticationService.get(this.authProvider.id);
				const session = await authProvider.getSession(
					{ ...this.authProviderDescriptor, connectionId: connectionId, cloud: true },
					{ source: source },
				);
				return session ?? undefined;
			} catch (ex) {
				scope?.error(ex);
				return undefined;
			}
		}

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);
		return this._session ?? undefined;
	}

	@debug()
	async connect(source: Sources): Promise<boolean> {
		try {
			return Boolean(await this.ensureSession({ createIfNeeded: true, source: source }));
		} catch (_ex) {
			return false;
		}
	}

	protected providerOnConnect?(): void | Promise<void>;

	@gate()
	@debug()
	async disconnect(options?: { silent?: boolean; currentSessionOnly?: boolean }): Promise<void> {
		if (options?.currentSessionOnly && this._session === null) return;

		const connected = this._session != null;

		let signOut = !options?.currentSessionOnly;

		if (connected && !options?.currentSessionOnly && !options?.silent) {
			const decision = await this.ctx.hooks?.onConfirmDisconnect?.({
				integrationName: this.name,
				offerSignOut: this.authenticationService.supports(this.authProvider.id),
			});
			if (decision == null) return;

			signOut = decision.signOut;
		}

		if (signOut) {
			// Disconnecting a provider signs out of ALL its connected accounts (multi-account), not just the
			// primary — otherwise secondary connections' secrets/config would be orphaned. Removing a single
			// account is done via IntegrationService.deleteConnection instead. Pass this instance's descriptor
			// so self-managed disconnects stay scoped to this host: those group every host under one provider
			// id, so an unscoped clear would sign the user out of unrelated hosts. deleteAllSessions derives an
			// undefined domain for cloud providers, so they still clear every account as intended.
			const authProvider = await this.authenticationService.get(this.authProvider.id);
			void authProvider.deleteAllSessions(this.authProviderDescriptor);
		}

		this.resetRequestExceptionCount('all');
		this._session = null;

		if (connected) {
			// Don't store the disconnected flag if silently disconnecting or disconnecting this only for
			// this current VS Code session (will be re-connected on next restart)
			if (!options?.currentSessionOnly && !options?.silent) {
				void this.ctx.storage.storeWorkspace(this.connectedKey, false).catch();
			}

			this._onDidChange.fire();
			if (!options?.currentSessionOnly) {
				this.didChangeConnection?.fire({ integration: this, key: this.key, reason: 'disconnected' });
			}
		}

		await this.providerOnDisconnect?.();
	}

	protected providerOnDisconnect?(): void | Promise<void>;

	@debug()
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
		await this.ctx.storage.deleteWorkspace(this.connectedKey);
	}

	/**
	 * Drops the in-memory session so the next access re-resolves it from storage. Used when the primary
	 * connection changed underneath a warm integration (e.g. after `setPrimaryConnection`/
	 * `deleteConnection`). Unlike {@link reset}/{@link disconnect}, it deletes nothing from storage.
	 */
	switchConnection(): void {
		if (this._session === undefined) return;

		const wasConnected = this._session != null;
		this._session = undefined;
		this._onDidChange.fire();
		void this.refreshAfterSwitch(wasConnected);
	}

	private async refreshAfterSwitch(wasConnected: boolean): Promise<void> {
		const session = await this.ensureSession({ createIfNeeded: false });
		if (session != null || !wasConnected) return;

		this._onDidChange.fire();
		this.didChangeConnection?.fire({ integration: this, key: this.key, reason: 'disconnected' });
		await this.providerOnDisconnect?.();
	}

	private skippedNonCloudReported = false;
	@debug()
	async syncCloudConnection(state: 'connected' | 'disconnected', forceSync: boolean): Promise<void> {
		// Initially the condition on `this._session.cloud` has been added here: https://github.com/gitkraken/vscode-gitlens/commit/e95e70c430bd162924cc3bd5c1e8ab90e6293449#diff-4213141a45cccaab7aa2e40028b155a87eb913b07388485831403e60ce5555e4R237
		// I'm not sure about reasons, but it seems we want to replace it with the cloud session if it's connected.
		// Gradually we'll stop having non-cloud sessions.
		// However this is needed to be tested with PATs, e.g. with a GitLab PAT.
		if (this._session?.cloud === false && state !== 'connected') {
			if (this.id !== GitCloudHostIntegrationId.GitHub && !this.skippedNonCloudReported) {
				this.ctx.hooks?.session?.onRefreshSkipped?.({
					id: this.id,
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
				let resyncing = false;
				if (forceSync) {
					// Reset our stored session so that we get a new one from the cloud
					const authProvider = await this.authenticationService.get(this.authProvider.id);
					await authProvider.deleteSession(this.authProviderDescriptor);
					// Reset the session and clear our "stay disconnected" flag
					this._session = undefined;
					await this.ctx.storage.deleteWorkspace(this.connectedKey);
					resyncing = true;
				} else {
					// Only sync if we're not connected and not disabled and don't have pending errors
					if (
						this._session != null ||
						this.requestExceptionCount > 0 ||
						this.ctx.storage.getWorkspace(this.connectedKey) === false
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

				// The forced re-sync above deleted the cloud secret but preserved the descriptor to avoid UI
				// churn while a fresh token is fetched. If that fetch failed, drop the now token-less descriptor
				// so the connection isn't reported connected without a backing token (matches the pre-multi-account
				// clean-disconnect-on-failure behavior). The success path leaves the descriptor untouched.
				if (resyncing && newSession == null) {
					const authProvider = await this.authenticationService.get(this.authProvider.id);
					await authProvider.deleteSession(this.authProviderDescriptor, { preserveConfigured: false });
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
		options?: { scope?: ScopedLogger | undefined; silent?: boolean },
	): void {
		if (isCancellationError(ex)) return;

		options?.scope?.error(ex);

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
	protected async refreshSessionIfExpired(scope?: ScopedLogger): Promise<void> {
		if (this._session?.expiresAt != null && this._session.expiresAt < new Date()) {
			// The current session is expired, so get the latest from the cloud and refresh if needed
			try {
				await this.syncCloudConnection('connected', true);
			} catch (ex) {
				scope?.error(ex);
			}
		} else if (
			this._session?.expiresAt == null &&
			this.id !== GitCloudHostIntegrationId.GitHub &&
			!this.missingExpirityReported
		) {
			this.ctx.hooks?.session?.onRefreshSkipped?.({
				id: this.id,
				reason: 'missing-expiry',
				cloud: this._session?.cloud,
			});
			this.missingExpirityReported = true;
		}
	}

	@trace()
	trackRequestException(options?: { silent?: boolean }): void {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= IntegrationBase.requestExceptionLimit && this._session !== null) {
			if (!options?.silent) {
				this.ctx.hooks?.ui?.onDisconnectedAfterTooManyFailures?.(this.name);
			}
			void this.disconnect({ currentSessionOnly: true });
		}
	}

	@gate()
	@trace({ exit: true })
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
		if (this.ctx.config.isIntegrationsEnabled?.() === false) return undefined;

		if (createIfNeeded || sync) {
			await this.ctx.storage.deleteWorkspace(this.connectedKey);
		} else if (this.ctx.storage.getWorkspace(this.connectedKey) === false) {
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
			await this.ctx.storage.deleteWorkspace(this.connectedKey);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNeeded && !sync) {
			await this.ctx.storage.deleteWorkspace(this.connectedKey);
		}

		this._session = session ?? null;
		this.smoothifyRequestExceptionCount();

		if (session != null) {
			await this.ctx.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				this.didChangeConnection?.fire({ integration: this, key: this.key, reason: 'connected' });
				void this.providerOnConnect?.();
			});
		}

		return session ?? undefined;
	}

	getIgnoreSSLErrors(): boolean | 'force' {
		return this.authenticationService.ignoreSSLErrors(this);
	}

	async searchMyIssues(
		resource?: ResourceDescriptor,
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IssueShape[] | undefined>;
	async searchMyIssues(
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IssueShape[] | undefined>;
	@trace()
	async searchMyIssues(
		resources?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IssueShape[] | undefined> {
		return (await this.searchMyIssuesResult(resources, cancellation, connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link searchMyIssues}. Recovers thrown errors into `{ error }` so callers
	 * (e.g. the ProviderBackend account-wide issues read) can surface a per-provider warning instead of a
	 * silent empty result. Returns the normalized {@link IssueShape} (there is no raw account-wide issue read).
	 */
	async searchMyIssuesResult(
		resources?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IntegrationResult<IssueShape[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const issues = await this.searchProviderMyIssues(
				session,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount('searchMyIssues');
			return { value: issues };
		} catch (ex) {
			this.handleProviderException('searchMyIssues', ex, { scope: scope });
			return { error: ex };
		}
	}

	protected abstract searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined>;

	/**
	 * Truncation-aware variant of {@link searchProviderMyIssues}. The default wraps the normalized read and
	 * reports `truncated: false`; a provider whose account-wide search is capped without a cursor (GitHub)
	 * overrides this to report when the read is incomplete, so the facade can surface it instead of publishing
	 * a partial list as complete.
	 */
	protected async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
	): Promise<{ values: IssueShape[]; truncated: boolean } | undefined> {
		const values = await this.searchProviderMyIssues(session, resources, cancellation);
		if (values == null) return undefined;
		return { values: values, truncated: false };
	}

	/**
	 * Result-returning, truncation-aware account-wide issue read. Recovers thrown errors into `{ error }` and
	 * carries the `truncated` flag so the ProviderBackend facade can report an incomplete read honestly.
	 */
	async searchMyIssuesWithTruncationResult(
		resources?: ResourceDescriptor | ResourceDescriptor[],
		cancellation?: AbortSignal,
		connectionId?: string,
	): Promise<IntegrationResult<{ values: IssueShape[]; truncated: boolean } | undefined>> {
		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const result = await this.searchProviderMyIssuesWithTruncation(
				session,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount('searchMyIssues');
			return { value: result };
		} catch (ex) {
			this.handleProviderException('searchMyIssues', ex, { scope: scope });
			return { error: ex };
		}
	}

	@trace()
	async getLinkedIssueOrPullRequest(
		resource: T,
		link: { id: string; key: string },
		options?: { expiryOverride?: boolean | number; type?: IssueOrPullRequestType },
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const issueOrPR = this.ctx.cache.getIssueOrPullRequest(
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

	@trace()
	async getIssue(
		resource: T,
		id: string,
		options?: { expiryOverride?: boolean | number },
	): Promise<Issue | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const issue = this.ctx.cache.getIssue(
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
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const { expiryOverride, ...opts } = options ?? {};

		const currentAccount = await this.ctx.cache.getCurrentAccount(
			this,

			(cacheable: any) => ({
				value: (async () => {
					try {
						const account = await this.getProviderCurrentAccount?.(this._session!, opts);
						this.resetRequestExceptionCount('getCurrentAccount');
						return account;
					} catch (ex) {
						if (isCancellationError(ex)) {
							cacheable.invalidate();
							return undefined;
						}

						this.handleProviderException('getCurrentAccount', ex, { scope: scope });

						// Invalidate the cache on error, except for auth errors
						if (!(ex instanceof AuthenticationError)) {
							cacheable.invalidate();
						}

						// Re-throw to the caller
						throw ex;
					}
				})(),
			}),
			{ expiryOverride: expiryOverride, expireOnError: false },
		);
		return currentAccount;
	}

	protected getProviderCurrentAccount?(
		session: ProviderAuthenticationSession,
		options?: { avatarSize?: number },
	): Promise<Account | undefined>;

	/**
	 * Resolves the account for a specific session/token — including connections other than the current
	 * primary (multi-account) — using this integration's provider API base URL and auth type. Returns
	 * undefined when the provider doesn't support account lookup. Uncached (callers cache per connection).
	 */
	getProviderAccountForSession(session: ProviderAuthenticationSession): Promise<Account | undefined> {
		return this.getProviderCurrentAccount?.(session) ?? Promise.resolve(undefined);
	}

	@trace()
	async getPullRequest(resource: T, id: string): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const pr = await this.ctx.cache.getPullRequest(id, resource, this, () => ({
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
