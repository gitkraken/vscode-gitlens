import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { JIRA_MAX_PROJECT_KEYS_PER_REQUEST } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { chunk } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import { mapSettledBounded } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { ProviderRefusal } from '../collectionMetadata.js';
import { toCollectionScopeFailure } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import type { IssueEtagFields } from '../models/integration.js';
import type {
	AccountWideIssuesResult,
	IssuesForProjectOptions,
	ProjectIssuesDrain,
	ProjectIssuesRequest,
	SearchMyIssuesOptions,
} from '../models/issueReads.js';
import { groupProjectIssuesSearches, IssuesIntegration } from '../models/issuesIntegration.js';
import type { JiraIssueEtagResponse } from './jiraIssueByKey.js';
import { jiraBulkFetchMaxKeys, toJiraIssueEtagFields } from './jiraIssueByKey.js';
import type { ProviderApiCollectionResult } from './models.js';
import { providersMetadata, toAccount, toIssueShape, toProviderIssueStates } from './models.js';
import { isJiraMissingProjectError } from './providerErrors.js';
import { DiscoveryCache, isAutolinkSetExpired } from './utils/discoveryCache.js';
import { createIssueAutolinkReferences } from './utils/issueAutolinks.js';
import type { JiraDrainOptions, JiraIssuePageFetcher } from './utils/jiraIssueDrains.js';
import {
	drainJiraIssues,
	readUserScopedJiraIssues,
	searchJiraProjectIssues,
	summarizePageMetadata,
	toUniqueJiraIssueShapes,
} from './utils/jiraIssueDrains.js';
import { collectProviderPagedResult, mergeCollectionMetadata } from './utils/providerPaging.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Jira];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;
/** A numeric issue id, which Jira's issue reads accept in place of a key. */
const numericIssueId = /^\d+$/;

/**
 * `assignee` and `creator` are user FIELDS: Jira resolves an accountId against the directory, which is the identity
 * that keeps matching once a display name cannot be looked up — a deactivated account, or a profile whose visibility
 * hides the name. Measured against a live site: a deactivated assignee returns its issues by accountId and an empty
 * page by display name, and Jira reports that miss as a successful empty search rather than an error, so the list
 * simply appears empty.
 *
 * `mention` is NOT a user field. It is `comment ~ "..."`, a free-text search over comment bodies, so an accountId
 * matches nothing there and the display name is the only value that can. Hence the id is applied to the first two
 * and the handle is kept for the third, rather than swapping `user` wholesale.
 */
