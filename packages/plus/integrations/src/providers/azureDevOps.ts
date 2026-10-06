import type { CollectionMetadata, CollectionScope, CollectionScopeFailure } from '@gitkraken/provider-apis';
import { GitPullRequestState } from '@gitkraken/provider-apis';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestProjection,
	PullRequestShape,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import { chunk } from '@gitlens/utils/array.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { mapSettledBounded } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type {
	AuthenticationSessionLike as AuthenticationSession,
	ProviderAuthenticationSession,
	TokenWithInfo,
} from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { ProviderRefusal } from '../collectionMetadata.js';
import { throwIfCallerContractError, toCollectionScopeFailure } from '../collectionMetadata.js';
import type { GitSelfManagedHostIntegrationId } from '../constants.js';
import { GitCloudHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import { AuthenticationError } from '../errors.js';
import type { SearchMyPullRequestsOptions, SearchPullRequestsOptions } from '../models/gitHostIntegration.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type {
	AccountWideIssuesResult,
	IssueEtagFields,
	IssueEtagInclude,
	PullRequestEtagFields,
	PullRequestEtagInclude,
	SearchMyIssuesOptions,
} from '../models/integration.js';
import type { ProviderWarningCause, ProviderWarningScope } from '../results.js';
import { decodePathSegment } from '../utils/domain.utils.js';
import { getAzurePullRequestIdentityFromMaybeUrl } from './azure/azure.utils.js';
import type {
	AzureOrganizationDescriptor,
	AzureProjectDescriptor,
	AzureProjectInputDescriptor,
	AzureRemoteRepositoryDescriptor,
	AzureRepositoryDescriptor,
	AzureWorkItemResponse,
} from './azure/models.js';
import {
	azureWorkItemsEtagFieldsMaxIds,
	toAzurePullRequestEtagFields,
	toAzureWorkItemEtagFields,
} from './azure/models.js';
import type {
	ProviderApiCollectionResult,
	ProviderApiPagedResult,
	ProviderAzureResource,
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderRepository,
} from './models.js';
import {
	fromProviderIssue,
	fromProviderPullRequest,
	getProviderPullRequestIdentity,
	IssueFilter,
	providerPullRequestMatchesSearch,
	providersMetadata,
	PullRequestFilter,
	toIssueShape,
	toProviderPullRequestStates,
} from './models.js';
import { discoveryCacheTtl } from './utils/discoveryCache.js';
import {
	collectProviderPagedResult,
	flatSettledResultsOrThrow,
	mergeCollectionMetadata,
	resolveBranchPullRequests,
	selectBranchPullRequests,
} from './utils/providerPaging.js';

export function getAzureRepositoryIdentity(repo: Pick<AzureRepositoryDescriptor, 'owner' | 'name' | 'project'>): {
	resourceName: string;
	projectName?: string;
	repositoryName: string;
} {
	const match = /^([^/]+)\/_git\/([^/]+)$/i.exec(repo.name);
	return {
		resourceName: repo.owner,
		projectName: repo.project ?? match?.[1],
		repositoryName: match?.[2] ?? repo.name,
	};
}

export function getAzureRepositoryApiBaseUrl(
	baseUrl: string,
	repo: Pick<AzureRepositoryDescriptor, 'owner' | 'virtualDirectory'>,
): string {
	const directory = repo.virtualDirectory?.split('/');
	if (directory?.some(segment => !segment || segment === '.' || segment === '..')) {
		throw new Error(`Invalid Azure virtual directory '${repo.virtualDirectory}'.`);
	}

	const url = new URL(baseUrl);
	const toUrl = (segments: string[]) => `${url.protocol}//${url.host}${segments.map(s => `/${s}`).join('')}`;
	const configured = url.pathname.split('/').filter(Boolean);
	// A connection addressed at the host root takes the repository's own directory.
	if (!configured.length) return toUrl(directory?.map(encodeURIComponent) ?? []);

	// Otherwise the address is the installation, optionally followed by the repository's collection, which
	// requests append themselves (as the owner). IIS serves these paths case-insensitively.
	const namesCollection = sameAzurePathSegment(configured.at(-1)!, repo.owner);
	const installation = namesCollection ? configured.slice(0, -1) : configured;
	if (directory == null) return toUrl(installation);

	for (const candidate of namesCollection ? [configured, installation] : [configured]) {
		if (candidate.length === directory.length && candidate.every((s, i) => sameAzurePathSegment(s, directory[i]))) {
			return toUrl(candidate);
		}
	}
	throw new Error('Azure repository virtual directory does not match the configured installation');
}

function sameAzurePathSegment(encoded: string, value: string): boolean {
	return decodePathSegment(encoded).toLowerCase() === value.toLowerCase();
}

/**
 * Whether two collection or project names name the same scope. Azure DevOps treats them case-insensitively, so a
 * name typed by hand must still select the collection or project discovery reported.
 */
