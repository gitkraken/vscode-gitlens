import type { AuthenticationSession, CancellationToken } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../../autolinks/models/autolinks';
import { IssuesCloudHostIntegrationId } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { IssueResourceDescriptor, ResourceDescriptor } from '../../../git/models/resourceDescriptor';
import { isIssueResourceDescriptor } from '../../../git/utils/resourceDescriptor.utils';
import { Logger } from '../../../system/logger';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { ProviderAuthenticationSession } from '../authentication/models';
import { IssuesIntegration } from '../models/issuesIntegration';
import type { IssueFilter, ProviderIssue } from './models';
import { fromProviderIssue, providersMetadata, toIssueShape } from './models';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Linear];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;

export interface LinearTeamDescriptor extends IssueResourceDescriptor {
	avatarUrl: string | undefined;
}

export interface LinearOrganizationDescriptor extends IssueResourceDescriptor {
	url: string;
}

export interface LinearProjectDescriptor extends IssueResourceDescriptor {}

export class LinearIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Linear> {
	private _autolinks: Map<string, (AutolinkReference | DynamicAutolinkReference)[]> | undefined;
	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null) {
			return [];
		}
		const cachedAutolinks = this._autolinks?.get(this._session.accessToken);
		if (cachedAutolinks != null) return cachedAutolinks;

		const organization = await this.getOrganization(this._session);
		if (organization == null) return [];

		const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];

		const teams = await this.getTeams(this._session);
		for (const team of teams ?? []) {
			const dashedPrefix = `${team.key}-`;
			const underscoredPrefix = `${team.key}_`;

			autolinks.push({
				prefix: dashedPrefix,
				url: `${organization.url}/issue/${dashedPrefix}<num>`,
				alphanumeric: false,
				ignoreCase: false,
				title: `Open Issue ${dashedPrefix}<num> on ${organization.name}`,

				type: 'issue',
				description: `${organization.name} Issue ${dashedPrefix}<num>`,
				descriptor: { ...organization },
			});
			autolinks.push({
				prefix: underscoredPrefix,
				url: `${organization.url}/issue/${dashedPrefix}<num>`,
				alphanumeric: false,
				ignoreCase: false,
				referenceType: 'branch',
				title: `Open Issue ${dashedPrefix}<num> on ${organization.name}`,

				type: 'issue',
				description: `${organization.name} Issue ${dashedPrefix}<num>`,
				descriptor: { ...organization },
			});
		}

		this._autolinks ??= new Map<string, (AutolinkReference | DynamicAutolinkReference)[]>();
		this._autolinks.set(this._session.accessToken, autolinks);

		return autolinks;
	}

	private _organizations: Map<string, LinearOrganizationDescriptor | undefined> | undefined;
	private async getOrganization(
		{ accessToken }: AuthenticationSession,
		force: boolean = false,
	): Promise<LinearOrganizationDescriptor | undefined> {
		this._organizations ??= new Map<string, LinearOrganizationDescriptor | undefined>();

		const cachedResources = this._organizations.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const organization = await api.getLinearOrganization({ accessToken: accessToken });
			const descriptor: LinearOrganizationDescriptor | undefined = organization && {
				id: organization.id,
				key: organization.key,
				name: organization.name,
				url: organization.url,
			};
			if (descriptor) {
				this._organizations.set(accessToken, descriptor);
			}
		}

		return this._organizations.get(accessToken);
	}

	private _teams: Map<string, LinearTeamDescriptor[] | undefined> | undefined;
	private async getTeams(
		{ accessToken }: AuthenticationSession,
		force: boolean = false,
	): Promise<LinearTeamDescriptor[] | undefined> {
		this._teams ??= new Map<string, LinearTeamDescriptor[] | undefined>();

		const cachedResources = this._teams.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const teams = await api.getLinearTeamsForCurrentUser({ accessToken: accessToken });
			const descriptors: LinearTeamDescriptor[] | undefined = teams?.map(t => ({
				id: t.id,
				key: t.key,
				name: t.name,
				avatarUrl: t.iconUrl,
			}));
			if (descriptors) {
				this._teams.set(accessToken, descriptors);
			}
		}

		return this._teams.get(accessToken);
	}

	protected override getProviderResourcesForUser(
		_session: ProviderAuthenticationSession,
	): Promise<ResourceDescriptor[] | undefined> {
		throw new Error('Method not implemented.');
	}
	protected override getProviderProjectsForResources(
		_session: ProviderAuthenticationSession,
		_resources: ResourceDescriptor[],
	): Promise<ResourceDescriptor[] | undefined> {
		throw new Error('Method not implemented.');
	}
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;

	protected override getProviderAccountForResource(
		_session: ProviderAuthenticationSession,
		_resource: ResourceDescriptor,
	): Promise<Account | undefined> {
		throw new Error('Method not implemented.');
	}

	protected override getProviderIssuesForProject(
		_session: ProviderAuthenticationSession,
		_project: ResourceDescriptor,
		_options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined> {
		throw new Error('Method not implemented.');
	}

	override get id(): IssuesCloudHostIntegrationId.Linear {
		return IssuesCloudHostIntegrationId.Linear;
	}
	protected override get key(): 'linear' {
		return 'linear';
	}
	override get name(): string {
		return metadata.name;
	}
	override get domain(): string {
		return metadata.domain;
	}
	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: ResourceDescriptor[],
		cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined> {
		if (resources != null) {
			return undefined;
		}
		const api = await this.getProvidersApi();
		let cursor = undefined;
		let hasMore = false;
		let requestCount = 0;
		const issues = [];
		try {
			do {
				if (cancellation?.isCancellationRequested) {
					break;
				}
				const result = await api.getIssuesForCurrentUser(this.id, {
					accessToken: session.accessToken,
					cursor: cursor,
				});
				requestCount += 1;
				hasMore = result.paging?.more ?? false;
				cursor = result.paging?.cursor;
				const formattedIssues = result.values
					.map(issue => toIssueShape(issue, this))
					.filter((result): result is IssueShape => result != null);
				if (formattedIssues.length > 0) {
					issues.push(...formattedIssues);
				}
			} while (requestCount < maxPagesPerRequest && hasMore);
		} catch (ex) {
			if (issues.length === 0) {
				throw ex;
			}
			Logger.error(ex, 'searchProviderMyIssues');
		}
		return issues;
	}
	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		{ key }: { id: string; key: string },
		_type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		const issue = await this.getRawProviderIssue(session, resource, key);
		const autolinkableIssue: ProviderIssue | undefined = issue && {
			...issue,
			url: this.getIssueAutolinkLikeUrl(issue),
		};
		return autolinkableIssue && toIssueShape(autolinkableIssue, this);
	}
	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const result = await this.getRawProviderIssue(session, resource, id);
		return result && fromProviderIssue(result, this);
	}

	private async getRawProviderIssue(
		session: ProviderAuthenticationSession,
		resource: ResourceDescriptor,
		id: string,
	): Promise<ProviderIssue | undefined> {
		const api = await this.getProvidersApi();
		try {
			if (!isIssueResourceDescriptor(resource)) {
				Logger.error(undefined, 'getProviderIssue: resource is not an IssueResourceDescriptor');
				return undefined;
			}

			const result = await api.getIssue(
				this.id,
				{
					resourceId: resource.id,
					number: id,
				},
				{
					accessToken: session.accessToken,
				},
			);

			if (result == null) return undefined;

			return result;
		} catch (ex) {
			Logger.error(ex, 'getProviderIssue');
			return undefined;
		}
	}
	private getIssueAutolinkLikeUrl(issue: ProviderIssue): string | null {
		const url = issue.url;
		if (url == null) return null;
		const lastSegment = url.split('/').pop();
		if (!lastSegment || issue.number === lastSegment) {
			return url;
		}
		return url.substring(0, url.length - lastSegment.length - 1);
	}
}
