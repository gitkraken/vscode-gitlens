import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { Emitter } from '@gitlens/utils/event.js';
import { uniqueBy } from '@gitlens/utils/iterable.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { GitLabIntegrationIds } from './gitlab/gitlab.utils.js';
import { getGitLabPullRequestIdentityFromMaybeUrl, matchesGitLabOrgNamespace } from './gitlab/gitlab.utils.js';
import { fromGitLabMergeRequestProvidersApi } from './gitlab/models.js';
import type { ProviderHierarchyResult, ProviderOrganization, ProviderRepository } from './models.js';
import { ProviderPullRequestReviewState, providersMetadata, toIssueShape } from './models.js';
import type { ProvidersApi } from './providersApi.js';

const metadata = providersMetadata[GitCloudHostIntegrationId.GitLab];
const authProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: metadata.id,
	scopes: metadata.scopes,
});

const cloudEnterpriseMetadata = providersMetadata[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted];
const cloudEnterpriseAuthProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: cloudEnterpriseMetadata.id,
	scopes: cloudEnterpriseMetadata.scopes,
});

export type GitLabRepositoryDescriptor = RepositoryDescriptor;

abstract class GitLabIntegrationBase<ID extends GitLabIntegrationIds> extends GitHostIntegration<
	ID,
	GitLabRepositoryDescriptor
