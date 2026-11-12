import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { JIRA_MAX_PROJECT_KEYS_PER_REQUEST } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { AutolinkReference, DynamicAutolinkReference } from '@gitlens/git/models/autolink.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { chunk } from '@gitlens/utils/array.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areEqual } from '@gitlens/utils/object.js';
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
import { DiscoveryCache, isAutolinkSetExpired, isEmptyAutolinkFallback } from './utils/discoveryCache.js';
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
	/**
	 * Moves whenever `_autolinks` is dropped for a list a build reads, so a build that then fails keeps no fallback
	 * over lists it didn't read; the next render builds from them instead (#6183). Rule: every writer that stores a
	 * different project list for a site must bump it and retire the token's build, through {@link onProjectListStored};
	 * the same list stored again does neither while a complete set is kept (#6184). The connect's clear bumps it too.
	 * Site-list stores deliberately don't: a build's own site store would then refuse its own fallback. Drops and
	 * evictions need no bump: they fail a build's `isCurrent`.
	 */
	private _autolinksResets = 0;

	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null) return [];

		const session = this._session;
		const cached = this._autolinks.get(session.accessToken);
		// A session kept through a failed refresh is expired: building with it would send that token to the provider
		// on every render, so serve whatever was built before (none after a forced re-sync) until a read refreshes it.
		if (this.connectionExpired === true) return cached?.autolinks ?? [];
		if (cached == null) return this.buildAutolinks(session);

		if (isAutolinkSetExpired(cached)) {
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
			build = this.buildAutolinksCore(session).finally(() => {
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
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const { accessToken } = session;
		const generation = this._projects.generation;
		const evictions = this._projectEvictions.get(accessToken);
		const resets = this._autolinksResets;
		// What this build falls back on, and carries over for the sites it couldn't read
		const held = this._autolinks.get(accessToken);
		// False once the caches were dropped, or a site's list evicted, since this build started: what it read then is
		// only an answer for the render that waited on it.
		const isCurrent = (): boolean =>
			this._projects.generation === generation && this._projectEvictions.get(accessToken) === evictions;
		// Kept even when incomplete, to be retried sooner rather than by every render (#6183). Complete only when built
		// wholly from the lists as stored now, the site list and every site's projects. Once a list change retired this
		// build, another may have kept a set meanwhile: a complete set still replaces it, and any replaces an empty
		// incomplete one, the fallback of a build that read none; otherwise, as it also rests on what only this build
		// read (its site list, a site cut short) or held, it only replaces the set it held, or none (#6184). Refused, it
		// still answers the renders waiting on it with its own result, a known limit.
		const keep = (
			autolinks: (AutolinkReference | DynamicAutolinkReference)[],
			complete: boolean,
		): (AutolinkReference | DynamicAutolinkReference)[] => {
			const kept = this._autolinks.get(accessToken);
			if (isCurrent() && (complete || kept == null || kept === held || isEmptyAutolinkFallback(kept))) {
				this._autolinks.set(accessToken, {
					autolinks: autolinks,
					builtAt: Date.now(),
					complete: complete,
				});
			}
			return autolinks;
		};
		// Serves the held set until the retry, unless a list was stored meanwhile
		const keepHeld = (): (AutolinkReference | DynamicAutolinkReference)[] =>
			this._autolinksResets === resets ? keep(held?.autolinks ?? [], false) : (held?.autolinks ?? []);
		try {
			const organizations = await this.getProviderResourcesForUser(session);
			if (organizations == null) return keepHeld();

			// Whether the site list is still the one stored, expired or not: a read storing a different one since
			// replaced it
			const sitesCached = (): boolean => areEqual(this._organizations.peek(accessToken), organizations);
			if (!organizations.length) return keep([], sitesCached());

			// Served from the cache for every site whose projects are still fresh; only the rest are read.
			const { values: projects, metadata } = await this.getProviderProjectsForResourcesWithMetadata(
				session,
				organizations,
			);

			// Each site's projects as cached now, which any read during this build may have refreshed. A site with none
			// cached fresh serves what the read answered for it, its newest list stored when read whole, and, where that
			// read failed or got nothing, the prefixes it had, rather than losing its links until the retry.
			const current = isCurrent();
			// No set held, as once a list change dropped it, or only the empty fallback a build that read none kept
			const heldNone = held == null || isEmptyAutolinkFallback(held);
			const failedSites = new Set(metadata?.failures?.map(f => f.scope?.resourceId));
			const refsOf = (
				organization: JiraOrganizationDescriptor,
				siteProjects: JiraProjectDescriptor[],
			): AutolinkReference[] =>
				siteProjects.flatMap(project =>
					createIssueAutolinkReferences(
						project.key,
						`${organization.url}/browse/${project.key}-<num>`,
						organization,
					),
				);
			const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];
			let complete = true;
			for (const organization of organizations) {
				const key = `${accessToken}:${organization.id}`;
				const cachedProjects = current ? this._projects.get(key) : undefined;
				const siteProjects = cachedProjects ?? projects.filter(p => p.resourceId === organization.id);
				const refs = refsOf(organization, siteProjects);
				autolinks.push(...refs);
				if (cachedProjects != null) continue;

				complete = false;
				// A site whose read failed, or got nothing, keeps the prefixes it had; one only cut short has none missing
				const failed = failedSites.has(organization.id) || !siteProjects.length;
				if (!failed) continue;

				// Those of the set held, keyed by the site's id (#6183); with none, those of the site's last list stored,
				// expired or not, which a list change dropping the set leaves in place (#6184). Known limits, until the
				// carry moves into the cache: that list is the last one read whole, so a site read cut short since can
				// carry prefixes that read no longer lists; and a site never read whole carries none once the set it was
				// carried in is dropped.
				const stored = heldNone && current ? this._projects.peek(key) : undefined;
				const had =
					stored != null
						? refsOf(organization, stored)
						: (held?.autolinks.filter(
								(ref): ref is AutolinkReference =>
									'prefix' in ref && ref.descriptor?.key === organization.id,
							) ?? []);
				const prefixes = new Set(refs.map(r => r.prefix));
				for (const ref of had) {
					if (!prefixes.has(ref.prefix)) {
						autolinks.push(ref);
					}
				}
			}
			return keep(autolinks, complete && sitesCached());
		} catch (ex) {
			// Autolinks are decoration: don't fail the render that asked
			Logger.error(ex, 'JiraIntegration.autolinks');
			return keepHeld();
		}
	}

	/**
	 * A site's project list was stored. A different one drops the autolinks built from the lists, so a build that then
	 * fails keeps no fallback, and retires the build in flight, which may hold the list as it was. The same one again
	 * keeps a complete set and the build in flight; otherwise it drops the incomplete set kept, if any, so the next
	 * render builds from the lists again, and still fences a failing build's fallback (#6183, #6184). Other tokens' sets
	 * and builds stay; only `_autolinksResets`, shared by all tokens, also stops their failing builds' fallback.
	 *
	 * A known limit: a build whose own read stores a different list, or a site's first one (with nothing seeded since a
	 * start, a clear or an eviction, every first store reads as different), retires itself too. A render in the
	 * microtasks before that build resumes then starts a second one rather than joining it; that one builds from the
	 * cache, reading again only the sites the first couldn't read whole. A loss of the sharing core had, with no effect
	 * on what is kept, and none on an identical list, which retires nothing.
	 */
	private onProjectListStored(accessToken: string, stored: 'changed' | 'unchanged'): void {
		if (stored === 'changed') {
			this._autolinksBuilds.delete(accessToken);
		} else if (this._autolinks.get(accessToken)?.complete === true) {
			return;
		}

		this._autolinks.delete(accessToken);
		this._autolinksResets++;
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
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		const { accessToken } = session;

		const cachedResources = this._organizations.get(accessToken);
		if (cachedResources != null && !force) return cachedResources;

		const generation = this._organizations.generation;
		const organizations = await this.readOrganizations(session);
		if (organizations == null) {
			this._organizations.delete(accessToken);
			return undefined;
		}

		this._organizations.set(accessToken, organizations, { generation: generation });
		return organizations;
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
		const values = [...read.partial];
		for (const [resourceId, projects] of read.complete) {
			// Not stored when the cache was dropped, a list evicted, or a read started after this one stored it, while
			// this read was in flight: what it found is then no longer trusted for the next read.
			if (this._projectEvictions.get(accessToken) !== evictions) continue;

			const stored = projectsCache.set(`${accessToken}:${resourceId}`, projects, {
				generation: generation,
				read: started,
			});
			if (stored !== false) {
				this.onProjectListStored(accessToken, stored);
			}
		}
		// A site read whole, or served from the cache, answers with its newest list stored: this read's own, or the one
		// a read started after it stored, which this older read must not stand in for, not even once expired (#6184).
		// Once the cache was dropped or a list evicted meanwhile, only what it found itself.
		const current =
			projectsCache.generation === generation && this._projectEvictions.get(accessToken) === evictions;
		for (const resource of resources) {
			const resourceProjects = read.complete.get(resource.id) ?? cachedProjects.get(resource.id);
			if (resourceProjects == null) continue;

			const stored = current ? projectsCache.peek(`${accessToken}:${resource.id}`) : undefined;
			values.push(...(stored ?? resourceProjects));
		}
		return { values: uniqueProjects(values), metadata: read.metadata };
	}

	protected override async getProviderUncachedProjectsForResourcesWithMetadata(
		session: ProviderAuthenticationSession,
		resources: JiraOrganizationDescriptor[],
	): Promise<ProviderApiCollectionResult<JiraProjectDescriptor>> {
		const read = await this.readProjects(session, resources);
		return {
			values: uniqueProjects([...read.partial, ...[...read.complete.values()].flat()]),
			metadata: read.metadata,
		};
	}

	/**
	 * Reads the projects of each resource from the provider, apart by whether a resource's list came back complete:
	 * only a complete one may be cached as the resource's project set.
	 */
	private async readProjects(
		session: ProviderAuthenticationSession,
		resources: JiraOrganizationDescriptor[],
	): Promise<{
		complete: Map<string, JiraProjectDescriptor[]>;
		partial: JiraProjectDescriptor[];
		metadata: CollectionMetadata | undefined;
	}> {
		const complete = new Map<string, JiraProjectDescriptor[]>();
		const partial: JiraProjectDescriptor[] = [];
		let metadata: CollectionMetadata | undefined;
		if (resources.length === 0) return { complete: complete, partial: partial, metadata: metadata };

		const api = await this.getProvidersApi();
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const drains = await Promise.allSettled(
			resources.map(async resource => ({
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

			const { resource, result } = drain.value;
			metadata = mergeCollectionMetadata(metadata, result.metadata);
			const projects = result.values
				.filter(project => project.resourceId === resource.id)
				.map(project => ({ ...project }));
			const incomplete =
				result.truncated === true || (result.metadata != null && result.metadata.completeness !== 'complete');
			if (incomplete) {
				partial.push(...projects);
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
		return { complete: complete, partial: partial, metadata: metadata };
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
		this._autolinksResets++;
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
