import type { Account } from '@gitlens/git/models/author.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { mapBounded, mapSettledBounded } from '@gitlens/utils/promise.js';
import type { ProviderAuthenticationSession, SessionPublication } from '../authentication/models.js';
import { failsEveryScope } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import { toError } from '../errors.js';
import type { ProviderApiCollectionResult } from '../providers/models.js';
import type {
	BatchSlot,
	Integration,
	IntegrationResult,
	IntegrationType,
	IssueEtagFields,
	IssueEtagInclude,
} from './integration.js';
import { IntegrationBase, isReadSessionFailure } from './integration.js';
import type { IssuesForProjectOptions, ProjectIssuesDrain, ProjectIssuesRequest } from './issueReads.js';

/**
 * Groups requests into searches of at most `maxPerSearch` projects sharing `searchKey`. Undefined, reading
 * every project on its own, when any request has no key, i.e. cannot be searched together with others.
 */
export function groupProjectIssuesSearches<P>(
	requests: readonly ProjectIssuesRequest<P>[],
	searchKey: (request: ProjectIssuesRequest<P>) => string | undefined,
	maxPerSearch: number = Number.POSITIVE_INFINITY,
): number[][] | undefined {
	const searchesByKey = new Map<string, number[][]>();
	for (let index = 0; index < requests.length; index++) {
		const key = searchKey(requests[index]);
		if (key == null) return undefined;

		let searches = searchesByKey.get(key);
		if (searches == null) {
			searches = [];
			searchesByKey.set(key, searches);
		}

		let search = searches.at(-1);
		if (search == null || search.length >= maxPerSearch) {
			search = [];
			searches.push(search);
		}
		search.push(index);
	}
	return [...searchesByKey.values()].flat();
}

/**
 * Splits one search's issues back to its projects, in the order of `projectKeys`. Undefined when an issue belongs to
 * no requested project (or `projectKeyOf` can't tell), since the split then can't be trusted and the search's
 * projects are read one by one instead.
 */
export function splitProjectIssuesSearch<I>(
	projectKeys: readonly string[],
	issues: readonly I[],
	projectKeyOf: (issue: I) => string | undefined,
): I[][] | undefined {
	const indexByKey = new Map(projectKeys.map((key, index) => [key, index]));
	const split = projectKeys.map((): I[] => []);
	for (const issue of issues) {
		const key = projectKeyOf(issue);
		const index = key != null ? indexByKey.get(key) : undefined;
		if (index == null) return undefined;

		split[index].push(issue);
	}
	return split;
}

export function isIssuesIntegration(integration: Integration): integration is IssuesIntegration {
	return integration.type === 'issues';
}

function sessionPublicationKey(id: string, cloud: boolean | undefined): string {
	return JSON.stringify([id, cloud]);
}

