import type { AuthenticationSession, CancellationToken } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../../autolinks/models/autolinks';
import { IssuesCloudHostIntegrationId } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest';
import type { IssueResourceDescriptor } from '../../../git/models/resourceDescriptor';
import { filterMap, flatten } from '../../../system/iterable';
import { Logger } from '../../../system/logger';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import { IssuesIntegration } from '../models/issuesIntegration';
import { IssueFilter, providersMetadata, toAccount, toIssueShape } from './models';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Jira];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;

export type JiraBaseDescriptor = IssueResourceDescriptor;

export interface JiraOrganizationDescriptor extends JiraBaseDescriptor {
	url: string;
	avatarUrl: string;
}

export interface JiraProjectDescriptor extends JiraBaseDescriptor {
	resourceId: string;
}

export class JiraIntegration extends IssuesIntegration<IssuesCloudHostIntegrationId.Jira> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = IssuesCloudHostIntegrationId.Jira;
	protected readonly key = this.id;
	readonly name: string = 'Jira';

	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.atlassian.com';
	}

	private _autolinks: Map<string, (AutolinkReference | DynamicAutolinkReference)[]> | undefined;
	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null || this._organizations == null || this._projects == null) {
			return [];
		}

		const cachedAutolinks = this._autolinks?.get(this._session.accessToken);
		if (cachedAutolinks != null) return cachedAutolinks;

		const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];
		const organizations = this._organizations.get(this._session.accessToken);
		if (organizations != null) {
			for (const organization of organizations) {
				const projects = this._projects.get(`${this._session.accessToken}:${organization.id}`);
				if (projects != null) {
					for (const project of projects) {
						const dashedPrefix = `${project.key}-`;
						const underscoredPrefix = `${project.key}_`;
						autolinks.push({
							prefix: dashedPrefix,
							url: `${organization.url}/browse/${dashedPrefix}<num>`,
							alphanumeric: false,
							ignoreCase: false,
							title: `Open Issue ${dashedPrefix}<num> on ${organization.name}`,

							type: 'issue',
							description: `${organization.name} Issue ${dashedPrefix}<num>`,
							descriptor: { ...organization },
						});
						autolinks.push({
							prefix: underscoredPrefix,
							url: `${organization.url}/browse/${dashedPrefix}<num>`,
							alphanumeric: false,
							ignoreCase: false,
							referenceType: 'branch',
							title: `Open Issue ${dashedPrefix}<num> on ${organization.name}`,

							type: 'issue',
							description: `${organization.name} Issue ${dashedPrefix}<num>`,
							descriptor: { ...organization },
						});
					}
				}
			}
		}

		this._autolinks ??= new Map<string, (AutolinkReference | DynamicAutolinkReference)[]>();
		this._autolinks.set(this._session.accessToken, autolinks);

		return autolinks;
	}

	protected override async getProviderAccountForResource(
		{ accessToken }: AuthenticationSession,
		resource: JiraOrganizationDescriptor,
	): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const user = await api.getCurrentUserForResource(this.id, resource.id, {
			accessToken: accessToken,
		});

		if (user == null) return undefined;
		return toAccount(user, this);
	}

	private _organizations: Map<string, JiraOrganizationDescriptor[] | undefined> | undefined;
	protected override async getProviderResourcesForUser(
		{ accessToken }: AuthenticationSession,
		force: boolean = false,
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		this._organizations ??= new Map<string, JiraOrganizationDescriptor[] | undefined>();

		const cachedResources = this._organizations.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const resources = await api.getJiraResourcesForCurrentUser({ accessToken: accessToken });
			this._organizations.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._organizations.get(accessToken);
	}

	private _projects: Map<string, JiraProjectDescriptor[] | undefined> | undefined;
	protected override async getProviderProjectsForResources(
		{ accessToken }: AuthenticationSession,
		resources: JiraOrganizationDescriptor[],
		force: boolean = false,
	): Promise<JiraProjectDescriptor[] | undefined> {
		this._projects ??= new Map<string, JiraProjectDescriptor[] | undefined>();

		let resourcesWithoutProjects = [];
		if (force) {
			resourcesWithoutProjects = resources;
		} else {
			for (const resource of resources) {
				const resourceKey = `${accessToken}:${resource.id}`;
				const cachedProjects = this._projects.get(resourceKey);
				if (cachedProjects == null) {
					resourcesWithoutProjects.push(resource);
				}
			}
		}

		if (resourcesWithoutProjects.length > 0) {
			const api = await this.getProvidersApi();
			const jiraProjectBaseDescriptors = await api.getJiraProjectsForResources(
				resourcesWithoutProjects.map(r => r.id),
				{ accessToken: accessToken },
			);

			for (const resource of resourcesWithoutProjects) {
				const projects = jiraProjectBaseDescriptors?.filter(p => p.resourceId === resource.id);
				if (projects != null) {
					this._projects.set(
						`${accessToken}:${resource.id}`,
						projects.map(p => ({ ...p })),
					);
				}
			}
		}

		return resources.reduce<JiraProjectDescriptor[]>((projects, resource) => {
			const resourceProjects = this._projects!.get(`${accessToken}:${resource.id}`);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, []);
	}

	protected override async getProviderIssuesForProject(
		{ accessToken }: AuthenticationSession,
		project: JiraProjectDescriptor,
		options?: { user: string; filters: IssueFilter[] },
	): Promise<IssueShape[] | undefined> {
		let results;

		const api = await this.getProvidersApi();

		const getSearchedUserIssuesForFilter = async (
			user: string,
			filter: IssueFilter,
		): Promise<IssueShape[] | undefined> => {
			const results = await api.getIssuesForProject(this.id, project.name, project.resourceId, {
				authorLogin: filter === IssueFilter.Author ? user : undefined,
				assigneeLogins: filter === IssueFilter.Assignee ? [user] : undefined,
				mentionLogin: filter === IssueFilter.Mention ? user : undefined,
				accessToken: accessToken,
			});

			return results
				?.map(issue => toIssueShape(issue, this))
				.filter((result): result is IssueShape => result !== undefined);
		};

		if (options?.user != null && options.filters.length > 0) {
			const resultsPromise = Promise.allSettled(
				options.filters.map(filter => getSearchedUserIssuesForFilter(options.user, filter)),
			);

			results = [
				...flatten(
					filterMap(await resultsPromise, r =>
						r.status === 'fulfilled' && r.value != null ? r.value : undefined,
					),
				),
			];

			const resultsById = new Map<string, IssueShape>();
			for (const resultIssue of results) {
				if (!resultsById.has(resultIssue.id)) {
					resultsById.set(resultIssue.id, resultIssue);
				}
			}

			return [...resultsById.values()];
		}

		results = await api.getIssuesForProject(this.id, project.name, project.resourceId, {
			accessToken: accessToken,
		});
		return results
			?.map(issue => toIssueShape(issue, this))
			.filter((result): result is IssueShape => result !== undefined);
	}

	protected override async searchProviderMyIssues(
		session: AuthenticationSession,
		resources?: JiraOrganizationDescriptor[],
		_cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined> {
		const myResources = resources ?? (await this.getProviderResourcesForUser(session));
		if (!myResources) return undefined;

		const api = await this.getProvidersApi();

		const results: IssueShape[] = [];
		for (const resource of myResources) {
			try {
				let cursor = undefined;
				let hasMore = false;
				let requestCount = 0;
				do {
					const resourceIssues = await api.getIssuesForResourceForCurrentUser(this.id, resource.id, {
						accessToken: session.accessToken,
						cursor: cursor,
					});
					requestCount += 1;
					hasMore = resourceIssues.paging?.more ?? false;
					cursor = resourceIssues.paging?.cursor;
					const formattedIssues = resourceIssues.values
						.map(issue => toIssueShape(issue, this))
						.filter((result): result is IssueShape => result != null);
					if (formattedIssues.length > 0) {
						results.push(...formattedIssues);
					}
				} while (requestCount < maxPagesPerRequest && hasMore);
			} catch (ex) {
				// TODO: We need a better way to message the failure to the user here.
				// This is a stopgap to prevent one bag org from throwing and preventing any issues from being returned.
				Logger.error(ex, 'searchProviderMyIssues');
			}
		}

		return results;
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: AuthenticationSession,
		resource: JiraOrganizationDescriptor,
		{ key }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		const api = await this.getProvidersApi();
		const issue = await api.getIssue(
			this.id,
			{ resourceId: resource.id, number: key },
			{ accessToken: session.accessToken },
		);
		return issue != null ? toIssueShape(issue, this) : undefined;
	}

	protected override async getProviderIssue(
		session: AuthenticationSession,
		resource: JiraOrganizationDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const api = await this.getProvidersApi();
		const apiResult = await api.getIssue(
			this.id,
			{ resourceId: resource.id, number: id },
			{ accessToken: session.accessToken },
		);
		const issue = apiResult != null ? toIssueShape(apiResult, this) : undefined;
		return issue != null ? { ...issue, type: 'issue' } : undefined;
	}

	protected override async providerOnConnect(): Promise<void> {
		this._autolinks = undefined;
		if (this._session == null) return;

		const storedOrganizations = this.container.storage.get(`jira:${this._session.accessToken}:organizations`);
		const storedProjects = this.container.storage.get(`jira:${this._session.accessToken}:projects`);
		let organizations = storedOrganizations?.data?.map(o => ({ ...o }));
		let projects = storedProjects?.data?.map(p => ({ ...p }));

		if (storedOrganizations == null) {
			organizations = await this.getProviderResourcesForUser(this._session, true);
			// Clear all other stored organizations and projects when our session changes
			await this.container.storage.deleteWithPrefix('jira');
			await this.container.storage.store(`jira:${this._session.accessToken}:organizations`, {
				v: 1,
				timestamp: Date.now(),
				data: organizations,
			});
		}

		this._organizations ??= new Map<string, JiraOrganizationDescriptor[] | undefined>();
		this._organizations.set(this._session.accessToken, organizations);

		if (storedProjects == null && organizations?.length) {
			projects = await this.getProviderProjectsForResources(this._session, organizations);
			await this.container.storage.store(`jira:${this._session.accessToken}:projects`, {
				v: 1,
				timestamp: Date.now(),
				data: projects,
			});
		}

		this._projects ??= new Map<string, JiraProjectDescriptor[] | undefined>();
		for (const project of projects ?? []) {
			const projectKey = `${this._session.accessToken}:${project.resourceId}`;
			const projects = this._projects.get(projectKey);
			if (projects == null) {
				this._projects.set(projectKey, [project]);
			} else if (!projects.some(p => p.id === project.id)) {
				projects.push(project);
			}
		}
	}

	protected override providerOnDisconnect(): void {
		this._organizations = undefined;
		this._projects = undefined;
		this._autolinks = undefined;
	}
}