> {
	protected abstract get apiBaseUrl(): string;

	/** Self-hosted GitLab uses PAT semantics and a domain-based API base; gitlab.com does not. */
	protected get isEnterprise(): boolean {
		return this.id === GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
	}

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderAccountForEmail(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getAccountForEmail(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			email,
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderDefaultBranch(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getDefaultBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		{ id }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getIssueOrPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const api = await this.authenticationService.apis.gitlab;
		const providerApi = await this.getProvidersApi();
		if (!api || !repo || !id) {
			return undefined;
		}

		const repoId = await api.getProjectId(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			this.apiBaseUrl,
			undefined,
		);
		if (!repoId) {
			return undefined;
		}

		const apiResult = await providerApi.getIssue(
			toTokenWithInfo(this.id, session),
			{ namespace: repo.owner, name: repo.name, number: id },
			{
				isPAT: this.isEnterprise,
				baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
			},
		);
		const issue = apiResult != null ? toIssueShape(apiResult, this) : undefined;
		return issue != null ? { ...issue, type: 'issue' } : undefined;
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const { include, ...opts } = options ?? {};

		const toGitLabMergeRequestState = (await import(/* webpackChunkName: "integrations" */ './gitlab/models.js'))
			.toGitLabMergeRequestState;
		return (await this.authenticationService.apis.gitlab)?.getPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			{
				...opts,
				include: include?.map(s => toGitLabMergeRequestState(s)),
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequest(
		session: ProviderAuthenticationSession,
		resource: GitLabRepositoryDescriptor,
		id: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			resource.owner,
			resource.name,
			parseInt(id, 10),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	public override async getRepoInfo(repo: { owner: string; name: string }): Promise<ProviderRepository | undefined> {
		const api = await this.getProvidersApi();
		const tokenOptInfo = this._session ? toTokenWithInfo(this.id, this._session) : { providerId: this.id };
		return api.getRepo(tokenOptInfo, repo.owner, repo.name, undefined);
	}

	protected override async getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.authenticationService.apis.gitlab)?.getRepositoryMetadata(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		const api = await this.getProvidersApi();
		const result = await api.getGitlabGroupsForCurrentUser(toTokenWithInfo(this.id, session), {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
		});
		return {
			values: result.values.map(g => ({ id: g.id, name: g.fullPath, url: g.webUrl })),
			...(result.truncated ? { truncated: true } : {}),
		};
	}

	/**
	 * GitLab has no group-scoped repos endpoint, so each page is a page of the current user's member repos
	 * across all namespaces, filtered to `org` and its subgroups (mirroring gkcli's `gitlabOrgMatches`).
	 * Follow `paging.cursor` to page the full list; repos the user isn't a member of aren't returned.
	 * Because the filter is applied per page, a page can come back with `values: []` while
	 * `paging.more` is still `true` (e.g. a page full of repos outside `org`) — don't treat an empty
	 * page as the end of pagination, only `paging.more`/`collectPagedResults` reaching exhaustion.
	 */
	protected override async getProviderRepositoriesForOrg(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		const result = await api.getReposForCurrentUser(toTokenWithInfo(this.id, session), {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
			cursor: options?.cursor,
		});
		return {
			values: result.values.filter(r => matchesGitLabOrgNamespace(r.namespace, org)),
			...(result.paging != null ? { paging: result.paging } : {}),
		};
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
	): Promise<PullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		const username = (await this.getCurrentAccount())?.username;
		if (!username) {
			return Promise.resolve([]);
		}

		const apiResult = await api.getPullRequestsForUser(toTokenWithInfo(this.id, session), username, {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
		});

		if (apiResult == null) {
			return Promise.resolve([]);
		}

		// now I'm going to filter prs from the result according to the repos parameter
		let prs;
		if (repos != null) {
			const repoMap = new Map<string, GitLabRepositoryDescriptor>();
			for (const repo of repos) {
				repoMap.set(`${repo.owner}/${repo.name}`, repo);
			}
			prs = apiResult.values.filter(pr => {
				const repo = repoMap.get(`${pr.repository.owner.login}/${pr.repository.name}`);
				return repo != null;
			});
		} else {
			prs = apiResult.values;
		}

		const results: IterableIterator<PullRequest> = uniqueBy(
			[
				...prs
					.filter(pr => {
						const isAssignee = pr.assignees?.some(a => a.username === username);
						const isRequestedReviewer = pr.reviews?.some(
							review =>
								review.reviewer?.username === username ||
								review.state === ProviderPullRequestReviewState.ReviewRequested,
						);
						const isAuthor = pr.author?.username === username;
						// It seems like GitLab doesn't give us mentioned PRs.
						// const isMentioned = ???;

						return isAssignee || isRequestedReviewer || isAuthor;
					})
					.map(pr => fromGitLabMergeRequestProvidersApi(pr, this)),
			],
			r => r.url,
			(original, _current) => original,
		);

		return [...results];
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		const api = await this.authenticationService.apis.gitlab;
		const providerApi = await this.getProvidersApi();
		if (!api || !repos) {
			return undefined;
		}

		const repoIdsResult = await Promise.allSettled(
			repos.map(
				(r: GitLabRepositoryDescriptor): Promise<string | undefined> =>
					api.getProjectId(
						this,
						toTokenWithInfo(this.id, session),
						r.owner,
						r.name,
						this.apiBaseUrl,
						undefined,
					),
			) ?? [],
		);
		const repoInput = repoIdsResult
			.map(result => (result.status === 'fulfilled' ? result.value : undefined))
			.filter((r): r is string => r != null);
		const apiResult = await providerApi.getIssuesForRepos(toTokenWithInfo(this.id, session), repoInput, {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
		});

		return apiResult.values
			.map(issue => toIssueShape(issue, this))
			.filter((result): result is IssueShape => result != null);
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: GitLabRepositoryDescriptor[],
		cancellation?: AbortSignal,
	): Promise<PullRequest[] | undefined> {
		const api = await this.authenticationService.apis.gitlab;
		if (!api) {
			return undefined;
		}

		return api.searchPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				search: searchQuery,
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
	}

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		if (!this.isPullRequest(pr)) return false;

		const api = await this.getProvidersApi();
		try {
			const res = await api.mergePullRequest(toTokenWithInfo(this.id, session), pr, {
				...options,
				isPAT: this.isEnterprise,
				baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
			});
			return res;
		} catch (ex) {
			void this.showMergeErrorMessage(ex);
			return false;
		}
	}

	private async showMergeErrorMessage(ex: Error) {
		// Unfortunately, providers-api does not let us know the exact reason for the error,
		// so we show the same message to everything.
		// When we update the library, we can improve the error handling here.
		const reauthenticate = await this.ctx.hooks?.onReauthenticationRequired?.(
			`${ex.message}. Would you like to try reauthenticating to provide additional access? Your token needs to have the 'api' scope to perform merge.`,
		);

		if (reauthenticate) {
			await this.reauthenticate();
		}
	}

	private isPullRequest(pr: PullRequest | { id: string; headRefSha: string }): pr is PullRequest {
		return (pr as PullRequest).refs != null;
	}

	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const currentUser = await api.getCurrentUser(toTokenWithInfo(this.id, session), {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
		});
		if (currentUser == null) return undefined;

		return {
			provider: {
				id: this.id,
				name: this.name,
				domain: this.domain,
				icon: this.icon,
			},
			id: currentUser.id,
			name: currentUser.name || undefined,
			email: currentUser.email || undefined,
			avatarUrl: currentUser.avatarUrl || undefined,
			username: currentUser.username || undefined,
		};
	}

	protected override getProviderPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return getGitLabPullRequestIdentityFromMaybeUrl(search, this.id);
	}
}

export class GitLabIntegration extends GitLabIntegrationBase<GitCloudHostIntegrationId.GitLab> {
	readonly authProvider = authProvider;
	readonly id = GitCloudHostIntegrationId.GitLab;
	protected readonly key = this.id;
	readonly name: string = 'GitLab';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://gitlab.com/api';
	}

	override access(): Promise<boolean> {
		// Always allow GitHub cloud integration access
		return Promise.resolve(true);
	}
}

export class GitLabSelfHostedIntegration extends GitLabIntegrationBase<GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted> {
	readonly authProvider = cloudEnterpriseAuthProvider;
	readonly id = GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
	protected readonly key;
	readonly name = 'GitLab Self-Hosted';
	get domain(): string {
		return this._domain;
	}
	protected override get apiBaseUrl(): string {
		return `https://${this._domain}/api`;
	}

	constructor(
		ctx: IntegrationServiceContext,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
	) {
		super(ctx, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}` as const;
	}
}
