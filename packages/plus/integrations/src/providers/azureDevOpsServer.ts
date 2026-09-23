import type { Account } from '@gitlens/git/models/author.js';
import type { IssueSearchCriteria } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestSearchCriteria, PullRequestSorting } from '@gitlens/git/models/pullRequest.js';
import { defaultPullRequestSort } from '@gitlens/git/models/pullRequest.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { uuid } from '@gitlens/utils/crypto.js';
import type { Emitter } from '@gitlens/utils/event.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { IntegrationReadUnavailableError, RequestNotFoundError } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type {
	IntegrationKey,
	ProviderIssueSearchPage,
	ProviderPullRequestCount,
	ProviderPullRequestSearchPage,
	ProviderSearchCount,
} from '../models/integration.js';
import type { AzureOrganizationDescriptor, AzureProjectDescriptor } from './azure/models.js';
import type { AzurePullRequestSearchPosition } from './azure/search.js';
import {
	compareAzurePullRequestSearchPositions,
	getInvalidAzureSearchDate,
	isAzureWorkItemSearchFirstPage,
	parseAzurePullRequestSearchCursor,
	toAzurePullRequestSearchCursorKey,
	toAzurePullRequestSearchFilter,
	toAzurePullRequestSearchPosition,
	toAzureSearchPageSize,
} from './azure/search.js';
import {
	AzureDevOpsIntegrationBase,
	getAzureRepositoryApiBaseUrl,
	getAzureRepositoryIdentity,
	sameAzureName,
	uniqueAzureNames,
} from './azureDevOps.js';
import type {
	ProviderApiCollectionResult,
	ProviderAzureResource,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
} from './models.js';
import {
	fromProviderPullRequest,
	getProviderPullRequestIdentity,
	providersMetadata,
	PullRequestFilter,
	toProviderPullRequestStates,
} from './models.js';
import type { ProvidersApi } from './providersApi.js';

/**
 * Whether `value` can stand as one route segment. Encoding keeps `.` and `..` as they are, and a URL resolves them
 * as directory steps, so a name of either would address a different route than the one named.
 */
function isAzureRouteSegment(value: string): boolean {
	return value.length > 0 && value !== '.' && value !== '..';
}

/**
 * Runs one scope of a count probe, answering a refusal of THAT scope (see `searchUnavailable`) as the error itself,
 * which the facade reports and drops without failing the scopes around it. Anything else — a rejected credential,
 * a failed request — still rejects, so the batch reports it.
 */
async function refusalAsCount<T>(count: () => Promise<T>): Promise<T | IntegrationReadUnavailableError> {
	try {
		return await count();
	} catch (ex) {
		if (ex instanceof IntegrationReadUnavailableError) return ex;

		throw ex;
	}
}

function findAzureCollection(
	collections: readonly AzureOrganizationDescriptor[],
	name: string,
): AzureOrganizationDescriptor | undefined {
	return collections.find(c => sameAzureName(c.name, name) || c.id === name);
}

/**
 * The most pull requests one facet of a filtered pull-request search drains. Azure has no server-side text, date or
 * draft filter and no ordering, so a facet is read in full before any of them apply; past this bound the facet's
 * unread rows could sort anywhere, and the search reports itself truncated instead of guessing.
 */
const azurePullRequestSearchFacetLimit = 1000;

/**
 * The page size a facet drain reads. The SDK's own default for both pull request reads, and the size it sizes
 * `$skip` by, so the budget above counts what was actually read.
 */
const azurePullRequestSearchPageSize = 100;

/**
 * How many scopes of one work-item count batch query at once. The facade already runs several batches concurrently,
 * so this multiplies with it: kept small, so a large count preview can't flood a self-hosted server.
 */
const azureIssueCountConcurrency = 2;

/**
 * How long a drained pull-request search keeps serving its continuation pages after the last one was read, and the
 * most it lives however actively it is paged. A pagination that keeps reading stays on one consistent drain; one
 * left idle, or paged for longer than that, is read again.
 */
const pullRequestSearchIdleTtl = 5 * 60 * 1000;
const pullRequestSearchMaxTtl = 30 * 60 * 1000;

/**
 * How long a count reuses the drain a search of its query just read. Long enough for a count shown next to the
 * search it previews to agree with it, short enough that a count polled next to an unapplied filter stays live: the
 * window runs from the drain, not from the last count, so polling never extends it.
 */