export abstract class IssuesIntegration<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'issues';
	private _discoverySequence = 0;
	private _globalRetirement = 0;
	private _primaryPublication = 0;
	private readonly _actualPublications = new Map<string, number>();
	private readonly _selectorPublications = new Map<string, number>();
	private readonly _selectorSessions = new Map<string, { id: string; cloud?: boolean }>();
	private readonly _sessionPublications = new WeakMap<
		ProviderAuthenticationSession,
		Map<string, { beforeGeneration: number; afterGeneration: number }>
	>();

	override get discoveryGeneration(): number {
		return this._discoverySequence;
	}

	override getSessionDiscoveryGeneration(sessionId?: string, connectionId?: string, cloud?: boolean): number {
		const actual =
			sessionId == null
				? 0
				: Math.max(
						this._actualPublications.get(sessionPublicationKey(sessionId, undefined)) ?? 0,
						...(cloud == null ? [true, false] : [cloud]).map(
							variant => this._actualPublications.get(sessionPublicationKey(sessionId, variant)) ?? 0,
						),
					);
		return Math.max(
			this._globalRetirement,
			actual,
			connectionId != null ? (this._selectorPublications.get(connectionId) ?? 0) : this._primaryPublication,
		);
	}

	override invalidateDiscoveryCaches(): void {
		this._globalRetirement = ++this._discoverySequence;
		this.clearDiscoveryCaches();
	}

	override invalidateDiscoveryForConnection(connectionId?: string): void {
		const stamp = ++this._discoverySequence;
		if (connectionId != null) {
			this._selectorPublications.set(connectionId, stamp);
			const session = this._selectorSessions.get(connectionId);
			this._actualPublications.set(
				sessionPublicationKey(session?.id ?? connectionId, session == null ? true : session.cloud),
				stamp,
			);
		} else {
			this._primaryPublication = stamp;
			if (this._session != null) {
				this._actualPublications.set(sessionPublicationKey(this._session.id, this._session.cloud), stamp);
			}
		}
		this.clearDiscoveryCaches();
	}

	protected clearDiscoveryCaches(): void {}

	protected override invalidatePublishedSession(publication: SessionPublication, affectsPrimary: boolean): void {
		const stamp = ++this._discoverySequence;
		const cloud = publication.session != null ? publication.session.cloud : publication.cloud;
		for (const id of [publication.session?.id, publication.previousSessionId]) {
			if (id != null) {
				this._actualPublications.set(sessionPublicationKey(id, cloud), stamp);
			}
		}
		if (publication.connectionId != null) {
			this._selectorPublications.set(publication.connectionId, stamp);
			if (publication.session != null) {
				this._selectorSessions.set(publication.connectionId, {
					id: publication.session.id,
					cloud: publication.session.cloud,
				});
			}
		}
		if (affectsPrimary) {
			this._primaryPublication = stamp;
			this.clearDiscoveryCaches();
		}
	}

	override onSessionPublishing(publication: SessionPublication): void {
		const session = publication.session;
		const transitions = session != null ? (this._sessionPublications.get(session) ?? new Map()) : undefined;
		const selectors = new Set([
			...(transitions?.keys() ?? []),
			'',
			publication.connectionId ?? '',
			session?.id ?? '',
		]);
		const before = new Map(
			Array.from(selectors, selector => [
				selector,
				this.getSessionDiscoveryGeneration(session?.id, selector || undefined, session?.cloud),
			]),
		);
		super.onSessionPublishing(publication);
		if (session == null || transitions == null) return;

		for (const selector of selectors) {
			const beforeGeneration = before.get(selector)!;
			const previous = transitions.get(selector);
			transitions.set(selector, {
				beforeGeneration:
					previous?.afterGeneration === beforeGeneration ? previous.beforeGeneration : beforeGeneration,
				afterGeneration: this.getSessionDiscoveryGeneration(session.id, selector || undefined, session.cloud),
			});
		}
		this._sessionPublications.set(session, transitions);
	}

	private isResolvedDiscoverySessionCurrent(
		session: ProviderAuthenticationSession,
		startingGeneration: number,
		connectionId: string | undefined,
	): boolean {
		if (!connectionId && session !== this._session) return false;
		return this.isResolvedSessionCurrent(session, startingGeneration, connectionId);
	}

	protected override isResolvedSessionCurrent(
		session: ProviderAuthenticationSession | undefined,
		startingGeneration: number,
		connectionId?: string,
	): boolean {
		if (session == null) return startingGeneration === this.discoveryGeneration;

		const current = this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud);
		if (current <= startingGeneration) return true;

		// Only this resolution's publications may bridge a retirement boundary.
		const publication = this._sessionPublications.get(session)?.get(connectionId ?? '');
		return (
			publication != null &&
			publication.beforeGeneration <= startingGeneration &&
			publication.afterGeneration === current
		);
	}

	get supportsIssueLookupByResourceId(): boolean {
		return this.getProviderIssueByResourceId != null;
	}

	/**
	 * Whether this tracker has the cheap check behind the batch issue read's etags
	 * ({@link getProviderIssuesEtagFieldsByResourceId}). The read decides before calling anything, so a tracker without
	 * one makes one call.
	 */
	get supportsIssueEtagsByResourceId(): boolean {
		return this.getProviderIssuesEtagFieldsByResourceId != null;
	}

	/**
	 * Result-returning wrapper for the BATCH tracker issue read: resolves several `(resourceId, identifier)` targets
	 * with one {@link getProviderIssueByResourceId} request each, run with bounded concurrency. One settled slot per
	 * input target: `fulfilled` with `undefined` means the issue does not exist or is not visible to this token;
	 * `rejected` means that target could not be checked, never that it is absent.
	 *
	 * Failure isolation happens PER TARGET, mirroring `GitHostIntegration.getPullRequestsBatchResult`: the whole
	 * call counts as a failure against the integration's request-exception budget only when EVERY slot rejected,
	 * and not even then when a credential that checks out was refused by each target's own resource
	 * (`settleBatchRefusals`), so a batch of mostly-good targets never spends more than one strike. A batch read with
	 * etags makes up to two such calls (a full read of the targets without an etag, and a full read of the ones that
	 * changed), so it can spend two; its cheap check ({@link getIssuesEtagFieldsByResourceIdBatchResult}) spends
	 * nothing unless the credential is refused.
	 *
	 * Uncached on purpose: the caller owns caching, as with the git hosts' batch reads.
	 */
	async getIssuesByResourceIdBatchResult(
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
		connectionId?: string,
	): Promise<IntegrationResult<BatchSlot<IssueShape | undefined>[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		const getProviderIssue = this.getProviderIssueByResourceId;
		if (getProviderIssue == null) return { value: undefined };

		const start = performance.now();
		try {
			const slots = await mapSettledBounded(targets, providerFanOutConcurrency, t =>
				getProviderIssue.call(this, session, t.resourceId, t.identifier, t.resourceUrl),
			);

			const settled = await this.settleBatchRefusals(session, targets, slots);

			this.resetRequestExceptionCount('getIssue', connectionId);
			return { value: settled, duration: performance.now() - start };
		} catch (ex) {
			this.handleProviderException('getIssue', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	protected getProviderIssueByResourceId?(
		_session: ProviderAuthenticationSession,
		_resourceId: string,
		_id: string,
		_resourceUrl: string | undefined,
	): Promise<Issue | undefined>;

	/**
	 * Result-returning wrapper for the cheap check behind the batch tracker issue read's etags: each target's change
	 * state ({@link IssueEtagFields}), in ONE call to {@link getProviderIssuesEtagFieldsByResourceId}, which is handed
	 * `options.etagIncludes` as the git hosts' check is. The slots mean
	 * what {@link getIssuesByResourceIdBatchResult}'s do — `fulfilled` with `undefined` is a PROVEN ABSENCE, `rejected`
	 * means that target could not be checked. Failures are judged and budgeted as in
	 * `GitHostIntegration.getIssuesEtagFieldsResult`: every slot comes back as it settled, even when none answered, and
	 * only a refused credential fails the call or spends a strike.
	 */
	async getIssuesEtagFieldsByResourceIdBatchResult(
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
		options: { etagIncludes?: readonly IssueEtagInclude[] },
		connectionId?: string,
	): Promise<IntegrationResult<BatchSlot<IssueEtagFields | undefined>[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		const getProviderEtagFields = this.getProviderIssuesEtagFieldsByResourceId;
		if (getProviderEtagFields == null) return { value: undefined };

		const start = performance.now();
		try {
			const slots = await getProviderEtagFields.call(this, session, targets, options);
			if (slots == null) return { value: undefined, duration: performance.now() - start };

			const settled = await this.settleBatchRefusals(session, targets, slots, { keepOtherFailures: true });

			if (slots.some(slot => slot.status === 'fulfilled')) {
				this.resetRequestExceptionCount('getIssuesEtagFields', connectionId);
			}
			return { value: settled, duration: performance.now() - start };
		} catch (ex) {
			this.handleEtagCheckException('getIssuesEtagFields', ex, { scope: scope, connectionId: connectionId });
			return { error: toError(ex), duration: performance.now() - start };
		}
	}

	/**
	 * OPTIONAL: the cheap check behind the batch tracker issue read's etags — one settled slot per input target, in
	 * order, holding the issue's change state in the vocabulary {@link getProviderIssueByResourceId}'s issues end in,
	 * so both reads compute the same etag. `fulfilled` with `undefined` is a PROVEN ABSENCE, as there; a tracker whose
	 * cheap read can't prove one rejects the slot instead, so the full read decides. `undefined` declines the whole
	 * check, sending every target to the full read without counting as a failure. A tracker implements this only
	 * where it is cheaper than the full read. No tracker's row carries a real reaction count, so `'reactions'` in
	 * `options.etagIncludes` reads nothing here.
	 */
	protected getProviderIssuesEtagFieldsByResourceId?(
		session: ProviderAuthenticationSession,
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
		options: { etagIncludes?: readonly IssueEtagInclude[] },
	): Promise<PromiseSettledResult<IssueEtagFields | undefined>[] | undefined>;

	@trace()
	async getAccountForResource(resource: T, connectionId?: string): Promise<Account | undefined> {
		return (await this.getAccountForResourceResult(resource, connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getAccountForResource}. Recovers a thrown error into `{ error }` so
	 * callers can preserve its classification (e.g. a 401/403 → an `auth` warning that drives re-auth)
	 * instead of collapsing every failure into an untyped `undefined`. Gated here (not on the wrapper) so
	 * direct callers such as the ProviderBackend facade share the same dedup as `getAccountForResource`.
	 */
	@gate()
	async getAccountForResourceResult(
		resource: T,
		connectionId?: string,
	): Promise<IntegrationResult<Account | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const account = await this.getProviderAccountForResource(session, resource);
			this.resetRequestExceptionCount('getAccountForResource', connectionId);
			return { value: account };
		} catch (ex) {
			this.handleProviderException('getAccountForResource', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	protected abstract getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		resource: T,
	): Promise<Account | undefined>;

	@trace()
	async getResourcesForUser(connectionId?: string): Promise<T[] | undefined> {
		return (await this.getResourcesForUserResult(connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getResourcesForUser}. Recovers thrown errors into `{ error }` so callers
	 * can surface them as warnings rather than silently swallowing them to `undefined`. Gated here (not on the
	 * wrapper) so direct callers such as the ProviderBackend facade share the same dedup as `getResourcesForUser`.
	 */
	@gate()
	async getResourcesForUserResult(connectionId?: string): Promise<IntegrationResult<T[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const resources = await this.getProviderResourcesForUser(session);
			this.resetRequestExceptionCount('getResourcesForUser', connectionId);
			return { value: resources };
		} catch (ex) {
			this.handleProviderException('getResourcesForUser', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	protected abstract getProviderResourcesForUser(session: ProviderAuthenticationSession): Promise<T[] | undefined>;

	/**
	 * Project discovery for a set of resources, returning the SDK collection `{ values, metadata }` (completeness
	 * + per-resource failures) so callers can warn on failed resources and set `fetchFailed` without discarding
	 * the resources that succeeded. Thrown errors are recovered into `{ error }` for the same reason: a caller
	 * surfaces them as a warning rather than swallowing them to `undefined`.
	 */
	@trace()
	async getProjectsForResourcesWithMetadataResult(
		resources: T[],
		connectionId?: string,
	): Promise<IntegrationResult<ProviderApiCollectionResult<T> | undefined>> {
		const scope = getScopedLogger();
		const startingGeneration = this.discoveryGeneration;
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };
		// Primary resolution can refresh its own session before discovery starts.
		if (!this.isResolvedDiscoverySessionCurrent(session, startingGeneration, connectionId)) {
			return undefined;
		}

		const generation = this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud);

		try {
			const projects = await this.getProviderProjectsForResourcesWithMetadata(session, resources);
			// Existing cached readers keep their snapshot after invalidation without changing the replacement session.
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return { value: projects };
			}

			await this.confirmScopedAuthFailures(session, projects.metadata);
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return { value: projects };
			}

			this.resetRequestExceptionCount('getProjectsForResources', connectionId);
			return { value: projects };
		} catch (ex) {
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return undefined;
			}

			this.handleProviderException('getProjectsForResources', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	/**
	 * Metadata-aware provider project discovery. The default wraps the array-returning
	 * {@link getProviderProjectsForResources} in `{ values }`, so providers without a fan-out completeness signal
	 * (Jira Data Center, Trello) need no change; a read that returned no data is `unknown`, not an empty project list.
	 * Jira Cloud and Linear override it to preserve their completeness/failures.
	 */
	protected async getProviderProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: T[],
	): Promise<ProviderApiCollectionResult<T>> {
		return toProjectsCollection(await this.getProviderProjectsForResources(session, resources));
	}

	protected abstract getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: T[],
	): Promise<T[] | undefined>;

	/**
	 * The resources, and the projects of those `projectsOf` keeps, as the provider lists them now. For a read that must
	 * not take a cached list for the current one: what it decides from this snapshot (that a selection is gone) would
	 * be wrong for as long as the cache is stale. Shares nothing with the cached discovery: joins no read in flight,
	 * reads and writes no cache, so it can neither be answered by a read started before what it needs to see, nor put
	 * its answer into a cache a concurrent read relies on. `projects` is omitted when no resource list came back.
	 */
	@trace()
	async getUncachedDiscoveryResult(
		projectsOf: (resource: T) => boolean,
		connectionId?: string,
	): Promise<
		IntegrationResult<
			| {
					resources: T[] | undefined;
					projects?: ProviderApiCollectionResult<T>;
					generation: number;
					sessionId: string;
					sessionCloud?: boolean;
			  }
			| undefined
		>
	> {
		const scope = getScopedLogger();
		const startingGeneration = this.discoveryGeneration;
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };
		if (!this.isResolvedDiscoverySessionCurrent(session, startingGeneration, connectionId)) {
			return undefined;
		}

		const generation = this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud);

		try {
			// Reset on success as the cached reads are, so a refusal a re-sync healed doesn't count toward a disconnect.
			const resources = await this.getProviderUncachedResourcesForUser(session);
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return undefined;
			}

			this.resetRequestExceptionCount('getResourcesForUser', connectionId);
			if (resources == null) {
				return {
					value: {
						resources: undefined,
						generation: generation,
						sessionId: session.id,
						sessionCloud: session.cloud,
					},
				};
			}

			const projects = await this.getProviderUncachedProjectsForResourcesWithMetadata(
				session,
				resources.filter(projectsOf),
			);
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return undefined;
			}

			await this.confirmScopedAuthFailures(session, projects.metadata);
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return undefined;
			}

			this.resetRequestExceptionCount('getProjectsForResources', connectionId);
			return {
				value: {
					resources: resources,
					projects: projects,
					generation: generation,
					sessionId: session.id,
					sessionCloud: session.cloud,
				},
			};
		} catch (ex) {
			if (generation !== this.getSessionDiscoveryGeneration(session.id, connectionId, session.cloud)) {
				return undefined;
			}

			this.handleProviderException('getProjectsForResources', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	/**
	 * {@link getAccountForResourceResult} asked of the provider now, joining no lookup in flight and served from no
	 * account it lends: a lookup started before the credential was revoked would vouch for it.
	 */
	@trace()
	async getUncachedAccountForResourceResult(
		resource: T,
		connectionId?: string,
	): Promise<IntegrationResult<Account | undefined>> {
		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const account = await this.getProviderUncachedAccountForResource(session, resource);
			this.resetRequestExceptionCount('getAccountForResource', connectionId);
			return { value: account };
		} catch (ex) {
			this.handleProviderException('getAccountForResource', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	/** The account, asked of the provider; the default is {@link getProviderAccountForResource}, which lends none. */
	protected getProviderUncachedAccountForResource(
		session: ProviderAuthenticationSession,
		resource: T,
	): Promise<Account | undefined> {
		return this.getProviderAccountForResource(session, resource);
	}

	/**
	 * The provider's resources, read past any cache it keeps and without storing into it. The default is
	 * {@link getProviderResourcesForUser}, right for a provider that keeps none.
	 */
	protected getProviderUncachedResourcesForUser(session: ProviderAuthenticationSession): Promise<T[] | undefined> {
		return this.getProviderResourcesForUser(session);
	}

	/**
	 * The projects of `resources`, read past any cache the provider keeps and without storing into it. The default is
	 * {@link getProviderProjectsForResourcesWithMetadata}, right for a provider that keeps none.
	 */
	protected getProviderUncachedProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: T[],
	): Promise<ProviderApiCollectionResult<T>> {
		return this.getProviderProjectsForResourcesWithMetadata(session, resources);
	}

	@trace()
	async getIssuesForProject(
		project: T,
		options?: IssuesForProjectOptions,
		connectionId?: string,
	): Promise<IssueShape[] | undefined> {
		return (await this.getIssuesForProjectResult(project, options, connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getIssuesForProject}. Recovers thrown errors into `{ error }` so callers
	 * (e.g. the ProviderBackend facade) can surface a per-provider warning instead of a silent empty read —
	 * important for providers that throw on unsupported operations (e.g. Linear's not-implemented issue read).
	 */
	async getIssuesForProjectResult(
		project: T,
		options?: IssuesForProjectOptions,
		connectionId?: string,
	): Promise<IntegrationResult<IssueShape[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const issues = await this.getProviderIssuesForProject(session, project, options);
			this.resetRequestExceptionCount('getIssuesForProject', connectionId);
			return { value: issues };
		} catch (ex) {
			this.handleProviderException('getIssuesForProject', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	/**
	 * Truncation-aware variant of {@link getIssuesForProjectResult}. A provider that drains a project's issues
	 * with an internal page backstop (Jira/Linear) overrides {@link getProviderIssuesForProjectWithTruncation}
	 * to report when that backstop was hit, so the facade can surface an incomplete project read instead of
	 * publishing it as complete. The default reports `truncated: false`.
	 */
	async getIssuesForProjectWithTruncationResult(
		project: T,
		options?: IssuesForProjectOptions,
		connectionId?: string,
	): Promise<IntegrationResult<ProjectIssuesDrain | undefined>> {
		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) return session && { error: session.error };

		try {
			const result = await this.getProviderIssuesForProjectWithTruncation(session, project, options);
			await this.confirmScopedAuthFailures(session, result?.metadata);
			this.resetRequestExceptionCount('getIssuesForProject', connectionId);
			return { value: result };
		} catch (ex) {
			this.handleProviderException('getIssuesForProject', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	/**
	 * Reads several projects' issues, one result per request in request order, each with the contract of
	 * {@link getIssuesForProjectWithTruncationResult}, so one project failing leaves its siblings readable.
	 *
	 * A tracker that can read several projects in one query (Jira, Linear) groups them through
	 * {@link getProjectIssuesSearches}, so a project with none of the user's issues costs no request of its own.
	 * Every other request, and every project of a search that did not complete, is read on its own.
	 *
	 * A search's pages are global to its project set, so only a search that completes says something about each
	 * of its projects: one that does not, or that fails for a reason that may be one project's
	 * ({@link failsEveryScope}), is read again project by project, which reports completeness, failures and
	 * retries per project. Only a failure every project would hit on its own read too fails them all at once.
	 */
	async getIssuesForProjectsWithTruncationResult(
		requests: readonly ProjectIssuesRequest<T>[],
		connectionId?: string,
	): Promise<IntegrationResult<ProjectIssuesDrain | undefined>[]> {
		const searches = this.getProjectIssuesSearches(requests);
		if (searches == null) return this.readProjectsOneByOne(requests, connectionId);

		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null || isReadSessionFailure(session)) {
			return requests.map(() => session && { error: session.error });
		}

		const results: IntegrationResult<ProjectIssuesDrain | undefined>[] = requests.map(() => undefined);
		const unsearchedIndices: number[] = [];
		await mapBounded(searches, providerFanOutConcurrency, async indices => {
			try {
				const values = await this.searchProviderProjectIssues(
					session,
					indices.map(index => requests[index]),
				);
				if (values == null) {
					unsearchedIndices.push(...indices);
					return;
				}

				this.resetRequestExceptionCount('getIssuesForProject', connectionId);
				indices.forEach((index, i) => {
					results[index] = { value: { values: values[i], truncated: false } };
				});
			} catch (ex) {
				if (!failsEveryScope(ex)) {
					Logger.warn(scope, `Project search failed (${String(ex)}); reading its projects one by one`);
					unsearchedIndices.push(...indices);
					return;
				}

				this.handleProviderException('getIssuesForProject', ex, { connectionId: connectionId });
				const error = toError(ex);
				for (const index of indices) {
					results[index] = { error: error };
				}
			}
		});

		// After every search rather than inside each, so the fallback reads share one concurrency bound.
		if (unsearchedIndices.length > 0) {
			const fallback = await this.readProjectsOneByOne(
				unsearchedIndices.map(index => requests[index]),
				connectionId,
			);
			unsearchedIndices.forEach((index, i) => {
				results[index] = fallback[i];
			});
		}
		return results;
	}

	/**
	 * Groups requests into searches, as lists of request indices, that {@link searchProviderProjectIssues} can read
	 * in one query each. Undefined reads every project on its own, which is the default.
	 */
	protected getProjectIssuesSearches(_requests: readonly ProjectIssuesRequest<T>[]): number[][] | undefined {
		return undefined;
	}

	/**
	 * Reads the projects of one search in one query: each project's issues in request order, or undefined when the
	 * query did not complete, which reads them one by one instead. A throw is classified by {@link failsEveryScope}.
	 */
	protected searchProviderProjectIssues(
		_session: ProviderAuthenticationSession,
		_requests: readonly ProjectIssuesRequest<T>[],
	): Promise<IssueShape[][] | undefined> {
		return Promise.resolve(undefined);
	}

	private readProjectsOneByOne(
		requests: readonly ProjectIssuesRequest<T>[],
		connectionId: string | undefined,
	): Promise<IntegrationResult<ProjectIssuesDrain | undefined>[]> {
		return mapBounded(requests, providerFanOutConcurrency, async request => {
			try {
				return await this.getIssuesForProjectWithTruncationResult(
					request.project,
					request.options,
					connectionId,
				);
			} catch (ex) {
				return { error: toError(ex) };
			}
		});
	}

	protected abstract getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: T,
		options?: IssuesForProjectOptions,
	): Promise<IssueShape[] | undefined>;

	/**
	 * Truncation-aware core of {@link getProviderIssuesForProject}. The default wraps the plain read and
	 * reports `truncated: false`; a provider whose per-project drain is capped by a page backstop overrides
	 * this to report incompleteness. Optional metadata lets providers surface structured per-project failures
	 * (e.g. a page-level auth rejection) without discarding the already-fetched prefix.
	 */
	protected async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: T,
		options?: IssuesForProjectOptions,
	): Promise<ProjectIssuesDrain | undefined> {
		const values = await this.getProviderIssuesForProject(session, project, options);
		if (values == null) return undefined;
		return { values: values, truncated: false };
	}
}

/** A project list as a collection: no data is no list, `unknown`, never an empty complete one. */
export function toProjectsCollection<T extends ResourceDescriptor>(
	projects: T[] | undefined,
): ProviderApiCollectionResult<T> {
	return projects != null ? { values: projects } : { values: [], metadata: { completeness: 'unknown' } };
}
