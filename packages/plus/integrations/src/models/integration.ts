import type { CollectionMetadata, CollectionScope } from '@gitkraken/provider-apis';
import { getDeferredRequestFailure } from '@gitlens/git/errors.js';
import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type {
	IssueOrPullRequest,
	IssueOrPullRequestState,
	IssueOrPullRequestType,
} from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationSessionDescriptor,
} from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { RejectedTokenTracker } from '../authentication/rejectedTokenTracker.js';
import type { ProviderRefusal, ProviderScopeFailure } from '../collectionMetadata.js';
import {
	attributeScopedAuthFailures,
	hasOnlyScopedAuthFailures,
	markCredentialRefusals,
	toCollectionScopeFailure,
} from '../collectionMetadata.js';
import type { IntegrationIds, IssuesCloudHostIntegrationId, IssuesHostIntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	isProviderUnreachableError,
	RequestClientError,
	toError,
} from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { providersMetadata } from '../providers/models.js';
import { isAzureProviderId } from '../providers/providerErrors.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import { throwIfAllSettledFailed } from '../providers/utils/providerPaging.js';
import type { ProviderWarningCause, ProviderWarningScope } from '../results.js';
import type { Sources } from '../telemetry.js';
import { areDomainsOnSameHost } from '../utils/domain.utils.js';
import { isSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { GitHostIntegration } from './gitHostIntegration.js';
import { getCachedIssue } from './issueCache.js';
import type { AccountWideIssuesResult, SearchMyIssuesOptions } from './issueReads.js';
import type { IssuesIntegration } from './issuesIntegration.js';

export type Integration = GitHostIntegration | IssuesIntegration;
export type IntegrationById<T extends IntegrationIds> = T extends IssuesHostIntegrationIds
	? IssuesIntegration
	: GitHostIntegration;
export type IntegrationType = 'git' | 'issues';

// The issue-read contracts live in their own module (pure data, and their relationship to each other is the
// point of reading them together); re-exported here so the providers that implement these reads keep one import.
export type {
	AccountWideIssuesResult,
	ProviderIssueSearchPage,
	ProviderSearchCount,
	SearchMyIssuesOptions,
} from './issueReads.js';
export type { ProviderPullRequestCount, ProviderPullRequestSearchPage } from './pullRequestReads.js';

// Keep this in step with `isSelfManagedHostIntegrationId`: it is the type-level twin of that predicate, and a
// disagreement compiles cleanly while the runtime writes a domain-keyed key the type says is unkeyed (so the
// local-disconnect flag is written under one key and read under another).
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

/** A per-connection read's session that could not be resolved for a retryable reason (see `resolveReadSession`). */
export class ReadSessionFailure {
	constructor(readonly error: Error) {}
}

export function isReadSessionFailure(
	session: ProviderAuthenticationSession | ReadSessionFailure | undefined,
): session is ReadSessionFailure {
	return session instanceof ReadSessionFailure;
}

/**
 * One target's answer in a batch read. A slot rejected by an authentication refusal carries the scope failure it was
 * recorded as (see `IntegrationBase.settleBatchRefusals`).
 */
export type BatchSlot<T> = PromiseFulfilledResult<T> | (PromiseRejectedResult & { failure?: ProviderScopeFailure });

/**
 * An input a pull request's etag can be widened to, each of which a host changes without moving `updatedAt`. Every
 * entry costs its own fields in the cheap check, so a caller picks only the ones it needs. `'checks'` is the check
 * rollup.
 */
export type PullRequestEtagInclude = 'mergeable' | 'reviewDecision' | 'checks';

/** Every {@link PullRequestEtagInclude}, in the canonical order an etag lists them in. */
export const pullRequestEtagIncludes: readonly PullRequestEtagInclude[] = ['mergeable', 'reviewDecision', 'checks'];

/**
 * The change state a batch read's etag is computed from (see `reads/etag.ts`), in the NORMALIZED vocabulary of
 * `PullRequestShape` — the values a full row carries after its provider's whole conversion chain, so a cheap
 * check and a full read of the same pull request yield the same fields. Each of `mergeableState`, `reviewDecision`
 * and `statusCheckRollupState` counts only when its {@link PullRequestEtagInclude} is requested.
 */
export interface PullRequestEtagFields {
	state: PullRequestState;
	isDraft?: boolean;
	updatedDate: Date;
	headSha?: string;
	mergeableState?: PullRequestMergeableState;
	reviewDecision?: PullRequestReviewDecision;
	statusCheckRollupState?: PullRequestStatusCheckRollupState;
	/**
	 * A fingerprint of the fields a host changes without moving an update time ({@link pullRequestRevision}); set
	 * only for hosts that keep none (Azure DevOps and Server). Part of the etag whenever it is set, not an include.
	 */
	revision?: string;
}

/**
 * The fields of a pull request {@link pullRequestRevision} reads, as a full row carries them. A `PullRequestShape`
 * is one, so a full read passes its row as is and a cheap check builds one from the same mapped values.
 */
export interface PullRequestRevisionSource {
	readonly title: string;
	readonly body?: string;
	readonly refs?: { readonly base: { readonly branch: string } };
	readonly reviewRequests?: readonly PullRequestRevisionReviewer[];
	readonly latestReviews?: readonly PullRequestRevisionReviewer[];
}

interface PullRequestRevisionReviewer {
	readonly reviewer: { readonly id: string };
	readonly state: PullRequestReviewState;
}

/**
 * {@link PullRequestEtagFields.revision}: a 64-bit hash of a pull request's title, description, target branch and
 * reviewers (each one's id and review state, in a canonical order). Hashed to keep the etag short, so a collision is
 * the only way a change can hide, at about 2^-64.
 */
export function pullRequestRevision(pr: PullRequestRevisionSource): string {
	return fnv1aHash64(
		JSON.stringify([
			pr.title,
			pr.body ?? null,
			pr.refs?.base.branch ?? null,
			toRevisionReviewers(pr.reviewRequests),
			toRevisionReviewers(pr.latestReviews),
		]),
	);
}

/** Each reviewer as its serialized `[id, state]`, sorted, so the host's order never moves the revision. */
function toRevisionReviewers(reviewers: readonly PullRequestRevisionReviewer[] | undefined): string[] | null {
	return reviewers?.map(r => JSON.stringify([r.reviewer.id, r.state])).sort() ?? null;
}

/**
 * An input an issue's etag can be widened to, which a host changes without moving `updatedAt`. `'reactions'` is the
 * thumbs-up count, and widens the etag only on hosts whose rows really fetch one (GitHub/GHE and GitLab).
 */
export type IssueEtagInclude = 'reactions';

/** Every {@link IssueEtagInclude}, in the canonical order an etag lists them in. */
export const issueEtagIncludes: readonly IssueEtagInclude[] = ['reactions'];

/** The issue twin of {@link PullRequestEtagFields}, in {@link IssueShape}'s normalized vocabulary. */
export interface IssueEtagFields {
	state: IssueOrPullRequestState;
	updatedDate: Date;
	/** Counts only when `'reactions'` is requested, and only from a row whose read fetched reactions. */
	thumbsUpCount?: number;
}

/** A batch read's target, in the form its provider addresses it by: a repository coordinate, or a tracker's resource. */
type BatchTarget = { owner: string; repo: string; project?: string } | { resourceId: string };

/**
 * The scope a batch read records a refused target under. It is decided here rather than in the read, which has the
 * same targets, because naming the refusal's cause (`describeRefusal`) needs it too. Azure DevOps: the organization
 * and project, since its refusals come from those (an organization's OAuth policy or tenant, a project's permissions)
 * and its work items belong to no repository. Every other git host: the repository, `owner/repo`, which is how its
 * repo-scoped reads record one. A tracker: the resource.
 */
function batchTargetScope(providerId: IntegrationIds, target: BatchTarget): CollectionScope {
	if ('resourceId' in target) return { providerId: providerId, resourceId: target.resourceId };
	if (isAzureProviderId(providerId)) {
		return { providerId: providerId, resourceId: target.owner, projectId: target.project };
	}
	return { providerId: providerId, repositoryId: `${target.owner}/${target.repo}` };
}

type SyncReqUsecase = Exclude<
	| 'getAccountForCommit'
	| 'getAccountForEmail'
	| 'getAccountForResource'
	| 'getCurrentAccount'
	| 'getDefaultBranch'
	| 'getIssue'
	| 'getIssueOrPullRequest'
	| 'getIssuesBatch'
	| 'getIssuesEtagFields'
	| 'getIssuesForProject'
	| 'getIssuesForRepos'
	| 'getMyPullRequestsForUser'
	| 'getOrganizationsForUser'
	| 'getProjectsForOrg'
	| 'getProjectsForResources'
	| 'getPullRequest'
	| 'getPullRequestsBatch'
	| 'getPullRequestsEtagFields'
	| 'getPullRequestsForBranches'
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

	/**
	 * The `gl-provider-<key>` glicon key for this provider, which is NOT always its id.
	 *
	 * `providersMetadata.iconKey` is the field that says which glyph a provider draws with, and a
	 * self-managed variant reuses its cloud family's — Jira Data Center draws with Jira's, because it is the
	 * same product and the id only selects an icon. Returning the id instead named a glyph the registry has
	 * no entry for, so a consumer rendering a `gl-provider-` glicon from `issue.provider.icon` requested a
	 * glyph that does not exist.
	 */
	get icon(): string {
		return providersMetadata[this.id]?.iconKey ?? this.id;
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
	/**
	 * Every change to the session (a resolution, a forced re-sync, a disconnect, a reauthentication, a connection
	 * switch, a refused token) runs here, one at a time. Each one reads storage and the cloud and then settles
	 * `_session`, the stored tokens and the connected flag; run concurrently, one would publish what it read over
	 * what another settled meanwhile (gitkraken/kepler#3546). Reads don't queue: they read `_session` as it is.
	 */
	private _sessionTransitions: Promise<void> = Promise.resolve();
	/**
	 * Runs `fn` after every transition queued before it. `fn` must not queue another transition and wait for it,
	 * which would wait for itself: inside a transition, call the `*Locked` methods instead.
	 */
	protected runSessionTransition<T>(fn: () => Promise<T>): Promise<T> {
		const run = this._sessionTransitions.then(fn);
		this._sessionTransitions = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/** An expired session is refreshed first; when that fails, nothing is returned rather than a token the provider refuses. */
	getSession(
		source: Sources,
	): ProviderAuthenticationSession | Promise<ProviderAuthenticationSession | undefined> | undefined {
		// Served as is even while a transition runs: a forced re-sync keeps the session it is replacing, and a read
		// meanwhile reads with it rather than waiting on the cloud.
		if (this._session === undefined) {
			return this.ensureSession({ createIfNeeded: false, source: source });
		}
		if (this._session == null || !this.isSessionForIntegrationHost(this._session)) return undefined;
		if (this.connectionExpired) return this.getRefreshedSession();

		return this._session;
	}

	private async getRefreshedSession(): Promise<ProviderAuthenticationSession | undefined> {
		const failure = await this.refreshSessionIfExpired();
		if (failure != null) return undefined;

		// The refresh may have been skipped (a non-cloud session) or overtaken by a disconnect or a switch.
		return this._session != null &&
			this.connectionExpired !== true &&
			this.isSessionForIntegrationHost(this._session)
			? this._session
			: undefined;
	}

	private isSessionForIntegrationHost(session: ProviderAuthenticationSession): boolean {
		if (!isSelfManagedHostIntegrationId(this.id)) return true;

		return areDomainsOnSameHost(this.domain, session.domain);
	}

	/**
	 * Resolves the session to read as, for a per-connection (multi-account) read. When `connectionId` is
	 * omitted this is the integration's primary session, resolved exactly like the existing read flow
	 * (ensure-connected + refresh-if-expired). When set, it resolves THAT connection's session directly
	 * from the auth provider — refreshing it if expired — WITHOUT disturbing the cached primary
	 * `_session`. Never throws: `undefined` when there is no session to read with (the connection is gone,
	 * the provider isn't connected), `{ error }` when the connection's token could not be fetched.
	 *
	 * The two must not be conflated. A token fetch that THROWS is, by `getConnectionSession`'s contract, a
	 * retryable failure (a rate-limited or failing GK API, a network error), not evidence that the connection is
	 * gone (#5569). Answering "no session" for it made every connection read during a GK API 429 report
	 * `no-connection`, which a consumer rightly treats as a credential to reconnect (gitkraken/kepler#3546).
	 * Returned as the read's error instead, the read core surfaces it like any other failed request: a rate
	 * limit as `rate-limit`, anything else as `other`.
	 */
	protected async resolveReadSession(
		connectionId: string | undefined,
		scope: ScopedLogger | undefined,
		source?: Sources,
	): Promise<ProviderAuthenticationSession | ReadSessionFailure | undefined> {
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
			// Never throws, matching the primary path (whose ensureSession/refreshSessionIfExpired swallow
			// errors), so read methods keep their never-throws contract.
			try {
				const authProvider = await this.authenticationService.get(this.authProvider.id);
				const session = await authProvider.getSession(
					{ ...this.authProviderDescriptor, connectionId: connectionId, cloud: true },
					{ source: source, refreshRejectedToken: refreshRejectedToken },
				);
				return session != null && this.isSessionForIntegrationHost(session) ? session : undefined;
			} catch (ex) {
				if (isCancellationError(ex)) return undefined;

				scope?.error(ex);
				return new ReadSessionFailure(toError(ex));
			}
		}

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		// The primary path's equivalent of the per-connection failure above: an expired session the cloud could not
		// replace right now is the refresh's failure, not a missing connection, and is never read with.
		const refreshFailure = await this.refreshSessionIfExpired();
		if (refreshFailure != null) return new ReadSessionFailure(refreshFailure);

		return this._session != null && this.isSessionForIntegrationHost(this._session) ? this._session : undefined;
	}

	/**
	 * The session lookups' prelude for a caller that can surface a failure (`throwOnError`): the refresh's failure to
	 * report, or `'unconnected'`, so a throttled refresh is not mistaken for "no pull request" and kept.
	 */
	protected async prepareSessionLookup(): Promise<Error | 'unconnected' | undefined> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return 'unconnected';

		const failure = await this.refreshSessionIfExpired();
		if (failure != null) return failure;

		// A disconnect, or a refetch the cloud answered for another host, can leave no session to read with.
		return this._session != null ? undefined : 'unconnected';
	}

	/**
	 * {@link resolveReadSession} for a read that already rethrows its provider's failures (a repository or account
	 * lookup), or whose callers treat any failure as "nothing to show": a token that could not be fetched is
	 * thrown like those failures, so it is classified as the failed request it is rather than as a missing
	 * connection.
	 */
	protected async resolveReadSessionOrThrow(
		connectionId: string | undefined,
		scope: ScopedLogger | undefined,
	): Promise<ProviderAuthenticationSession | undefined> {
		const session = await this.resolveReadSession(connectionId, scope);
		if (isReadSessionFailure(session)) throw session.error;

		return session;
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

		let signOut = !options?.currentSessionOnly;

		// Asked before queueing: the user's answer can take any time, and the queue must not wait on it.
		if (this._session != null && !options?.currentSessionOnly && !options?.silent) {
			const decision = await this.ctx.hooks?.onConfirmDisconnect?.({
				integrationName: this.name,
				offerSignOut: this.authenticationService.supports(this.authProvider.id),
			});
			if (decision == null) return;

			signOut = decision.signOut;
		}

		// Waits for a forced re-sync in flight, so the session it settles cannot land over the disconnect.
		await this.runSessionTransition(() => this.disconnectLocked(options, signOut));
	}

	private async disconnectLocked(
		options: { silent?: boolean; currentSessionOnly?: boolean } | undefined,
		signOut: boolean,
	): Promise<void> {
		if (options?.currentSessionOnly && this._session === null) return;

		const connected = this._session != null;

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

		const cleared = await this.runSessionTransition(() => {
			if (this._session === undefined) return Promise.resolve(false);

			this._session = undefined;
			return Promise.resolve(true);
		});
		if (!cleared) return;

		void (await this.ensureSession({ createIfNeeded: true, forceNewSession: true }));
	}

	refresh(): void {
		void this.ensureSession({ createIfNeeded: false });
	}

	/**
	 * Drops the cached session when its token is no longer `accessToken` (a session replaced outside the
	 * integration) and resolves it again, in one transition, so nothing in flight publishes the replaced one.
	 */
	protected resyncSessionIfTokenChanged(accessToken: string | undefined): Promise<void> {
		return this.runSessionTransition(async () => {
			if (this._session != null && this._session.accessToken !== accessToken) {
				this._session = undefined;
			}
			await this.resolveSessionLocked({ createIfNeeded: false });
		});
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
		this.invalidateDiscoveryCaches();
	}

	/**
	 * Drops what this integration discovered through its session and kept for later reads: a tracker's sites,
	 * projects or teams. Called by every path that replaces the stored tokens (see {@link onStoredTokensReplaced}),
	 * which includes the forced re-sync a consumer's refresh runs, and by a read asked to `forceSync`. A refresh is
	 * the consumer saying the account may have changed, and a project created or deleted since the first read would
	 * otherwise stay invisible, or keep being searched, for the rest of the session (#5907).
	 */
	invalidateDiscoveryCaches(): void {}

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
		await this.runSessionTransition(async () => {
			await this.disconnectLocked({ silent: true }, true);
			await this.ctx.storage.deleteWorkspace(this.connectedKey);
		});
	}

	/**
	 * Drops the in-memory session so the next access re-resolves it from storage. Used when the primary
	 * connection changed underneath a warm integration (e.g. after `setPrimaryConnection`/
	 * `deleteConnection`). Unlike {@link reset}/{@link disconnect}, it deletes nothing from storage.
	 */
	switchConnection(): Promise<void> {
		// A connection was deleted, or a different one became primary. Ahead of the guard — see
		// `onStoredTokensReplaced`.
		this.onStoredTokensReplaced();

		// Queued, so a resolution already running finishes with the former primary and this one then re-resolves.
		return this.runSessionTransition(async () => {
			if (this._session === undefined) return;

			const wasConnected = this._session != null;
			this._session = undefined;
			this._onDidChange.fire();

			const session = await this.resolveSessionLocked({ createIfNeeded: false });
			if (session != null || !wasConnected) return;

			this._onDidChange.fire();
			this.didChangeConnection?.fire({ integration: this, key: this.key, reason: 'disconnected' });
			await this.providerOnDisconnect?.();
		});
	}

	private skippedNonCloudReported = false;
	/**
	 * Resolves the re-sync's failure, when its token fetch threw (cancellations included), so a caller can report it.
	 * Never rejects: the cloud sync fans this out over every integration and must not fail on one.
	 */
	@debug()
	syncCloudConnection(state: 'connected' | 'disconnected', forceSync: boolean): Promise<Error | undefined> {
		return this.runSessionTransition(() => this.syncCloudConnectionLocked(state, forceSync));
	}

	private async syncCloudConnectionLocked(
		state: 'connected' | 'disconnected',
		forceSync: boolean,
	): Promise<Error | undefined> {
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
			return undefined;
		}

		let failure: Error | undefined;
		switch (state) {
			case 'connected': {
				const oldSession = this._session;
				let resyncing = false;
				if (forceSync) {
					// Get a new session from the cloud. The stored one is refetched rather than deleted first (see
					// `GetSessionOptions.refetch`), so a fetch that fails transiently keeps the token it had.
					// Not left to the token-changed check below, which needs an `oldSession` — see
					// `onStoredTokensReplaced`.
					this.onStoredTokensReplaced();
					// The cached session is kept while the replacement is fetched (the refetch does not read it): a
					// transient failure then leaves it as it was, expiry included, and a read meanwhile does not have to
					// resolve a session of its own, which during a GK API outage fails the same way and reports the
					// integration as not connected (gitkraken/kepler#3546). Clear our "stay disconnected" flag.
					await this.ctx.storage.deleteWorkspace(this.connectedKey);
					resyncing = true;
				} else {
					// Only sync if we're not connected and not disabled and don't have pending errors
					if (
						this._session != null ||
						this.requestExceptionCount > 0 ||
						this.ctx.storage.getWorkspace(this.connectedKey) === false
					) {
						return undefined;
					}

					forceSync = true;
				}

				// sync option, rather than createIfNeeded, makes sure we don't call connectCloudIntegrations and open a gkdev window
				// if there was no session or some problem fetching/refreshing the existing session from the cloud api
				let newSession: ProviderAuthenticationSession | undefined;
				let refetchFailed = false;
				try {
					newSession = await this.resolveSessionLocked({ sync: forceSync, refetch: resyncing });
				} catch (ex) {
					refetchFailed = true;
					if (!isCancellationError(ex)) {
						scope?.error(ex);
					}
					// Not evidence the connection is gone (#5569). A cancelled refetch is still reported: its caller must
					// not read with the session it could not replace.
					failure = toError(ex);
				}

				if (oldSession && newSession && newSession.accessToken !== oldSession.accessToken) {
					this.resetRequestExceptionCount('all');
				}

				// The forced re-sync above kept the stored token and its descriptor until a replacement arrived.
				// Drop both only when the replacement fetch came back definitively empty, so a connection whose
				// token is really gone is cleanly disconnected (#5497) while a healthy one survives a blip (#5569).
				if (resyncing && newSession == null && !refetchFailed) {
					const authProvider = await this.authenticationService.get(this.authProvider.id);
					await authProvider.deleteSession(this.authProviderDescriptor, { preserveConfigured: false });
				}

				break;
			}
			case 'disconnected':
				await this.disconnectLocked({ silent: true }, true);
				break;
		}
		this._resyncs++;
		this._lastResyncFailure = failure;
		return failure;
	}

	/**
	 * Proves the credential with an uncached check, rejecting with the provider's `AuthenticationError` when it is
	 * refused, and with anything else when the check proves nothing. A `403` proves nothing either: the credential
	 * authenticated and was only denied the check's request.
	 *
	 * Implemented by the providers whose reads can reach their scopes without an uncached request to the connection
	 * first: discovery served from a per-token cache (Azure DevOps, Bitbucket, Jira Cloud), or an SDK fan-out across
	 * the requested repositories (Bitbucket Data Center). There, a dead token comes back as scoped refusals with no
	 * failure of the connection: the same shape as one scope refusing a sound credential.
	 * {@link confirmScopedAuthFailures} uses this to tell the two apart.
	 */
	protected validateCredential?(session: ProviderAuthenticationSession): Promise<void>;

	/**
	 * Credentials that passed {@link validateCredential} within the last minute. A probe already in flight is
	 * shared rather than repeated, and a refused one is not kept. Cleared whenever a credential is refused (see
	 * {@link handleProviderException}), so a pass is never vouched for past a refusal this instance has seen.
	 */
	private readonly _validatedCredentials = new PromiseCache<string, void>({ createTTL: 60 * 1000, capacity: 10 });

	/**
	 * Whether a scope's refusal is the credential's own, by the provider's account of it: e.g. a token missing the
	 * OAuth scopes the read needs. The probe cannot see that, because it proves the token authenticates, not that
	 * it is authorized. So {@link confirmScopedAuthFailures} publishes one for the connection, unscoped, which asks
	 * for the reconnect (consenting to the scopes again) that fixes it, and keeps the results of the scopes that
	 * answered.
	 */
	protected isCredentialRefusal?(refusal: ProviderRefusal): boolean;

	/**
	 * Names why a confirmed credential was refused by one scope, from what the refusal said (see
	 * `ProviderWarning.cause`). Called only by {@link confirmScopedAuthFailures}, once the credential passed: the
	 * refusals this names are indistinguishable from a dead credential until then.
	 */
	protected describeRefusal?(
		session: ProviderAuthenticationSession,
		refusal: ProviderRefusal,
		scope: ProviderWarningScope,
	): ProviderWarningCause | undefined;

	/**
	 * Settles what a read's only-scoped authentication failures mean, when the provider can tell (see
	 * {@link validateCredential}).
	 *
	 * A refused credential is thrown: the caller's `catch` then fails the read as a whole, exactly as it does when
	 * discovery is not cached and the first request is the one refused. Without this, a token revoked after
	 * discovery would publish scoped `auth` warnings, which a consumer must not answer with a reconnect (see
	 * `ProviderWarning.scope`), next to results served from the cache, for as long as the token stays stored.
	 *
	 * A confirmed credential makes each refusal the scope's own, so its cause is named through
	 * {@link describeRefusal}. A probe that fails for another reason proves nothing either way and leaves the read
	 * as it was.
	 *
	 * A refusal the provider pins on the credential itself (see {@link isCredentialRefusal}) is published for the
	 * connection instead, without a probe.
	 *
	 * A token that passed within the last minute is not probed again, so a scope that keeps refusing it costs one
	 * probe a minute, and a revocation right after a probe can take up to a minute to surface: until then its
	 * refusals stay scoped, and may be named. A probe that proved nothing is not remembered, so the next read probes
	 * again, and a credential no probe can confirm (e.g. a Bitbucket Data Center project access token) is probed on
	 * every read that has scoped refusals.
	 */
	protected async confirmScopedAuthFailures(
		session: ProviderAuthenticationSession,
		metadata: CollectionMetadata | undefined,
	): Promise<void> {
		if (!hasOnlyScopedAuthFailures(metadata)) return;

		// Published for the connection, as a refusal outside any scope would be, while the scopes that answered keep
		// their results. That already asks for a reconnect, so there is nothing left for a probe to settle.
		if (this.markCredentialRefusals(metadata)) return;
		if ((await this.confirmCredential(session)) !== 'confirmed') return;

		this.nameRefusalCauses(session, metadata);
	}

	/**
	 * Settles what a batch read's authentication refusals mean before the call is judged, as
	 * {@link confirmScopedAuthFailures} settles an account-wide read's: each refused slot comes back carrying the scope
	 * failure it was recorded as, against the scope its target names (see {@link batchTargetScope}), and a read
	 * publishes that instead of the bare reason.
	 *
	 * When any target answered, that proved the credential, so each refusal is its own target's. When every target
	 * failed, the call fails as a whole, as it always has, unless every failure is a refusal of a credential that checks
	 * out. Every target refusing is also what a dead credential looks like, so the credential is checked once first,
	 * with {@link validateCredential}. A check that proves nothing leaves the refusals scoped and unnamed, as it leaves
	 * an account-wide read's. A provider with no check cannot tell, and a refusal it pins on the credential (see
	 * {@link isCredentialRefusal}) needs none, so either still fails the call.
	 *
	 * `keepOtherFailures` is for the etag cheap check, whose failed targets fall through to a full read one by one:
	 * there, only a refused credential fails the call, always on one of the refusals, and every other failure stays
	 * its own slot's. A batch with refusals and other failures but no answer then has its credential checked, as when
	 * every target refused, and a provider with no check leaves its refusals scoped and unnamed.
	 */
	protected async settleBatchRefusals<T>(
		session: ProviderAuthenticationSession,
		targets: readonly BatchTarget[],
		slots: PromiseSettledResult<T>[],
		options?: { keepOtherFailures?: boolean },
	): Promise<BatchSlot<T>[]> {
		const keepOtherFailures = options?.keepOtherFailures ?? false;
		const failures = slots.map((slot, i) =>
			slot.status === 'rejected' && slot.reason instanceof AuthenticationError
				? toCollectionScopeFailure(batchTargetScope(this.id, targets[i]), slot.reason)
				: undefined,
		);
		const refused = failures.filter(f => f != null);
		if (!refused.length) {
			if (!keepOtherFailures) {
				throwIfAllSettledFailed(slots);
			}
			return slots;
		}

		const metadata: CollectionMetadata = { completeness: 'partial', failures: refused };
		const credentialRefused = this.markCredentialRefusals(metadata);
		if (slots.some(slot => slot.status === 'fulfilled')) {
			this.nameRefusalCauses(session, metadata);
		} else if (credentialRefused) {
			throwIfAllSettledFailed(keepOtherFailures ? slots.filter((_, i) => failures[i] != null) : slots);
		} else if (refused.length < slots.length && !keepOtherFailures) {
			// Fails on a target that failed for another reason: failing on a refusal would run the credential's own
			// recovery (a session expiry or a disconnect strike) for what may be only its target's refusal.
			throwIfAllSettledFailed(slots.filter((_, i) => failures[i] == null));
		} else {
			const confirmation = await this.confirmCredential(session);
			if (confirmation == null) {
				if (refused.length === slots.length) {
					throwIfAllSettledFailed(slots);
				}
			} else if (confirmation === 'confirmed') {
				this.nameRefusalCauses(session, metadata);
			}
		}

		return slots.map((slot, i) => {
			const failure = failures[i];
			return slot.status === 'rejected' && failure != null ? { ...slot, failure: failure } : slot;
		});
	}

	/**
	 * Shows one notice, and spends at most one strike, for a batch read whose targets failed with a server error or a
	 * timeout. Our own clients leave both to the batch (see `reportRequestFailure`) instead of spending them per
	 * target. `strike` is true only when every target failed and the call's own failure spent none: a call that
	 * answered some targets showed the host is up, and budgets strikes the same way as the rest of its failures.
	 */
	protected reportDeferredRequestFailures(
		slots: readonly PromiseSettledResult<unknown>[] | undefined,
		strike: boolean,
	): void {
		let notify: (() => void) | undefined;
		for (const slot of slots ?? []) {
			if (slot.status !== 'rejected') continue;

			notify = getDeferredRequestFailure(slot.reason);
			if (notify != null) break;
		}

		if (notify == null) return;

		if (strike) {
			this.trackRequestException();
		}
		notify();
	}

	/**
	 * The failure handling of an etag cheap check that failed as a whole. Only a refused credential runs
	 * {@link handleProviderException}, for its session expiry, re-authentication and strike. Anything else is only
	 * logged, spending no strike and showing no notice: every target the check held then falls through to a full
	 * read, which spends and notifies if the host really is failing, or is dropped, as rate-limited or without a
	 * connection, with the check's warning. A rate limit costs nothing in `handleProviderException` either.
	 */
	protected handleEtagCheckException(
		syncReqUsecase: SyncReqUsecase,
		ex: Error,
		options: { scope: ScopedLogger | undefined; connectionId: string | undefined },
	): void {
		if (ex instanceof AuthenticationError) {
			this.handleProviderException(syncReqUsecase, ex, options);
			return;
		}
		if (isCancellationError(ex)) return;

		if (options.scope != null) {
			options.scope.error(ex);
		} else {
			Logger.error(ex);
		}
	}

	/** Marks the scoped refusals the provider pins on the credential (see {@link isCredentialRefusal}). */
	private markCredentialRefusals(metadata: CollectionMetadata | undefined): boolean {
		const isCredentialRefusal = this.isCredentialRefusal?.bind(this);
		return isCredentialRefusal != null && markCredentialRefusals(metadata, isCredentialRefusal);
	}

	/**
	 * Checks the credential with {@link validateCredential}, rethrowing the provider's refusal when it is refused.
	 * `undefined` when the provider has no check, and `'unproven'` when the check proved nothing either way.
	 */
	private async confirmCredential(
		session: ProviderAuthenticationSession,
	): Promise<'confirmed' | 'unproven' | undefined> {
		const validateCredential = this.validateCredential?.bind(this);
		if (validateCredential == null) return undefined;

		// Keyed by the address as well as the token: a self-managed instance serves every installation on its host,
		// and one installation accepting a token says nothing about another.
		const key = [session.domain, session.baseUrl ?? '', session.accessToken].join('\n');
		try {
			await this._validatedCredentials.getOrCreate(key, () => validateCredential(session));
		} catch (ex) {
			// A 403 answered a credential that authenticated and was only denied the check's own request, so it proves
			// nothing about the scopes' refusals either.
			if (ex instanceof AuthenticationError && ex.reason !== AuthenticationErrorReason.Forbidden) throw ex;

			return 'unproven';
		}
		return 'confirmed';
	}

	/** Names each scoped refusal's cause (see {@link describeRefusal}); only once the credential is proven. */
	private nameRefusalCauses(session: ProviderAuthenticationSession, metadata: CollectionMetadata | undefined): void {
		const describeRefusal = this.describeRefusal?.bind(this);
		if (describeRefusal == null) return;

		attributeScopedAuthFailures(metadata, (refusal, scope) => describeRefusal(session, refusal, scope));
	}

	/** Returns whether it spent a strike toward disconnecting (see {@link trackRequestException}). */
	protected handleProviderException(
		syncReqUsecase: SyncReqUsecase,
		ex: Error,
		options?: { scope?: ScopedLogger | undefined; silent?: boolean; connectionId?: string },
	): boolean {
		if (isCancellationError(ex)) return false;

		// A refused credential may be one a probe passed moments ago: stop vouching for it.
		if (ex instanceof AuthenticationError) {
			this._validatedCredentials.clear();
		}

		if (options?.scope != null) {
			options.scope.error(ex);
		} else {
			Logger.error(ex);
		}

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
			if (this._rejectedTokens.recordRejection(options.connectionId)) return false;

			this.trackRequestException(options);
			return true;
		}

		if (ex instanceof AuthenticationError && this._session?.cloud && !this.hasSessionSyncRequests()) {
			this.requestSessionSyncForUsecase(syncReqUsecase);
			// Expired now, so a read in progress stops using it, and again once any transition in flight settles, in
			// case it publishes the same token anew (compared by token: a re-read is a new object).
			const refused = this._session.accessToken;
			this.expireSessionIfToken(refused);
			void this.runSessionTransition(() => {
				this.expireSessionIfToken(refused);
				return Promise.resolve();
			});
			return false;
		}

		if (!(ex instanceof AuthenticationError) && !(ex instanceof RequestClientError)) return false;

		this.trackRequestException(options);
		return true;
	}

	private expireSessionIfToken(accessToken: string): void {
		if (this._session?.accessToken !== accessToken || this.connectionExpired === true) return;

		this._session = { ...this._session, expiresAt: new Date(Date.now() - 1) };
	}

	/** Counts completed cloud re-syncs, so a refresh queued behind one reuses its outcome rather than running another. */
	private _resyncs = 0;
	private _lastResyncFailure: Error | undefined;
	private missingExpirityReported = false;
	/**
	 * Resolves the refresh's failure while the session it could not replace is still unusable, so a read can report
	 * that instead of reading with an expired token or as a missing connection.
	 */
	@gate()
	protected async refreshSessionIfExpired(): Promise<Error | undefined> {
		if (this._session?.expiresAt != null && this._session.expiresAt < new Date()) {
			// The current session is expired, so get the latest from the cloud and refresh if needed. Queued, so it
			// sees what any transition in flight settles: a re-sync that already replaced the session, or ran meanwhile
			// and could not, is not repeated, and a disconnect stands.
			const resyncs = this._resyncs;
			return this.runSessionTransition(async () => {
				let failure: Error | undefined;
				if (this._resyncs !== resyncs) {
					failure = this._lastResyncFailure;
				} else if (this._session != null && this.connectionExpired === true) {
					try {
						failure = await this.syncCloudConnectionLocked('connected', true);
					} catch (ex) {
						failure = toError(ex);
					}
				}
				// Only a session still there and still expired is this read's failure, including one a provider
				// refusal expired again after the re-sync replaced it.
				if (this._session == null || this.connectionExpired !== true) return undefined;

				return failure ?? new Error(`The ${this.name} session could not be refreshed`);
			});
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
		return undefined;
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
		// Not `getSession()`: an expired session is still a connection, and refreshing it here would put a GK API round
		// trip on every connection check and report a throttled refresh as no connection (gitkraken/kepler#3546).
		const session =
			this._session === undefined
				? await this.ensureSession({ createIfNeeded: false, source: 'integrations' })
				: this._session;
		return session != null && this.isSessionForIntegrationHost(session);
	}

	@gate()
	private async ensureSession(
		options:
			| {
					createIfNeeded?: boolean;
					forceNewSession?: boolean;
					sync?: never;
					refetch?: never;
					source?: Sources;
			  }
			| {
					createIfNeeded?: never;
					forceNewSession?: never;
					sync: boolean;
					refetch?: boolean;
					source?: Sources;
			  },
	): Promise<ProviderAuthenticationSession | undefined> {
		if (options.createIfNeeded || options.forceNewSession) {
			// The sign-in runs outside the queue: it waits on the user, and its cloud sync re-enters this integration
			// (`syncCloudConnection`, `isConnected`), which would wait for it. What it stored is then resolved in a
			// transition, so a disconnect during the sign-in still stands.
			if (!(await this.signIn(options))) return this._session ?? undefined;

			return this.runSessionTransition(() => this.resolveSessionLocked({ createIfNeeded: false }));
		}

		return this.runSessionTransition(() => this.resolveSessionLocked(options));
	}

	/**
	 * Asks the auth provider for a session interactively, storing what it gets; whether one came back. A declined
	 * consent or any other failure is not one, and never throws: it is resolved, like any read, from storage.
	 */
	private async signIn(options: {
		createIfNeeded?: boolean;
		forceNewSession?: boolean;
		source?: Sources;
	}): Promise<boolean> {
		if (this.ctx.config.isIntegrationsEnabled?.() === false) return false;

		await this.ctx.storage.deleteWorkspace(this.connectedKey);
		try {
			const authProvider = await this.authenticationService.get(this.authProvider.id);
			return (await authProvider.getSession(this.authProviderDescriptor, options)) != null;
		} catch {
			return false;
		}
	}

	/** Resolves and publishes the session. Only ever runs inside a transition (see {@link runSessionTransition}). */
	private async resolveSessionLocked(options: {
		createIfNeeded?: boolean;
		sync?: boolean;
		refetch?: boolean;
		source?: Sources;
	}): Promise<ProviderAuthenticationSession | undefined> {
		const scope = getScopedLogger();

		const { createIfNeeded, source, sync, refetch } = options;
		// A forced re-sync keeps the session it is replacing; serving it would skip the refetch the caller forced.
		if (this._session != null && !refetch) {
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
					? { sync: sync, refetch: refetch, source: source }
					: { createIfNeeded: createIfNeeded, source: source },
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
				// best-effort warm-up, so swallow the failure with a warning instead. Never awaited by the
				// transition: its reads can disconnect, which queues a transition of their own.
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
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

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
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const result = await this.searchProviderMyIssuesWithTruncation(
				session,
				resources != null ? (Array.isArray(resources) ? resources : [resources]) : undefined,
				cancellation,
				options,
			);
			await this.confirmScopedAuthFailures(session, result?.metadata);
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
		options?: { expiryOverride?: boolean | number; type?: IssueOrPullRequestType; throwOnError?: boolean },
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getScopedLogger();

		if ((await this.prepareSessionLookup()) != null) return undefined;

		const { throwOnError, ...cacheOptions } = options ?? {};

		const issueOrPR = this.ctx.cache.getIssueOrPullRequest(
			link.key,
			options?.type,
			resource,
			this,
			cacheable => ({
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
						// A failed lookup is not an answer — and a missed issue/PR never expires from the cache.
						cacheable.invalidate();
						this.handleProviderException('getIssueOrPullRequest', ex, { scope: scope });
						if (throwOnError) throw ex;

						return undefined;
					}
				})(),
			}),
			cacheOptions,
		);
		return issueOrPR;
	}

	protected abstract getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		resource: T,
		link: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined>;

	async getIssue(
		resource: T,
		id: string,
		options?: { connectionId?: string; expiryOverride?: boolean | number },
	): Promise<Issue | undefined> {
		return (await this.getIssueResult(resource, id, options))?.value;
	}

	getIssueResult(
		resource: T,
		id: string,
		options?: { connectionId?: string; expiryOverride?: boolean | number },
	): Promise<IntegrationResult<Issue | undefined>> {
		return this.getIssueResultCore(resource, id, options, session => this.getProviderIssue(session, resource, id));
	}

	@trace()
	protected async getIssueResultCore(
		resource: ResourceDescriptor,
		id: string,
		options: { connectionId?: string; expiryOverride?: boolean | number } | undefined,
		getProviderIssue: (session: ProviderAuthenticationSession) => Promise<Issue | undefined>,
	): Promise<IntegrationResult<Issue | undefined>> {
		const scope = getScopedLogger();
		const { connectionId: requestedConnectionId, expiryOverride } = options ?? {};
		const connectionId = requestedConnectionId || undefined;
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const issue = await getCachedIssue({
				cache: this.ctx.cache,
				id: id,
				resource: resource,
				integration: this,
				load: async () => {
					try {
						const issue = await getProviderIssue(session);
						this.resetRequestExceptionCount('getIssue');
						return issue;
					} catch (ex) {
						if (!isCancellationError(ex)) {
							this.handleProviderException('getIssue', toError(ex), {
								scope: scope,
								connectionId: connectionId,
							});
						}
						throw ex;
					}
				},
				cacheOptions: {
					connectionId: connectionId,
					expiryOverride: expiryOverride,
					etag: `${this.id}:${this.maybeConnected ?? false}:${this.getSessionFingerprint(session)}`,
				},
			});
			return { value: issue };
		} catch (ex) {
			return { error: toError(ex) };
		}
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
		const session = await this.resolveReadSessionOrThrow(connectionId, scope);
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
						if (isCancellationError(ex) && !isProviderUnreachableError(ex)) {
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

	/** Whether this integration can answer {@link getCurrentAccount} at all — Jira, Linear and Trello cannot. */
	get supportsCurrentAccount(): boolean {
		return this.getProviderCurrentAccount != null;
	}

	/**
	 * Resolves the account for a specific session/token — including connections other than the current
	 * primary (multi-account) — using this integration's provider API base URL and auth type. Returns
	 * undefined when the provider doesn't support account lookup. Uncached (callers cache per connection).
	 */
	getProviderAccountForSession(session: ProviderAuthenticationSession): Promise<Account | undefined> {
		return this.getProviderCurrentAccount?.(session) ?? Promise.resolve(undefined);
	}

	@trace()
	async getPullRequest(
		resource: T,
		id: string,
		options?: { expiryOverride?: boolean | number; throwOnError?: boolean },
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		const refreshFailure = await this.prepareSessionLookup();
		if (refreshFailure === 'unconnected') return undefined;
		if (refreshFailure != null) {
			if (options?.throwOnError) throw refreshFailure;
			return undefined;
		}

		const pr = await this.ctx.cache.getPullRequest(
			id,
			resource,
			this,
			cacheable => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequest?.(this._session!, resource, id);
						this.resetRequestExceptionCount('getPullRequest');
						return result;
					} catch (ex) {
						// A failed lookup is not an answer — and the by-id bucket never expires a miss.
						cacheable.invalidate();
						this.handleProviderException('getPullRequest', ex, { scope: scope });
						if (options?.throwOnError) throw ex;

						return undefined;
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return pr;
	}

	protected getProviderPullRequest?(
		session: ProviderAuthenticationSession,
		resource: T,
		id: string,
	): Promise<PullRequest | undefined>;
}