function toUserIdentities(user: string, options: IssuesForProjectOptions): { userField: string; mention: string } {
	return { userField: options.userId ?? user, mention: user };
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

	/**
	 * Built from the sites and their projects, so it follows them: rebuilt when a site's project list changes or the
	 * caches are dropped, and once {@link isAutolinkSetExpired}: older than the TTL, or than a shorter retry delay when
	 * the sites or a site's projects couldn't be read whole. An expired set is still served while it is rebuilt in the
	 * background, because autolinks are read on every render of a commit message and must not wait on the network,
	 * nor go empty just because nothing read the projects for a while (#5907, #6183).
	 */
	private readonly _autolinks = new Map<
		string,
		{ autolinks: (AutolinkReference | DynamicAutolinkReference)[]; builtAt: number; complete: boolean }
	>();
	private readonly _autolinksBuilds = new Map<string, Promise<(AutolinkReference | DynamicAutolinkReference)[]>>();
	/**
	 * Moves, by token, on every missing-project eviction, which drops one site's list without clearing the caches: a
	 * build or project read that started before it puts neither the list it read back in `_projects` nor what it built
	 * from it in `_autolinks` (#6176). Cleared with `_projects`, whose generation then refuses those same writes.
	 */
	private readonly _projectEvictions = new Map<string, number>();

	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null) return [];

		const session = this._session;
		const cached = this._autolinks.get(session.accessToken);
		// A session kept through a failed refresh is expired: building with it would send that token to the provider
		// on every render, so serve whatever was built before (none after a forced re-sync) until a read refreshes it.
		if (this.connectionExpired === true) return cached?.autolinks ?? [];
		if (cached == null || (cached.builtAt === 0 && !cached.complete && cached.autolinks.length === 0)) {
			return this.buildAutolinks(session);
		}

		if (cached.builtAt === 0 || isAutolinkSetExpired(cached)) {
			void this.buildAutolinks(session);
		}
		return cached.autolinks;
	}

	/**
	 * One build per token at a time: concurrent renders share it rather than each re-reading sites and projects. A
	 * drop, a missing-project eviction or a change to a site's project list retires it, so a render after one doesn't
	 * join a build reading the lists as they were before (#6170, #6176, #6184).
	 */
	private buildAutolinks(
		session: ProviderAuthenticationSession,
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const { accessToken } = session;
		let build = this._autolinksBuilds.get(accessToken);
		if (build == null) {
			build = this.buildAutolinksCore(session, () => build).finally(() => {
				// A drop, an eviction or a list change meanwhile retired this build, and the entry may be a later
				// one's now.
				if (this._autolinksBuilds.get(accessToken) === build) {
					this._autolinksBuilds.delete(accessToken);
				}
			});
			this._autolinksBuilds.set(accessToken, build);
		}
		return build;
	}

	private async buildAutolinksCore(
		session: ProviderAuthenticationSession,
		reader?: () => Promise<unknown> | undefined,
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const { accessToken } = session;
		const generation = this._projects.generation;
		const evictions = this._projectEvictions.get(accessToken);
		try {
			const organizations = await this.getProviderResourcesForUser(session, false, reader);
			if (
				organizations != null &&
				this._projects.generation === generation &&
				this._projectEvictions.get(accessToken) === evictions
			) {
				const projects = await this.getProviderProjectsForResourcesWithMetadata(
					session,
					organizations,
					false,
					reader,
				);
				if (
					(this._projects.generation !== generation ||
						this._projectEvictions.get(accessToken) !== evictions) &&
					(projects.values.length > 0 || !projects.metadata?.failures?.length)
				) {
					// Existing waiters own this successful response, but the active generation must not retain it.
					return organizations.flatMap(organization =>
						getProjectAutolinks(
							organization,
							projects.values.filter(p => p.resourceId === organization.id),
						),
					);
				}
			}
		} catch (ex) {
			Logger.error(ex, 'JiraIntegration.autolinks');
		}
		return this.deriveAutolinks(accessToken, {
			store: this._projects.generation === generation && this._projectEvictions.get(accessToken) === evictions,
		});
	}

	private deriveAutolinks(
		accessToken: string,
		options?: {
			store?: boolean;
			settled?: boolean;
		},
	): (AutolinkReference | DynamicAutolinkReference)[] {
		const organizations = this._organizations.peek(accessToken);
		let complete = this._organizations.get(accessToken) != null;
		const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];
		for (const organization of organizations ?? []) {
			const key = `${accessToken}:${organization.id}`;
			complete &&= this._projects.get(key) != null;
			autolinks.push(...getProjectAutolinks(organization, this._projects.peek(key) ?? []));
		}
		if (options?.store !== false) {
			this._autolinks.set(accessToken, {
				autolinks: autolinks,
				complete: complete,
				// Stores preserve the retry deadline; only a settled build restarts it.
				builtAt:
					options?.settled !== false
						? Date.now()
						: this._autolinks.get(accessToken)?.builtAt || (complete ? Date.now() : 0),
			});
		}
		return autolinks;
	}

	private onDiscoveryStored(accessToken: string, reader?: () => Promise<unknown> | undefined): void {
		// A build's own store must not break sharing before its continuation runs.
		if (this._autolinksBuilds.get(accessToken) !== reader?.()) {
			this._autolinksBuilds.delete(accessToken);
		}
		this.deriveAutolinks(accessToken, { settled: false });
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

	/** Atlassian's account id is the same on every site, so the first site answers for all of them. */
	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const resource = (await this.getProviderResourcesForUser(session))?.[0];
		return resource != null ? this.getProviderAccountForResource(session, resource) : undefined;
	}

	/** The site-list request the resource cache would otherwise answer; see `IntegrationBase.validateCredential`. */
	protected override async validateCredential(session: ProviderAuthenticationSession): Promise<void> {
		const api = await this.getProvidersApi();
		if ((await api.getJiraResourcesForCurrentUser(toTokenWithInfo(this.id, session))) == null) {
			throw new Error('Jira did not confirm the credential');
		}
	}

	/**
	 * Atlassian's `401` for a token missing a scope the request needs, which a reconnect fixes by consenting to it
	 * again; see `IntegrationBase.isCredentialRefusal`. Atlassian gives the same answer to a malformed request URL,
	 * so a request the SDK built wrong would read as the credential's too.
	 */
	protected override isCredentialRefusal(refusal: ProviderRefusal): boolean {
		return refusal.status === 401 && /scope does not match/i.test(refusal.detail ?? '');
	}

	/**
	 * The sites and the projects discovered under them, both of which expire and are dropped on a re-sync, so a site
	 * or project created or deleted mid-session is picked up (#5907). Keyed by token, and projects by token and site.
	 */
	private readonly _organizations = new DiscoveryCache<JiraOrganizationDescriptor[]>();
	private readonly _projects = new DiscoveryCache<JiraProjectDescriptor[]>();

	protected override async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
		reader?: () => Promise<unknown> | undefined,
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		const { accessToken } = session;

		const cachedResources = this._organizations.get(accessToken);
		if (cachedResources != null && !force) return cachedResources;

		const generation = this._organizations.generation;
		const started = this._organizations.startRead();
		const organizations = await this.readOrganizations(session);
		if (organizations == null) return undefined;

		const stored = this._organizations.set(accessToken, organizations, { generation: generation, read: started });
		if (stored === 'changed') {
			this.onDiscoveryStored(accessToken, reader);
		}
		return stored === false && this._organizations.generation === generation
			? this._organizations.peek(accessToken)
			: organizations;
	}

	protected override getProviderUncachedResourcesForUser(
		session: ProviderAuthenticationSession,
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		return this.readOrganizations(session);
	}

	private async readOrganizations(
		session: ProviderAuthenticationSession,
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		const api = await this.getProvidersApi();
		const resources = await api.getJiraResourcesForCurrentUser(toTokenWithInfo(this.id, session));
		return resources?.map(r => ({ ...r, key: r.id }));
	}

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
		reader?: () => Promise<unknown> | undefined,
	): Promise<ProviderApiCollectionResult<JiraProjectDescriptor>> {
		const { accessToken } = session;
		const projectsCache = this._projects;
		const generation = projectsCache.generation;
		const evictions = this._projectEvictions.get(accessToken);
		const started = projectsCache.startRead();

		// Taken before the read, so a clear while it is in flight can't empty what was cached when it started. A forced
		// read reads every resource, and still keeps a cached list for one it can't read completely.
		const cachedProjects = new Map<string, JiraProjectDescriptor[]>();
		for (const resource of resources) {
			const projects = projectsCache.get(`${accessToken}:${resource.id}`);
			if (projects != null) {
				cachedProjects.set(resource.id, projects);
			}
		}
		const resourcesWithoutProjects = force
			? resources
			: resources.filter(resource => !cachedProjects.has(resource.id));

		const read = await this.readProjects(session, resourcesWithoutProjects);
		const values: JiraProjectDescriptor[] = [];
		let metadata = read.metadata;
		let changed = false;
		for (const [resourceId, projects] of [...read.complete, ...read.incomplete]) {
			// Not stored when the cache was dropped, a list evicted, or a read started after this one stored it, while
			// this read was in flight: what it found is then no longer trusted for the next read.
			if (this._projectEvictions.get(accessToken) !== evictions) continue;

			const stored = projectsCache.set(`${accessToken}:${resourceId}`, projects, {
				generation: generation,
				read: started,
				complete: read.complete.has(resourceId),
			});
			if (stored === 'changed') {
				changed = true;
			}
		}
		if (changed) {
			this.onDiscoveryStored(accessToken, reader);
		}

		// A site read whole, or served from the cache, answers with its newest list stored: this read's own, or the one
		// a read started after it stored, which this older read must not stand in for, not even once expired (#6184).
		// Once the cache was dropped or a list evicted meanwhile, only what it found itself.
		const current =
			projectsCache.generation === generation && this._projectEvictions.get(accessToken) === evictions;
		for (const resource of resources) {
			const resourceProjects =
				read.complete.get(resource.id) ?? read.incomplete.get(resource.id) ?? cachedProjects.get(resource.id);
			if (resourceProjects == null) continue;

			const stored = current ? projectsCache.peek(`${accessToken}:${resource.id}`) : undefined;
			values.push(...(stored ?? resourceProjects));
			if (stored != null && projectsCache.get(`${accessToken}:${resource.id}`) == null) {
				metadata = mergeCollectionMetadata(metadata, { completeness: 'unknown' });
			}
		}
		return { values: uniqueProjects(values), metadata: metadata };
	}

	protected override async getProviderUncachedProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: JiraOrganizationDescriptor[],
	): Promise<ProviderApiCollectionResult<JiraProjectDescriptor>> {
		const read = await this.readProjects(session, resources);
		return {
			values: uniqueProjects([...read.incomplete.values(), ...read.complete.values()].flat()),
			metadata: read.metadata,
		};
	}

	/**
	 * Reads the projects of each resource from the provider, apart by whether a resource's list came back complete:
	 * incomplete lists remain available for decoration but cannot satisfy a fresh discovery read.
	 */
	private async readProjects(
		session: ProviderAuthenticationSession,
		resources: JiraOrganizationDescriptor[],
	): Promise<{
		complete: Map<string, JiraProjectDescriptor[]>;
		incomplete: Map<string, JiraProjectDescriptor[]>;
		metadata: CollectionMetadata | undefined;
	}> {
		const complete = new Map<string, JiraProjectDescriptor[]>();
		const incompleteLists = new Map<string, JiraProjectDescriptor[]>();
		let metadata: CollectionMetadata | undefined;
		if (resources.length === 0) {
			return { complete: complete, incomplete: incompleteLists, metadata: metadata };
		}

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const drains = await Promise.allSettled(
			resources.map(async resource => {
				let readPage = false;
				const result = await collectProviderPagedResult(
					async cursor => {
						const page = await api.getJiraProjectsForResource(tokenWithInfo, resource.id, {
							cursor: cursor,
						});
						readPage ||= page != null && (page.values.length > 0 || !page.metadata?.failures?.length);
						return page;
					},
					maxPagesPerRequest,
					{ providerId: this.id, resourceId: resource.id },
				);
				return { resource: resource, result: result, readPage: readPage };
			}),
		);

		drains.forEach((drain, index) => {
			if (drain.status === 'rejected') {
				const resource = resources[index];
				if (resource == null) return;

				metadata = mergeCollectionMetadata(metadata, {
					completeness: 'partial',
					failures: [
						toCollectionScopeFailure({ providerId: this.id, resourceId: resource.id }, drain.reason),
					],
				});
				return;
			}

			const { resource, result, readPage } = drain.value;
			metadata = mergeCollectionMetadata(metadata, result.metadata);
			const projects = result.values
				.filter(project => project.resourceId === resource.id)
				.map(project => ({ ...project }));
			const incomplete =
				result.truncated === true || (result.metadata != null && result.metadata.completeness !== 'complete');
			if (incomplete) {
				if (readPage) {
					incompleteLists.set(resource.id, projects);
				}
				if (
					result.truncated === true &&
					(result.metadata == null || result.metadata.completeness === 'complete')
				) {
					metadata = mergeCollectionMetadata(metadata, { completeness: 'partial' });
				}
				return;
			}

			complete.set(resource.id, projects);
		});
		return { complete: complete, incomplete: incompleteLists, metadata: metadata };
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

		const states = toProviderIssueStates(options?.state);
		// By key, not name, as the multi-project search: JQL's `project = "<value>"` also accepts a name or id, so a
		// display name equal to another project's key would address that project. The key is the only unambiguous one.
		const fetchPage: JiraIssuePageFetcher = (scope, cursor) =>
			api.getIssuesForProjectPaged(tokenWithInfo, project.key, project.resourceId, {
				...scope,
				cursor: cursor,
				states: states,
				sort: options?.sort,
			});
		const drainOptions: JiraDrainOptions = {
			maxPages: maxPagesPerRequest,
			failureScope: { providerId: this.id, resourceId: project.resourceId, projectId: project.key },
			providerName: 'Jira',
			// A project this token can no longer see (deleted, or its browse permission removed) holds no issues
			// for it, and the site's project list that named it is stale: drop that list so the next read
			// re-reads it, instead of failing the whole provider on every read until a restart (#5907).
			isEmptyFailure: ex => {
				if (!isJiraMissingProjectError(ex)) return false;

				Logger.warn(`Jira project '${project.key}' no longer exists or is not visible`);
				const { accessToken } = session;
				this._projects.delete(`${accessToken}:${project.resourceId}`);
				// A build or project read in flight may hold the list just dropped; see `_projectEvictions`.
				this._projectEvictions.set(accessToken, (this._projectEvictions.get(accessToken) ?? 0) + 1);
				this._autolinks.delete(accessToken);
				this._autolinksBuilds.delete(accessToken);
				return true;
			},
		};

		if (options?.user != null) {
			const read = await readUserScopedJiraIssues(
				fetchPage,
				options.filters,
				toUserIdentities(options.user, options),
				drainOptions,
			);
			const values = toUniqueJiraIssueShapes(read.issues, this);
			const drain = { values: values, metadata: read.metadata, scope: drainOptions.failureScope };
			return read.truncated ? { ...drain, truncated: true, recovery: 'none' } : { ...drain, truncated: false };
		}

		const unscoped = await drainJiraIssues(fetchPage, {}, drainOptions);
		const values = unscoped.issues
			.map(issue => toIssueShape(issue, this, { projection: 'project' }))
			.filter((result): result is IssueShape => result !== undefined);
		const drain = { values: values, metadata: unscoped.metadata, scope: drainOptions.failureScope };
		return unscoped.status !== 'complete'
			? { ...drain, truncated: true, recovery: unscoped.status === 'backstop' ? 'narrow-scope' : 'none' }
			: { ...drain, truncated: false };
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
							options.state ?? '',
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
		// One project's search is its own read, by the same key and user clauses, so it costs no more to read it as one;
		// and that read attributes a failure to the project and drops a project list that no longer has it.
		if (requests.length === 1) return undefined;

		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const api = await this.getProvidersApi();
		// By key, not name: JQL resolves `project = "<value>"` against key first, so a name could read another
		// project's issues.
		const projectKeys = requests.map(request => request.project.key);
		const states = toProviderIssueStates(options.state);

		return searchJiraProjectIssues(
			(userScope, cursor) =>
				api.getIssuesForProjectsPaged(tokenWithInfo, projectKeys, project.resourceId, {
					...userScope,
					cursor: cursor,
					states: states,
					sort: options.sort,
				}),
			requests.map(request => request.project.id),
			options.filters,
			toUserIdentities(options.user, options),
			{
				maxPages: maxPagesPerRequest,
				failureScope: { providerId: this.id, resourceId: project.resourceId },
				providerName: 'Jira',
			},
			this,
		);
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: JiraOrganizationDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		const result = await this.searchProviderMyIssuesWithTruncation(session, resources, cancellation);
		// This read can only return values, so what the account-wide read reports as missing is at least logged.
		for (const failure of result?.metadata?.failures ?? []) {
			Logger.warn(
				`searchProviderMyIssues: Jira site '${failure.scope?.resourceId ?? '?'}' was not fully read: ${failure.message ?? failure.kind}`,
			);
		}
		return result?.values;
	}

	/**
	 * Overridden so `state` reaches the per-site read, which the default drops. Each site is drained on its own, so a
	 * site that fails keeps what it read and is recorded as that site's failure instead of discarding the sites that
	 * answered; so is an issue a page dropped because it could not be read. A page backstop or a stalled continuation
	 * makes the read `truncated`. A refused site therefore goes through `confirmScopedAuthFailures`, which publishes it
	 * as that site's auth warning or, if the credential itself is refused, as the connection's.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		resources?: JiraOrganizationDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		const states = toProviderIssueStates(options?.state);
		const myResources = resources ?? (await this.getProviderResourcesForUser(session));
		if (!myResources) return undefined;

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);

		const results: IssueShape[] = [];
		let truncated = false;
		let metadata: CollectionMetadata | undefined;
		// What each page reported failing, summarized at the end so a site whose many pages dropped issues reports
		// it once (see `summarizePageMetadata`); the pages keep the rest of their metadata, so `truncated` holds.
		const pages: CollectionMetadata[] = [];
		const readPage = async (resourceId: string, cursor: string | undefined) => {
			const page = await api.getIssuesForResourceForCurrentUser(tokenWithInfo, resourceId, {
				cursor: cursor,
				states: states,
			});
			if (!page.metadata?.failures?.length) return page;

			const { failures: _failures, ...rest } = page.metadata;
			pages.push(page.metadata);
			return { ...page, metadata: rest };
		};
		for (const resource of myResources) {
			if (cancellation?.aborted) break;

			const site = await collectProviderPagedResult(
				cursor =>
					// Cancellation is not truncation: the caller asked for the stop, so the site ends where it is.
					cancellation?.aborted
						? Promise.resolve({ values: [], paging: { cursor: '{}', more: false } })
						: readPage(resource.id, cursor),
				maxPagesPerRequest,
				{ providerId: this.id, resourceId: resource.id },
			);
			results.push(
				...site.values
					.map(issue => toIssueShape(issue, this, { projection: 'account' }))
					.filter((result): result is IssueShape => result != null),
			);
			truncated ||= site.truncated === true;
			metadata = mergeCollectionMetadata(metadata, site.metadata);
		}

		return {
			values: results,
			truncated: truncated,
			metadata: mergeCollectionMetadata(summarizePageMetadata(pages), metadata),
		};
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
		return issue != null ? toIssueShape(issue, this, { projection: 'point' }) : undefined;
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
		const issue = apiResult != null ? toIssueShape(apiResult, this, { projection: 'point' }) : undefined;
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
		const issue = apiResult != null ? toIssueShape(apiResult, this, { projection: 'batch' }) : undefined;
		return issue != null ? { ...issue, type: 'issue' } : undefined;
	}

	/**
	 * The cheap check behind the batch issue read's etags: one bulk fetch per site and {@link jiraBulkFetchMaxKeys}
	 * distinct keys, where {@link getProviderIssueByResourceId} sends one request per issue. A request that throws
	 * rejects only its own targets' slots, with its error classified as the full read's would be.
	 *
	 * A target identified by a numeric issue id, which both reads accept as well as a key, is matched by the returned
	 * issue's `id`; every other target by its key.
	 *
	 * Never proves an absence. Jira silently omits a key it can't find or show (listing it in no `issueErrors` either),
	 * and answers a moved issue under its new key, which no longer matches the key asked for. Either way the target's
	 * slot is rejected, so the full read distinguishes a missing issue from a site failure. When no target was
	 * answered and nothing failed, the check declines, so a batch of only such keys costs a full read, not a failure.
	 */
	protected override async getProviderIssuesEtagFieldsByResourceId(
		session: ProviderAuthenticationSession,
		targets: readonly { resourceId: string; identifier: string; resourceUrl?: string }[],
	): Promise<PromiseSettledResult<IssueEtagFields | undefined>[] | undefined> {
		const slots = new Array<PromiseSettledResult<IssueEtagFields | undefined>>(targets.length);
		let answered = false;
		let failed = false;

		// Each site's distinct keys, matched case-insensitively as Jira matches them, with the targets asking for each.
		const bySite = new Map<string, Map<string, number[]>>();
		for (const [index, target] of targets.entries()) {
			if (target.resourceUrl == null) {
				// Required as the full read requires it, so a check never answers for a target the full read refuses.
				slots[index] = {
					status: 'rejected',
					reason: new Error('Jira direct issue reads require a resource URL'),
				};
				failed = true;
				continue;
			}

			let keys = bySite.get(target.resourceId);
			if (keys == null) {
				keys = new Map();
				bySite.set(target.resourceId, keys);
			}

			const key = target.identifier.toUpperCase();
			let indices = keys.get(key);
			if (indices == null) {
				indices = [];
				keys.set(key, indices);
			}
			indices.push(index);
		}

		const requests = [...bySite].flatMap(([resourceId, keys]) =>
			chunk([...keys], jiraBulkFetchMaxKeys).map(entries => ({ resourceId: resourceId, entries: entries })),
		);
		if (!requests.length) return slots;

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const answers = await mapSettledBounded(requests, providerFanOutConcurrency, r =>
			api.getJiraIssuesEtagFields(
				tokenWithInfo,
				r.resourceId,
				r.entries.map(([key]) => key),
			),
		);

		for (const [i, answer] of answers.entries()) {
			const { entries } = requests[i];
			if (answer.status === 'rejected') {
				failed = true;
				for (const [, indices] of entries) {
					for (const index of indices) {
						slots[index] = answer;
					}
				}
				continue;
			}

			if (answer.value.errorCount > 0) {
				failed = true;
			}

			// By key or id, never by position: Jira returns the issues in its own order, and only the ones it found.
			const byKey = new Map<string, JiraIssueEtagResponse>();
			const byId = new Map<string, JiraIssueEtagResponse>();
			for (const issue of answer.value.issues) {
				byKey.set(issue.key.toUpperCase(), issue);
				byId.set(issue.id, issue);
			}

			for (const [key, indices] of entries) {
				// A key target never matches by id, so an issue returned under a different key (moved) is rejected.
				const issue = numericIssueId.test(key) ? byId.get(key) : byKey.get(key);
				let slot: PromiseSettledResult<IssueEtagFields | undefined>;
				if (issue == null) {
					slot = { status: 'rejected', reason: new Error(`Jira bulk fetch did not return ${key}`) };
				} else {
					try {
						slot = { status: 'fulfilled', value: toJiraIssueEtagFields(issue) };
						answered = true;
					} catch (ex) {
						slot = { status: 'rejected', reason: ex };
						failed = true;
					}
				}

				for (const index of indices) {
					slots[index] = slot;
				}
			}
		}

		return answered || failed ? slots : undefined;
	}

	protected override async providerOnConnect(): Promise<void> {
		this._autolinks.clear();
		if (this._session == null) return;

		const session = this._session;
		const organizations = await this.getProviderResourcesForUser(session, true);
		if (organizations?.length) {
			await this.getProviderProjectsForResources(session, organizations, true);
		}
	}

	protected override clearDiscoveryCaches(): void {
		this._organizations.clear();
		this._projects.clear();
		this._projectEvictions.clear();
		this._autolinks.clear();
		this._autolinksBuilds.clear();
	}

	protected override providerOnDisconnect(): void {
		this._organizations.clear();
		this._projects.clear();
		this._projectEvictions.clear();
		this._autolinks.clear();
	}
}

function getProjectAutolinks(
	organization: JiraOrganizationDescriptor,
	projects: readonly JiraProjectDescriptor[],
): AutolinkReference[] {
	return projects.flatMap(project =>
		createIssueAutolinkReferences(project.key, `${organization.url}/browse/${project.key}-<num>`, organization),
	);
}

/** The projects once each, by site and id. */
function uniqueProjects(projects: JiraProjectDescriptor[]): JiraProjectDescriptor[] {
	const projectsByIdentity = new Map<string, JiraProjectDescriptor>();
	for (const project of projects) {
		const identity = `${project.resourceId}:${project.id}`;
		if (!projectsByIdentity.has(identity)) {
			projectsByIdentity.set(identity, project);
		}
	}
	return [...projectsByIdentity.values()];
}
