/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { IntegrationIds } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { IssueShape } from '../../../git/models/issue';
import type { ResourceDescriptor } from '../../../git/models/resourceDescriptor';
import { gate } from '../../../system/decorators/-webview/gate';
import { debug } from '../../../system/decorators/log';
import { getLogScope } from '../../../system/logger.scope';
import type { ProviderAuthenticationSession } from '../authentication/models';
import type { IssueFilter } from '../providers/models';
import type { Integration, IntegrationType } from './integration';
import { IntegrationBase } from './integration';

export function isIssuesIntegration(integration: Integration): integration is IssuesIntegration {
	return integration.type === 'issues';
}

export abstract class IssuesIntegration<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'issues';

	@gate()
	@debug()
	async getAccountForResource(resource: T): Promise<Account | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const account = await this.getProviderAccountForResource(this._session!, resource);
			this.resetRequestExceptionCount('getAccountForResource');
			return account;
		} catch (ex) {
			return this.handleProviderException<Account | undefined>('getAccountForResource', ex, undefined, undefined);
		}
	}

	protected abstract getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		resource: T,
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getResourcesForUser(): Promise<T[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const resources = await this.getProviderResourcesForUser(this._session!);
			this.resetRequestExceptionCount('getResourcesForUser');
			return resources;
		} catch (ex) {
			return this.handleProviderException<T[] | undefined>('getResourcesForUser', ex, undefined, undefined);
		}
	}

	protected abstract getProviderResourcesForUser(session: ProviderAuthenticationSession): Promise<T[] | undefined>;

	@debug()
	async getProjectsForResources(resources: T[]): Promise<T[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const projects = await this.getProviderProjectsForResources(this._session!, resources);
			this.resetRequestExceptionCount('getProjectsForResources');
			return projects;
		} catch (ex) {
			return this.handleProviderException<T[] | undefined>('getProjectsForResources', ex, undefined, undefined);
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
	): Promise<IssueShape[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const issues = await this.getProviderIssuesForProject(this._session!, project, options);
			this.resetRequestExceptionCount('getIssuesForProject');
			return issues;
		} catch (ex) {
			return this.handleProviderException<IssueShape[] | undefined>(
				'getIssuesForProject',
				ex,
				undefined,
				undefined,
			);
		}
	}

	protected abstract getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: T,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined>;
}
