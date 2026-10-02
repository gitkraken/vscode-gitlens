import type { CollectionMetadata } from '@gitkraken/provider-apis';
import * as l10n from '@vscode/l10n';
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
import { throwIfCallerContractError, toCollectionScopeFailure } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import type { IssueEtagFields } from '../models/integration.js';
import type {
	AccountWideIssuesResult,
	IssuesForProjectOptions,
	ProjectIssuesDrain,
	SearchMyIssuesOptions,
} from '../models/issueReads.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';
import type { JiraIssueEtagResponse } from './jiraIssueByKey.js';
import { jiraBulkFetchMaxKeys, toJiraIssueEtagFields } from './jiraIssueByKey.js';
import type { ProviderApiCollectionResult, ProviderIssue } from './models.js';
import { IssueFilter, providersMetadata, toAccount, toIssueShape, toProviderIssueStates } from './models.js';
import { isJiraMissingProjectError } from './providerErrors.js';
import { DiscoveryCache, discoveryCacheTtl } from './utils/discoveryCache.js';
import { collectProviderPagedResult, mergeCollectionMetadata } from './utils/providerPaging.js';

const metadata = providersMetadata[IssuesCloudHostIntegrationId.Jira];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;
/** A numeric issue id, which Jira's issue reads accept in place of a key. */
const numericIssueId = /^\d+$/;

