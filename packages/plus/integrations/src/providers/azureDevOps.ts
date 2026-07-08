import type { CollectionMetadata, CollectionScope, CollectionScopeFailure } from '@gitkraken/provider-apis';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { base64 } from '@gitlens/utils/base64.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Emitter } from '@gitlens/utils/event.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type {
	AuthenticationSessionLike as AuthenticationSession,
	ProviderAuthenticationSession,
	TokenWithInfo,
} from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { AccountWideIssuesResult, IntegrationKey } from '../models/integration.js';
import { toCollectionScopeFailure } from '../results.js';
import type {
	AzureOrganizationDescriptor,
	AzureProjectDescriptor,
	AzureProjectInputDescriptor,
	AzureRemoteRepositoryDescriptor,
	AzureRepositoryDescriptor,
} from './azure/models.js';
import type {
	ProviderApiCollectionResult,
	ProviderApiPagedResult,
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderRepository,
} from './models.js';
import {
	fromProviderIssue,
	fromProviderPullRequest,
	providerPullRequestMatchesSearch,
	providersMetadata,
	toProviderPullRequestStates,
} from './models.js';
import type { ProvidersApi } from './providersApi.js';
import { collectProviderPagedResult, flatSettledOrThrow, mergeCollectionMetadata } from './utils/providerPaging.js';