const pullRequestCountReuseTtl = 60 * 1000;

interface AzurePullRequestSearchRow {
	pr: PullRequest;
	position: AzurePullRequestSearchPosition;
}

interface AzurePullRequestSearchDrain {
	rows: AzurePullRequestSearchRow[];
	truncated: boolean;
}

/**
 * Everything that decides a pull-request search's result set and order, as the value its cursor is fingerprinted
 * from. `pageSize` is left out on purpose: it only decides where a page ends, which the keyset cursor already
 * carries.
 */
function toPullRequestSearchQuery(
	options: { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria },
	sort: PullRequestSorting,
): unknown {
	const criteria = options.criteria;
	return {
		repos: options.repos?.map(r => [r.namespace, r.project ?? null, r.name]),
		org: options.org ?? null,
		relationships: [...new Set(criteria?.relationships ?? [])].sort(),
		states: [...new Set(criteria?.states ?? [])].sort(),
		text: criteria?.text?.trim() ?? null,
		draft: criteria?.draft ?? null,
		updatedAfter: criteria?.updatedAfter ?? null,
		createdAfter: criteria?.createdAfter ?? null,
		sort: sort,
	};
}

const serverMetadata = providersMetadata[GitSelfManagedHostIntegrationId.AzureDevOpsServer];
const serverAuthProvider = Object.freeze({ id: serverMetadata.id, scopes: serverMetadata.scopes });

