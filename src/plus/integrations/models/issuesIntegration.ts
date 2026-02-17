import type { IntegrationIds } from '../../../constants.integrations.js';
import type { Account } from '../../../git/models/author.js';
import type { IssueShape } from '../../../git/models/issue.js';
import type { ResourceDescriptor } from '../../../git/models/resourceDescriptor.js';
import { gate } from '../../../system/decorators/gate.js';
import { trace } from '../../../system/decorators/log.js';
import { getScopedLogger } from '../../../system/logger.scope.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IssueFilter } from '../providers/models.js';
import type { Integration, IntegrationType } from './integration.js';
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
	async getAccountForResource(resource: T): Promise<Account | undefined> {
		const scope = getScopedLogger();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const account = await this.getProviderAccountForResource(this._session!, resource);
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

	@gate()
	@trace()
	async getResourcesForUser(): Promise<T[] | undefined> {
		const scope = getScopedLogger();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const resources = await this.getProviderResourcesForUser(this._session!);
			this.resetRequestExceptionCount('getResourcesForUser');
			return resources;
		} catch (ex) {
			this.handleProviderException('getResourcesForUser', ex);
			return undefined;
		}
	}

	protected abstract getProviderResourcesForUser(session: ProviderAuthenticationSession): Promise<T[] | undefined>;

	@trace()
	async getProjectsForResources(resources: T[]): Promise<T[] | undefined> {
		const scope = getScopedLogger();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const projects = await this.getProviderProjectsForResources(this._session!, resources);
			this.resetRequestExceptionCount('getProjectsForResources');
			return projects;
		} catch (ex) {
			this.handleProviderException('getProjectsForResources', ex);
			return undefined;
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

	@trace()
	async getIssuesForProject(
		project: T,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined> {
		const scope = getScopedLogger();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const issues = await this.getProviderIssuesForProject(this._session!, project, options);
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
