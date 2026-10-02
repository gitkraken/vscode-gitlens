import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import { JIRA_MAX_PROJECT_KEYS_PER_REQUEST } from '@gitkraken/provider-apis';
import * as l10n from '@vscode/l10n';
import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { throwIfCallerContractError, toCollectionScopeFailure } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import type { IssuesForProjectOptions, ProjectIssuesDrain, ProjectIssuesRequest } from '../models/issueReads.js';
import {
	groupProjectIssuesSearches,
	IssuesIntegration,
	splitProjectIssuesSearch,
} from '../models/issuesIntegration.js';
import type { ProviderApiCollectionResult, ProviderIssue } from './models.js';
import { IssueFilter, providersMetadata, toAccount, toIssueShape } from './models.js';
import type { ProvidersApi } from './providersApi.js';
import { collectProviderPagedResult, mergeCollectionMetadata } from './utils/providerPaging.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Jira];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;

type JiraUserScope = { authorLogin?: string; assigneeLogins?: string[]; mentionLogin?: string };
type JiraIssuePage = Awaited<ReturnType<ProvidersApi['getIssuesForProjectPaged']>>;
/** One page of a Jira issue search, whether it names one project or several. */
type JiraIssuePageFetcher = (scope: JiraUserScope, cursor: string | undefined) => Promise<JiraIssuePage>;

type JiraFailureScope = CollectionScopeFailure['scope'];

type JiraIssuesDrain = {
	issues: ProviderIssue[];
	status: 'complete' | 'backstop' | 'incomplete';
	metadata?: CollectionMetadata;
};

type JiraUserScopedRead = { issues: ProviderIssue[]; truncated: boolean; metadata?: CollectionMetadata };

/**
 * Follows a search's cursor up to `maxPages`. A page failure after the first page leaves the already-drained prefix
 * intact and records the failure at `failureScope` instead of re-throwing and discarding the prefix; if nothing was
 * fetched yet, the throw propagates so the caller sees a hard error rather than an empty partial success.
 */