function getAzureRepositoryIdentity(repo: AzureRepositoryDescriptor): {
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

export abstract class AzureDevOpsIntegrationBase<
	TIntegrationId extends GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	TRepositoryDescriptor extends AzureRepositoryDescriptor = AzureRepositoryDescriptor,
> extends GitHostIntegration<TIntegrationId, TRepositoryDescriptor> {
	protected abstract get apiBaseUrl(): string;
	protected getApiOptions(
		session: ProviderAuthenticationSession,
		doNotConvertToPat: boolean = false,
	): {
		tokenWithInfo: TokenWithInfo<TIntegrationId>;
		options: { isPAT: boolean; baseUrl?: string };
	} {
		const usePat = !doNotConvertToPat;
		const accessToken = usePat ? convertTokentoPAT(session.accessToken) : session.accessToken;
		const tokenWithInfo = toTokenWithInfo<TIntegrationId>(this.id, session, accessToken);
		return {
			tokenWithInfo: tokenWithInfo,
			options: { isPAT: usePat },
		};
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const { accessToken } = session;
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const user = await this._requestForCurrentUser(session);
			this._accounts.set(accessToken, user);
		}

		return this._accounts.get(accessToken);
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

	private _organizations: Map<string, AzureOrganizationDescriptor[] | undefined> | undefined;
	private async getProviderResourcesForUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<AzureOrganizationDescriptor[] | undefined> {
		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		const { accessToken } = session;
		const cachedResources = this._organizations.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const account = await this.getProviderCurrentAccount(session);
			if (account?.id == null) return undefined;

			const { tokenWithInfo, options } = this.getApiOptions(session);
			const resources = await api.getAzureResourcesForUser(tokenWithInfo, account.id, options);
			this._organizations.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._organizations.get(accessToken);
	}

	private _projects: Map<string, AzureProjectDescriptor[] | undefined> | undefined;
	/**
	 * Discovers (and caches) each resource's projects. Only resources whose drain completed cleanly are cached;
	 * a rejected or backstop-truncated drain is left uncached (retried next call). When `failures` is supplied,
	 * a rejected resource is recorded there as a structured {@link CollectionScopeFailure} so an account-wide
	 * caller can surface the incomplete project set (a whole org's PRs/issues silently missing otherwise) as a
	 * scope-aware warning + `fetchFailed` rather than an all-pages success over a hole.
	 */
	private async getProviderProjectsForResources(
		session: ProviderAuthenticationSession,
		resources: AzureOrganizationDescriptor[],
		force: boolean = false,
		failures?: CollectionScopeFailure[],
	): Promise<ProviderApiCollectionResult<AzureProjectDescriptor>> {
		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();
		const { accessToken } = session;

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

		const allProjects: AzureProjectDescriptor[] = [];
		let resultMetadata: CollectionMetadata | undefined;

		if (resourcesWithoutProjects.length > 0) {
			const api = await this.getProvidersApi();
			const { tokenWithInfo, options } = this.getApiOptions(session);
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
								...options,
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

				if (result.truncated) {
					// A truncated drain is an incomplete project set; include its partial values in the current
					// result but don't cache it as if complete. Add a structured failure for the truncation unless
					// the drain already recorded a page-level failure for this resource.
					if (
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

				this._projects!.set(`${accessToken}:${resource.id}`, projects);
			});
		}

		const cachedProjects = resources.reduce<AzureProjectDescriptor[]>((projects, resource) => {
			const resourceProjects = this._projects!.get(`${accessToken}:${resource.id}`);
			if (resourceProjects != null) {
				projects.push(...resourceProjects);
			}
			return projects;
		}, []);
		allProjects.push(...cachedProjects);

		return resultMetadata != null ? { values: allProjects, metadata: resultMetadata } : { values: allProjects };
	}

	private async getRepoDescriptorsForProjects(
		session: ProviderAuthenticationSession,
		projects: AzureProjectDescriptor[],
	): Promise<Map<string, AzureRemoteRepositoryDescriptor[] | undefined>> {
		const descriptors = new Map<string, AzureRemoteRepositoryDescriptor[] | undefined>();
		if (projects.length === 0) return descriptors;

		const api = await this.getProvidersApi();
		const { tokenWithInfo, options } = this.getApiOptions(session);
		await Promise.all(
			projects.map(async project => {
				const repos = (
					await api.getReposForAzureProject(tokenWithInfo, project.resourceName, project.name, options)
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
			values: orgs.map(o => ({ id: o.id, name: o.name, url: `${this.apiBaseUrl}/${o.name}` })),
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
		if (orgs == null || orgs.length === 0) return undefined;

		const scopedOrgs = org != null ? orgs.filter(o => o.name === org || o.id === org) : orgs;
		if (scopedOrgs.length === 0) return { values: [] };

		const projects = await this.getProviderProjectsForResources(session, scopedOrgs);
		if (projects.values.length === 0 && projects.metadata == null) return { values: [] };

		return {
			values: projects.values.map(p => ({
				id: p.id,
				name: p.name,
				url: `${this.apiBaseUrl}/${p.resourceName}/${p.name}`,
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
		const { tokenWithInfo, options: apiOptions } = this.getApiOptions(session);

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

		const { tokenWithInfo, options: apiOptions } = this.getApiOptions(session);

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
			this.apiBaseUrl,
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
			{ baseUrl: this.apiBaseUrl },
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
				baseUrl: this.apiBaseUrl,
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
				baseUrl: this.apiBaseUrl,
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
				baseUrl: this.apiBaseUrl,
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
			this.apiBaseUrl,
		);
	}

	public override async getRepoInfo(repo: {
		owner: string;
		name: string;
		project?: string;
		connectionId?: string;
	}): Promise<ProviderRepository | undefined> {
		if (repo.project == null) return undefined;
		if (this.id === GitSelfManagedHostIntegrationId.AzureDevOpsServer) return undefined;

		const api = await this.getProvidersApi();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(repo.connectionId, undefined);
		if (session == null) return undefined;

		const { tokenWithInfo, options } = this.getApiOptions(session);
		return api.getRepo(tokenWithInfo, repo.owner, repo.name, repo.project, options);
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
			{ baseUrl: this.apiBaseUrl },
			cancellation,
		);
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: AzureRepositoryDescriptor[],
		_cancellation?: AbortSignal,
		_silent?: boolean,
		state?: PullRequestStateFilter,
	): Promise<PullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		if (repos != null) {
			// TODO: implement repos version
			return undefined;
		}

		const states = toProviderPullRequestStates(state);

		const user = await this.getProviderCurrentAccount(session);
		// Azure filters key on the identity GUID (account id), not the display name — see
		// getProviderMyPullRequestsForUser and the repo-scoped path in gitHostIntegration.ts.
		if (user?.id == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		const projects = await this.getProviderProjectsForResources(session, orgs);
		if (projects.values.length === 0) return undefined;

		const repoDescriptors = [
			...((await this.getRepoDescriptorsForProjects(session, projects.values)) ?? new Map()).values(),
		]
			.filter(r => r != null)
			.flat();

		const { tokenWithInfo, options } = this.getApiOptions(session);
		const projectInputs = projects.values.map(p => ({ namespace: p.resourceName, project: p.name }));
		// Legacy array-returning path (Launchpad/focus view): unwrap `.values` from the SDK collection result.
		// The metadata (partial/failures) isn't surfaced here because this path's return type has no warning
		// channel; the metadata-aware ProviderBackend surface is getProviderMyPullRequestsForUser above.
		const assignedPrs = (
			await api.getPullRequestsForAzureProjects(tokenWithInfo, projectInputs, {
				...options,
				assigneeLogins: [user.id],
				states: states,
			})
		).values.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects.values));
		const authoredPrs = (
			await api.getPullRequestsForAzureProjects(tokenWithInfo, projectInputs, {
				...options,
				authorLogin: user.id,
				states: states,
			})
		).values.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects.values));
		const prsById = new Map<string, PullRequest>();
		for (const pr of authoredPrs) {
			prsById.set(pr.id, pr);
		}

		for (const pr of assignedPrs) {
			const existing = prsById.get(pr.id);
			if (existing == null) {
				prsById.set(pr.id, pr);
			}
		}

		return [...prsById.values()];
	}

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string },
	): Promise<ProviderApiPagedResult<ProviderPullRequest> | undefined> {
		const api = await this.getProvidersApi();
		const user = await this.getProviderCurrentAccount(session);
		// Azure routes authorLogin/assigneeLogins to `searchCriteria.creatorId`/`reviewerId`, which require the
		// identity GUID (account id), not the display name — matching the repo-scoped path in
		// gitHostIntegration.ts. Using `username` here would match nothing and return zero PRs.
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
			return projects.metadata != null
				? { values: [], paging: { cursor: '{}', more: false }, metadata: projects.metadata }
				: undefined;
		}

		const { tokenWithInfo, options: apiOptions } = this.getApiOptions(session);
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
			filter: { authorLogin?: string; assigneeLogins?: string[] },
		): Promise<{ prs: ProviderPullRequest[]; failure?: CollectionScopeFailure }> => {
			const collected: ProviderPullRequest[] = [];
			let page: number | undefined;
			for (let i = 0; i < maxPagesPerProject; i++) {
				try {
					const result = await api.getPullRequestsForAzureProject(tokenWithInfo, project, {
						...apiOptions,
						...filter,
						states: states,
						page: page,
					});
					if (result == null) break;

					collected.push(...result.data);
					if (!result.hasMore || result.nextPage == null) break;

					page = result.nextPage;
					if (i === maxPagesPerProject - 1) {
						truncated = true;
					}
				} catch (ex) {
					// A page failure after the first page leaves the already-drained prefix intact; record the
					// failure at the project scope instead of re-throwing and discarding the prefix.
					truncated = true;
					return { prs: collected, failure: toCollectionScopeFailure(scope, ex) };
				}
			}
			return { prs: collected };
		};

		// Settle per-project failures instead of rejecting the whole sweep. `drainProject` already catches its own
		// page-level failures, so the structured failure (attributed to that project) is preserved rather than
		// re-thrown — re-throwing an auth/rate-limit rejection would discard every other project's already-drained
		// PRs. Auth/rate-limit stay actionable through the failure's kind (the facade maps it to an `auth`/`rate-limit`
		// warning + `fetchFailed`), matching the SDK's model. `failures` was declared above so project-discovery
		// failures and per-project drain failures share it.
		const outcomes = await Promise.all(
			projects.values.flatMap(p => {
				const project = { namespace: p.resourceName, project: p.name };
				const scope = { providerId: this.id, resourceId: p.resourceId, projectId: p.name };
				return [
					drainProject(project, scope, { authorLogin: user.id }),
					drainProject(project, scope, { assigneeLogins: [user.id] }),
				];
			}),
		);

		// Dedupe by URL, not the numeric `pr.id`: Azure's `pullRequestId` is unique only within an org, and
		// this sweep spans every org the user belongs to, so two orgs can each surface id "42" — keying by id
		// would drop one of them. The normalized `url` is org-qualified and unambiguous.
		const prsByUrl = new Map<string, ProviderPullRequest>();
		for (const outcome of outcomes) {
			if (outcome.failure != null) {
				failures.push(outcome.failure);
			}
			for (const pr of outcome.prs) {
				const key = pr.url ?? pr.id;
				if (!prsByUrl.has(key)) {
					prsByUrl.set(key, pr);
				}
			}
		}

		const metadata: CollectionMetadata | undefined = mergeCollectionMetadata(
			failures.length > 0 ? { completeness: 'partial', failures: failures } : undefined,
			projects.metadata,
		);

		return {
			values: [...prsByUrl.values()],
			paging: { cursor: '{}', more: false, truncated: truncated || undefined },
			metadata: metadata,
		};
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: AzureRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: { include?: PullRequestState[] },
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
		const { tokenWithInfo, options } = this.getApiOptions(session);
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

		const providerPullRequests = await flatSettledOrThrow(
			searchScopes.map(async scope => {
				const values: ProviderPullRequest[] = [];
				let page: number | undefined;
				for (let i = 0; i < 20; i++) {
					if (cancellation?.aborted) throw new CancellationError();

					const result = await api.getPullRequestsForAzureProject(tokenWithInfo, scope.project, {
						...options,
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
			.map(pr => this.fromAzureProviderPullRequest(pr, repoDescriptors, projects));
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
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		_resources?: ResourceDescriptor[],
		_cancellation?: AbortSignal,
	): Promise<AccountWideIssuesResult | undefined> {
		const api = await this.getProvidersApi();

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const orgs = await this.getProviderResourcesForUser(session);
		if (orgs == null || orgs.length === 0) return undefined;

		// Structured per-scope failures from BOTH project discovery (a whole org dropped) and the per-project
		// issue drains, so the facade warns on the failed scope + sets `fetchFailed` instead of narrowing silently.
		const failures: CollectionScopeFailure[] = [];
		const projects = await this.getProviderProjectsForResources(session, orgs, false, failures);
		if (projects.values.length === 0) {
			return projects.metadata != null ? { values: [], truncated: true, metadata: projects.metadata } : undefined;
		}

		const { tokenWithInfo, options } = this.getApiOptions(session);

		// Drain one (project × filter) read fully, threading the provider's paging cursor. The scope is passed so
		// a page-level failure preserves the already-drained prefix and records a structured failure instead of
		// re-throwing.
		const drain = async (
			p: AzureProjectDescriptor,
			filter: { assigneeLogins?: string[]; authorLogin?: string },
		): Promise<{ issues: IssueShape[]; truncated: boolean; metadata?: CollectionMetadata }> => {
			const result = await collectProviderPagedResult(
				cursor =>
					api.getIssuesForAzureProject(tokenWithInfo, p.resourceName, p.name, {
						...options,
						...filter,
						cursor: cursor,
					}),
				20,
				{ providerId: this.id, resourceId: p.resourceId, projectId: p.name },
			);
			return {
				issues: result.values.map(i => fromProviderIssue(i, this as any, { project: p })),
				truncated: result.truncated ?? false,
				metadata: result.metadata,
			};
		};

		const outcomes = await Promise.all(
			projects.values.flatMap(p => {
				return [drain(p, { assigneeLogins: [user.username!] }), drain(p, { authorLogin: user.username! })];
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
				if (!issuesById.has(issue.id)) {
					issuesById.set(issue.id, issue);
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

		const canHydrateStoredProjects = (metadata: CollectionMetadata | undefined): boolean =>
			metadata == null || metadata.completeness === 'complete';

		const storedAccount = this.ctx.storage.get(`azure:${this._session.accessToken}:account`);
		const storedOrganizations = this.ctx.storage.get(`azure:${this._session.accessToken}:organizations`);
		const storedProjects = this.ctx.storage.get(`azure:${this._session.accessToken}:projects`);
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
				await this.ctx.storage.store(`azure:${this._session.accessToken}:account`, {
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
		this._accounts.set(this._session.accessToken, account);

		if (storedOrganizations == null) {
			organizations = await this.getProviderResourcesForUser(this._session, true);
			await this.ctx.storage.store(`azure:${this._session.accessToken}:organizations`, {
				v: 1,
				timestamp: Date.now(),
				data: organizations,
			});
		}

		this._organizations ??= new Map<string, AzureOrganizationDescriptor[] | undefined>();
		this._organizations.set(this._session.accessToken, organizations);

		if (projects == null && organizations?.length) {
			projects = await this.getProviderProjectsForResources(this._session, organizations);
			if (projects != null && canHydrateStoredProjects(projects.metadata)) {
				await this.ctx.storage.store(`azure:${this._session.accessToken}:projects`, {
					v: 2,
					timestamp: Date.now(),
					data: projects,
				});
			} else {
				await this.ctx.storage.delete(`azure:${this._session.accessToken}:projects`);
			}
		}

		this._projects ??= new Map<string, AzureProjectDescriptor[] | undefined>();
		if (projects != null && canHydrateStoredProjects(projects.metadata)) {
			for (const project of projects.values) {
				const projectKey = `${this._session.accessToken}:${project.resourceId}`;
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
	}

	protected fromAzureProviderPullRequest(
		azurePullRequest: ProviderPullRequest,
		repoDescriptors: AzureRemoteRepositoryDescriptor[],
		projectDescriptors: AzureProjectDescriptor[],
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
		return fromProviderPullRequest(azurePullRequest, this, { project: project });
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
	protected override get apiBaseUrl(): string {
		return 'https://dev.azure.com';
	}
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

	protected override get apiBaseUrl(): string {
		const protocol = this._session?.protocol ?? 'https:';
		return `${protocol}//${this.domain}`;
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
			options: { ...options, baseUrl: this.apiBaseUrl },
		};
	}

	protected override async _requestForCurrentUser(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const azure = await this.authenticationService.apis.azure;
		const user = azure
			? await azure.getCurrentUserOnServer(this, toTokenWithInfo(this.id, session), this.apiBaseUrl)
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

export function convertTokentoPAT(accessToken: string): string {
	return base64(`PAT:${accessToken}`);
}
