import type { Account } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Emitter } from '@gitlens/utils/event.js';
import { uniqueBy } from '@gitlens/utils/iterable.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { batch } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { SearchMyPullRequestsOptions } from '../models/gitHostIntegration.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { AccountWideIssuesResult, SearchMyIssuesOptions } from '../models/integration.js';
import type { GitLabIntegrationIds } from './gitlab/gitlab.utils.js';
import { getGitLabPullRequestIdentityFromMaybeUrl, matchesGitLabOrgNamespace } from './gitlab/gitlab.utils.js';
import { fromGitLabMergeRequestProvidersApi } from './gitlab/models.js';
import type {
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepository,
} from './models.js';
import {
	ProviderPullRequestReviewState,
	providersMetadata,
	toIssueShape,
	toProviderPullRequestStates,
} from './models.js';
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

/** How many SSH signing-key lookups (account resolve + keys fetch) to run concurrently, to avoid a request burst. */
const sshSigningKeyResolveBatchSize = 10;

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

	protected override async getProviderSshSigningKeysForEmails(
		session: ProviderAuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		emails: string[],
	): Promise<Map<string, string[]>> {
		const result = new Map<string, string[]>();

		const api = await this.authenticationService.apis.gitlab;
		if (api == null) return result;

		const token = toTokenWithInfo(this.id, session);

		// GitLab resolves users one email at a time (no batch search). Run them in bounded batches rather than firing all
		// (up to providerVerifyLimit) account + key lookups at once, to avoid a request burst that trips rate limiting.
		await batch(emails, sshSigningKeyResolveBatchSize, async email => {
			const account = await this.getProviderAccountForEmail(session, repo, email);
			if (account?.id == null) return;

			const keys = await api.getUserSigningKeys(this, token, account.id, { baseUrl: this.apiBaseUrl });
			result.set(
				email.toLowerCase(),
				keys.map(k => k.key),
			);
		});

		return result;
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

	public override async getRepoInfo(repo: {
		owner: string;
		name: string;
		project?: string;
		connectionId?: string;
	}): Promise<ProviderRepository | undefined> {
		const api = await this.getProvidersApi();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(repo.connectionId, undefined);
		if (session == null) return undefined;

		return api.getRepo(toTokenWithInfo(this.id, session), repo.owner, repo.name, repo.project, {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
		});
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
			values: result.values.map(g => ({ id: g.id, providerId: this.id, name: g.fullPath, url: g.webUrl })),
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

	protected override async getProviderRepositoriesForUser(
		session: ProviderAuthenticationSession,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		// GitLab's membership read is already user-affiliated, so the account-wide walk is the unfiltered
		// version of the per-org read above (which pages the same source and filters by namespace).
		return api.getReposForCurrentUser(toTokenWithInfo(this.id, session), {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
			cursor: options?.cursor,
		});
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
		_cancellation?: AbortSignal,
		_silent?: boolean,
		state?: PullRequestStateFilter,
		_options?: SearchMyPullRequestsOptions,
	): Promise<PullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		// Resolve the username from THIS session's token (multi-account: `session` may be a non-primary
		// connection); `getCurrentAccount()` would use the primary `_session` and filter by the wrong user.
		const username = (await this.getProviderCurrentAccount(session))?.username;
		if (!username) {
			return Promise.resolve([]);
		}

		const apiResult = await api.getPullRequestsForUser(toTokenWithInfo(this.id, session), username, {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
			states: toProviderPullRequestStates(state),
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
							// Match only reviews assigned to the current user; a bare `state === ReviewRequested`
							// check would also match reviews requested from OTHER people, leaking their MRs in.
							review =>
								review.reviewer?.username === username &&
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

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string },
	): Promise<PagedResult<ProviderPullRequest> | undefined> {
		// Resolve the username from THIS session's token (multi-account safe) to scope the account-wide read.
		const username = (await this.getProviderCurrentAccount(session))?.username;
		if (username == null) return undefined;

		const api = await this.getProvidersApi();
		const states = toProviderPullRequestStates(options?.state);
		const result = await api.getPullRequestsForUser(toTokenWithInfo(this.id, session), username, {
			isPAT: this.isEnterprise,
			baseUrl: this.isEnterprise ? `https://${this.domain}` : undefined,
			states: states,
			cursor: options?.cursor,
		});
		if (result == null) return undefined;

		// GitLab's user query returns PRs the user is involved in; keep only those they authored, are
		// assigned to, or are a requested reviewer on, matching the "my pull requests" scope. The SDK's
		// account-wide read (getPullRequestsAssociatedWithUser) also drops the `states` input, so filter by
		// state client-side too (e.g. the closed+merged "done" sweep would otherwise include open MRs).
		const values = result.values.filter(pr => {
			if (states != null && !states.includes(pr.state)) return false;

			const isAssignee = pr.assignees?.some(a => a.username === username);
			const isRequestedReviewer = pr.reviews?.some(
				// Match only reviews assigned to the current user; a bare `state === ReviewRequested`
				// check would also match reviews requested from OTHER people, leaking their MRs in.
				review =>
					review.reviewer?.username === username &&
					review.state === ProviderPullRequestReviewState.ReviewRequested,
			);
			const isAuthor = pr.author?.username === username;
			return isAssignee || isRequestedReviewer || isAuthor;
		});
		return { ...result, values: values };
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

	/**
	 * Account-wide "my issues" for GitLab. GitLab's repo-scoped issue read bails without repos, and GitLab has
	 * no GraphQL cross-project issue field, so this goes through the SDK's REST `GET /issues` read
	 * ({@link ProvidersApi.getIssuesForCurrentUser}). Open issues only (matching GitHub's baked `is:open`).
	 *
	 * Default scope is the current user's assigned issues; `includeAllAssignees` broadens to `scope=all` (every
	 * visible issue, any assignee). The read is numbered-paged, so each page is drained to exhaustion, bounded by
	 * a defensive backstop — a hit backstop is reported as `truncated` so the facade surfaces an incomplete read
	 * rather than publishing a partial list as complete.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		_resources?: GitLabRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<AccountWideIssuesResult | undefined> {
		if (cancellation?.aborted) throw new CancellationError();

		const api = await this.getProvidersApi();

		// Resolve the username from THIS session's token (multi-account safe), matching the PR account-wide read.
		// Only needed to scope the default (assigned-to-me) read; the all-assignees broaden drops it.
		const username = options?.includeAllAssignees
			? undefined
			: (await this.getProviderCurrentAccount(session))?.username;
		if (!options?.includeAllAssignees && username == null) return undefined;
		if (cancellation?.aborted) throw new CancellationError();

		const baseUrl = this.isEnterprise ? `https://${this.domain}` : undefined;
		const maxPages = 20;
		// Dedupe by `url`, not `IssueShape.id`: for GitLab `id` is the per-project `iid`, which collides across
		// projects in an account-wide read (two repos both have issue `#1`), so an id-keyed map would silently
		// drop distinct issues. `url` is globally unique. Matches the GitHub/GitLab account-wide PR reads.
		const issuesByUrl = new Map<string, IssueShape>();
		let truncated = false;
		let cursor: string | undefined;
		for (let page = 1; ; page++) {
			if (cancellation?.aborted) throw new CancellationError();

			const result = await api.getIssuesForCurrentUser(toTokenWithInfo(this.id, session), {
				scope: options?.includeAllAssignees ? 'all' : 'assigned_to_me',
				assigneeUsername: username,
				isPAT: this.isEnterprise,
				baseUrl: baseUrl,
				cursor: cursor,
			});
			if (cancellation?.aborted) throw new CancellationError();

			for (const issue of result.values) {
				const shape = toIssueShape(issue, this);
				if (shape != null && !issuesByUrl.has(shape.url)) {
					issuesByUrl.set(shape.url, shape);
				}
			}

			// A page that couldn't confirm completeness (SDK metadata incompleteness) means the read is already
			// incomplete, independent of the backstop below.
			if (result.paging?.truncated) {
				truncated = true;
			}

			if (!(result.paging?.more ?? false)) {
				break;
			}

			const paging = result.paging;
			const nextCursor = paging?.cursor;
			if (nextCursor == null || nextCursor === '{}' || nextCursor === cursor) {
				truncated = true;
				break;
			}

			if (page >= maxPages) {
				truncated = true;
				break;
			}

			cursor = nextCursor;
		}

		return { values: [...issuesByUrl.values()], truncated: truncated };
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: GitLabRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: { include?: PullRequestState[] },
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
				include: options?.include,
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
