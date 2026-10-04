import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { JIRA_MAX_PROJECT_KEYS_PER_REQUEST } from '@gitkraken/provider-apis';
import type { Account } from '@gitlens/git/models/author.js';
import type { Issue, IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { IssueResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { toCollectionScopeFailure } from '../collectionMetadata.js';
import { IssuesSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { IntegrationKey } from '../models/integration.js';
import type {
	AccountWideIssuesResult,
	IssuesForProjectOptions,
	ProjectIssuesDrain,
	ProjectIssuesRequest,
	SearchMyIssuesOptions,
} from '../models/issueReads.js';
import { groupProjectIssuesSearches, IssuesIntegration } from '../models/issuesIntegration.js';
import { areDomainsOnSameHost, baseUrlFromDomain } from '../utils/domain.utils.js';
import { providersMetadata, toAccount, toIssueShape, toProviderIssueStates } from './models.js';
import { isJiraMissingProjectError } from './providerErrors.js';
import type { ProvidersApi } from './providersApi.js';
import { DiscoveryCache } from './utils/discoveryCache.js';
import type { JiraDrainOptions, JiraIssuePageFetcher } from './utils/jiraIssueDrains.js';
import {
	drainJiraIssues,
	readUserScopedJiraIssues,
	searchJiraProjectIssues,
	toUniqueJiraIssueShapes,
} from './utils/jiraIssueDrains.js';
import { mergeCollectionMetadata } from './utils/providerPaging.js';

const metadata = providersMetadata[IssuesSelfManagedHostIntegrationId.JiraServer];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const maxPagesPerRequest = 10;

/**
 * Every clause is scoped by the HANDLE, and `options.userId` is deliberately ignored here — the one
 * place this provider diverges from Jira Cloud's, which applies it to `assignee`/`creator` (#5857).
 *
 * The two are not interchangeable because `Account.id` means something different per deployment. On
 * Cloud it is the `accountId`, which JQL resolves, so scoping by it fixes the deactivated-account case
 * where the display name no longer resolves. On Server it is the user KEY (`JIRAUSER10224`), which JQL
 * does not resolve at all: measured against a live Jira Server 8.20.13 site, `assignee in
 * ("JIRAUSER10224")` returns 0 with `"The value 'JIRAUSER10224' does not exist for the field
 * 'assignee'"` — the identical warning a genuinely nonexistent user produces — while the username and
 * the display name both return the real 4.
 *
 * So applying `userId` here would silently empty the read rather than harden it. Do not "fix" this
 * asymmetry to match Cloud without re-measuring against a Server instance.
 *
 * The handle itself is already the right one: `provider-apis` 0.60.0 maps `Account.username` from the
 * Server payload's `name` (falling back to `displayName` when absent), so these clauses are scoped by the
 * real username rather than a display name (GKDEV-3629). That is what makes the `mention` clause work at
 * all — it is a free-text `comment ~ "..."` over comment bodies, and a Jira mention is stored as
 * `[~username]`, which a display name never matches.
 */
function toUserIdentities(user: string): { userField: string; mention: string } {
	return { userField: user, mention: user };
}

/**
 * The single resource a Jira Server connection has: the instance itself.
 *
 * Jira Cloud's account spans many sites, so its resources come from an API call that lists them. A
 * self-hosted instance IS the one site the connection addresses, so there is nothing to enumerate — this
 * descriptor is synthesized from the configured host. Modelling it as a resource anyway keeps the
 * resource → project contract of {@link IssuesIntegration} intact, so every tracker read (`listOrgs`,
 * `listProjects`, `listIssueTrackerIssuesPage`) works unchanged.
 */
export interface JiraServerResourceDescriptor extends IssueResourceDescriptor {
	url: string;
}

export interface JiraServerProjectDescriptor extends IssueResourceDescriptor {
	resourceId: string;
}

export class JiraServerIntegration extends IssuesIntegration<IssuesSelfManagedHostIntegrationId.JiraServer> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = IssuesSelfManagedHostIntegrationId.JiraServer;
	protected readonly key: IntegrationKey<IssuesSelfManagedHostIntegrationId.JiraServer>;
	readonly name: string = 'Jira Data Center';

	constructor(
		ctx: IntegrationServiceContext,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
	) {
		super(ctx, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this._domain}`;
	}

	get domain(): string {
		return this._domain;
	}

	/**
	 * The URL every request for this connection is addressed to, built from the SESSION's domain rather than
	 * the integration's.
	 *
	 * `this.domain` is the host-keyed identity — `IntegrationService.get()` runs it through `hostFromDomain`
	 * so one host can't build two instances — which means it has had any context path stripped, and so has
	 * `session.domain`, which is stored as that same normalized host. Jira Data Center officially supports
	 * being mounted below a context path (`https://jira.example.com/jira`), so the address comes from
	 * {@link ProviderAuthenticationSession.baseUrl}, which carries the configured value verbatim; it falls
	 * back to the host when the backend reported nothing more, which is the common case.
	 *
	 * Takes the session rather than reading `_session` so a per-connection (multi-account) read is addressed
	 * to the host of the connection it resolved, not to whichever one happens to be current.
	 */
	protected apiBaseUrlFor(session: ProviderAuthenticationSession | undefined): string {
		const configured = baseUrlFromDomain(session?.baseUrl, session?.protocol);
		// A `baseUrl` from another host is not this connection's address — refuse it rather than routing this
		// integration's reads somewhere its key never named.
		if (configured != null && areDomainsOnSameHost(session?.baseUrl, this.domain)) return configured;

		return (
			baseUrlFromDomain(session?.domain, session?.protocol) ??
			baseUrlFromDomain(this.domain, session?.protocol) ??
			`${session?.protocol ?? 'https:'}//${this.domain}`
		);
	}

	/** The one resource this connection has — see {@link JiraServerResourceDescriptor}. */
	private resourceFor(session: ProviderAuthenticationSession | undefined): JiraServerResourceDescriptor {
		return { id: this.domain, key: this.domain, name: this.domain, url: this.apiBaseUrlFor(session) };
	}

	// No `autolinks()` override, unlike Jira Cloud: an autolink prefix has to be the Jira project KEY, which
	// is what a commit message or branch name carries (`PROJ-123`). `/rest/api/2/project` reports no key — see
	// `getProviderProjectsForResources`, which falls back to the name because JQL accepts it — so the only
	// prefix this class could build is the display name, which matches nothing and yields a `/browse/` URL that
	// is not an issue. Registering that would be worse than registering none. Restore the override once the SDK
	// surfaces the project key (GKDEV-3629's sibling gap).

	protected override async getProviderAccountForResource(
		session: ProviderAuthenticationSession,
		_resource: JiraServerResourceDescriptor,
	): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const user = await api.getJiraServerCurrentUser(toTokenWithInfo(this.id, session), this.apiBaseUrlFor(session));

		if (user == null) return undefined;
		return toAccount(user, this);
	}

	protected override getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		_force?: boolean,
	): Promise<JiraServerResourceDescriptor[] | undefined> {
		// Synthesized from the configured host rather than fetched, so there is nothing to cache or force.
		return Promise.resolve([this.resourceFor(session)]);
	}

	/** Expires, and is dropped on a re-sync, so a project created or deleted mid-session is picked up (#5907). */
	private readonly _projects = new DiscoveryCache<JiraServerProjectDescriptor[]>();
	protected override async getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: JiraServerResourceDescriptor[],
		force: boolean = false,
	): Promise<JiraServerProjectDescriptor[] | undefined> {
		// Every resource here is this instance (see `getProviderResourcesForUser`), so one read serves them
		// all; a caller that passes none is asking for nothing.
		if (resources.length === 0) return [];

		const cacheKey = this.projectsCacheKey(session);
		const cached = this._projects.get(cacheKey);
		if (cached != null && !force) return cached;

		const generation = this._projects.generation;
		const api = await this.getProvidersApi();
		const projects = await api.getJiraServerProjects(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrlFor(session),
		);
		if (projects == null) return undefined;

		const resourceId = this.resourceFor(session).id;
		const descriptors = projects.map<JiraServerProjectDescriptor>(p => ({
			id: p.id,
			// The display name, NOT what the reads address the project by. `/rest/api/2/project` reports no
			// project key (GKDEV-3629's sibling gap) and the SDK's `JiraServerProject` carries only `id` and
			// `name`, so there is no key to put here; the reads below use `id` instead, because JQL resolves a
			// `project = "<value>"` clause against key before name, and a display name that collides with
			// ANOTHER project's key would silently return that project's issues.
			key: p.name,
			name: p.name,
			resourceId: resourceId,
		}));

		this._projects.set(cacheKey, descriptors, { generation: generation });

		return descriptors;
	}

	protected override async getProviderIssuesForProject(
		session: ProviderAuthenticationSession,
		project: JiraServerProjectDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<IssueShape[] | undefined> {
		return (await this.getProviderIssuesForProjectWithTruncation(session, project, options))?.values;
	}

	protected override async getProviderIssuesForProjectWithTruncation(
		session: ProviderAuthenticationSession,
		project: JiraServerProjectDescriptor,
		options?: IssuesForProjectOptions,
	): Promise<ProjectIssuesDrain | undefined> {
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const api = await this.getProvidersApi();
		const baseUrl = this.apiBaseUrlFor(session);

		// The same drain as Jira Cloud's (`jiraIssueDrains.ts`): page to a defensive backstop, and report `truncated`
		// plus a structured failure rather than discarding an already-fetched prefix.
		const states = toProviderIssueStates(options?.state);
		// The numeric project id, not the name: JQL resolves `project = "<value>"` against key first, so a display
		// name that matches another project's key reads that project's issues instead. A Jira project key must begin
		// with a letter, so a purely numeric value can only be an id.
		const fetchPage: JiraIssuePageFetcher = (scope, cursor) =>
			api.getJiraServerIssuesForProjectPaged(tokenWithInfo, baseUrl, project.id, {
				...scope,
				cursor: cursor,
				states: states,
				sort: options?.sort,
			});
		const drainOptions: JiraDrainOptions = {
			maxPages: maxPagesPerRequest,
			failureScope: { providerId: this.id, resourceId: project.resourceId, projectId: project.id },
			providerName: 'Jira Server',
			// A project this connection can no longer see (deleted, or its browse permission removed) holds
			// no issues for it, and the project list that named it is stale: drop that list so the next read
			// re-reads it, instead of failing the whole provider on every read until a restart (#5907).
			isEmptyFailure: ex => {
				if (!isJiraMissingProjectError(ex)) return false;

				Logger.warn(`Jira Server project '${project.name}' (${project.id}) no longer exists or is not visible`);
				this._projects.delete(this.projectsCacheKey(session));
				return true;
			},
		};

		if (options?.user != null) {
			const read = await readUserScopedJiraIssues(
				fetchPage,
				options.filters,
				toUserIdentities(options.user),
				drainOptions,
			);
			const values = toUniqueJiraIssueShapes(read.issues, this);
			// `recovery: 'none'` for the whole set: the filter branches merge here, so even a pure backstop in one
			// branch is not fixable by narrowing this read's scope.
			return read.truncated
				? { values: values, truncated: true, recovery: 'none', metadata: read.metadata }
				: { values: values, truncated: false, metadata: read.metadata };
		}

		const unscoped = await drainJiraIssues(fetchPage, {}, drainOptions);
		const values = unscoped.issues
			.map(issue => toIssueShape(issue, this, { projection: 'project' }))
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
	 * Searches the instance's projects together for a user-scoped read, as Jira Cloud does per site: one JQL names
	 * up to {@link JIRA_MAX_PROJECT_KEYS_PER_REQUEST} projects of one user scope. An unscoped read stays per project,
	 * since its backstop is reported as `narrow-scope` per project.
	 */
	protected override getProjectIssuesSearches(
		requests: readonly ProjectIssuesRequest<JiraServerProjectDescriptor>[],
	): number[][] | undefined {
		return groupProjectIssuesSearches(
			requests,
			({ options }) =>
				options.user != null
					? [options.user, options.sort ?? '', options.state ?? '', options.filters?.join(',') ?? ''].join(
							'\0',
						)
					: undefined,
			JIRA_MAX_PROJECT_KEYS_PER_REQUEST,
		);
	}

	protected override async searchProviderProjectIssues(
		session: ProviderAuthenticationSession,
		requests: readonly ProjectIssuesRequest<JiraServerProjectDescriptor>[],
	): Promise<IssueShape[][] | undefined> {
		// Every request of a search shares its user scope (see `getProjectIssuesSearches`).
		const { options } = requests[0];
		if (options.user == null) return undefined;

		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const api = await this.getProvidersApi();
		const baseUrl = this.apiBaseUrlFor(session);
		// By numeric id, as the per-project read names them (see there).
		const projectIds = requests.map(request => request.project.id);
		const states = toProviderIssueStates(options.state);

		return searchJiraProjectIssues(
			(userScope, cursor) =>
				api.getJiraServerIssuesForProjectsPaged(tokenWithInfo, baseUrl, projectIds, {
					...userScope,
					cursor: cursor,
					states: states,
					sort: options.sort,
				}),
			projectIds,
			options.filters,
			toUserIdentities(options.user),
			{ maxPages: maxPagesPerRequest, failureScope: { providerId: this.id }, providerName: 'Jira Server' },
			this,
		);
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		resources?: JiraServerResourceDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		return (await this.searchProviderMyIssuesWithTruncation(session, resources, cancellation))?.values;
	}

	/**
	 * Account-wide "my issues" for this instance, drained to the backstop and reporting whether it got there.
	 *
	 * The override exists for the same reason the project drain reports `status`: the default
	 * implementation wraps whatever the normalized read returned as `truncated: false`, so a run that stopped
	 * at `maxPagesPerRequest` with pages left, or on a continuation the server never advanced, would be
	 * published as a complete account. Cancellation is NOT truncation — the caller asked for the stop and
	 * already knows the prefix is partial — so it breaks without setting the flag.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		_resources?: JiraServerResourceDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		const api = await this.getProvidersApi();
		const states = toProviderIssueStates(options?.state);
		const tokenWithInfo = toTokenWithInfo(this.id, session);
		const baseUrl = this.apiBaseUrlFor(session);

		// Errors propagate, unlike Jira Cloud's sibling. Cloud swallows per resource because it loops over the
		// account's many sites and one bad site must not discard the others; this connection addresses exactly
		// one instance, so there is no sibling to protect and swallowing would turn every failure — an expired
		// token, an unreachable host — into an empty success. `searchMyIssuesWithTruncationResult` recovers the
		// throw into `{ error }`, which is what lets the caller warn instead of reporting "no issues".
		// Only the provider: the instance is this connection's single resource, so naming it would publish a
		// failure of the whole connection as one confined to a sub-scope (see `ProviderWarning.scope`).
		const accountScope = { providerId: this.id };
		const results: IssueShape[] = [];
		let cursor: string | undefined;
		let truncated = false;
		let metadata: CollectionMetadata | undefined;

		const stopIncomplete = (reason: string) => {
			truncated = true;
			metadata = mergeCollectionMetadata(metadata, {
				completeness: 'partial',
				failures: [toCollectionScopeFailure(accountScope, new Error(reason))],
			});
		};

		for (let i = 0; i < maxPagesPerRequest; i++) {
			if (cancellation?.aborted) break;

			const page = await api.getJiraServerIssuesForCurrentUser(tokenWithInfo, baseUrl, {
				cursor: cursor,
				states: states,
			});
			if (page == null) {
				// Nothing fetched yet and no page is an empty account, not a failure; after a continuation it
				// means the server dropped the drain mid-way.
				if (cursor != null) {
					stopIncomplete('Jira Server returned no page after advertising a continuation');
				}
				break;
			}

			results.push(
				...page.data
					.map(issue => toIssueShape(issue, this, { projection: 'account' }))
					.filter((r): r is IssueShape => r != null),
			);

			if (!page.hasMore) break;

			// More pages are claimed but no advancing cursor came back: the drain can't continue, so flag it
			// rather than stopping silently.
			if (page.nextCursor == null || page.nextCursor === cursor) {
				stopIncomplete('Jira Server returned no advancing issue continuation');
				break;
			}

			cursor = page.nextCursor;
			// Pages remain but this was the last allowed iteration: the backstop stopped the drain.
			if (i === maxPagesPerRequest - 1) {
				stopIncomplete(
					`Jira Server account-wide issue drain stopped at the ${maxPagesPerRequest}-page backstop`,
				);
			}
		}

		return { values: results, truncated: truncated, metadata: metadata };
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		_resource: JiraServerResourceDescriptor,
		{ key }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		const api = await this.getProvidersApi();
		const issue = await api.getJiraServerIssue(toTokenWithInfo(this.id, session), this.apiBaseUrlFor(session), key);
		return issue != null ? toIssueShape(issue, this, { projection: 'point' }) : undefined;
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		_resource: JiraServerResourceDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		return this.readIssue(session, id, 'point');
	}

	private async readIssue(
		session: ProviderAuthenticationSession,
		id: string,
		projection: IssueProjection,
	): Promise<Issue | undefined> {
		const api = await this.getProvidersApi();
		const apiResult = await api.getJiraServerIssue(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrlFor(session),
			id,
		);
		const issue = apiResult != null ? toIssueShape(apiResult, this, { projection: projection }) : undefined;
		return issue != null ? { ...issue, type: 'issue' } : undefined;
	}

	/**
	 * The point read behind `getIssuesBatch`'s tracker targets (#5872). `resourceId` is this connection's single
	 * synthetic resource — the host itself, see {@link JiraServerResourceDescriptor} — so it selects nothing further
	 * here: the host was chosen upstream by `domain` (or the connection's configured domain) and the request is
	 * addressed to the SESSION's base URL like every other read. No `resourceUrl` is needed either, unlike Jira
	 * Cloud: its REST `self` link is an API endpoint, whereas `getJiraServerIssue` builds the browser link from
	 * the base URL it was addressed to. A key that names no issue resolves to `undefined`, a proven absence.
	 */
	protected override getProviderIssueByResourceId(
		session: ProviderAuthenticationSession,
		_resourceId: string,
		id: string,
		_resourceUrl: string | undefined,
	): Promise<Issue | undefined> {
		return this.readIssue(session, id, 'batch');
	}

	/**
	 * Caches are keyed by the ADDRESS the read was made against as well as the token: one integration instance
	 * exists per configured host and two hosts can hold the same token, so a token-only key would serve one
	 * host's projects for the other — and the host alone is not enough either, because a connection re-pointed
	 * to another context path on the same host keeps its token and would otherwise be served the old path's
	 * projects.
	 */
	private projectsCacheKey(session: ProviderAuthenticationSession): string {
		return `${this.apiBaseUrlFor(session)}:${session.accessToken}`;
	}

	override invalidateDiscoveryCaches(): void {
		this._projects.clear();
	}

	protected override providerOnDisconnect(): void {
		this._projects.clear();
	}
}
