import type { Account } from '@gitlens/git/models/author.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import type { IssueFilter } from '../providers/models.js';
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

	@gate()
	@trace()
	async getAccountForResource(resource: T, connectionId?: string): Promise<Account | undefined> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const account = await this.getProviderAccountForResource(session, resource);
			this.resetRequestExceptionCount('getAccountForResource');
			return account;
		} catch (ex) {
			this.handleProviderException('getAccountForResource', ex);
			return undefined;
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
	 * can surface them as warnings rather than silently swallowing them to `undefined`.
	 */
	async getProjectsForResourcesResult(
		resources: T[],
		connectionId?: string,
	): Promise<IntegrationResult<T[] | undefined>> {
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const projects = await this.getProviderProjectsForResources(session, resources);
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
	 * callers can surface per-step warnings.
	 */
	async getProjectsForUserResult(connectionId?: string): Promise<IntegrationResult<T[] | undefined>> {
		const resources = await this.getResourcesForUserResult(connectionId);
		if (resources?.error != null) return resources;
		if (resources?.value == null) return undefined;

		return this.getProjectsForResourcesResult(resources.value, connectionId);
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
		const scope = getScopedLogger();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(connectionId, scope);
		if (session == null) return undefined;

		try {
			const issues = await this.getProviderIssuesForProject(session, project, options);
			this.resetRequestExceptionCount('getIssuesForProject');
			return issues;
		} catch (ex) {
			this.handleProviderException('getIssuesForProject', ex);
			return undefined;
		}
	}

	protected abstract getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: T,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined>;
}
