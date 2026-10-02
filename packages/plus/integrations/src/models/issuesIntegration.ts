import type { Account } from '@gitlens/git/models/author.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { mapSettledBounded } from '@gitlens/utils/promise.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import { toError } from '../errors.js';
import type { ProviderApiCollectionResult } from '../providers/models.js';
import type { BatchSlot, Integration, IntegrationResult, IntegrationType, IssueEtagFields } from './integration.js';
import { IntegrationBase } from './integration.js';
import type { IssuesForProjectOptions, ProjectIssuesDrain } from './issueReads.js';

export function isIssuesIntegration(integration: Integration): integration is IssuesIntegration {
	return integration.type === 'issues';
}

export abstract class IssuesIntegration<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'issues';

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
		if (session == null) return undefined;

		const getProviderIssue = this.getProviderIssueByResourceId;
		if (getProviderIssue == null) return { value: undefined };

		const start = performance.now();
		try {
			const slots = await mapSettledBounded(targets, providerFanOutConcurrency, t =>
				getProviderIssue.call(this, session, t.resourceId, t.identifier, t.resourceUrl),
			);

			const settled = await this.settleBatchRefusals(session, targets, slots);

			this.resetRequestExceptionCount('getIssue');
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
	 * state ({@link IssueEtagFields}), in ONE call to {@link getProviderIssuesEtagFieldsByResourceId}. The slots mean
	 * what {@link getIssuesByResourceIdBatchResult}'s do — `fulfilled` with `undefined` is a PROVEN ABSENCE, `rejected`
	 * means that target could not be checked. Failures are judged and budgeted as in
	 * `GitHostIntegration.getIssuesEtagFieldsResult`: every slot comes back as it settled, even when none answered, and
	 * only a refused credential fails the call or spends a strike.
	 */
	async getIssuesEtagFieldsByResourceIdBatchResult(
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
		connectionId?: string,
	): Promise<IntegrationResult<BatchSlot<IssueEtagFields | undefined>[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		const getProviderEtagFields = this.getProviderIssuesEtagFieldsByResourceId;
		if (getProviderEtagFields == null) return { value: undefined };

		const start = performance.now();
		try {
			const slots = await getProviderEtagFields.call(this, session, targets);
			if (slots == null) return { value: undefined, duration: performance.now() - start };

			const settled = await this.settleBatchRefusals(session, targets, slots, { keepOtherFailures: true });

			if (slots.some(slot => slot.status === 'fulfilled')) {
				this.resetRequestExceptionCount('getIssuesEtagFields');
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
	 * where it is cheaper than the full read.
	 */
	protected getProviderIssuesEtagFieldsByResourceId?(
		session: ProviderAuthenticationSession,
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
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
		if (session == null) return undefined;

		try {
			const account = await this.getProviderAccountForResource(session, resource);
			this.resetRequestExceptionCount('getAccountForResource');
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
		if (session == null) return undefined;

		try {
			const resources = await this.getProviderResourcesForUser(session);
			this.resetRequestExceptionCount('getResourcesForUser');
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
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const projects = await this.getProviderProjectsForResourcesWithMetadata(session, resources);
			await this.confirmScopedAuthFailures(session, projects.metadata);
			this.resetRequestExceptionCount('getProjectsForResources');
			return { value: projects };
		} catch (ex) {
			this.handleProviderException('getProjectsForResources', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
	}

	/**
	 * Metadata-aware provider project discovery. The default wraps the array-returning
	 * {@link getProviderProjectsForResources} in `{ values }` with no metadata, so providers without a
	 * fan-out completeness signal (Linear, Trello) need no change; Jira overrides it to preserve the SDK's
	 * per-resource completeness/failures.
	 */
	protected async getProviderProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: T[],
	): Promise<ProviderApiCollectionResult<T>> {
		const projects = await this.getProviderProjectsForResources(session, resources);
		return { values: projects ?? [] };
	}

	protected abstract getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: T[],
	): Promise<T[] | undefined>;

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
		if (session == null) return undefined;

		try {
			const issues = await this.getProviderIssuesForProject(session, project, options);
			this.resetRequestExceptionCount('getIssuesForProject');
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
		if (session == null) return undefined;

		try {
			const result = await this.getProviderIssuesForProjectWithTruncation(session, project, options);
			await this.confirmScopedAuthFailures(session, result?.metadata);
			this.resetRequestExceptionCount('getIssuesForProject');
			return { value: result };
		} catch (ex) {
			this.handleProviderException('getIssuesForProject', ex, { connectionId: connectionId });
			return { error: toError(ex) };
		}
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
