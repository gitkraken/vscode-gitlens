import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import type { IssueFilter, ProviderApiCollectionResult } from '../providers/models.js';
import type { Integration, IntegrationResult, IntegrationType } from './integration.js';
import { IntegrationBase } from './integration.js';

export function isIssuesIntegration(integration: Integration): integration is IssuesIntegration {
	return integration.type === 'issues';
}

export abstract class IssuesIntegration<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'issues';

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
			this.handleProviderException('getAccountForResource', ex);
			return { error: ex };
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
			this.handleProviderException('getResourcesForUser', ex);
			return { error: ex };
		}
	}

	protected abstract getProviderResourcesForUser(session: ProviderAuthenticationSession): Promise<T[] | undefined>;

	@trace()
	async getProjectsForResources(resources: T[], connectionId?: string): Promise<T[] | undefined> {
		return (await this.getProjectsForResourcesResult(resources, connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getProjectsForResources}. Recovers thrown errors into `{ error }` so callers
	 * can surface them as warnings rather than silently swallowing them to `undefined`. Implemented by unwrapping
	 * the metadata-aware path's `values` so the array-returning contract stays backward compatible.
	 */
	async getProjectsForResourcesResult(
		resources: T[],
		connectionId?: string,
	): Promise<IntegrationResult<T[] | undefined>> {
		const result = await this.getProjectsForResourcesWithMetadataResult(resources, connectionId);
		if (result == null) return undefined;
		if (result.error != null) return { value: result.value?.values, error: result.error };
		return { value: result.value?.values };
	}

	/**
	 * Metadata-aware counterpart of {@link getProjectsForResourcesResult} for ProviderBackend composition:
	 * returns the SDK collection `{ values, metadata }` (completeness + per-resource failures) so callers can
	 * warn on failed resources and set `fetchFailed` without discarding the resources that succeeded.
	 */
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
			this.resetRequestExceptionCount('getProjectsForResources');
			return { value: projects };
		} catch (ex) {
			this.handleProviderException('getProjectsForResources', ex);
			return { error: ex };
		}
	}

	async getProjectsForUser(connectionId?: string): Promise<T[] | undefined> {
		return (await this.getProjectsForUserResult(connectionId))?.value;
	}

	/**
	 * Result-returning core of {@link getProjectsForUser}. Composes the resource and project result methods so
	 * callers can surface per-step warnings. Unwraps the metadata-aware path for the array-returning contract.
	 */
	async getProjectsForUserResult(connectionId?: string): Promise<IntegrationResult<T[] | undefined>> {
		const result = await this.getProjectsForUserWithMetadataResult(connectionId);
		if (result == null) return undefined;
		if (result.error != null) return { value: result.value?.values, error: result.error };
		return { value: result.value?.values };
	}

	/**
	 * Metadata-aware counterpart of {@link getProjectsForUserResult}: composes resource discovery with the
	 * metadata-aware project read so ProviderBackend consumers get completeness/failures across resources.
	 */
	async getProjectsForUserWithMetadataResult(
		connectionId?: string,
	): Promise<IntegrationResult<ProviderApiCollectionResult<T> | undefined>> {
		const resources = await this.getResourcesForUserResult(connectionId);
		if (resources?.error != null) return { error: resources.error };
		if (resources?.value == null) return undefined;

		return this.getProjectsForResourcesWithMetadataResult(resources.value, connectionId);
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
		options?: { user?: string; filters?: IssueFilter[] },
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
		options?: { user?: string; filters?: IssueFilter[] },
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
			this.handleProviderException('getIssuesForProject', ex);
			return { error: ex };
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
		options?: { user?: string; filters?: IssueFilter[] },
		connectionId?: string,
	): Promise<
		IntegrationResult<{ values: IssueShape[]; truncated: boolean; metadata?: CollectionMetadata } | undefined>
	> {
		const scope = getScopedLogger();
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const result = await this.getProviderIssuesForProjectWithTruncation(session, project, options);
			this.resetRequestExceptionCount('getIssuesForProject');
			return { value: result };
		} catch (ex) {
			this.handleProviderException('getIssuesForProject', ex);
			return { error: ex };
		}
	}

	protected abstract getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: T,
		options?: { user?: string; filters?: IssueFilter[] },
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
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<{ values: IssueShape[]; truncated: boolean; metadata?: CollectionMetadata } | undefined> {
		const values = await this.getProviderIssuesForProject(session, project, options);
		if (values == null) return undefined;
		return { values: values, truncated: false };
	}
}