type JiraProjectIssuesDrain<T> = {
	issues: T[];
	status: 'complete' | 'backstop' | 'incomplete';
	metadata?: CollectionMetadata;
};

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
	 * caches are dropped, and once older than {@link discoveryCacheTtl}. An expired set is still served while it is
	 * rebuilt in the background, because autolinks are read on every render of a commit message and must not wait
	 * on the network, nor go empty just because nothing read the projects for a while (#5907).
	 */
	private readonly _autolinks = new Map<
		string,
		{ autolinks: (AutolinkReference | DynamicAutolinkReference)[]; builtAt: number }
	>();
	private readonly _autolinksBuilds = new Map<string, Promise<(AutolinkReference | DynamicAutolinkReference)[]>>();

	override async autolinks(): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected || this._session == null) return [];

		const session = this._session;
		const cached = this._autolinks.get(session.accessToken);
		if (cached == null) return this.buildAutolinks(session);

		if (Date.now() - cached.builtAt >= discoveryCacheTtl) {
			void this.buildAutolinks(session);
		}
		return cached.autolinks;
	}

	/** One build per token at a time: concurrent renders share it rather than each re-reading sites and projects. */
	private buildAutolinks(
		session: ProviderAuthenticationSession,
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const { accessToken } = session;
		let build = this._autolinksBuilds.get(accessToken);
		if (build == null) {
			build = this.buildAutolinksCore(session).finally(() => this._autolinksBuilds.delete(accessToken));
			this._autolinksBuilds.set(accessToken, build);
		}
		return build;
	}

	private async buildAutolinksCore(
		session: ProviderAuthenticationSession,
	): Promise<(AutolinkReference | DynamicAutolinkReference)[]> {
		const { accessToken } = session;
		const generation = this._projects.generation;
		try {
			const organizations = await this.getProviderResourcesForUser(session);
			if (!organizations?.length) return [];

			// Served from the cache for every site whose projects are still fresh; only the rest are read.
			const { values: projects, metadata } = await this.getProviderProjectsForResourcesWithMetadata(
				session,
				organizations,
			);

			const autolinks: (AutolinkReference | DynamicAutolinkReference)[] = [];
			for (const project of projects) {
				const organization = organizations.find(o => o.id === project.resourceId);
				if (organization == null) continue;

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

			// A set missing a site's projects is served but not kept, so the next call tries that site again; one
			// built from projects read before the caches were dropped is not kept either.
			const complete = metadata == null || metadata.completeness === 'complete';
			if (complete && this._projects.generation === generation) {
				this._autolinks.set(accessToken, { autolinks: autolinks, builtAt: Date.now() });
			}
			return autolinks;
		} catch (ex) {
			// Autolinks are decoration: keep serving the last set rather than failing the render that asked.
			Logger.error(ex, 'JiraIntegration.autolinks');
			return this._autolinks.get(accessToken)?.autolinks ?? [];
		}
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
	/** When the caches were last dropped; a persisted discovery read before then is as stale as they were. */
	private _discoveryInvalidatedAt = 0;

	protected override async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<JiraOrganizationDescriptor[] | undefined> {
		const { accessToken } = session;

		const cachedResources = this._organizations.get(accessToken);
		if (cachedResources != null && !force) return cachedResources;

		const generation = this._organizations.generation;
		const api = await this.getProvidersApi();
		const resources = await api.getJiraResourcesForCurrentUser(toTokenWithInfo(this.id, session));
		const organizations = resources?.map(r => ({ ...r, key: r.id }));
		if (organizations == null) {
			this._organizations.delete(accessToken);
			return undefined;
		}

		this._organizations.set(accessToken, organizations, { generation: generation });
		return organizations;
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

				// Not stored when the cache was dropped while this read was in flight, but still returned below: it
				// is what this read found, only no longer trusted for the next one.
				if (!projectsCache.set(`${accessToken}:${resource.id}`, projects, { generation: generation })) {
					partialProjects.push(...projects);
					return;
				}

				this._autolinks.delete(accessToken);
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
		const states = toProviderIssueStates(options?.state);
		const drainIssues = async (scope: {
			authorLogin?: string;
			assigneeLogins?: string[];
			mentionLogin?: string;
		}): Promise<JiraProjectIssuesDrain<ProviderIssue>> => {
			const collected: ProviderIssue[] = [];
			let cursor: string | undefined;
			let status: JiraProjectIssuesDrain<ProviderIssue>['status'] = 'complete';
			let metadata: CollectionMetadata | undefined;
			for (let i = 0; i < maxPagesPerRequest; i++) {
				let result: Awaited<ReturnType<typeof api.getIssuesForProjectPaged>> | undefined;
				try {
					result = await api.getIssuesForProjectPaged(tokenWithInfo, project.name, project.resourceId, {
						...scope,
						cursor: cursor,
						states: states,
						sort: options?.sort,
					});
				} catch (ex) {
					// A project this token can no longer see (deleted, or its browse permission removed) holds no issues
					// for it, and the site's project list that named it is stale: drop that list so the next read
					// re-reads it, instead of failing the whole provider on every read until a restart (#5907).
					if (collected.length === 0 && isJiraMissingProjectError(ex)) {
						Logger.warn(`Jira project '${project.key}' no longer exists or is not visible`);
						this._projects.delete(`${session.accessToken}:${project.resourceId}`);
						this._autolinks.delete(session.accessToken);
						return { issues: [], status: 'complete' };
					}

					// A page failure after the first page leaves the already-drained prefix intact; record the
					// failure at the project scope instead of re-throwing and discarding the prefix. If nothing was
					// fetched yet, the original throw behavior is preserved so the caller sees a hard error rather
					// than an empty partial success.
					if (collected.length === 0) throw ex;

					status = 'incomplete';
					metadata = mergeCollectionMetadata(metadata, {
						completeness: 'partial',
						failures: [toCollectionScopeFailure(projectScope, ex)],
					});
					break;
				}
				if (result == null) {
					if (cursor == null) break;

					status = 'incomplete';
					metadata = mergeCollectionMetadata(metadata, {
						completeness: 'partial',
						failures: [
							toCollectionScopeFailure(
								projectScope,
								new Error('Jira returned no page after advertising a continuation'),
							),
						],
					});
					break;
				}

				collected.push(...result.data);
				if (!result.hasMore) break;

				// The provider claims more pages but gave no advancing cursor: we can't continue, so the drain
				// is incomplete — flag it rather than silently stopping (matches drainPullRequests/Repositories).
				if (result.nextCursor == null || result.nextCursor === cursor) {
					status = 'incomplete';
					metadata = mergeCollectionMetadata(metadata, {
						completeness: 'partial',
						failures: [
							toCollectionScopeFailure(
								projectScope,
								new Error('Jira returned no advancing issue continuation'),
							),
						],
					});
					break;
				}

				cursor = result.nextCursor;
				if (i === maxPagesPerRequest - 1) {
					status = 'backstop';
				}
			}
			return {
				issues: collected,
				status: status,
				metadata: metadata,
			};
		};

		const getSearchedUserIssuesForFilter = async (
			user: string,
			filter: IssueFilter,
		): Promise<JiraProjectIssuesDrain<IssueShape>> => {
			// `assignee` and `creator` are user FIELDS: Jira resolves an accountId against the directory, which is
			// the identity that keeps matching once a display name cannot be looked up — a deactivated account, or
			// a profile whose visibility hides the name. Measured against a live site: a deactivated assignee
			// returns its issues by accountId and an empty page by display name, and Jira reports that miss as a
			// successful empty search rather than an error, so the list simply appears empty.
			//
			// `mention` is NOT a user field. It is `comment ~ "..."`, a free-text search over comment bodies, so an
			// accountId matches nothing there and the display name is the only value that can. Hence the id is
			// applied to the first two and the handle is kept for the third, rather than swapping `user` wholesale.
			const userField = options?.userId ?? user;
			const result = await drainIssues({
				authorLogin: filter === IssueFilter.Author ? userField : undefined,
				assigneeLogins: filter === IssueFilter.Assignee ? [userField] : undefined,
				mentionLogin: filter === IssueFilter.Mention ? user : undefined,
			});

			return {
				issues: result.issues
					.map(issue => toIssueShape(issue, this))
					.filter((r): r is IssueShape => r !== undefined),
				status: result.status,
				metadata: result.metadata,
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
			// otherwise surface as a successful "no issues" rather than a warning + fetchFailed. The first
			// reason is re-thrown as-is (not wrapped in an AggregateError) so the facade can still classify it
			// by type (auth/rate-limit) — wrapping would collapse every failure to a generic 'other'. The
			// remaining reasons would otherwise be discarded, so log them here to keep them diagnosable.
			if (settled.every(r => r.status === 'rejected')) {
				for (let i = 1; i < settled.length; i++) {
					const outcome = settled[i];
					if (outcome.status === 'rejected') {
						Logger.error(
							outcome.reason,
							`getProviderIssuesForProjectWithTruncation: filter '${filters[i]}' failed`,
						);
					}
				}
				throw settled[0].status === 'rejected' ? settled[0].reason : new Error('Jira issue read failed');
			}

			let truncated = false;
			let metadata: CollectionMetadata | undefined;
			const resultsById = new Map<string, IssueShape>();
			for (let i = 0; i < settled.length; i++) {
				const outcome = settled[i];
				const filter = filters[i];
				// A rejected filter branch (with at least one sibling succeeding) means this project's issues are
				// incomplete: keep the sibling results but record a structured failure so the facade can warn on
				// the specific filter (auth/rate-limit) instead of just a generic truncation flag.
				if (outcome.status !== 'fulfilled') {
					// Identical for every filter branch, so degrading it would report one failure per branch for a
					// single invalid call — see `throwIfCallerContractError`.
					throwIfCallerContractError(outcome.reason);

					truncated = true;
					const failure = toCollectionScopeFailure(
						{ providerId: this.id, resourceId: project.resourceId, projectId: project.name },
						outcome.reason,
					);
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
				for (const resultIssue of outcome.value.issues) {
					if (!resultsById.has(resultIssue.id)) {
						resultsById.set(resultIssue.id, resultIssue);
					}
				}
			}

			return truncated
				? { values: [...resultsById.values()], truncated: true, recovery: 'none', metadata: metadata }
				: { values: [...resultsById.values()], truncated: false, metadata: metadata };
		}

		const unscoped = await drainIssues({});
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

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: JiraOrganizationDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		return (await this.searchProviderMyIssuesWithTruncation(session, resources, cancellation))?.values;
	}

	/**
	 * Overridden so `state` reaches the per-site read, which the default drops. Still reports `truncated: false`,
	 * as the default did: the per-site loop has no way to say it stopped early.
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
							states: states,
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

		return { values: results, truncated: false };
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
	 * slot is rejected, so the full read, whose 404 does prove an absence, decides. When no target was answered and
	 * nothing failed, the check declines instead, so a batch of only such keys costs a full read, not a failure.
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
		const { accessToken } = session;
		const organizationsGeneration = this._organizations.generation;
		const projectsGeneration = this._projects.generation;

		// Persisted discovery seeds the caches only while it would still be fresh in them: read within the TTL, and
		// after the caches were last dropped. Otherwise a re-sync, which runs this again, would put back the very
		// project list it just dropped, and a restart would trust one read any time before (#5907).
		const isFresh = (timestamp: unknown): timestamp is number =>
			typeof timestamp === 'number' &&
			timestamp > this._discoveryInvalidatedAt &&
			Date.now() - timestamp < discoveryCacheTtl;

		const storedOrganizations = this.ctx.storage.get(`jira:${accessToken}:organizations`);
		// Projects persisted without their sites belong to a session whose sites were cleared below; ignore them.
		const storedProjects =
			storedOrganizations != null ? this.ctx.storage.get(`jira:${accessToken}:projects`) : undefined;

		let organizations: JiraOrganizationDescriptor[] | undefined;
		if (storedOrganizations?.data != null && isFresh(storedOrganizations.timestamp)) {
			const seeded = storedOrganizations.data.map((o: JiraOrganizationDescriptor) => ({ ...o }));
			organizations = seeded;
			this._organizations.set(accessToken, seeded, {
				generation: organizationsGeneration,
				storedAt: storedOrganizations.timestamp,
			});
		} else {
			// Stamped with when the read started, so the TTL counts from what it actually saw.
			const readAt = Date.now();
			organizations = await this.getProviderResourcesForUser(session, true);
			if (storedOrganizations == null) {
				// Clear all other stored organizations and projects when our session changes
				await this.ctx.storage.deleteWithPrefix('jira');
			}
			// Not persisted when the caches were dropped while it was in flight: it is then a read from before the
			// refresh, and the next start, which knows nothing of that refresh, would take it for fresh.
			if (this._organizations.generation === organizationsGeneration) {
				await this.ctx.storage.store(`jira:${accessToken}:organizations`, {
					v: 1,
					timestamp: readAt,
					data: organizations,
				});
			}
		}

		if (storedProjects?.data != null && isFresh(storedProjects.timestamp)) {
			const projectsByResource = new Map<string, JiraProjectDescriptor[]>();
			for (const project of storedProjects.data as JiraProjectDescriptor[]) {
				const projects = projectsByResource.get(project.resourceId);
				if (projects == null) {
					projectsByResource.set(project.resourceId, [{ ...project }]);
				} else if (!projects.some(p => p.id === project.id)) {
					projects.push({ ...project });
				}
			}
			for (const [resourceId, projects] of projectsByResource) {
				this._projects.set(`${accessToken}:${resourceId}`, projects, {
					generation: projectsGeneration,
					storedAt: storedProjects.timestamp,
				});
			}
		} else if (organizations?.length) {
			const readAt = Date.now();
			const projects = await this.getProviderProjectsForResources(session, organizations, true);
			// See the organizations above.
			if (this._projects.generation === projectsGeneration) {
				await this.ctx.storage.store(`jira:${accessToken}:projects`, {
					v: 1,
					timestamp: readAt,
					data: projects,
				});
			}
		}
	}

	override invalidateDiscoveryCaches(): void {
		this._discoveryInvalidatedAt = Date.now();
		this._organizations.clear();
		this._projects.clear();
		this._autolinks.clear();
	}

	protected override providerOnDisconnect(): void {
		this._organizations.clear();
		this._projects.clear();
		this._autolinks.clear();
	}
}
