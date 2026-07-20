import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderApiCollectionResult, ProviderIssue } from './models.js';
import { IssueFilter, providersMetadata, toAccount, toIssueShape } from './models.js';

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
		session: ProviderAuthenticationSession,
		resource: JiraOrganizationDescriptor,
	): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const user = await api.getCurrentUserForResource(toTokenWithInfo(this.id, session), resource.id);

		if (user == null) return undefined;
		return toAccount(user, this);
	}

	private _organizations: Map<string, JiraOrganizationDescriptor[] | undefined> | undefined;
	protected override async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		const { accessToken } = session;
		this._organizations ??= new Map<string, JiraOrganizationDescriptor[] | undefined>();

		const cachedResources = this._organizations.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const resources = await api.getJiraResourcesForCurrentUser(toTokenWithInfo(this.id, session));
			this._organizations.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._organizations.get(accessToken);
	}

	private _projects: Map<string, JiraProjectDescriptor[] | undefined> | undefined;
	protected override async getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: JiraOrganizationDescriptor[],
		force: boolean = false,
	): Promise<JiraProjectDescriptor[] | undefined> {
		return (await this.getProviderProjectsForResourcesWithMetadata(session, resources, force)).values;
	}

	protected override async getProviderProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: JiraOrganizationDescriptor[],
		force: boolean = false,
	): Promise<ProviderApiCollectionResult<JiraProjectDescriptor>> {
		const { accessToken } = session;
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

		let metadata: CollectionMetadata | undefined;
		if (resourcesWithoutProjects.length > 0) {
			const api = await this.getProvidersApi();
			const result = await api.getJiraProjectsForResources(
				toTokenWithInfo(this.id, session),
				resourcesWithoutProjects.map(r => r.id),
			);
			metadata = result.metadata;

			// Only the resources the SDK did NOT report as failed are proven: cache their mapped projects
			// (including a proven-empty array, so a genuinely empty resource doesn't refetch every time). A
			// resource listed in `metadata.failures` is left uncached so the next read retries it, and — crucially
			// on a forced refresh — its existing valid cache entry is preserved rather than erased by the failure.
			const failedResourceIds = new Set(
				(metadata?.failures ?? []).map(f => f.scope?.resourceId).filter((id): id is string => id != null),
			);

			for (const resource of resourcesWithoutProjects) {
				if (failedResourceIds.has(resource.id)) continue;

				const projects = result.values.filter(p => p.resourceId === resource.id);
				this._projects.set(
					`${accessToken}:${resource.id}`,
					projects.map(p => ({ ...p })),
				);
			}
		}

		const values = resources.reduce<JiraProjectDescriptor[]>((projects, resource) => {
			const resourceProjects = this._projects!.get(`${accessToken}:${resource.id}`);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, []);

		return { values: values, metadata: metadata };
	}

	protected override async getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: JiraProjectDescriptor,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<IssueShape[] | undefined> {
		return (await this.getProviderIssuesForProjectWithTruncation(session, project, options))?.values;
	}

	protected override async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: JiraProjectDescriptor,
		options?: { user?: string; filters?: IssueFilter[] },
	): Promise<{ values: IssueShape[]; truncated: boolean } | undefined> {
		const tokenWithInfo = toTokenWithInfo(this.id, session);

		const api = await this.getProvidersApi();

		// Drain every page for a project read (bounded by a defensive backstop): the paged wrapper preserves the
		// SDK's cursor, unlike the plain read which silently caps at the first page. `filter` undefined = the
		// unscoped project read. Reports `truncated` when the drain stopped at the backstop with more pages
		// still available, so the facade can flag an incomplete project read.
		const drainIssues = async (scope: {
			authorLogin?: string;
			assigneeLogins?: string[];
			mentionLogin?: string;
		}): Promise<{ issues: ProviderIssue[]; truncated: boolean }> => {
			const collected: ProviderIssue[] = [];
			let cursor: string | undefined;
			let truncated = false;
			for (let i = 0; i < maxPagesPerRequest; i++) {
				const result = await api.getIssuesForProjectPaged(tokenWithInfo, project.name, project.resourceId, {
					...scope,
					cursor: cursor,
				});
				if (result == null) break;

				collected.push(...result.data);
				if (!result.hasMore) break;

				// The provider claims more pages but gave no advancing cursor: we can't continue, so the drain
				// is incomplete — flag it rather than silently stopping (matches drainPullRequests/Repositories).
				if (result.nextCursor == null || result.nextCursor === cursor) {
					truncated = true;
					break;
				}

				cursor = result.nextCursor;
				// More pages remain but we're at the last allowed iteration: the drain is incomplete.
				if (i === maxPagesPerRequest - 1) {
					truncated = true;
				}
			}
			return { issues: collected, truncated: truncated };
		};

		const getSearchedUserIssuesForFilter = async (
			user: string,
			filter: IssueFilter,
		): Promise<{ issues: IssueShape[]; truncated: boolean }> => {
			const result = await drainIssues({
				authorLogin: filter === IssueFilter.Author ? user : undefined,
				assigneeLogins: filter === IssueFilter.Assignee ? [user] : undefined,
				mentionLogin: filter === IssueFilter.Mention ? user : undefined,
			});

			return {
				issues: result.issues
					.map(issue => toIssueShape(issue, this))
					.filter((r): r is IssueShape => r !== undefined),
				truncated: result.truncated,
			};
		};

		if (options?.user != null) {
			const user = options.user;
			// A resolved user always scopes the read. Default to the assignee filter ("my issues") when no
			// explicit filters are given — otherwise a caller that scopes by user but omits filters would fall
			// through to the unscoped fetch below and get every issue in the project instead of the user's.
			const filters = options.filters?.length ? options.filters : [IssueFilter.Assignee];
			const settled = await Promise.allSettled(
				filters.map(filter => getSearchedUserIssuesForFilter(user, filter)),
			);

			// If every filter branch rejected, the read failed outright — propagate the first rejection instead
			// of returning an empty list, which the facade (getIssuesForProjectResult → runCaptured) would
			// otherwise surface as a successful "no issues" rather than a warning + fetchFailed.
			if (settled.every(r => r.status === 'rejected')) {
				throw settled[0].status === 'rejected' ? settled[0].reason : new Error('Jira issue read failed');
			}

			let truncated = false;
			const resultsById = new Map<string, IssueShape>();
			for (const outcome of settled) {
				// A rejected filter branch (with at least one sibling succeeding) means this project's issues are
				// incomplete: keep the sibling results but flag `truncated` so the facade reports the read as
				// partial rather than publishing a mixed-success fan-out as complete. (This path returns
				// `{ values, truncated }` with no structured-failure channel; the truncation drives the facade's
				// incompleteness warning.)
				if (outcome.status !== 'fulfilled') {
					truncated = true;
					continue;
				}

				if (outcome.value.truncated) {
					truncated = true;
				}
				for (const resultIssue of outcome.value.issues) {
					if (!resultsById.has(resultIssue.id)) {
						resultsById.set(resultIssue.id, resultIssue);
					}
				}
			}

			return { values: [...resultsById.values()], truncated: truncated };
		}

		const unscoped = await drainIssues({});
		return {
			values: unscoped.issues
				.map(issue => toIssueShape(issue, this))
				.filter((result): result is IssueShape => result !== undefined),
			truncated: unscoped.truncated,
		};
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: JiraOrganizationDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		const myResources = resources ?? (await this.getProviderResourcesForUser(session));
		if (!myResources) return undefined;

		const api = await this.getProvidersApi();

		const results: IssueShape[] = [];
		for (const resource of myResources) {
			if (cancellation?.aborted) break;

			try {
				let cursor = undefined;
				let hasMore = false;
				let requestCount = 0;
				do {
					if (cancellation?.aborted) break;

					const resourceIssues = await api.getIssuesForResourceForCurrentUser(
						toTokenWithInfo(this.id, session),
						resource.id,
						{
							cursor: cursor,
						},
					);
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
		session: ProviderAuthenticationSession,
		resource: JiraOrganizationDescriptor,
		{ key }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		const api = await this.getProvidersApi();
		const issue = await api.getIssue(toTokenWithInfo(this.id, session), {
			resourceId: resource.id,
			number: key,
		});
		return issue != null ? toIssueShape(issue, this) : undefined;
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		resource: JiraOrganizationDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const api = await this.getProvidersApi();
		const apiResult = await api.getIssue(toTokenWithInfo(this.id, session), {
			resourceId: resource.id,
			number: id,
		});
		const issue = apiResult != null ? toIssueShape(apiResult, this) : undefined;
		return issue != null ? { ...issue, type: 'issue' } : undefined;
	}

	protected override async providerOnConnect(): Promise<void> {
		this._autolinks = undefined;
		if (this._session == null) return;

		const storedOrganizations = this.ctx.storage.get(`jira:${this._session.accessToken}:organizations`);
		const storedProjects = this.ctx.storage.get(`jira:${this._session.accessToken}:projects`);

		let organizations = storedOrganizations?.data?.map((o: JiraOrganizationDescriptor) => ({ ...o }));

		let projects = storedProjects?.data?.map((p: JiraProjectDescriptor) => ({ ...p }));

		if (storedOrganizations == null) {
			organizations = await this.getProviderResourcesForUser(this._session, true);
			// Clear all other stored organizations and projects when our session changes
			await this.ctx.storage.deleteWithPrefix('jira');
			await this.ctx.storage.store(`jira:${this._session.accessToken}:organizations`, {
				v: 1,
				timestamp: Date.now(),
				data: organizations,
			});
		}

		this._organizations ??= new Map<string, JiraOrganizationDescriptor[] | undefined>();
		this._organizations.set(this._session.accessToken, organizations);

		if (storedProjects == null && organizations?.length) {
			projects = await this.getProviderProjectsForResources(this._session, organizations);
			await this.ctx.storage.store(`jira:${this._session.accessToken}:projects`, {
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