export function sameAzureName(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/** The distinct names in `names`, compared as Azure compares them, keeping the first spelling of each. */
export function uniqueAzureNames(names: readonly string[]): string[] {
	const unique: string[] = [];
	for (const name of names) {
		if (!unique.some(n => sameAzureName(n, name))) {
			unique.push(name);
		}
	}
	return unique;
}

/**
 * Flags the reviews of `pr` that name one of the current user's groups (see `PullRequestReviewer.isMyGroup`), which a
 * reviewer read finds through that group rather than through the user.
 */
export function markMyGroupReviews(pr: ProviderPullRequest, groupIds: ReadonlySet<string>): ProviderPullRequest {
	if (pr.reviews == null || !pr.reviews.some(r => groupIds.has(r.reviewer.id))) return pr;

	return { ...pr, reviews: pr.reviews.map(r => (groupIds.has(r.reviewer.id) ? { ...r, isMyGroup: true } : r)) };
}

/** One read a reviewer relationship takes in a project or repository, and the rows of it the relationship keeps. */
export interface AzureReviewerRead {
	filter: { reviewerId?: string; states?: GitPullRequestState[] };
	keep?: (pr: ProviderPullRequest) => boolean;
}

/**
 * The reads a reviewer relationship over `states` (omitted: open) takes for `userId`, whose groups are `groupIds`:
 *
 * - Open pull requests: all of them, kept when one names the user, or names one of the user's groups and the user
 *   didn't write it. Azure's reviewer filter only matches the identity it names, never the groups that identity is in,
 *   and a group asked to review the user's own pull request isn't asking the user.
 * - Closed and merged ones: Azure's own filter for the user. They are every pull request a project ever had, too many
 *   to read whole on every read, so a group's request is only followed while the pull request is open.
 */
export function toAzureReviewerReads(
	userId: string,
	groupIds: ReadonlySet<string>,
	states: readonly GitPullRequestState[] | undefined,
): AzureReviewerRead[] {
	const reads: AzureReviewerRead[] = [];
	if (states == null || states.includes(GitPullRequestState.Open)) {
		reads.push({
			filter: { states: [GitPullRequestState.Open] },
			keep: pr =>
				pr.reviews?.some(
					r => r.reviewer.id === userId || (groupIds.has(r.reviewer.id) && pr.author?.id !== userId),
				) ?? false,
		});
	}

	const closed = states?.filter(s => s !== GitPullRequestState.Open) ?? [];
	if (closed.length > 0) {
		reads.push({ filter: { reviewerId: userId, states: closed } });
	}
	return reads;
}

/**
 * Matches an org/project descriptor against a caller-supplied name, mirroring the facade's own
 * key/id/name comparison so `listIssuesPage({ org, project })` narrows on the same identifiers a consumer
 * already got back from `listOrgs`/`listProjects`.
 */
function azureResourceMatches(resource: { key?: string; id?: string; name?: string }, value: string): boolean {
	return resource.key === value || resource.id === value || resource.name === value;
}

export abstract class AzureDevOpsIntegrationBase<
	TIntegrationId extends GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	TRepositoryDescriptor extends AzureRepositoryDescriptor = AzureRepositoryDescriptor,
> extends GitHostIntegration<TIntegrationId, TRepositoryDescriptor> {
	protected abstract apiBaseUrlFor(session: ProviderAuthenticationSession): string;
	protected getApiOptions(
		session: ProviderAuthenticationSession,
		doNotConvertToPat: boolean = false,
	): {
		tokenWithInfo: TokenWithInfo<TIntegrationId>;
		options: { isPAT: boolean; baseUrl?: string };
	} {
		// The secret is handed over raw: `isPAT` tells provider-apis to send it as an HTTP Basic credential, which
		// it encodes itself as `base64(':' + token)`. Pre-encoding here would be encoded a second time and refused
		// by Azure DevOps. `getCurrentUser` is the one read that needs a bearer token, and passes
		// `doNotConvertToPat` to get one.
		const usePat = !doNotConvertToPat;
		const tokenWithInfo = toTokenWithInfo<TIntegrationId>(this.id, session);
		return {
			tokenWithInfo: tokenWithInfo,
			options: { isPAT: usePat },
		};
	}

	/**
	 * The options for a request addressed below one collection (an Azure DevOps Services organization).
	 *
	 * The same as {@link getApiOptions} unless a self-managed address already names the collection, which requests
	 * append themselves: see the server override, which keeps it from being applied twice.
	 */
	protected getCollectionApiOptions(
		session: ProviderAuthenticationSession,
		_collection: string,
	): { isPAT: boolean; baseUrl?: string } {
		return this.getApiOptions(session).options;
	}

	/** The base a request or link below `collection` appends the collection to; see {@link getCollectionApiOptions}. */
	protected collectionApiBaseUrl(session: ProviderAuthenticationSession, _collection: string): string {
		return this.apiBaseUrlFor(session);
	}

	/** Reads the organizations (Azure DevOps Server: the collections) the account can see. */
	protected async requestResourcesForUser(
		session: ProviderAuthenticationSession,
		userId: string,
	): Promise<ProviderAzureResource[] | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo, options } = this.getApiOptions(session);
		return api.getAzureResourcesForUser(tokenWithInfo, userId, options);
	}

	/**
	 * The identity id a pull-request creator/reviewer filter must carry for `collection`.
	 *
	 * On Azure DevOps Services that is the account id, one per user. The server override resolves it per collection,
	 * since Azure DevOps Server gives one person a different id in each collection than at the server level.
	 */
	protected async getFilterUserId(
		session: ProviderAuthenticationSession,
		_collection: string,
	): Promise<string | undefined> {
		return (await this.getProviderCurrentAccount(session))?.id;
	}

	/**
	 * The current user's groups per credential, collection and user, kept for {@link discoveryCacheTtl} like the other
	 * discovered sets: membership changes rarely, and a sweep that reads every few minutes would otherwise pay for it
	 * every time. A failed read isn't kept, and a re-sync drops them all (see {@link invalidateDiscoveryCaches}).
	 */
	private readonly _reviewerGroupIds = new PromiseCache<string, Set<string>>({
		capacity: 50,
		createTTL: discoveryCacheTtl,
	});

	/**
	 * Every group the current user (`userId`, as {@link getFilterUserId} resolved it) is a member of in `collection`:
	 * teams and security groups, in any project, directly or through other groups. Two requests per collection,
	 * however many groups, and none while the last read is kept.
	 */
	protected getReviewerGroupIds(
		session: ProviderAuthenticationSession,
		collection: string,
		userId: string,
	): Promise<Set<string>> {
		return this._reviewerGroupIds.getOrCreate(
			JSON.stringify([this.discoveryKey(session), collection.toLowerCase(), userId]),
			async () => {
				const api = await this.getProvidersApi();
				const { tokenWithInfo } = this.getApiOptions(session);
				const ids = await api.getAzureGroupIdsForUser(
					tokenWithInfo,
					collection,
					userId,
					this.getCollectionApiOptions(session, collection),
				);
				return new Set(ids);
			},
		);
	}

	override invalidateDiscoveryCaches(): void {
		super.invalidateDiscoveryCaches();
		this._reviewerGroupIds.clear();
	}

	/**
	 * For one read, the current account as each organization's pull requests identify it, given the account itself
	 * (`undefined` when it couldn't be read). Azure DevOps Services gives a person one id, so that is `account`; the
	 * server override resolves each collection's own, once per read.
	 */
	protected getOrganizationViewers(
		_session: ProviderAuthenticationSession,
		account: { id: string; username?: string } | undefined,
	): (org: string) => Promise<{ id: string; username?: string } | undefined> {
		return () => Promise.resolve(account);
	}

	/**
	 * What the discovery caches (account, organizations, projects, and their stored copies) are keyed by. Azure DevOps
	 * Services has a single address, so the credential alone identifies what it discovers; the server override adds
	 * the installation address.
	 */
	protected discoveryKey(session: ProviderAuthenticationSession): string {
		return session.accessToken;
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const key = this.discoveryKey(session);
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(key);
		if (cachedAccount == null) {
			const user = await this._requestForCurrentUser(session);
			this._accounts.set(key, user);
		}

		return this._accounts.get(key);
	}

	protected async _requestForCurrentUser(session: ProviderAuthenticationSession): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo, options } = this.getApiOptions(session, true);
		const user = await api.getCurrentUser(tokenWithInfo, options);
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

	/**
	 * Bypasses the account cache so a previously accepted credential cannot vouch for one that is now refused.
	 */
	protected override async validateCredential(session: ProviderAuthenticationSession): Promise<void> {
		if ((await this._requestForCurrentUser(session)) == null) {
			throw new Error('Azure DevOps did not confirm the credential');
		}
	}

	/**
	 * Names a confirmed credential's refusal from the answers Azure DevOps gives, captured live (#5890):
	 * - `VS403463` in the explanation is a Conditional Access policy;
	 * - a typed `UnauthorizedRequestException` body is an organization or project the account has no access to;
	 * - a `401` to an OAuth token that explains nothing (sent as Basic), or only `TF400813` (sent as Bearer), is an
	 *   organization whose "Third-party application access via OAuth" policy is off. It is the same answer an
	 *   expired token gets, which is why this is only asked once the credential passed. The policy does not govern
	 *   personal access tokens, so a PAT is never given it.
	 *
	 * Any other explanation is left unnamed, so the warning keeps Azure's own words rather than a guess.
	 */
	protected override describeRefusal(
		session: ProviderAuthenticationSession,
		refusal: ProviderRefusal,
		scope: ProviderWarningScope,
	): ProviderWarningCause | undefined {
		const code = /\b(?:TF|VS)\d{6}\b/.exec(refusal.detail ?? '')?.[0];
		if (code === 'VS403463') return { reason: 'conditional-access', code: code };
		if (refusal.typeKey === 'UnauthorizedRequestException') {
			return { reason: 'access-denied', ...(code != null ? { code: code } : {}) };
		}
		if (
			this.id !== GitCloudHostIntegrationId.AzureDevOps ||
			session.type !== 'oauth' ||
			refusal.status !== 401 ||
			refusal.typeKey != null ||
			(refusal.detail != null && code !== 'TF400813')
		) {
			return undefined;
		}

		// The organization's name, for the policy page, comes from the discovery the failure was recorded under. Most
		// reads record the organization's id, the repo-scoped ones its name.
		const org =
			scope.resourceId != null
				? this._organizations
						?.get(this.discoveryKey(session))
						?.find(o => o.id === scope.resourceId || o.name === scope.resourceId)?.name
				: undefined;
		return {
			reason: 'oauth-app-not-allowed',
			...(code != null ? { code: code } : {}),
			...(org != null
				? {
						remedyUrl: `${this.apiBaseUrlFor(session)}/${encodeURIComponent(org)}/_settings/organizationPolicy`,
					}
				: {}),
		};
	}

	private _organizations: Map<string, AzureOrganizationDescriptor[] | undefined> | undefined;
	protected async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<AzureOrganizationDescriptor[] | undefined> {
		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		const key = this.discoveryKey(session);
		const cachedResources = this._organizations.get(key);

		if (cachedResources == null || force) {
			const account = await this.getProviderCurrentAccount(session);
			if (account?.id == null) return undefined;

			const resources = await this.requestResourcesForUser(session, account.id);
			this._organizations.set(key, resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined);
		}

		return this._organizations.get(key);
	}

	private _projects: Map<string, AzureProjectDescriptor[] | undefined> | undefined;
	/**
	 * Discovers (and caches) each resource's projects. Only resources whose drain completed cleanly are cached;
	 * a rejected or backstop-truncated drain is left uncached (retried next call). When `failures` is supplied,
	 * a rejected resource is recorded there as a structured {@link CollectionScopeFailure} so an account-wide
	 * caller can surface the incomplete project set (a whole org's PRs/issues silently missing otherwise) as a
	 * scope-aware warning + `fetchFailed` rather than an all-pages success over a hole.
	 */
	protected async getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: AzureOrganizationDescriptor[],
		force: boolean = false,
		failures?: CollectionScopeFailure[],
	): Promise<ProviderApiCollectionResult<AzureProjectDescriptor>> {
		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();
		const discoveryKey = this.discoveryKey(session);

		let resourcesWithoutProjects = [];
		if (force) {
			resourcesWithoutProjects = resources;
		} else {
			for (const resource of resources) {
				const resourceKey = `${discoveryKey}:${resource.id}`;
				const cachedProjects = this._projects.get(resourceKey);
				if (cachedProjects == null) {
					resourcesWithoutProjects.push(resource);
				}
			}
		}

		const allProjects: AzureProjectDescriptor[] = [];
		let resultMetadata: CollectionMetadata | undefined;

		if (resourcesWithoutProjects.length > 0) {
			const api = await this.getProvidersApi();
			const { tokenWithInfo } = this.getApiOptions(session);
			// The projects API is paginated; a single call would drop every project past the first page (and
			// with it their repos and PRs). Drain all pages per resource, threading the returned cursor.
			// Per-resource (not a shared flatSettled) so a resource whose drain was truncated (hit the paging
			// backstop) or rejected is NOT cached — caching a partial list here would make every later repo/PR/
			// issue read for that org silently inherit an incomplete project set. Leaving it uncached means the
			// next call retries it. The scope is passed so a page-level failure preserves the prefix already
			// fetched and records a structured failure instead of re-throwing.
			const drains = await Promise.allSettled(
				resourcesWithoutProjects.map(async resource => ({
					resource: resource,
					result: await collectProviderPagedResult(
						cursor =>
							api.getAzureProjectsForResource(tokenWithInfo, resource.name, {
								...this.getCollectionApiOptions(session, resource.name),
								cursor: cursor,
							}),
						20,
						{ providerId: this.id, resourceId: resource.id },
					),
				})),
			);

			// `allSettled` preserves order, so `drains[i]` is `resourcesWithoutProjects[i]`.
			drains.forEach((drain, i) => {
				// A rejected resource drain contributes nothing and is left uncached (retried next call). Record
				// it as a structured failure so an account-wide caller can warn on the org whose projects (and
				// thus PRs/issues) are missing, instead of silently narrowing the read.
				if (drain.status !== 'fulfilled') {
					const resource = resourcesWithoutProjects[i];
					const failure = toCollectionScopeFailure(
						{ providerId: this.id, resourceId: resource.id },
						drain.reason,
					);
					failures?.push(failure);
					resultMetadata = mergeCollectionMetadata(resultMetadata, {
						completeness: 'partial',
						failures: [failure],
					});
					return;
				}

				const { resource, result } = drain.value;
				const projects = result.values
					.filter(p => p.namespace === resource.name)
					.map(p => ({
						id: p.id,
						name: p.name,
						resourceId: resource.id,
						resourceName: resource.name,
						key: p.id,
					}));

				if (result.metadata != null) {
					resultMetadata = mergeCollectionMetadata(resultMetadata, result.metadata);
				}

				const metadataIncomplete = result.metadata != null && result.metadata.completeness !== 'complete';
				if (result.truncated || metadataIncomplete) {
					// A truncated drain is an incomplete project set; include its partial values in the current
					// result but don't cache it as if complete. Add a structured failure for the truncation unless
					// the drain already recorded a page-level failure for this resource.
					if (
						result.truncated &&
						!result.metadata?.failures?.some(
							f => f.scope?.resourceId === resource.id && f.kind !== 'unknown',
						)
					) {
						const failure = toCollectionScopeFailure(
							{ providerId: this.id, resourceId: resource.id },
							new Error('Project discovery was truncated before all pages were read'),
						);
						failures?.push(failure);
						resultMetadata = mergeCollectionMetadata(resultMetadata, {
							completeness: 'partial',
							failures: [failure],
						});
					}
					allProjects.push(...projects);
					return;
				}

				this._projects!.set(`${discoveryKey}:${resource.id}`, projects);
			});
		}

		const cachedProjects = resources.reduce<AzureProjectDescriptor[]>((projects, resource) => {
			const resourceProjects = this._projects!.get(`${discoveryKey}:${resource.id}`);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, []);
		allProjects.push(...cachedProjects);

		const projectsByIdentity = new Map<string, AzureProjectDescriptor>();
		for (const project of allProjects) {
			const identity = `${project.resourceId}:${project.id}`;
			if (!projectsByIdentity.has(identity)) {
				projectsByIdentity.set(identity, project);
			}
		}
		const values = [...projectsByIdentity.values()];
		return resultMetadata != null ? { values: values, metadata: resultMetadata } : { values: values };
	}

	private async getRepoDescriptorsForProjects(
		session: ProviderAuthenticationSession,
		projects: AzureProjectDescriptor[],
	): Promise<Map<string, AzureRemoteRepositoryDescriptor[] | undefined>> {
		const descriptors = new Map<string, AzureRemoteRepositoryDescriptor[] | undefined>();
		if (projects.length === 0) return descriptors;

		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);
		await Promise.all(
			projects.map(async project => {
				const repos = (
					await api.getReposForAzureProject(
						tokenWithInfo,
						project.resourceName,
						project.name,
						this.getCollectionApiOptions(session, project.resourceName),
					)
				)?.values;
				if (repos != null && repos.length > 0) {
					descriptors.set(
						project.id,
						repos.map(r => ({
							id: r.id,
							nodeId: r.graphQLId ?? undefined,
							resourceName: project.resourceName,
							name: r.name,
							projectName: project.name,
							url: r.webUrl ?? undefined,
							cloneUrlHttps: r.httpsUrl ?? undefined,
							cloneUrlSsh: r.sshUrl ?? undefined,
							key: r.id,
						})),
					);
				}
			}),
		);

		return descriptors;
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null) return undefined;

		return {
			values: orgs.map(o => ({
				id: o.id,
				providerId: this.id,
				name: o.name,
				url: `${this.collectionApiBaseUrl(session, o.name)}/${o.name}`,
			})),
		};
	}

	protected override async getProviderProjectsForOrg(
		session: ProviderAuthenticationSession,
		org?: string,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		// Azure is the one git host with a project tier: repos live under org (resource) → project. Enumerate
		// the user's orgs (optionally scoped to `org`), read their projects, and surface each as an org-shaped
		// entry so the ProviderBackend facade can list them uniformly.
		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null) return undefined;
		if (orgs.length === 0) {
			return { values: [], paging: { cursor: '{}', more: false } };
		}

		const scopedOrgs = org != null ? orgs.filter(o => o.name === org || o.id === org) : orgs;
		if (scopedOrgs.length === 0) return { values: [] };

		const projects = await this.getProviderProjectsForResources(session, scopedOrgs);
		if (projects.values.length === 0 && projects.metadata == null) return { values: [] };

		return {
			values: projects.values.map(p => ({
				id: p.id,
				providerId: this.id,
				name: p.name,
				org: p.resourceName,
				url: `${this.collectionApiBaseUrl(session, p.resourceName)}/${p.resourceName}/${p.name}`,
			})),
			...(projects.metadata != null ? { metadata: projects.metadata } : {}),
		};
	}

	/**
	 * With `options.project`, returns one page of that project's repos (follow `paging.cursor` to page).
	 * Without a project it fans out across every project under `org` and returns them all at once — there's
	 * no single cursor to page a parallel merge — skipping any project that fails to list rather than
	 * failing the whole org. If any successful project drain hits the defensive page backstop, the merged
	 * result is marked `truncated` without exposing a synthetic cursor.
	 */
	protected override async getProviderRepositoriesForOrg(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { project?: string; cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);
		const apiOptions = this.getCollectionApiOptions(session, org);

		if (options?.project) {
			return api.getReposForAzureProject(tokenWithInfo, org, options.project, {
				...apiOptions,
				cursor: options.cursor,
			});
		}

		const orgDescriptor = (await this.getProviderResourcesForUser(session))?.find(o => o.name === org);
		if (orgDescriptor == null) return undefined;

		const discoveryFailures: CollectionScopeFailure[] = [];
		const projects = await this.getProviderProjectsForResources(session, [orgDescriptor], false, discoveryFailures);
		// An empty result is only proven-empty when discovery itself succeeded; a rejected project-discovery
		// leaves the repo set unknowable, so surface the discovery metadata rather than publishing a hole as a
		// complete list.
		if (projects.values.length === 0) {
			return { values: [], metadata: projects.metadata };
		}

		let repoMetadata: CollectionMetadata | undefined;
		const results = await Promise.allSettled(
			projects.values.map(p =>
				collectProviderPagedResult(
					cursor =>
						api.getReposForAzureProject(tokenWithInfo, org, p.name, { ...apiOptions, cursor: cursor }),
					20,
					{ providerId: this.id, resourceId: org, projectId: p.name },
				),
			),
		);

		const values: ProviderRepository[] = [];
		let truncated = false;
		for (const result of results) {
			// With a per-project scope, collectProviderPagedResult catches page-level failures itself and returns
			// them as metadata rather than rejecting. A rejected promise here is an unexpected internal error.
			if (result.status !== 'fulfilled') {
				truncated = true;
				continue;
			}

			values.push(...result.value.values);
			if (result.value.metadata != null) {
				repoMetadata = mergeCollectionMetadata(repoMetadata, result.value.metadata);
			}
			truncated ||= result.value.truncated === true;
		}

		const metadata = mergeCollectionMetadata(repoMetadata, projects.metadata);
		return {
			values: values,
			...(metadata != null ? { metadata: metadata } : {}),
			...(truncated || (metadata != null && metadata.completeness !== 'complete') ? { truncated: true } : {}),
		};
	}

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		if (pr.refs == null || pr.project == null) return false;

		const { tokenWithInfo } = this.getApiOptions(session);
		const apiOptions = this.getCollectionApiOptions(session, pr.repository.owner);

		try {
			const merged = await api.mergePullRequest(tokenWithInfo, pr, {
				...options,
				...apiOptions,
			});
			return merged;
		} catch (ex) {
			this.showMergeErrorMessage(ex);
			return false;
		}
	}

	protected showMergeErrorMessage(ex: Error): void {
		this.ctx.hooks?.ui?.onError?.(
			`${ex.message}. Check branch policies, and ensure you have the necessary permissions to merge the pull request.`,
		);
	}

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<UnidentifiedAuthor | undefined> {
		return (await this.authenticationService.apis.azure)?.getAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo),
			options,
		);
	}

	protected override async getProviderAccountForEmail(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_email: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderDefaultBranch(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<DefaultBranch | undefined> {
		return (await this.authenticationService.apis.azure)?.getDefaultBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{ baseUrl: getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo) },
			cancellation,
		);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		{ id }: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.authenticationService.apis.azure)?.getIssueOrPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			id,
			{
				baseUrl: getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo),
				type: type,
			},
		);
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		project: AzureProjectInputDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		const projects = await this.getProviderProjectsForResources(session, orgs);
		if (projects.values.length === 0) return undefined;

		const matchingProject = projects.values.find(p => p.resourceName === project.owner && p.name === project.name);
		if (matchingProject == null) return undefined;

		return (await this.authenticationService.apis.azure)?.getIssue(
			this,
			toTokenWithInfo(this.id, session),
			matchingProject,
			id,
			{
				baseUrl: this.collectionApiBaseUrl(session, matchingProject.resourceName),
			},
		);
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.azure)?.getPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			{
				baseUrl: getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo),
			},
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.azure)?.getPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo),
		);
	}

	/**
	 * One request per target, settled independently so one target's failure rejects only its own slot; converted
	 * like the repo-scoped list rows. Not through {@link getProviderIssue}: that read swallows every failure but a
	 * rejected credential into `undefined`, discovers every project of every organization first, and converts
	 * differently from the list reads.
	 */
	protected override async getProviderIssuesBatch(
		session: ProviderAuthenticationSession,
		coordinates: readonly { owner: string; repo: string; number: number; project?: string }[],
		_cancellation?: AbortSignal,
	): Promise<PromiseSettledResult<IssueShape | undefined>[] | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);

		return mapSettledBounded(coordinates, providerFanOutConcurrency, async c => {
			if (c.project == null) throw new Error(`Azure DevOps needs a project to read work item ${c.number}`);

			const issue = await api.getAzureWorkItem(
				tokenWithInfo,
				{ namespace: c.owner, project: c.project },
				c.number,
				this.getCollectionApiOptions(session, c.owner),
			);
			if (issue == null) return undefined;

			const shape = toIssueShape(issue, this, { projection: 'batch' });
			if (shape == null) {
				throw new Error(`Azure DevOps returned work item ${c.number} without a URL or change date`);
			}

			return shape;
		});
	}

	/**
	 * One request per target, settled independently so one target's failure rejects only its own slot; converted
	 * like the repo-scoped list rows — not through {@link fromAzureProviderPullRequest}, which only the
	 * account-wide searches use.
	 */
	protected override async getProviderPullRequestsBatch(
		session: ProviderAuthenticationSession,
		coordinates: readonly { owner: string; repo: string; number: number; project?: string }[],
		options: { currentAccount?: { id: string; username?: string } } | undefined,
		_cancellation?: AbortSignal,
	): Promise<PromiseSettledResult<PullRequestShape | undefined>[] | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);
		const viewerFor = this.getOrganizationViewers(session, options?.currentAccount);

		return mapSettledBounded(coordinates, providerFanOutConcurrency, async c => {
			const pr = await api.getPullRequestForRepo(
				tokenWithInfo,
				{ namespace: c.owner, name: c.repo, project: c.project },
				c.number,
				{ ...this.getCollectionApiOptions(session, c.owner), includeRemoteInfo: true },
			);
			if (pr == null) return undefined;

			return fromProviderPullRequest(pr, this, { currentAccount: await viewerFor(c.owner), projection: 'batch' });
		});
	}

	/**
	 * The cheap check behind the batch issue read's etags: one request per organization, project and
	 * {@link azureWorkItemsEtagFieldsMaxIds} distinct ids, where {@link getProviderIssuesBatch} sends one per target,
	 * asking only for each work item's change state. A request that throws rejects only its own targets' slots, with
	 * its error classified as the full read's would be.
	 *
	 * Never proves an absence. Azure silently leaves out every id it can't return, whether missing, hidden or failing,
	 * so such a target's slot is rejected and the full read, whose not-found does prove an absence, decides. So is a
	 * work item in another project, which the full read fails. When no target was answered and nothing failed, the
	 * check declines instead, so a batch of only such ids costs a full read, not a failure.
	 *
	 * A work item has no reactions, and its full row no count, so `'reactions'` reads nothing and costs nothing.
	 */
	protected override async getProviderIssuesEtagFields(
		session: ProviderAuthenticationSession,
		coordinates: readonly { owner: string; repo: string; number: number; project?: string }[],
		_options: { etagIncludes?: readonly IssueEtagInclude[] },
		_cancellation?: AbortSignal,
	): Promise<PromiseSettledResult<IssueEtagFields | undefined>[] | undefined> {
		const slots = new Array<PromiseSettledResult<IssueEtagFields | undefined>>(coordinates.length);
		let answered = false;
		let failed = false;

		// Each organization and project's distinct ids, with the targets asking for each.
		const byProject = new Map<string, { owner: string; project: string; ids: Map<number, number[]> }>();
		for (const [index, c] of coordinates.entries()) {
			if (c.project == null) {
				// Required as the full read requires it, so a check never answers for a target the full read refuses.
				slots[index] = {
					status: 'rejected',
					reason: new Error(`Azure DevOps needs a project to read work item ${c.number}`),
				};
				failed = true;
				continue;
			}

			const key = JSON.stringify([c.owner, c.project]);
			let group = byProject.get(key);
			if (group == null) {
				group = { owner: c.owner, project: c.project, ids: new Map() };
				byProject.set(key, group);
			}

			let indices = group.ids.get(c.number);
			if (indices == null) {
				indices = [];
				group.ids.set(c.number, indices);
			}
			indices.push(index);
		}

		const requests = [...byProject.values()].flatMap(group =>
			chunk([...group.ids], azureWorkItemsEtagFieldsMaxIds).map(entries => ({ ...group, entries: entries })),
		);
		if (!requests.length) return slots;

		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);
		const answers = await mapSettledBounded(requests, providerFanOutConcurrency, r =>
			api.getAzureWorkItemsEtagFields(
				tokenWithInfo,
				{ namespace: r.owner, project: r.project },
				r.entries.map(([id]) => id),
				this.getCollectionApiOptions(session, r.owner),
			),
		);

		for (const [i, answer] of answers.entries()) {
			const { project, entries } = requests[i];
			if (answer.status === 'rejected') {
				failed = true;
				for (const [, indices] of entries) {
					for (const index of indices) {
						slots[index] = answer;
					}
				}
				continue;
			}

			// By id, never by position: Azure leaves out the ids it can't return.
			const workItems = new Map<unknown, AzureWorkItemResponse>();
			for (const workItem of answer.value) {
				workItems.set(workItem.id, workItem);
			}

			for (const [id, indices] of entries) {
				const workItem = workItems.get(id);
				let slot: PromiseSettledResult<IssueEtagFields | undefined>;
				if (workItem == null) {
					slot = { status: 'rejected', reason: new Error(`Azure DevOps did not return work item ${id}`) };
				} else {
					try {
						slot = { status: 'fulfilled', value: toAzureWorkItemEtagFields(workItem, project) };
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

	/**
	 * The cheap check behind the batch pull request read's etags: still one request per target, as Azure DevOps has
	 * no read of several pull requests by id, but only the one {@link getProviderPullRequestsBatch} sends first —
	 * not the repository read provider-apis adds to it for clone URLs, once per pull request. Settled per target,
	 * with absence proven by the same not-found rule as the full read.
	 *
	 * Azure DevOps reports no update time, so a full row's `updatedDate` is its close time, else its creation time,
	 * and moves only when it closes. Its etag therefore adds a `revision` of the fields that change without it —
	 * title, description, target branch, and every reviewer and their vote — read off the same response at no extra
	 * cost. It sees a pull request's state, draft flag, head commit and those fields, and, when included, its
	 * mergeability and its required reviewers' review decision; never a comment or a label, which its full row
	 * doesn't carry either. A full row carries no check rollup, so the `checks` include adds nothing and costs nothing.
	 */
	protected override async getProviderPullRequestsEtagFields(
		session: ProviderAuthenticationSession,
		coordinates: readonly { owner: string; repo: string; number: number; project?: string }[],
		options: { etagIncludes?: readonly PullRequestEtagInclude[] },
		_cancellation?: AbortSignal,
	): Promise<PromiseSettledResult<PullRequestEtagFields | undefined>[] | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);
		const etagIncludes = options.etagIncludes ?? [];

		return mapSettledBounded(coordinates, providerFanOutConcurrency, async c => {
			// Required as provider-apis requires it for the full read.
			if (c.project == null) throw new Error(`Azure DevOps needs a project to read pull request ${c.number}`);

			const pr = await api.getAzurePullRequest(
				tokenWithInfo,
				{ namespace: c.owner, project: c.project, name: c.repo },
				c.number,
				this.getCollectionApiOptions(session, c.owner),
			);
			return pr != null ? toAzurePullRequestEtagFields(pr, etagIncludes) : undefined;
		});
	}

	/**
	 * Two steps, because provider-apis has no source-branch filter: a direct Azure read finds each branch's matching
	 * pull request ids, one request per target, then {@link getProviderPullRequestsBatch} resolves them — so a row is
	 * the one `getPullRequestsBatch` returns for that pull request, `url` and `authoredByMe` included.
	 *
	 * Serves only a branch in the base repository: an Azure DevOps fork shares its organization and is identified
	 * by repository, so `headOwner` can't name one — the manager read refuses one that names a different owner.
	 */
	protected override async getProviderPullRequestsForBranches(
		session: ProviderAuthenticationSession,
		targets: readonly { owner: string; repo: string; project?: string; branch: string; headOwner?: string }[],
		options: { currentAccount?: { id: string; username?: string }; limit: number },
		cancellation?: AbortSignal,
	): Promise<PromiseSettledResult<{ pullRequests: PullRequestShape[]; truncated: boolean }>[] | undefined> {
		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);

		const found = await mapSettledBounded(targets, providerFanOutConcurrency, async t => {
			if (t.project == null || t.headOwner != null) {
				throw new Error(`Azure DevOps needs a project and no head owner to find ${t.branch}'s pull requests`);
			}

			// One past the cap, since Azure reports no total to tell a full page from a truncated one.
			const rows = await api.getAzurePullRequestsForBranch(
				tokenWithInfo,
				{ namespace: t.owner, project: t.project, name: t.repo },
				t.branch,
				options.limit + 1,
				this.getCollectionApiOptions(session, t.owner),
			);
			if (rows == null) return { numbers: [], truncated: false };

			const ref = `refs/heads/${t.branch}`;
			const { values, truncated } = selectBranchPullRequests(rows, {
				matchesHead: pr => pr.sourceRefName === ref && pr.forkSource == null,
				// Azure reports no update time; this is the one the batch read's rows carry.
				updatedAt: pr => Date.parse(pr.closedDate || pr.creationDate),
				map: pr => pr.pullRequestId,
				limit: options.limit,
				more: rows.length > options.limit,
			});
			return { numbers: values, truncated: truncated };
		});
		return resolveBranchPullRequests(targets, found, coordinates =>
			this.getProviderPullRequestsBatch(
				session,
				coordinates,
				{ currentAccount: options.currentAccount },
				cancellation,
			),
		);
	}

	protected override async getProviderPullRequest(
		session: ProviderAuthenticationSession,
		resource: AzureRepositoryDescriptor,
		id: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.azure)?.getPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			resource.owner,
			resource.project ?? resource.name,
			id,
			{ baseUrl: getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), resource) },
		);
	}

	protected override getProviderPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return getAzurePullRequestIdentityFromMaybeUrl(search, this.id);
	}

	public override async getRepoInfo(repo: {
		owner: string;
		name: string;
		project?: string;
		virtualDirectory?: string;
		connectionId?: string;
	}): Promise<ProviderRepository | undefined> {
		const identity = getAzureRepositoryIdentity(repo);
		if (identity.projectName == null) return undefined;

		const api = await this.getProvidersApi();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSessionOrThrow(repo.connectionId, undefined);
		if (session == null) return undefined;

		const { tokenWithInfo, options } = this.getApiOptions(session);
		return api.getRepo(tokenWithInfo, identity.resourceName, identity.repositoryName, identity.projectName, {
			...options,
			baseUrl: getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo),
		});
	}

	protected override async getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: AzureRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.authenticationService.apis.azure)?.getRepositoryMetadata(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{ baseUrl: getAzureRepositoryApiBaseUrl(this.apiBaseUrlFor(session), repo) },
			cancellation,
		);
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: AzureRepositoryDescriptor[],
		_cancellation?: AbortSignal,
		options?: SearchMyPullRequestsOptions,
	): Promise<PullRequest[] | undefined> {
		if (repos != null) {
			// TODO: implement repos version
			return undefined;
		}

		// Legacy array-returning path (Launchpad/focus view): the account-wide read, mapped to the normalized model.
		// Its metadata (partial/failures) isn't surfaced here because this path's return type has no warning channel.
		const result = await this.getProviderMyPullRequestsForUser(session, {
			state: options?.state != null ? [options.state] : undefined,
		});
		if (result == null) return undefined;

		// Both served from the discovery caches the read above just filled.
		const projects = (
			await this.getProviderProjectsForResources(session, (await this.getProviderResourcesForUser(session)) ?? [])
		).values;
		if (projects.length === 0) return undefined;

		const repoDescriptors = [
			...((await this.getRepoDescriptorsForProjects(session, projects)) ?? new Map()).values(),
		]
			.filter(r => r != null)
			.flat();
		return result.values.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects, 'search'));
	}

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string; filters?: PullRequestFilter[] },
	): Promise<ProviderApiPagedResult<ProviderPullRequest> | undefined> {
		const api = await this.getProvidersApi();
		const user = await this.getProviderCurrentAccount(session);
		// Azure routes authorLogin/assigneeLogins to `searchCriteria.creatorId`/`reviewerId`, which require the
		// identity GUID, not the display name — matching the repo-scoped path in gitHostIntegration.ts. Using
		// `username` here would match nothing and return zero PRs. The GUID is resolved per organization below
		// (see `getFilterUserId`); this only checks there is a user at all.
		if (user?.id == null) return undefined;

		// Azure PRs are org + project scoped: enumerate the user's orgs and their projects, then read authored
		// and assigned PRs across all of them. Return the raw provider shape (not the normalized model) so the
		// ProviderBackend surface stays uniform with the other providers.
		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		// Structured per-scope failures from BOTH project discovery (a whole org dropped) and the per-project PR
		// drains, so the facade warns on the failed scope + sets `fetchFailed` instead of silently narrowing.
		const failures: CollectionScopeFailure[] = [];
		const projects = await this.getProviderProjectsForResources(session, orgs, false, failures);
		if (projects.values.length === 0) {
			// Project discovery itself was incomplete (e.g. a truncated org); surface the metadata so the facade
			// can warn and set fetchFailed rather than reporting an empty account.
			const incomplete = projects.metadata != null && projects.metadata.completeness !== 'complete';
			return {
				values: [],
				paging: { cursor: '{}', more: false, truncated: incomplete || undefined },
				...(projects.metadata != null ? { metadata: projects.metadata } : {}),
			};
		}

		const { tokenWithInfo } = this.getApiOptions(session);
		const states = toProviderPullRequestStates(options?.state);
		const maxPagesPerProject = 20;

		// Drain each project fully (numbered pages) for both the authored and assigned reads. Azure has no
		// single cross-project cursor, so the aggregate is one page; `truncated` is set only if a project hit
		// the backstop with more pages remaining.
		let truncated = projects.metadata != null && projects.metadata.completeness !== 'complete';
		// Drain one project's numbered pages, returning its PRs and any per-page failure. Returns per-project
		// (not mutating shared state) so the fan-out below can be settled independently: one project's read
		// failure must not discard every other project's already-drained PRs.
		const drainProject = async (
			project: { namespace: string; project: string },
			scope: CollectionScope,
			filter: {
				authorLogin?: string;
				assigneeLogins?: string[];
				reviewerId?: string;
				states?: GitPullRequestState[];
			},
		): Promise<{ prs: ProviderPullRequest[]; projectIdentity: string; failure?: CollectionScopeFailure }> => {
			const collected: ProviderPullRequest[] = [];
			const projectIdentity = `${project.namespace}/${project.project}`;
			let page: number | undefined;
			for (let i = 0; i < maxPagesPerProject; i++) {
				try {
					const result = await api.getPullRequestsForAzureProject(tokenWithInfo, project, {
						// Addressed below the project's own collection, applied once even when the configured address
						// already names it (the request appends the collection as `namespace`).
						...this.getCollectionApiOptions(session, project.namespace),
						// A reviewer read narrows the states itself (see `toAzureReviewerReads`).
						states: states,
						...filter,
						page: page,
					});
					if (result == null) {
						if (page == null) break;

						truncated = true;
						return {
							prs: collected,
							projectIdentity: projectIdentity,
							failure: toCollectionScopeFailure(
								scope,
								new Error('Azure DevOps returned no page after advertising a continuation'),
							),
						};
					}

					collected.push(...result.data);
					if (!result.hasMore) break;
					if (result.nextPage == null || result.nextPage === page) {
						truncated = true;
						return {
							prs: collected,
							projectIdentity: projectIdentity,
							failure: toCollectionScopeFailure(
								scope,
								new Error('Azure DevOps returned no advancing pull request continuation'),
							),
						};
					}

					page = result.nextPage;
					if (i === maxPagesPerProject - 1) {
						truncated = true;
					}
				} catch (ex) {
					// A page failure after the first page leaves the already-drained prefix intact; record the
					// failure at the project scope instead of re-throwing and discarding the prefix.
					truncated = true;
					return {
						prs: collected,
						projectIdentity: projectIdentity,
						failure: toCollectionScopeFailure(scope, ex),
					};
				}
			}
			return { prs: collected, projectIdentity: projectIdentity };
		};

		// Settle per-project failures instead of rejecting the whole sweep. `drainProject` already catches its own
		// page-level failures, so the structured failure (attributed to that project) is preserved rather than
		// re-thrown — re-throwing an auth/rate-limit rejection would discard every other project's already-drained
		// PRs. Auth/rate-limit stay actionable through the failure's kind (the facade maps it to an `auth`/`rate-limit`
		// warning + `fetchFailed`), matching the SDK's model. `failures` was declared above so project-discovery
		// failures and per-project drain failures share it.
		const requested = options?.filters?.length ? new Set(options.filters) : undefined;
		const wantAuthored = requested == null || requested.has(PullRequestFilter.Author);
		// Azure has no assignee concept distinct from reviewer. Both neutral relationships map to reviewerId.
		const wantReviewed =
			requested == null ||
			requested.has(PullRequestFilter.Assignee) ||
			requested.has(PullRequestFilter.ReviewRequested);
		const userIds = new Map<string, string | undefined>();
		const identityFailures = new Map<string, unknown>();
		for (const org of uniqueAzureNames(projects.values.map(p => p.resourceName))) {
			try {
				userIds.set(org.toLowerCase(), await this.getFilterUserId(session, org));
			} catch (ex) {
				throwIfCallerContractError(ex);
				if (ex instanceof AuthenticationError) throw ex;

				identityFailures.set(org.toLowerCase(), ex);
			}
		}
		const groups = wantReviewed
			? await this.getReviewerGroupsByOrganization(session, projects.values, userIds, failures)
			: undefined;
		if (groups?.incomplete) {
			truncated = true;
		}
		const outcomes = await Promise.all(
			projects.values.flatMap(p => {
				const project = { namespace: p.resourceName, project: p.name };
				const scope = { providerId: this.id, resourceId: p.resourceId, projectId: p.name };
				const userId = userIds.get(p.resourceName.toLowerCase());
				if (userId == null) {
					failures.push(
						toCollectionScopeFailure(
							scope,
							identityFailures.get(p.resourceName.toLowerCase()) ??
								new Error('The current user could not be resolved here'),
						),
					);
					truncated = true;
					return [];
				}

				const drains = [];
				if (wantAuthored) {
					drains.push(drainProject(project, scope, { authorLogin: userId }));
				}
				if (wantReviewed) {
					const groupIds = groups?.byOrganization.get(p.resourceName.toLowerCase()) ?? new Set<string>();
					for (const { filter, keep } of toAzureReviewerReads(userId, groupIds, states)) {
						drains.push(
							drainProject(project, scope, filter).then(o =>
								keep != null ? { ...o, prs: o.prs.filter(keep) } : o,
							),
						);
					}
				}
				return drains;
			}),
		);

		// Azure's `pullRequestId` is not account-global. Prefer repository + PR id, then the org-qualified URL.
		// If neither is available, preserve the row instead of collapsing unrelated repositories by numeric id.
		const prsByIdentity = new Map<string, ProviderPullRequest>();
		for (const outcome of outcomes) {
			if (outcome.failure != null) {
				failures.push(outcome.failure);
			}
			for (const pr of outcome.prs) {
				const key =
					getProviderPullRequestIdentity(pr) ?? `project:${outcome.projectIdentity}:pull-request:${pr.id}`;
				if (!prsByIdentity.has(key)) {
					prsByIdentity.set(key, pr);
				}
			}
		}

		const metadata: CollectionMetadata | undefined = mergeCollectionMetadata(
			failures.length > 0 ? { completeness: 'partial', failures: failures } : undefined,
			projects.metadata,
		);

		const groupIds = groups?.groupIds ?? new Set<string>();
		return {
			values: Array.from(prsByIdentity.values(), pr => markMyGroupReviews(pr, groupIds)),
			paging: { cursor: '{}', more: false, truncated: truncated || undefined },
			metadata: metadata,
		};
	}

	/**
	 * Per organization (keyed by its lowercased name), every group the user is in (see {@link getReviewerGroupIds}),
	 * and their union. An organization whose groups can't be read gets none and is recorded in `failures`, with the
	 * read reported `incomplete`: what only its groups review is missing, while what names the user is still read.
	 * Organizations whose user could not be resolved are left out; the read already reports them.
	 */
	private async getReviewerGroupsByOrganization(
		session: ProviderAuthenticationSession,
		projects: readonly AzureProjectDescriptor[],
		userIds: ReadonlyMap<string, string | undefined>,
		failures: CollectionScopeFailure[],
	): Promise<{ byOrganization: Map<string, Set<string>>; groupIds: Set<string>; incomplete: boolean }> {
		const byOrganization = new Map<string, Set<string>>();
		const groupIds = new Set<string>();
		let incomplete = false;
		await Promise.all(
			uniqueAzureNames(projects.map(p => p.resourceName)).map(async org => {
				const userId = userIds.get(org.toLowerCase());
				if (userId == null) return;

				try {
					const ids = await this.getReviewerGroupIds(session, org, userId);
					byOrganization.set(org.toLowerCase(), ids);
					for (const id of ids) {
						groupIds.add(id);
					}
				} catch (ex) {
					const resourceId = projects.find(p => sameAzureName(p.resourceName, org))!.resourceId;
					failures.push(toCollectionScopeFailure({ providerId: this.id, resourceId: resourceId }, ex));
					incomplete = true;
				}
			}),
		);

		return { byOrganization: byOrganization, groupIds: groupIds, incomplete: incomplete };
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: AzureRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchPullRequestsOptions,
	): Promise<PullRequest[] | undefined> {
		if (cancellation?.aborted) throw new CancellationError();

		const orgs = await this.getProviderResourcesForUser(session);
		if (cancellation?.aborted) throw new CancellationError();
		if (orgs == null || orgs.length === 0) return undefined;

		// `getProviderProjectsForResources` returns a collection result ({ values, metadata }); this search
		// path only needs the resolved projects, so read `.values`.
		const projects = (await this.getProviderProjectsForResources(session, orgs)).values;
		if (cancellation?.aborted) throw new CancellationError();
		if (projects.length === 0) return undefined;

		const repoDescriptorsByProject = await this.getRepoDescriptorsForProjects(session, projects);
		if (cancellation?.aborted) throw new CancellationError();

		const repoDescriptors = [...repoDescriptorsByProject.values()].filter(r => r != null).flat();
		const requestedRepos = repos?.map(getAzureRepositoryIdentity);
		const repoInputs =
			requestedRepos == null
				? undefined
				: repoDescriptors.filter(r =>
						requestedRepos.some(
							repo =>
								repo.resourceName === r.resourceName &&
								repo.repositoryName === r.name &&
								(repo.projectName == null || repo.projectName === r.projectName),
						),
					);
		if (repoInputs?.length === 0) return [];

		const api = await this.getProvidersApi();
		const { tokenWithInfo } = this.getApiOptions(session);
		const states = toProviderPullRequestStates(options?.include);
		const searchScopes: { project: { namespace: string; project: string }; repo?: ProviderRepoInput }[] =
			repoInputs != null
				? repoInputs.flatMap(repo =>
						repo.projectName == null
							? []
							: [
									{
										project: { namespace: repo.resourceName, project: repo.projectName },
										repo: {
											id: repo.id,
											name: repo.name,
											namespace: repo.resourceName,
											project: repo.projectName,
										},
									},
								],
					)
				: projects.map(project => ({
						project: { namespace: project.resourceName, project: project.name },
					}));

		const providerPullRequests = flatSettledResultsOrThrow(
			await mapSettledBounded(searchScopes, providerFanOutConcurrency, async scope => {
				const values: ProviderPullRequest[] = [];
				let page: number | undefined;
				for (let i = 0; i < 20; i++) {
					if (cancellation?.aborted) throw new CancellationError();

					const result = await api.getPullRequestsForAzureProject(tokenWithInfo, scope.project, {
						...this.getCollectionApiOptions(session, scope.project.namespace),
						page: page,
						repo: scope.repo,
						states: states,
					});
					if (result == null) break;

					values.push(...result.data);
					if (!result.hasMore || result.nextPage == null) break;

					page = result.nextPage;
				}
				return values;
			}),
		);
		if (cancellation?.aborted) throw new CancellationError();

		return [...new Map(providerPullRequests.map(pr => [pr.url ?? `${pr.repository.id}:${pr.id}`, pr])).values()]
			.filter(pr => providerPullRequestMatchesSearch(pr, searchQuery))
			.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects, 'text-search'));
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		repos?: AzureRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		return (await this.searchProviderMyIssuesWithTruncation(session, repos))?.values;
	}

	/**
	 * Account-wide "my issues" for Azure = the user's authored + assigned work items across every project of
	 * every org. Azure's issue read is numbered-page, so each (project × filter) read is drained to exhaustion
	 * (bounded by a defensive per-read backstop). Unlike a silent `flatSettled`, a project read that was
	 * truncated by the backstop or rejected outright is recorded as `truncated`, so the facade reports an
	 * incomplete read instead of publishing a partial list as complete.
	 *
	 * `searchOptions.org`/`.project` narrow the fan-out server-side (each drain is already a per-project read,
	 * so scoping just selects which projects to drain). Without this there was no way to ask for "work items in
	 * project P": a consumer had to filter the account-wide page client-side, which desynchronizes the filtered
	 * `items` from the `hasMore`/`currentPage` of the pre-filter read — a project-less page reads as "no issues"
	 * while `hasMore` is still true.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		_resources?: ResourceDescriptor[],
		_cancellation?: AbortSignal,
		searchOptions?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		const api = await this.getProvidersApi();

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const allOrgs = await this.getProviderResourcesForUser(session);
		if (allOrgs == null) return undefined;
		if (allOrgs.length === 0) return { values: [], truncated: false };

		// Scope by org first so project discovery only fans out over the requested account. An org filter that
		// matches nothing is an empty-but-successful read, not an unsupported one: returning `undefined` here
		// would be reported as "account-wide issue search is not supported by this provider".
		const orgs =
			searchOptions?.org != null ? allOrgs.filter(o => azureResourceMatches(o, searchOptions.org!)) : allOrgs;
		if (orgs.length === 0) return { values: [], truncated: false };

		// Structured per-scope failures from BOTH project discovery (a whole org dropped) and the per-project
		// issue drains, so the facade warns on the failed scope + sets `fetchFailed` instead of narrowing silently.
		const failures: CollectionScopeFailure[] = [];
		const discovered = await this.getProviderProjectsForResources(session, orgs, false, failures);
		const projects =
			searchOptions?.project != null
				? {
						...discovered,
						values: discovered.values.filter(p => azureResourceMatches(p, searchOptions.project!)),
					}
				: discovered;
		if (projects.values.length === 0) {
			// An explicitly-scoped read that found no matching project is an empty SUCCESS: `undefined` here is
			// reported as "account-wide issue search is not supported by this provider", which would send the
			// consumer down a repo-scoped fallback for what is simply an empty scope. Only an incomplete discovery
			// (which may itself have dropped the requested project) is truncated, and its metadata is forwarded so
			// the facade still warns on the failed scope.
			return projects.metadata != null
				? {
						values: [],
						truncated: projects.metadata.completeness !== 'complete',
						metadata: projects.metadata,
					}
				: { values: [], truncated: false };
		}

		const { tokenWithInfo } = this.getApiOptions(session);

		// Drain one (project × filter) read fully, threading the provider's paging cursor. The scope is passed so
		// a page-level failure preserves the already-drained prefix and records a structured failure instead of
		// re-throwing.
		const drain = async (
			p: AzureProjectDescriptor,
			filter: { assigneeLogins?: string[]; authorLogin?: string },
		): Promise<{
			issues: IssueShape[];
			projectKey: string;
			truncated: boolean;
			metadata?: CollectionMetadata;
		}> => {
			const result = await collectProviderPagedResult(
				cursor =>
					api.getIssuesForAzureProject(tokenWithInfo, p.resourceName, p.name, {
						...this.getCollectionApiOptions(session, p.resourceName),
						...filter,
						cursor: cursor,
						sort: searchOptions?.sort,
					}),
				20,
				{ providerId: this.id, resourceId: p.resourceId, projectId: p.name },
			);
			return {
				issues: result.values.map(i => fromProviderIssue(i, this, { project: p, projection: 'account' })),
				// Azure work-item ids are organization-scoped. Include both org and project so the
				// assigned/authored passes dedupe the same item without collapsing another org's item.
				projectKey: `${p.resourceId}:${p.id}`,
				truncated: result.truncated ?? false,
				metadata: result.metadata,
			};
		};

		// `includeAllAssignees` broadens to every issue in each project (any assignee, any author), so a single
		// unfiltered drain per project replaces the assigned+authored pair — an unfiltered assignee drain already
		// subsumes the authored one.
		//
		// `filters` narrows the other way: unfiltered, "my issues" here is assigned ∪ authored, which is wider than
		// `assignee:@me`. Selecting the drains is the only correct place to narrow — dropping authored-only items
		// from the returned page would leave them counted in the per-project paging that produced it.
		const filters = searchOptions?.filters;
		const wantAssigned = !filters?.length || filters.includes(IssueFilter.Assignee);
		const wantAuthored = !filters?.length || filters.includes(IssueFilter.Author);
		const outcomes = await Promise.all(
			projects.values.flatMap(p => {
				if (searchOptions?.includeAllAssignees) return [drain(p, {})];

				const drains = [];
				if (wantAssigned) {
					drains.push(drain(p, { assigneeLogins: [user.username!] }));
				}
				if (wantAuthored) {
					drains.push(drain(p, { authorLogin: user.username! }));
				}
				return drains;
			}),
		);

		const issuesById = new Map<string, IssueShape>();
		let truncated = projects.metadata != null && projects.metadata.completeness !== 'complete';
		let drainMetadata: CollectionMetadata | undefined;
		for (const outcome of outcomes) {
			if (outcome.truncated) {
				truncated = true;
			}
			if (outcome.metadata != null) {
				drainMetadata = mergeCollectionMetadata(drainMetadata, outcome.metadata);
			}

			for (const issue of outcome.issues) {
				const key = `${outcome.projectKey}:${issue.nodeId ?? issue.id}`;
				if (!issuesById.has(key)) {
					issuesById.set(key, issue);
				}
			}
		}

		const metadata: CollectionMetadata | undefined = mergeCollectionMetadata(
			failures.length > 0 ? { completeness: 'partial', failures: failures } : undefined,
			mergeCollectionMetadata(drainMetadata, projects.metadata),
		);

		return { values: [...issuesById.values()], truncated: truncated, metadata: metadata };
	}

	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const discoveryKey = this.discoveryKey(this._session);

		const canHydrateStoredProjects = (metadata: CollectionMetadata | undefined): boolean =>
			metadata == null || metadata.completeness === 'complete';

		const storedAccount = this.ctx.storage.get(`azure:${discoveryKey}:account`);
		const storedOrganizations = this.ctx.storage.get(`azure:${discoveryKey}:organizations`);
		const storedProjects = this.ctx.storage.get(`azure:${discoveryKey}:projects`);
		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;

		let organizations = storedOrganizations?.data?.map((o: AzureOrganizationDescriptor) => ({ ...o }));

		const storedProjectsData = storedProjects?.data as
			| ProviderApiCollectionResult<AzureProjectDescriptor>
			| AzureProjectDescriptor[]
			| undefined;
		let projects: ProviderApiCollectionResult<AzureProjectDescriptor> | undefined;
		if (!Array.isArray(storedProjectsData) && Array.isArray(storedProjectsData?.values)) {
			const hydrated = {
				values: storedProjectsData.values.map((p: AzureProjectDescriptor) => ({ ...p })),
				...(storedProjectsData.metadata != null ? { metadata: storedProjectsData.metadata } : {}),
			};
			if (canHydrateStoredProjects(hydrated.metadata)) {
				projects = hydrated;
			}
		}

		if (storedAccount == null) {
			account = await this.getProviderCurrentAccount(this._session);
			if (account != null) {
				// Clear all other stored organizations and projects and accounts when our session changes
				await this.ctx.storage.deleteWithPrefix('azure');
				await this.ctx.storage.store(`azure:${discoveryKey}:account`, {
					v: 1,
					timestamp: Date.now(),
					data: {
						id: account.id,
						name: account.name,
						email: account.email,
						avatarUrl: account.avatarUrl,
						username: account.username,
					},
				});
			}
		}

		this._accounts ??= new Map<string, Account | undefined>();
		this._accounts.set(discoveryKey, account);

		if (storedOrganizations == null) {
			organizations = await this.getProviderResourcesForUser(this._session, true);
			await this.ctx.storage.store(`azure:${discoveryKey}:organizations`, {
				v: 1,
				timestamp: Date.now(),
				data: organizations,
			});
		}

		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		this._organizations.set(discoveryKey, organizations);

		if (projects == null && organizations?.length) {
			projects = await this.getProviderProjectsForResources(this._session, organizations);
			if (projects != null && canHydrateStoredProjects(projects.metadata)) {
				await this.ctx.storage.store(`azure:${discoveryKey}:projects`, {
					v: 2,
					timestamp: Date.now(),
					data: projects,
				});
			} else {
				await this.ctx.storage.delete(`azure:${discoveryKey}:projects`);
			}
		}

		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();
		if (projects != null && canHydrateStoredProjects(projects.metadata)) {
			for (const project of projects.values) {
				const projectKey = `${discoveryKey}:${project.resourceId}`;
				const projects = this._projects.get(projectKey);
				if (projects == null) {
					this._projects.set(projectKey, [project]);
				} else if (!projects.some(p => p.id === project.id)) {
					projects.push(project);
				}
			}
		}
	}

	protected override providerOnDisconnect(): void {
		this._organizations = undefined;
		this._projects = undefined;
		this._accounts = undefined;
		this._reviewerGroupIds.clear();
	}

	protected fromAzureProviderPullRequest(
		azurePullRequest: ProviderPullRequest,
		repoDescriptors: AzureRemoteRepositoryDescriptor[],
		projectDescriptors: AzureProjectDescriptor[],
		projection: PullRequestProjection,
	): PullRequest {
		const baseRepoDescriptor = repoDescriptors.find(r => r.id === azurePullRequest.repository.id);
		const headRepoDescriptor =
			azurePullRequest.headRepository != null
				? repoDescriptors.find(r => r.id === azurePullRequest.headRepository!.id)
				: undefined;
		let project: AzureProjectDescriptor | undefined;
		if (baseRepoDescriptor != null) {
			azurePullRequest.repository.remoteInfo = {
				...azurePullRequest.repository.remoteInfo,
				cloneUrlHTTPS: baseRepoDescriptor.cloneUrlHttps ?? '',
				cloneUrlSSH: baseRepoDescriptor.cloneUrlSsh ?? '',
			};
		}

		if (headRepoDescriptor != null) {
			azurePullRequest.headRepository = {
				...azurePullRequest.headRepository,
				id: azurePullRequest.headRepository?.id ?? headRepoDescriptor.id,
				name: azurePullRequest.headRepository?.name ?? headRepoDescriptor.name,
				owner: {
					login: azurePullRequest.headRepository?.owner.login ?? headRepoDescriptor.resourceName,
				},
				remoteInfo: {
					...azurePullRequest.headRepository?.remoteInfo,
					cloneUrlHTTPS: headRepoDescriptor.cloneUrlHttps ?? '',
					cloneUrlSSH: headRepoDescriptor.cloneUrlSsh ?? '',
				},
			};
		}

		if (baseRepoDescriptor?.projectName != null) {
			project = projectDescriptors.find(
				p => p.resourceName === baseRepoDescriptor.resourceName && p.name === baseRepoDescriptor.projectName,
			);
		}
		return fromProviderPullRequest(azurePullRequest, this, { project: project, projection: projection });
	}
}

const cloudMetadata = providersMetadata[GitCloudHostIntegrationId.AzureDevOps];
const cloudAuthProvider = Object.freeze({ id: cloudMetadata.id, scopes: cloudMetadata.scopes });

export class AzureDevOpsIntegration extends AzureDevOpsIntegrationBase<GitCloudHostIntegrationId.AzureDevOps> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = cloudAuthProvider;
	readonly id = GitCloudHostIntegrationId.AzureDevOps;
	protected readonly key = this.id;
	readonly name: string = 'Azure DevOps';
	get domain(): string {
		return cloudMetadata.domain;
	}
	protected override apiBaseUrlFor(_session: ProviderAuthenticationSession): string {
		return 'https://dev.azure.com';
	}
}
