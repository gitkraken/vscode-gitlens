import type { AuthenticationSession, CancellationToken } from 'vscode';
import type { DynamicAutolinkReference } from '../../../annotations/autolinks';
import type { AutolinkReference } from '../../../config';
import type { Account } from '../../../git/models/author';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import { filterMap, flatten } from '../../../system/iterable';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import type { ResourceDescriptor } from '../integration';
import { IssueIntegration } from '../integration';
import { IssueFilter, IssueIntegrationId, providersMetadata, toAccount, toSearchedIssue } from './models';

const metadata = providersMetadata[IssueIntegrationId.Jira];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

export interface JiraBaseDescriptor extends ResourceDescriptor {
	id: string;
	name: string;
}
export interface JiraOrganizationDescriptor extends JiraBaseDescriptor {
	url: string;
	avatarUrl: string;
}

export interface JiraProjectDescriptor extends JiraBaseDescriptor {
	resourceId: string;
}

export class JiraIntegration extends IssueIntegration<IssueIntegrationId.Jira> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = IssueIntegrationId.Jira;
	protected readonly key = this.id;
	readonly name: string = 'Jira';

	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.atlassian.com';
	}

	private _autolinks: Map<string, (AutolinkReference | DynamicAutolinkReference)[]> | undefined;
	override autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._session == null || this._organizations == null || this._projects == null) return [];

		this._autolinks ||= new Map<string, (AutolinkReference | DynamicAutolinkReference)[]>();

		const cachedAutolinks = this._autolinks.get(this._session.accessToken);
		if (cachedAutolinks != null) {
			return cachedAutolinks;
		}

		const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];
		const organizations = this._organizations.get(this._session.accessToken);
		if (organizations != null) {
			for (const organization of organizations) {
				const projects = this._projects.get(`${this._session.accessToken}:${organization.id}`);
				if (projects != null) {
					for (const project of projects) {
						const prefix = `${project.key}-`;
						autolinks.push({
							type: 'issue',
							url: `${organization.url}/browse/${prefix}<num>`,
							prefix: prefix,
							title: `Open Issue ${prefix}<num> on ${organization.name}`,
							description: `${organization.name} Issue ${prefix}<num>`,
						});
					}
				}
			}
		}

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
		this._organizations ||= new Map<string, JiraOrganizationDescriptor[] | undefined>();

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
		this._projects ||= new Map<string, JiraProjectDescriptor[] | undefined>();

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
	): Promise<SearchedIssue[] | undefined> {
		let results;

		const api = await this.getProvidersApi();

		const getSearchedUserIssuesForFilter = async (
			user: string,
			filter: IssueFilter,
		): Promise<SearchedIssue[] | undefined> => {
			const results = await api.getIssuesForProject(this.id, project.name, project.resourceId, {
				authorLogin: filter === IssueFilter.Author ? user : undefined,
				assigneeLogins: filter === IssueFilter.Assignee ? [user] : undefined,
				mentionLogin: filter === IssueFilter.Mention ? user : undefined,
				accessToken: accessToken,
			});

			return results
				?.map(issue => toSearchedIssue(issue, this, filter))
				.filter((result): result is SearchedIssue => result !== undefined);
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

			const resultsById = new Map<string, SearchedIssue>();
			for (const result of results) {
				if (resultsById.has(result.issue.id)) {
					const existing = resultsById.get(result.issue.id)!;
					existing.reasons = [...existing.reasons, ...result.reasons];
				} else {
					resultsById.set(result.issue.id, result);
				}
			}

			return [...resultsById.values()];
		}

		results = await api.getIssuesForProject(this.id, project.name, project.resourceId, {
			accessToken: accessToken,
		});
		return results
			?.map(issue => toSearchedIssue(issue, this))
			.filter((result): result is SearchedIssue => result !== undefined);
	}

	protected override async searchProviderMyIssues(
		session: AuthenticationSession,
		resources?: JiraOrganizationDescriptor[],
		_cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const myResources = resources ?? (await this.getProviderResourcesForUser(session));
		if (!myResources) return undefined;

		const api = await this.getProvidersApi();

		const results: SearchedIssue[] = [];
		for (const resource of myResources) {
			const userLogin = (await this.getProviderAccountForResource(session, resource))?.username;
			const resourceIssues = await api.getIssuesForResourceForCurrentUser(this.id, resource.id, {
				accessToken: session.accessToken,
			});
			const formattedIssues = resourceIssues
				?.map(issue => toSearchedIssue(issue, this, undefined, userLogin))
				.filter((result): result is SearchedIssue => result != null);
			if (formattedIssues != null) {
				results.push(...formattedIssues);
			}
		}

		return results;
	}

	protected override async getProviderIssueOrPullRequest(
		session: AuthenticationSession,
		resource: JiraOrganizationDescriptor,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		const api = await this.getProvidersApi();
		const userLogin = (await this.getProviderAccountForResource(session, resource))?.username;
		const issue = await api.getIssue(this.id, resource.id, id, { accessToken: session.accessToken });
		return issue != null ? toSearchedIssue(issue, this, undefined, userLogin)?.issue : undefined;
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
			await this.container.storage.store(`jira:${this._session.accessToken}:organizations`, {
				v: 1,
				timestamp: Date.now(),
				data: organizations,
			});
		}

		this._organizations ||= new Map<string, JiraOrganizationDescriptor[] | undefined>();
		this._organizations.set(this._session.accessToken, organizations);

		if (storedProjects == null && organizations?.length) {
			projects = await this.getProviderProjectsForResources(this._session, organizations);
			await this.container.storage.store(`jira:${this._session.accessToken}:projects`, {
				v: 1,
				timestamp: Date.now(),
				data: projects,
			});
		}

		this._projects ||= new Map<string, JiraProjectDescriptor[] | undefined>();
		for (const project of projects ?? []) {
			const projectKey = `${this._session.accessToken}:${project.resourceId}`;
			const projects = this._projects.get(projectKey);
			if (projects == null) {
				this._projects.set(projectKey, [project]);
			} else {
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