async function drainJiraIssues(
	fetchPage: JiraIssuePageFetcher,
	scope: JiraUserScope,
	maxPages: number,
	failureScope: JiraFailureScope,
): Promise<JiraIssuesDrain> {
	const issues: ProviderIssue[] = [];
	let cursor: string | undefined;
	let status: JiraIssuesDrain['status'] = 'complete';
	let metadata: CollectionMetadata | undefined;
	const stopIncomplete = (ex: unknown): void => {
		status = 'incomplete';
		metadata = mergeCollectionMetadata(metadata, {
			completeness: 'partial',
			failures: [toCollectionScopeFailure(failureScope, ex)],
		});
	};
	for (let i = 0; i < maxPages; i++) {
		let result: JiraIssuePage;
		try {
			result = await fetchPage(scope, cursor);
		} catch (ex) {
			if (issues.length === 0) throw ex;

			stopIncomplete(ex);
			break;
		}
		if (result == null) {
			if (cursor == null) break;

			stopIncomplete(new Error('Jira returned no page after advertising a continuation'));
			break;
		}

		issues.push(...result.data);
		if (!result.hasMore) break;

		// The provider claims more pages but gave no advancing cursor: we can't continue, so the drain
		// is incomplete — flag it rather than silently stopping (matches drainPullRequests/Repositories).
		if (result.nextCursor == null || result.nextCursor === cursor) {
			stopIncomplete(new Error('Jira returned no advancing issue continuation'));
			break;
		}

		cursor = result.nextCursor;
		if (i === maxPages - 1) {
			status = 'backstop';
		}
	}
	return { issues: issues, status: status, metadata: metadata };
}

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
							title: l10n.t('Open Issue {0} on {1}', `${dashedPrefix}<num>`, organization.name),

							type: 'issue',
							description: l10n.t('{0} Issue {1}', organization.name, `${dashedPrefix}<num>`),
							descriptor: { ...organization },
						});
						autolinks.push({
							prefix: underscoredPrefix,
							url: `${organization.url}/browse/${dashedPrefix}<num>`,
							alphanumeric: false,
							ignoreCase: false,
							referenceType: 'branch',
							title: l10n.t('Open Issue {0} on {1}', `${dashedPrefix}<num>`, organization.name),

							type: 'issue',
							description: l10n.t('{0} Issue {1}', organization.name, `${dashedPrefix}<num>`),
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
		const projectsCache = (this._projects ??= new Map<string, JiraProjectDescriptor[] | undefined>());

		let resourcesWithoutProjects = [];
		if (force) {
			resourcesWithoutProjects = resources;
		} else {
			for (const resource of resources) {
				const resourceKey = `${accessToken}:${resource.id}`;
				const cachedProjects = projectsCache.get(resourceKey);
				if (cachedProjects == null) {
					resourcesWithoutProjects.push(resource);
				}
			}
		}

		let metadata: CollectionMetadata | undefined;
		const partialProjects: JiraProjectDescriptor[] = [];
		if (resourcesWithoutProjects.length > 0) {
			const api = await this.getProvidersApi();
			const tokenWithInfo = toTokenWithInfo(this.id, session);
			const drains = await Promise.allSettled(
				resourcesWithoutProjects.map(async resource => ({
					resource: resource,
					result: await collectProviderPagedResult(
						cursor => api.getJiraProjectsForResource(tokenWithInfo, resource.id, { cursor: cursor }),
						maxPagesPerRequest,
						{ providerId: this.id, resourceId: resource.id },
					),
				})),
			);

			drains.forEach((drain, index) => {
				if (drain.status === 'rejected') {
					const resource = resourcesWithoutProjects[index];
					if (resource == null) return;

					metadata = mergeCollectionMetadata(metadata, {
						completeness: 'partial',
						failures: [
							toCollectionScopeFailure({ providerId: this.id, resourceId: resource.id }, drain.reason),
						],
					});
					return;
				}

				const { resource, result } = drain.value;
				metadata = mergeCollectionMetadata(metadata, result.metadata);
				const projects = result.values
					.filter(project => project.resourceId === resource.id)
					.map(project => ({ ...project }));
				const incomplete =
					result.truncated === true ||
					(result.metadata != null && result.metadata.completeness !== 'complete');
				if (incomplete) {
					partialProjects.push(...projects);
					if (
						result.truncated === true &&
						(result.metadata == null || result.metadata.completeness === 'complete')
					) {
						metadata = mergeCollectionMetadata(metadata, { completeness: 'partial' });
					}
					return;
				}

				projectsCache.set(`${accessToken}:${resource.id}`, projects);
			});
		}

		const values = resources.reduce<JiraProjectDescriptor[]>((projects, resource) => {
			const resourceProjects = projectsCache.get(`${accessToken}:${resource.id}`);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, partialProjects);

		const projectsByIdentity = new Map<string, JiraProjectDescriptor>();
		for (const project of values) {
			const identity = `${project.resourceId}:${project.id}`;
			if (!projectsByIdentity.has(identity)) {
				projectsByIdentity.set(identity, project);
			}
		}
		return { values: [...projectsByIdentity.values()], metadata: metadata };
	}

	protected override async getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: JiraProjectDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<IssueShape[] | undefined> {
		return (await this.getProviderIssuesForProjectWithTruncation(session, project, options))?.values;
	}

	protected override async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: JiraProjectDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<ProjectIssuesDrain | undefined> {
		const tokenWithInfo = toTokenWithInfo(this.id, session);

		const api = await this.getProvidersApi();

		const projectScope = {
			providerId: this.id,
			resourceId: project.resourceId,
			projectId: project.name,
		};
		const fetchPage: JiraIssuePageFetcher = (scope, cursor) =>
			api.getIssuesForProjectPaged(tokenWithInfo, project.name, project.resourceId, {
				...scope,
				cursor: cursor,
				sort: options?.sort,
			});

		if (options?.user != null) {
			const read = await this.readUserScopedIssues(
				fetchPage,
				maxPagesPerRequest,
				options.user,
				options,
				projectScope,
			);
			const values = this.toUniqueIssueShapes(read.issues);
			return read.truncated
				? { values: values, truncated: true, recovery: 'none', metadata: read.metadata }
				: { values: values, truncated: false, metadata: read.metadata };
		}

		const unscoped = await drainJiraIssues(fetchPage, {}, maxPagesPerRequest, projectScope);
		const values = unscoped.issues
			.map(issue => toIssueShape(issue, this))
			.filter((result): result is IssueShape => result !== undefined);
		return unscoped.status !== 'complete'
			? {
					values: values,
					truncated: true,
					recovery: unscoped.status === 'backstop' ? 'narrow-scope' : 'none',
					metadata: unscoped.metadata,
				}
			: { values: values, truncated: false, metadata: unscoped.metadata };
	}

	/**
	 * Searches a site's projects together for a user-scoped read: one JQL names up to
	 * {@link JIRA_MAX_PROJECT_KEYS_PER_REQUEST} projects of one site and one user scope, past which the SDK refuses
	 * the call rather than risk a query string Jira rejects.
	 *
	 * An unscoped read is never searched across projects: it drains every issue in the project, and its backstop is
	 * reported as `narrow-scope` per project, which one search across projects could not attribute.
	 */
	protected override getProjectIssuesSearches(
		requests: readonly ProjectIssuesRequest<JiraProjectDescriptor>[],
	): number[][] | undefined {
		return groupProjectIssuesSearches(
			requests,
			({ project, options }) =>
				options.user != null
					? [
							project.resourceId,
							options.user,
							options.userId ?? '',
							options.sort ?? '',
							options.filters?.join(',') ?? '',
						].join('\0')
					: undefined,
			JIRA_MAX_PROJECT_KEYS_PER_REQUEST,
		);
	}

	protected override async searchProviderProjectIssues(
		session: ProviderAuthenticationSession,
		requests: readonly ProjectIssuesRequest<JiraProjectDescriptor>[],
	): Promise<IssueShape[][] | undefined> {
		// Every request of a search shares its site and user scope (see `getProjectIssuesSearches`).
		const { project, options } = requests[0];
		if (options.user == null) return undefined;

		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const api = await this.getProvidersApi();
		const projectKeys = requests.map(request => request.project.key);

		// The budget of a single project's read: a search that needs more is read again per project, whose reads
		// run concurrently, rather than walking one long cursor chain.
		const read = await this.readUserScopedIssues(
			(userScope, cursor) =>
				api.getIssuesForProjectsPaged(tokenWithInfo, projectKeys, project.resourceId, {
					...userScope,
					cursor: cursor,
					sort: options.sort,
				}),
			maxPagesPerRequest,
			options.user,
			options,
			// Never published: an incomplete search is read again per project, which records its own failures.
			{ providerId: this.id, resourceId: project.resourceId },
		);
		// Deliberately discarded rather than served: an incomplete search says nothing about which of its projects
		// it covered, so only the per-project reads can report each one's completeness. The waste is bounded by
		// one project's page budget, and paid only by a search that needed more than that or failed partway.
		if (read.truncated) return undefined;

		const split = splitProjectIssuesSearch(
			requests.map(request => request.project.id),
			read.issues,
			issue => issue.project?.id ?? undefined,
		);
		return split?.map(issues => this.toUniqueIssueShapes(issues));
	}

	/**
	 * Runs one drain per requested relationship (assignee by default) and keeps whatever succeeded. Throws only
	 * when every relationship failed, so the caller sees a hard error rather than an empty success.
	 */
	private async readUserScopedIssues(
		fetchPage: JiraIssuePageFetcher,
		maxPages: number,
		user: string,
		options: IssuesForProjectOptions,
		failureScope: JiraFailureScope,
	): Promise<JiraUserScopedRead> {
		// `assignee` and `creator` are user FIELDS: Jira resolves an accountId against the directory, which is
		// the identity that keeps matching once a display name cannot be looked up — a deactivated account, or
		// a profile whose visibility hides the name. Measured against a live site: a deactivated assignee
		// returns its issues by accountId and an empty page by display name, and Jira reports that miss as a
		// successful empty search rather than an error, so the list simply appears empty.
		//
		// `mention` is NOT a user field. It is `comment ~ "..."`, a free-text search over comment bodies, so an
		// accountId matches nothing there and the display name is the only value that can. Hence the id is
		// applied to the first two and the handle is kept for the third, rather than swapping `user` wholesale.
		const userField = options.userId ?? user;
		// A resolved user always scopes the read. Default to the assignee filter ("my issues") when no
		// explicit filters are given — otherwise a caller that scopes by user but omits filters would fall
		// through to an unscoped fetch and get every issue in the project instead of the user's.
		const filters = options.filters?.length ? options.filters : [IssueFilter.Assignee];
		const settled = await Promise.allSettled(
			filters.map(filter =>
				drainJiraIssues(
					fetchPage,
					{
						authorLogin: filter === IssueFilter.Author ? userField : undefined,
						assigneeLogins: filter === IssueFilter.Assignee ? [userField] : undefined,
						mentionLogin: filter === IssueFilter.Mention ? user : undefined,
					},
					maxPages,
					failureScope,
				),
			),
		);

		// If every filter branch rejected, the read failed outright — propagate the first rejection instead
		// of returning an empty list, which the facade (getIssuesForProjectResult → runCaptured) would
		// otherwise surface as a successful "no issues" rather than a warning + fetchFailed. The first
		// reason is re-thrown as-is (not wrapped in an AggregateError) so the facade can still classify it
		// by type (auth/rate-limit) — wrapping would collapse every failure to a generic 'other'. The
		// remaining reasons would otherwise be discarded, so log them here to keep them diagnosable.
		if (settled.every(r => r.status === 'rejected')) {
			for (let i = 1; i < settled.length; i++) {
				const outcome = settled[i];
				if (outcome.status === 'rejected') {
					Logger.error(outcome.reason, `readUserScopedIssues: filter '${filters[i]}' failed`);
				}
			}
			throw settled[0].status === 'rejected' ? settled[0].reason : new Error('Jira issue read failed');
		}

		let truncated = false;
		let metadata: CollectionMetadata | undefined;
		const issues: ProviderIssue[] = [];
		for (let i = 0; i < settled.length; i++) {
			const outcome = settled[i];
			const filter = filters[i];
			// A rejected filter branch (with at least one sibling succeeding) means these issues are incomplete:
			// keep the sibling results but record a structured failure so the facade can warn on the specific
			// filter (auth/rate-limit) instead of just a generic truncation flag.
			if (outcome.status !== 'fulfilled') {
				// Identical for every filter branch, so degrading it would report one failure per branch for a
				// single invalid call — see `throwIfCallerContractError`.
				throwIfCallerContractError(outcome.reason);

				truncated = true;
				const failure = toCollectionScopeFailure(failureScope, outcome.reason);
				metadata = mergeCollectionMetadata(metadata, {
					completeness: 'partial',
					failures: [
						{
							...failure,
							message: `Issue filter '${filter}' could not be read${
								failure.message != null ? `: ${failure.message}` : ''
							}`,
						},
					],
				});
				continue;
			}

			if (outcome.value.status !== 'complete') {
				truncated = true;
			}
			if (outcome.value.metadata != null) {
				metadata = mergeCollectionMetadata(metadata, outcome.value.metadata);
			}
			issues.push(...outcome.value.issues);
		}
		return { issues: issues, truncated: truncated, metadata: metadata };
	}

	/** Each relationship is its own search, so an issue matching two of them arrives twice. */
	private toUniqueIssueShapes(issues: ProviderIssue[]): IssueShape[] {
		const resultsById = new Map<string, IssueShape>();
		for (const issue of issues) {
			const shape = toIssueShape(issue, this);
			if (shape != null && !resultsById.has(shape.id)) {
				resultsById.set(shape.id, shape);
			}
		}
		return [...resultsById.values()];
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

	protected override async getProviderIssueByResourceId(
		session: ProviderAuthenticationSession,
		resourceId: string,
		id: string,
		resourceUrl: string | undefined,
	): Promise<Issue | undefined> {
		if (resourceUrl == null) {
			throw new Error('Jira direct issue reads require a resource URL');
		}

		const api = await this.getProvidersApi();
		const apiResult = await api.getJiraIssueByKey(toTokenWithInfo(this.id, session), resourceId, resourceUrl, id);
		const issue = apiResult != null ? toIssueShape(apiResult, this, { reliableStateCategory: true }) : undefined;
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
