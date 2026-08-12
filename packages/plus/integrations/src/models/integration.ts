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
import { RejectedTokenTracker } from '../authentication/rejectedTokenTracker.js';
import type { IntegrationIds, IssuesCloudHostIntegrationId } from '../constants.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { AuthenticationError, RequestClientError, toError } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import type { Sources } from '../telemetry.js';
import { areDomainsOnSameHost } from '../utils/domain.utils.js';
import { isGitSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { GitHostIntegration } from './gitHostIntegration.js';
import type { AccountWideIssuesResult, SearchMyIssuesOptions } from './issueReads.js';
import type { IssuesIntegration } from './issuesIntegration.js';

export type Integration = GitHostIntegration | IssuesIntegration;
export type IntegrationById<T extends IntegrationIds> = T extends IssuesCloudHostIntegrationId
	? IssuesIntegration
	: GitHostIntegration;
export type IntegrationType = 'git' | 'issues';

// The issue-read contracts live in their own module (pure data, and their relationship to each other is the
// point of reading them together); re-exported here so the providers that implement these reads keep one import.
export type { AccountWideIssuesResult, ProviderIssueSearchPage, SearchMyIssuesOptions } from './issueReads.js';
export type { ProviderPullRequestSearchPage } from './pullRequestReads.js';

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
	| 'getRepositoriesForUser'
	| 'getPullRequestForBranch'
	| 'getPullRequestForCommit'
	| 'getPullRequestsForRepos'
	| 'getRepositoryMetadata'
	| 'getResourcesForUser'
	| 'getSshSigningKeysForEmails'
	| 'countIssues'
	| 'countPullRequests'
	| 'mergePullRequest'
	| 'searchIssuesPage'
	| 'searchPullRequestsPage'
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
			this._sessionFingerprint = { session: this._session, hash: this.getSessionFingerprint(this._session) };
		}
		return this._sessionFingerprint.hash;
	}

	protected getSessionFingerprint(session: ProviderAuthenticationSession): string {
		return fnv1aHash64(session.accessToken);
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
		return this._session != null && this.isSessionForIntegrationHost(this._session) ? this._session : undefined;
	}

	private isSessionForIntegrationHost(session: ProviderAuthenticationSession): boolean {
		if (!isGitSelfManagedHostIntegrationId(this.id)) return true;

		return areDomainsOnSameHost(this.domain, session.domain);
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
			// A read of this connection previously failed with an AuthenticationError, so the token in
			// storage is known-refused. Ask for a refresh through the GK cloud before reading again, which
			// is this branch's equivalent of the primary path's `refreshSessionIfExpired`. Claimed here so
			// the forced refresh runs at most once per rejection.
			const refreshRejectedToken = this._rejectedTokens.claimRefresh(connectionId);
			// Degrade to "no results" on failure, matching the primary path (whose ensureSession/
			// refreshSessionIfExpired swallow errors) so read methods keep their never-throws contract.
			try {
				const authProvider = await this.authenticationService.get(this.authProvider.id);
				const session = await authProvider.getSession(
					{ ...this.authProviderDescriptor, connectionId: connectionId, cloud: true },
					{ source: source, refreshRejectedToken: refreshRejectedToken },
				);
				return session != null && this.isSessionForIntegrationHost(session) ? session : undefined;
			} catch (ex) {
				scope?.error(ex);
				return undefined;
			}
		}

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);
		return this._session != null && this.isSessionForIntegrationHost(this._session) ? this._session : undefined;
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
			// Awaited, not fire-and-forget: a caller that awaits `disconnect()` has to be able to rely on the
			// secrets and descriptors actually being gone when it resumes. Left floating, the only thing that
			// ever made this land in time was incidental scheduling slack — `syncCloudIntegrations` used to
			// await each provider in turn, so a later iteration's suspension let the previous provider's delete
			// finish. Syncing providers concurrently removes that slack and the clear was observably still
			// pending when the sync returned.
			await authProvider.deleteAllSessions(this.authProviderDescriptor);
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
		// `forceNewSession` below deletes the stored secrets to reconnect. Ahead of the guard — see
		// `onStoredTokensReplaced`.
		this.onStoredTokensReplaced();

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

	/**
	 * The per-connection counterpart of the primary session's expire-and-resync recovery: a token the
	 * provider refused is refreshed once through the GK cloud, which exchanges the refresh token server-side
	 * (the client never holds one). Armed by {@link handleProviderException} and consumed by
	 * {@link resolveReadSession}; a rejection it declines belongs to {@link trackRequestException} instead.
	 */
	private readonly _rejectedTokens = new RejectedTokenTracker();

	/**
	 * Called by every path that replaces or removes the stored tokens — a disconnect, a forced re-sync, a
	 * reauthentication, or the connection set changing. A rejection names a specific credential, so once that
	 * credential is gone the rejection describes nothing and must not force a refresh (or, for a deleted
	 * connection, outlive it).
	 *
	 * Deliberately NOT conditioned on `_session`. A per-connection read resolves through the auth provider and
	 * never populates the cached primary session, so the connections this recovery exists for are exactly the
	 * ones with no `_session` to inspect — the same blind spot the recovery itself was added to fix. Callers
	 * that guard on `_session` therefore invoke this ahead of that guard.
	 */
	protected onStoredTokensReplaced(): void {
		this._rejectedTokens.clear();
	}

	private static readonly requestExceptionLimit = 5;
	private requestExceptionCount = 0;

	resetRequestExceptionCount(syncReqUsecase: SyncReqUsecase | 'all'): void {
		this.requestExceptionCount = 0;
		if (syncReqUsecase === 'all') {
			this._syncRequestsPerFailedUsecase.clear();
			// 'all' is the whole-integration reset: a disconnect, or a re-sync that produced a new access token.
			this.onStoredTokensReplaced();
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
		// A connection was deleted, or a different one became primary. Ahead of the guard — see
		// `onStoredTokensReplaced`.
		this.onStoredTokensReplaced();

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
		const scope = getScopedLogger();
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
					// The stored token was just deleted. Not left to the token-changed check below, which needs
					// an `oldSession` — see `onStoredTokensReplaced`.
					this.onStoredTokensReplaced();
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
				let newSession: ProviderAuthenticationSession | undefined;
				let refetchFailed = false;
				try {
					newSession = await this.ensureSession({ sync: forceSync });
				} catch (ex) {
					// Not evidence the connection is gone (#5569). Also leaves `_session` as-is rather than
					// latching null, so the next access can re-resolve it.
					if (!isCancellationError(ex)) {
						scope?.error(ex);
					}
					refetchFailed = true;
				}

				if (oldSession && newSession && newSession.accessToken !== oldSession.accessToken) {
					this.resetRequestExceptionCount('all');
				}

				// The forced re-sync above deleted the cloud secret but kept the descriptor to avoid UI churn.
				// Drop it only when the replacement fetch came back definitively empty, so a connection whose
				// token is really gone is cleanly disconnected (#5497) while a healthy one survives a blip (#5569).
				if (resyncing && newSession == null && !refetchFailed) {
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
		options?: { scope?: ScopedLogger | undefined; silent?: boolean; connectionId?: string },
	): void {
		if (isCancellationError(ex)) return;

		options?.scope?.error(ex);

		// A per-connection (multi-account) read resolved its session through `resolveReadSession`'s
		// `connectionId` branch, which deliberately never touches the cached primary `_session`. So the
		// primary-session recovery below cannot apply to it: expiring `_session` would mark a session this
		// read never used, while the rejected connection kept its stored token and re-sent it on every
		// later read — a token the provider has already refused (expired scopes, a revoked grant, an
		// uninstalled app) is not self-healing, so the read failed identically until the user reconnected
		// by hand. Record the rejection against the connection instead; `resolveReadSession` consumes it
		// and forces the cloud `/refresh` on the next read of that connection. When there is nothing to
		// recover, fall through to the shared failure budget, which disconnects after
		// `requestExceptionLimit` and surfaces the reconnect prompt.
		if (ex instanceof AuthenticationError && options?.connectionId) {
			if (!this._rejectedTokens.recordRejection(options.connectionId)) {
				this.trackRequestException(options);
			}
			return;
		}

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
		const scope = getScopedLogger();

		const { createIfNeeded, forceNewSession, source, sync } = options;
		if (this._session != null) {
			if (this.isSessionForIntegrationHost(this._session)) return this._session;

			this._session = null;
		}
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
			if (session != null && !this.isSessionForIntegrationHost(session)) {
				session = undefined;
			}
		} catch (ex) {
			await this.ctx.storage.deleteWorkspace(this.connectedKey);

			// Only interactive paths can prompt for consent, so a sync failure must reach the rethrow below.
			if (!sync && ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			// On a forced re-sync, propagate so syncCloudConnection can tell a failure from a definitive empty
			// result (#5569); other callers keep swallowing to null so reads never throw.
			if (sync) {
				// Throwing skips the reset below, and a lingering count blocks the next non-forced sync.
				this.smoothifyRequestExceptionCount();
				throw ex;
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
				// Fired detached, so there is no caller left to catch anything: every implementor is async, and
				// a rejection would surface as a process-level unhandled rejection in the host. It is a
				// best-effort warm-up, so swallow the failure with a warning instead.
				void (async () => {
					try {
						await this.providerOnConnect?.();
					} catch (ex) {
						scope?.warn(
							`Failed to run providerOnConnect for ${this.key}: ${ex instanceof Error ? ex.message : String(ex)}`,
						);
					}
				})();
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

		const start = performance.now();
		try {
			const issues = await this.searchProviderMyIssues(
				session,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount('searchMyIssues');
			return { value: issues, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('searchMyIssues', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected abstract searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined>;

	/**
	 * Paging/truncation-aware variant of {@link searchProviderMyIssues}. The default wraps the normalized read
	 * as a complete single page; providers with native cursors or fan-out metadata override it.
	 */
	protected async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: AbortSignal,
		_options?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		// The default read has no assignee scoping to broaden, so `_options` is inert here; a provider whose
		// account-wide read is user-scoped (GitHub/GitLab/Azure) overrides this and honors `includeAllAssignees`.
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
		options?: SearchMyIssuesOptions,
	): Promise<IntegrationResult<AccountWideIssuesResult | undefined>> {
		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const result = await this.searchProviderMyIssuesWithTruncation(
				session,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
				options,
			);
			this.resetRequestExceptionCount('searchMyIssues');
			return { value: result };
		} catch (ex) {
			this.handleProviderException('searchMyIssues', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex) };
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
		connectionId?: string;
		expiryOverride?: boolean | number;
	}): Promise<Account | undefined> {
		const scope = getScopedLogger();
		const { connectionId: requestedConnectionId, expiryOverride, ...opts } = options ?? {};
		const connectionId = requestedConnectionId || undefined;
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const sessionFingerprint = this.getSessionFingerprint(session);

		const currentAccount = await this.ctx.cache.getCurrentAccount(
			this,

			(cacheable: any) => ({
				value: (async () => {
					try {
						const account = await this.getProviderCurrentAccount?.(session, opts);
						this.resetRequestExceptionCount('getCurrentAccount');
						return account;
					} catch (ex) {
						if (isCancellationError(ex)) {
							cacheable.invalidate();
							return undefined;
						}

						this.handleProviderException('getCurrentAccount', ex, {
							scope: scope,
							connectionId: connectionId,
						});

						// Invalidate the cache on error, except for auth errors
						if (!(ex instanceof AuthenticationError)) {
							cacheable.invalidate();
						}

						// Re-throw to the caller
						throw ex;
					}
				})(),
			}),
			{
				connectionId: connectionId,
				expiryOverride: expiryOverride,
				expireOnError: false,
				etag: `${this.id}:${this.maybeConnected ?? false}:${sessionFingerprint}`,
			},
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