export class AzureDevOpsServerIntegration extends AzureDevOpsIntegrationBase<GitSelfManagedHostIntegrationId.AzureDevOpsServer> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = serverAuthProvider;
	readonly id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	protected readonly key: IntegrationKey<GitSelfManagedHostIntegrationId.AzureDevOpsServer>;
	readonly name: string = 'Azure DevOps Server';

	constructor(
		ctx: IntegrationServiceContext,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
		readonly domain: string,
	) {
		super(ctx, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}`;
	}

	protected override apiBaseUrlFor(session: ProviderAuthenticationSession): string {
		return this.getSelfManagedApiBaseUrl(session);
	}

	/**
	 * The credential AND the installation it is used against: one integration instance serves every installation on
	 * its host (context paths differ, the host doesn't), and the same token connected to two of them must not reuse
	 * one installation's collections or projects on the other.
	 */
	protected override discoveryKey(session: ProviderAuthenticationSession): string {
		return `${session.accessToken}:${this.apiBaseUrlFor(session)}`;
	}

	protected override getRepositoriesApiBaseUrl(
		session: ProviderAuthenticationSession,
		repos: ProviderReposInput,
	): string {
		// Requests append each repository's organization (its collection), which an address naming that collection
		// already ends with. Only repositories of a single organization can share one base; mixed ones keep the
		// address, so another collection's repository stays below it (see `resolveRepository`).
		const owners = new Set(repos.map(r => (typeof r === 'object' ? r.namespace : undefined)));
		const [owner] = owners;
		const baseUrl = this.apiBaseUrlFor(session);
		return owners.size === 1 && owner != null
			? getAzureRepositoryApiBaseUrl(baseUrl, { owner: owner, virtualDirectory: undefined })
			: baseUrl;
	}

	protected override getApiOptions(
		session: ProviderAuthenticationSession,
		doNotConvertToPat: boolean = false,
	): {
		tokenWithInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.AzureDevOpsServer>;
		options: { isPAT: boolean; baseUrl?: string };
	} {
		const { options, ...rest } = super.getApiOptions(session, doNotConvertToPat);
		return {
			...rest,
			options: { ...options, baseUrl: this.apiBaseUrlFor(session) },
		};
	}

	protected override getCollectionApiOptions(
		session: ProviderAuthenticationSession,
		collection: string,
	): { isPAT: boolean; baseUrl?: string } {
		return {
			...super.getCollectionApiOptions(session, collection),
			baseUrl: this.collectionApiBaseUrl(session, collection),
		};
	}

	/** The base a request below `collection` appends to: the installation, whichever the address already ends in. */
	protected override collectionApiBaseUrl(session: ProviderAuthenticationSession, collection: string): string {
		return getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), {
			owner: collection,
			virtualDirectory: undefined,
		});
	}

	/**
	 * Only the server level lists the collections: below one, Azure DevOps Server answers `projectCollections` with a
	 * 404 page. On that 404 an address that names a collection reads the collection's own connection data, whose
	 * `webApplicationRelativeDirectory` spells it, and reports it as the one collection visible there.
	 */
	protected override async requestResourcesForUser(
		session: ProviderAuthenticationSession,
		userId: string,
	): Promise<ProviderAzureResource[] | undefined> {
		try {
			return await super.requestResourcesForUser(session, userId);
		} catch (ex) {
			if (!(ex instanceof RequestNotFoundError)) throw ex;

			const azure = await this.authenticationService.apis.azure;
			const addressed = await azure?.getAddressedCollection(
				this,
				toTokenWithInfo(this.id, session),
				this.apiBaseUrlFor(session),
			);
			if (addressed == null) throw ex;

			return [addressed];
		}
	}

	/**
	 * The filtered work-item search: one WIQL query per page over ONE collection, then one detail read for the
	 * page's slice. See {@link resolveWorkItemSearchScope} for why a search never spans several collections.
	 */
	protected override async searchProviderIssuesPage(
		session: ProviderAuthenticationSession,
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: IssueSearchCriteria;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderIssueSearchPage | undefined> {
		const azure = await this.authenticationService.apis.azure;
		if (azure == null) return undefined;

		this.assertSearchDates(options.criteria);
		// A first page re-reads the collection's projects, so a project created since discovery is known before its
		// work items can turn up in a collection-wide query; a continuation keeps the set its first page resolved.
		// The facade's page-1 marker (`broadenIssues` retries a failed first page with it) is a first page too.
		const scope = await this.resolveWorkItemSearchScope(
			session,
			options.repos,
			options.org,
			isAzureWorkItemSearchFirstPage(options.cursor),
		);
		return azure.searchWorkItemsPage(
			this,
			toTokenWithInfo(this.id, session),
			scope.collection,
			{
				baseUrl: this.collectionApiBaseUrl(session, scope.collection),
				criteria: options.criteria,
				projectNames: scope.projectNames,
				resolveProject: name => scope.projects.find(p => sameAzureName(p.name, name)),
				cursor: options.cursor,
				pageSize: options.pageSize,
			},
			cancellation,
		);
	}

	/**
	 * Counts each scope with the WIQL its search would page through, so a count never previews constraints the read
	 * doesn't apply. A scope this provider refuses (see {@link resolveWorkItemSearchScope}) is answered as that
	 * refusal, so the facade drops only it; a request failure still fails the batch, which the facade isolates from
	 * the other batches.
	 */
	protected override async countProviderIssues(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: IssueSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<ProviderSearchCount[] | undefined> {
		const azure = await this.authenticationService.apis.azure;
		if (azure == null) return undefined;

		const tokenWithInfo = toTokenWithInfo(this.id, session);
		return mapBounded(scopes, azureIssueCountConcurrency, s =>
			refusalAsCount(async () => {
				this.assertSearchDates(s.criteria);
				// Re-reads the projects like a first search page does, so a count and the page it previews resolve
				// the same project set — a newer project can't be counted by one and refused or missed by the other.
				const scope = await this.resolveWorkItemSearchScope(session, s.repos, s.org, true);
				return azure.countWorkItems(
					this,
					tokenWithInfo,
					scope.collection,
					{
						baseUrl: this.collectionApiBaseUrl(session, scope.collection),
						criteria: s.criteria,
						projectNames: scope.projectNames,
					},
					cancellation,
				);
			}),
		);
	}

	/**
	 * The ONE collection a work-item search runs in, and the projects that bound it.
	 *
	 * A WIQL query is collection-scoped, and ordering a union of several would need every match's details rather
	 * than one page's, so a search never spans collections. `org` names the collection; without it the repositories'
	 * collection is used, and without either the only collection the account can see. Anything else — repositories
	 * in two collections, or several visible collections and nothing to choose one — is refused rather than
	 * narrowed to whichever came first.
	 *
	 * Repositories bound the query by their PROJECT, since Azure work items belong to projects rather than to
	 * repositories, and every project must be one the collection actually has: WIQL answers an unknown project name
	 * with an empty result, which would read as "nothing matched".
	 */
	private async resolveWorkItemSearchScope(
		session: ProviderAuthenticationSession,
		repos: ProviderRepoInput[] | undefined,
		org: string | undefined,
		refreshProjects: boolean = false,
	): Promise<{ collection: string; projects: AzureProjectDescriptor[]; projectNames?: string[] }> {
		const repoCollections = uniqueAzureNames(repos?.map(r => r.namespace) ?? []);
		if (repoCollections.length > 1) {
			throw this.searchUnavailable(
				'the repositories span several collections; search each collection separately',
			);
		}
		if (org && repoCollections.length === 1 && !sameAzureName(org, repoCollections[0])) {
			throw this.searchUnavailable(`the repositories are not in the '${org}' collection`);
		}

		const collections = await this.getSearchCollections(session);
		const name = org || repoCollections[0] || (collections.length === 1 ? collections[0].name : undefined);
		if (name == null) {
			throw this.searchUnavailable(
				`the account can see ${collections.length} collections; pass \`org\` to choose the one to search`,
			);
		}

		const collection = findAzureCollection(collections, name);
		if (collection == null) throw this.searchUnavailable(`the '${name}' collection is not visible`);

		const projects = await this.getSearchProjects(session, collection, refreshProjects);
		if (!repos?.length) return { collection: collection.name, projects: projects };

		const projectNames = uniqueAzureNames(
			repos.map(r => {
				const projectName = getAzureRepositoryIdentity({
					owner: r.namespace,
					name: r.name,
					project: r.project,
				}).projectName;
				if (projectName == null) {
					throw this.searchUnavailable(`repository '${r.namespace}/${r.name}' names no project`);
				}

				const project = projects.find(p => sameAzureName(p.name, projectName));
				if (project == null) {
					throw this.searchUnavailable(`project '${projectName}' is not visible in '${collection.name}'`);
				}

				return project.name;
			}),
		);
		return { collection: collection.name, projects: projects, projectNames: projectNames };
	}

	/**
	 * The filtered pull-request search. Azure's pull request query can only narrow by creator, reviewer, status and
	 * repository, so every facet is drained (see {@link drainPullRequestSearch}) and the criteria it can't express
	 * are applied to the complete facets; the union is then ordered and served from a keyset cursor.
	 */
	protected override async searchProviderPullRequestsPage(
		session: ProviderAuthenticationSession,
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: PullRequestSearchCriteria;
			cursor?: string;
			pageSize?: number;
			summary?: boolean;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderPullRequestSearchPage | undefined> {
		this.assertSearchDates(options.criteria);
		const sort = options.criteria?.sort ?? defaultPullRequestSort;
		const query = toPullRequestSearchQuery(options, sort);
		const key = toAzurePullRequestSearchCursorKey(query);
		const cursor = parseAzurePullRequestSearchCursor(options.cursor, key);
		// A first page drains fresh, into a drain of its own, and its continuations page through that one: the cache
		// keeps it alive for as long as the pagination keeps reading it (an access TTL), so rows can't move between
		// pages, and a later first page of the same query never replaces it. A continuation whose drain is gone is
		// refused, like an expired work-item snapshot: resuming against a re-drain could skip or repeat a pull request
		// whose sort date changed. The drain is keyed by credential and installation too, so a cursor handed to
		// another connection finds nothing and is refused the same way.
		const drainId = cursor?.drain ?? uuid();
		const drainKey = this.pullRequestSearchCacheKey(session, query, drainId);
		// A continuation only ever READS its drain: creating one under its id would be the re-drain refused above.
		const drainFound =
			cursor != null
				? this._pullRequestSearches.get(drainKey)
				: this.getPullRequestSearch(this._pullRequestSearches, drainKey, session, options, sort, cancellation);
		if (drainFound == null) {
			throw new Error(
				'Pull request search results expired or belong to another connection; restart the read without a cursor',
			);
		}

		const drain = await drainFound;
		if (cursor == null) {
			// Also the query's latest drain, which a count of the same query reads rather than draining again. Stored
			// through `getOrCreate`, which applies the cache's capacity and expiry; `set` applies neither.
			const latestKey = this.pullRequestSearchCacheKey(session, query);
			this._latestPullRequestSearches.delete(latestKey);
			void this._latestPullRequestSearches.getOrCreate(latestKey, () => Promise.resolve(drain));
		}

		const pageSize = toAzureSearchPageSize(options.pageSize, 50, 100);
		const start =
			cursor == null
				? 0
				: drain.rows.findIndex(r => compareAzurePullRequestSearchPositions(r.position, cursor.after, sort) > 0);
		const slice = start < 0 ? [] : drain.rows.slice(start, start + pageSize);
		const page = cursor?.page ?? 1;
		const last = slice.at(-1);
		const hasMore = last != null && start + slice.length < drain.rows.length;
		return {
			values: slice.map(r => r.pr),
			cursor: hasMore
				? JSON.stringify({ key: key, drain: drainId, page: page + 1, after: last.position })
				: undefined,
			hasMore: hasMore,
			page: page,
			truncated: drain.truncated,
			totalCount: drain.truncated ? undefined : drain.rows.length,
		};
	}

	/**
	 * Counts each scope from the latest drain of its query, the one a search's first page just read, or drains it; see
	 * {@link searchProviderPullRequestsPage}.
	 */
	protected override async countProviderPullRequests(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<(ProviderPullRequestCount | Error)[] | undefined> {
		// One scope at a time: each is a drain that already fans out over its facets, and the facade runs several
		// batches of scopes at once, so a concurrent batch would multiply the requests reaching the server.
		return mapBounded(scopes, 1, s =>
			refusalAsCount(async () => {
				this.assertSearchDates(s.criteria);
				const sort = s.criteria?.sort ?? defaultPullRequestSort;
				const drain = await this.getPullRequestSearch(
					this._latestPullRequestSearches,
					this.pullRequestSearchCacheKey(session, toPullRequestSearchQuery(s, sort)),
					session,
					s,
					sort,
					cancellation,
				);
				// Past the drain budget the true total is unknown, so it is reported as uncounted rather than understated.
				return { count: drain.truncated ? undefined : drain.rows.length };
			}),
		);
	}

	/**
	 * The drain each pagination pages through, one per first page (see {@link searchProviderPullRequestsPage}), so
	 * the 50 most recently read paginations are kept for as long as they keep reading.
	 */
	private readonly _pullRequestSearches = new PromiseCache<string, AzurePullRequestSearchDrain>({
		capacity: 50,
		accessTTL: pullRequestSearchIdleTtl,
		createTTL: pullRequestSearchMaxTtl,
	});
	/**
	 * Each query's latest drain, which its count reads for {@link pullRequestCountReuseTtl}. Apart from the
	 * paginations' drains, so counting and starting searches never evicts a pagination still being read.
	 */
	private readonly _latestPullRequestSearches = new PromiseCache<string, AzurePullRequestSearchDrain>({
		capacity: 20,
		createTTL: pullRequestCountReuseTtl,
	});

	/**
	 * Keyed by the query itself, not its cursor fingerprint, so two queries whose fingerprints collide can never share
	 * a drain; by credential and installation, so two accounts or installations never read each other's results; and
	 * by `drainId` for a pagination's own drain, left out for the query's latest one.
	 */
	private pullRequestSearchCacheKey(
		session: ProviderAuthenticationSession,
		query: unknown,
		drainId?: string,
	): string {
		return JSON.stringify([session.accessToken, this.apiBaseUrlFor(session), query, drainId ?? null]);
	}

	private getPullRequestSearch(
		cache: PromiseCache<string, AzurePullRequestSearchDrain>,
		cacheKey: string,
		session: ProviderAuthenticationSession,
		options: { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria },
		sort: PullRequestSorting,
		cancellation: AbortSignal | undefined,
	): Promise<AzurePullRequestSearchDrain> {
		return cache.getOrCreate(
			cacheKey,
			(_cacheable, signal) => this.drainPullRequestSearch(session, options, sort, signal),
			{ cancellation: cancellation },
		);
	}

	/**
	 * Every pull request matching the search, filtered, deduplicated and ordered.
	 *
	 * One facet per (repository or project) × relationship: `Author` reads by creator, while `Assignee` and
	 * `ReviewRequested` both read by reviewer, since Azure has no assignee distinct from its reviewers. Each facet is
	 * drained to {@link azurePullRequestSearchFacetLimit}; a facet that still has more marks the whole result
	 * truncated, because its unread rows could sort anywhere in the union. A facet that fails fails the search: a
	 * union missing one facet would be served in an order it doesn't have.
	 */
	private async drainPullRequestSearch(
		session: ProviderAuthenticationSession,
		options: { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria },
		sort: PullRequestSorting,
		cancellation: AbortSignal | undefined,
	): Promise<AzurePullRequestSearchDrain> {
		const criteria = options.criteria;
		// Built before any request, so criteria it can't apply fail the search before the facets are drained.
		const matches = toAzurePullRequestSearchFilter(criteria);
		const relationships = new Set(criteria?.relationships ?? []);
		const wantAuthored = relationships.has(PullRequestFilter.Author);
		const wantReviewed =
			relationships.has(PullRequestFilter.Assignee) || relationships.has(PullRequestFilter.ReviewRequested);

		// A drain runs for a first page (or once its predecessor expired), so it re-reads the projects it fans out
		// over: an org search trusting the connection-long discovery cache would silently skip a newer project.
		const facets = await this.resolvePullRequestSearchFacets(session, options.repos, options.org);

		// The current user's id is resolved PER COLLECTION: Azure DevOps Server gives one person a different
		// identity id in each collection than at the server level, and a creator/reviewer filter only matches the
		// collection's. The server-level id matches nothing there and would serve an empty result as if nobody had
		// authored anything.
		const userIds = new Map<string, string>();
		if (relationships.size > 0) {
			for (const collection of uniqueAzureNames(facets.map(f => f.collection))) {
				const userId = await this.getFilterUserId(session, collection);
				if (userId == null) {
					throw this.searchUnavailable(`the current user could not be resolved in '${collection}'`);
				}

				userIds.set(collection, userId);
			}
		}

		const filtersFor = (collection: string): { authorLogin?: string; reviewerId?: string }[] => {
			if (relationships.size === 0) return [{}];

			const userId = userIds.get(collection)!;
			return [
				...(wantAuthored ? [{ authorLogin: userId }] : []),
				...(wantReviewed ? [{ reviewerId: userId }] : []),
			];
		};

		const api = await this.getProvidersApi();
		const { tokenWithInfo, options: apiOptions } = this.getApiOptions(session);
		const states = toProviderPullRequestStates(criteria?.states?.length ? criteria.states : 'open');
		const drains = await mapBounded(
			facets.flatMap(facet => filtersFor(facet.collection).map(filter => ({ facet: facet, filter: filter }))),
			providerFanOutConcurrency,
			async ({ facet, filter }) => {
				const baseUrl = this.collectionApiBaseUrl(session, facet.collection);
				const values: ProviderPullRequest[] = [];
				let page = 1;
				for (let read = 1; ; read++) {
					if (cancellation?.aborted) throw new CancellationError();

					const input = {
						...apiOptions,
						...filter,
						states: states,
						page: page,
						pageSize: azurePullRequestSearchPageSize,
						baseUrl: baseUrl,
					};
					const result =
						facet.repository != null
							? await api
									.getPullRequestsForRepo(
										tokenWithInfo,
										{
											namespace: facet.collection,
											name: facet.repository,
											project: facet.project.name,
										},
										input,
									)
									.then(r => ({
										values: r.values,
										more: r.paging?.more === true,
										nextPage: r.paging?.nextPage,
									}))
							: await api
									.getPullRequestsForAzureProject(
										tokenWithInfo,
										{ namespace: facet.collection, project: facet.project.name },
										input,
									)
									.then(r =>
										r != null
											? { values: r.data, more: r.hasMore, nextPage: r.nextPage ?? undefined }
											: undefined,
									);
					if (result == null) throw new Error('Azure DevOps returned no pull request page');

					values.push(...result.values);
					if (!result.more) return { facet: facet, values: values, truncated: false };
					// Follows the page the provider says comes next rather than assuming one: a continuation that
					// doesn't advance would re-read or skip rows, so it fails the facet — and with it the search —
					// instead of serving a union built from it.
					if (result.nextPage == null || result.nextPage <= page) {
						throw new Error('Azure DevOps returned no advancing pull request continuation');
					}
					// The budget counts pages READ, not rows kept: several states are one `status=all` query the SDK
					// narrows client-side, so counting survivors would keep paging through rows it discards.
					if (read * azurePullRequestSearchPageSize >= azurePullRequestSearchFacetLimit) {
						return { facet: facet, values: values, truncated: true };
					}

					page = result.nextPage;
				}
			},
		);

		const rows = new Map<string, AzurePullRequestSearchRow>();
		for (const { facet, values } of drains) {
			for (const pr of values) {
				if (!matches(pr)) continue;

				const identity =
					getProviderPullRequestIdentity(pr) ?? `project:${facet.collection}/${facet.project.name}:${pr.id}`;
				if (rows.has(identity)) continue;

				rows.set(identity, {
					pr: fromProviderPullRequest(pr, this, {
						project: facet.project,
						currentAccountId: userIds.get(facet.collection),
					}),
					position: toAzurePullRequestSearchPosition(pr, sort, identity),
				});
			}
		}

		return {
			rows: [...rows.values()].sort((a, b) =>
				compareAzurePullRequestSearchPositions(a.position, b.position, sort),
			),
			truncated: drains.some(d => d.truncated),
		};
	}

	/**
	 * The repositories or projects a pull-request search reads, each with its collection and project descriptor.
	 *
	 * Repositories are read one by one; an `org` is its collection's projects; a search bounded only by the current
	 * user reads every project the account can see, the same breadth as the account-wide pull request read.
	 */
	private async resolvePullRequestSearchFacets(
		session: ProviderAuthenticationSession,
		repos: ProviderRepoInput[] | undefined,
		org: string | undefined,
	): Promise<{ collection: string; project: AzureProjectDescriptor; repository?: string }[]> {
		const collections = await this.getSearchCollections(session);
		const collectionFor = (name: string): AzureOrganizationDescriptor => {
			const collection = findAzureCollection(collections, name);
			if (collection == null) throw this.searchUnavailable(`the '${name}' collection is not visible`);

			return collection;
		};

		if (repos?.length) {
			if (org && repos.some(r => !sameAzureName(r.namespace, org))) {
				throw this.searchUnavailable(`the repositories are not all in the '${org}' collection`);
			}

			// One discovery per distinct collection, however many of its repositories the search names.
			const projectsByCollection = new Map<string, Promise<AzureProjectDescriptor[]>>();
			const projectsOf = (collection: AzureOrganizationDescriptor): Promise<AzureProjectDescriptor[]> => {
				let projects = projectsByCollection.get(collection.id);
				if (projects == null) {
					projects = this.getSearchProjects(session, collection, true);
					projectsByCollection.set(collection.id, projects);
				}
				return projects;
			};

			return Promise.all(
				repos.map(async r => {
					const collection = collectionFor(r.namespace);
					const identity = getAzureRepositoryIdentity({
						owner: r.namespace,
						name: r.name,
						project: r.project,
					});
					if (identity.projectName == null) {
						throw this.searchUnavailable(`repository '${r.namespace}/${r.name}' names no project`);
					}
					// The repository becomes a URL segment the SDK encodes but doesn't validate, and a segment of `..`
					// survives encoding and resolves to the project-wide route: refused rather than widened.
					if (!isAzureRouteSegment(identity.repositoryName)) {
						throw this.searchUnavailable(`repository '${r.namespace}/${r.name}' is not a valid name`);
					}

					const project = (await projectsOf(collection)).find(p =>
						sameAzureName(p.name, identity.projectName!),
					);
					if (project == null) {
						throw this.searchUnavailable(
							`project '${identity.projectName}' is not visible in '${collection.name}'`,
						);
					}

					return { collection: collection.name, project: project, repository: identity.repositoryName };
				}),
			);
		}

		const scoped = org ? [collectionFor(org)] : collections;
		const projects = await Promise.all(scoped.map(c => this.getSearchProjects(session, c, true)));
		return projects.flat().map(p => ({ collection: p.resourceName, project: p }));
	}

	private readonly _collectionUserIds = new PromiseCache<string, string | undefined>({ capacity: 50 });

	/**
	 * The current user's identity id in `collection`, read from the collection's own connection data, which is
	 * what Azure's creator and reviewer filters compare against. Cached per credential and collection, since it
	 * can't change for either.
	 */
	protected override getFilterUserId(
		session: ProviderAuthenticationSession,
		collection: string,
	): Promise<string | undefined> {
		const baseUrl = this.collectionApiBaseUrl(session, collection);
		return this._collectionUserIds.getOrCreate(
			JSON.stringify([session.accessToken, baseUrl, collection.toLowerCase()]),
			async cacheable => {
				const azure = await this.authenticationService.apis.azure;
				const user = await azure?.getCurrentUserOnServer(
					this,
					toTokenWithInfo(this.id, session),
					`${baseUrl}/${encodeURIComponent(collection)}`,
				);
				// A miss is not cached: the lookup degrades to `undefined` on a transient failure, and caching that
				// would refuse every relationship search in the collection until the connection is dropped.
				if (user?.id == null) {
					cacheable.invalidate();
				}

				return user?.id;
			},
		);
	}

	/** Every collection the account can see, or a refusal when discovery itself failed. */
	private async getSearchCollections(session: ProviderAuthenticationSession): Promise<AzureOrganizationDescriptor[]> {
		const collections = await this.getProviderResourcesForUser(session);
		if (collections == null) throw this.searchUnavailable('the account’s collections could not be read');

		return collections;
	}

	/**
	 * A collection's projects, refused when discovery was incomplete: a search bounded by an incomplete project set
	 * would silently omit the missing projects' matches. `refresh` re-reads them rather than trusting the discovery
	 * cache, which lives for the whole connection and so doesn't know a project created since.
	 */
	private async getSearchProjects(
		session: ProviderAuthenticationSession,
		collection: AzureOrganizationDescriptor,
		refresh: boolean = false,
	): Promise<AzureProjectDescriptor[]> {
		const projects = refresh
			? await this.refreshSearchProjects(session, collection)
			: await this.getProviderProjectsForResources(session, [collection]);
		if (projects.metadata != null && projects.metadata.completeness !== 'complete') {
			throw this.searchUnavailable(`the projects of the '${collection.name}' collection could not all be read`);
		}

		return projects.values;
	}

	private readonly _projectRefreshes = new Map<
		string,
		Promise<ProviderApiCollectionResult<AzureProjectDescriptor>>
	>();

	/**
	 * Re-reads a collection's projects, sharing one read among the refreshes IN FLIGHT at once — a count batch or a
	 * multi-repository drain refreshes the same collection once per scope, and each would otherwise re-read every
	 * project page. Nothing outlives the read, so the next search still sees a project created after it.
	 */
	private refreshSearchProjects(
		session: ProviderAuthenticationSession,
		collection: AzureOrganizationDescriptor,
	): Promise<ProviderApiCollectionResult<AzureProjectDescriptor>> {
		const key = `${this.discoveryKey(session)}:${collection.id}`;
		let pending = this._projectRefreshes.get(key);
		if (pending == null) {
			pending = this.getProviderProjectsForResources(session, [collection], true).finally(() => {
				this._projectRefreshes.delete(key);
			});
			this._projectRefreshes.set(key, pending);
		}

		return pending;
	}

	/**
	 * Refuses dates the search can't apply before anything is read. The facade only checks that dates are
	 * supported, not their shape, and a refusal here stays with its own scope in a count batch.
	 */
	private assertSearchDates(criteria: { updatedAfter?: string; createdAfter?: string } | undefined): void {
		const invalid = getInvalidAzureSearchDate(criteria);
		if (invalid != null) throw this.searchUnavailable(invalid);
	}

	private searchUnavailable(reason: string): IntegrationReadUnavailableError {
		return new IntegrationReadUnavailableError(this.name, `search refused: ${reason}.`);
	}

	protected override providerOnDisconnect(): void {
		super.providerOnDisconnect();
		this._pullRequestSearches.clear();
		this._latestPullRequestSearches.clear();
		this._collectionUserIds.clear();
	}

	protected override async _requestForCurrentUser(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const azure = await this.authenticationService.apis.azure;
		const user = azure
			? await azure.getCurrentUserOnServer(this, toTokenWithInfo(this.id, session), this.apiBaseUrlFor(session))
			: undefined;
		return user
			? {
					provider: this,
					id: user.id,
					name: user.name ?? undefined,
					email: user.email ?? undefined,
					avatarUrl: user.avatarUrl ?? undefined,
					username: user.username ?? undefined,
				}
			: undefined;
	}
}
