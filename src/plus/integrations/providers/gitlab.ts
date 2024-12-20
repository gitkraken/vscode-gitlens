import type { AuthenticationSession, CancellationToken } from 'vscode';
import { window } from 'vscode';
import { HostingIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import type { Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { Issue, IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	SearchedPullRequest,
} from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { log } from '../../../system/decorators/log';
import { uniqueBy } from '../../../system/iterable';
import { ensurePaidPlan } from '../../utils';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationService,
} from '../authentication/integrationAuthentication';
import type { RepositoryDescriptor } from '../integration';
import { HostingIntegration } from '../integration';
import { fromGitLabMergeRequestProvidersApi } from './gitlab/models';
import type { ProviderPullRequest } from './models';
import { ProviderPullRequestReviewState, providersMetadata, toSearchedIssue } from './models';
import type { ProvidersApi } from './providersApi';

const metadata = providersMetadata[HostingIntegrationId.GitLab];
const authProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: metadata.id,
	scopes: metadata.scopes,
});

const enterpriseMetadata = providersMetadata[SelfHostedIntegrationId.GitLabSelfHosted];
const enterpriseAuthProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: enterpriseMetadata.id,
	scopes: enterpriseMetadata.scopes,
});

export type GitLabRepositoryDescriptor = RepositoryDescriptor;

abstract class GitLabIntegrationBase<
	ID extends HostingIntegrationId.GitLab | SelfHostedIntegrationId.GitLabSelfHosted,
> extends HostingIntegration<ID, GitLabRepositoryDescriptor> {
	protected abstract get apiBaseUrl(): string;

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.container.gitlab)?.getAccountForCommit(this, accessToken, repo.owner, repo.name, ref, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderAccountForEmail(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.container.gitlab)?.getAccountForEmail(this, accessToken, repo.owner, repo.name, email, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderDefaultBranch(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return (await this.container.gitlab)?.getDefaultBranch(this, accessToken, repo.owner, repo.name, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.gitlab)?.getIssueOrPullRequest(
			this,
			accessToken,
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderIssue(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		const api = await this.container.gitlab;
		const providerApi = await this.getProvidersApi();

		if (!api || !repo || !id) {
			return undefined;
		}

		const repoId = await api.getProjectId(this, accessToken, repo.owner, repo.name, this.apiBaseUrl, undefined);
		if (!repoId) {
			return undefined;
		}

		const apiResult = await providerApi.getIssue(
			this.id,
			{ namespace: repo.owner, name: repo.name, number: id },
			{ accessToken: accessToken },
		);
		const issue = apiResult != null ? toSearchedIssue(apiResult, this)?.issue : undefined;
		return issue != null ? { ...issue, type: 'issue' } : undefined;
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const { include, ...opts } = options ?? {};

		const toGitLabMergeRequestState = (await import(/* webpackChunkName: "integrations" */ './gitlab/models'))
			.toGitLabMergeRequestState;
		return (await this.container.gitlab)?.getPullRequestForBranch(
			this,
			accessToken,
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
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		ref: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.gitlab)?.getPullRequestForCommit(this, accessToken, repo.owner, repo.name, ref, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderRepositoryMetadata(
		{ accessToken }: AuthenticationSession,
		repo: GitLabRepositoryDescriptor,
		cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.container.gitlab)?.getRepositoryMetadata(
			this,
			accessToken,
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
	}

	protected override async searchProviderMyPullRequests(
		{ accessToken }: AuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
	): Promise<SearchedPullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		const username = (await this.getCurrentAccount())?.username;
		if (!username) {
			return Promise.resolve([]);
		}
		const apiResult = await api.getPullRequestsForUser(this.id, username, {
			accessToken: accessToken,
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

		const toQueryResult = (pr: ProviderPullRequest, reason?: string): SearchedPullRequest => {
			return {
				pullRequest: fromGitLabMergeRequestProvidersApi(pr, this),
				reasons: reason ? [reason] : [],
			};
		};

		function uniqueWithReasons<T extends { reasons: string[] }>(items: T[], lookup: (item: T) => unknown): T[] {
			return [
				...uniqueBy(items, lookup, (original, current) => {
					if (current.reasons.length !== 0) {
						original.reasons.push(...current.reasons);
					}
					return original;
				}),
			];
		}

		const results: SearchedPullRequest[] = uniqueWithReasons(
			[
				...prs.flatMap(pr => {
					const result: SearchedPullRequest[] = [];
					if (pr.assignees?.some(a => a.username === username)) {
						result.push(toQueryResult(pr, 'assigned'));
					}

					if (
						pr.reviews?.some(
							review =>
								review.reviewer?.username === username ||
								review.state === ProviderPullRequestReviewState.ReviewRequested,
						)
					) {
						result.push(toQueryResult(pr, 'review-requested'));
					}

					if (pr.author?.username === username) {
						result.push(toQueryResult(pr, 'authored'));
					}

					// It seems like GitLab doesn't give us mentioned PRs.
					// if (???) {
					// 	return toQueryResult(pr, 'mentioned');
					// }

					return result;
				}),
			],
			r => r.pullRequest.url,
		);

		return results;
	}

	protected override async searchProviderMyIssues(
		{ accessToken }: AuthenticationSession,
		repos?: GitLabRepositoryDescriptor[],
	): Promise<SearchedIssue[] | undefined> {
		const api = await this.container.gitlab;
		const providerApi = await this.getProvidersApi();

		if (!api || !repos) {
			return undefined;
		}

		const repoIdsResult = await Promise.allSettled(
			repos.map(
				(r: GitLabRepositoryDescriptor): Promise<string | undefined> =>
					api.getProjectId(this, accessToken, r.owner, r.name, this.apiBaseUrl, undefined),
			) ?? [],
		);
		const repoInput = repoIdsResult
			.map(result => (result.status === 'fulfilled' ? result.value : undefined))
			.filter((r): r is string => r != null);
		const apiResult = await providerApi.getIssuesForRepos(this.id, repoInput, {
			accessToken: accessToken,
		});

		return apiResult.values
			.map(issue => toSearchedIssue(issue, this))
			.filter((result): result is SearchedIssue => result != null);
	}

	protected override async mergeProviderPullRequest(
		_session: AuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		if (!this.isPullRequest(pr)) return false;
		const api = await this.getProvidersApi();
		try {
			const res = await api.mergePullRequest(this.id, pr, options);
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
		const confirm = 'Reauthenticate';
		const result = await window.showErrorMessage(
			`${ex.message}. Would you like to try reauthenticating to provide additional access? Your token needs to have the 'api' scope to perform merge.`,
			confirm,
		);

		if (result === confirm) {
			await this.reauthenticate();
		}
	}

	private isPullRequest(pr: PullRequest | { id: string; headRefSha: string }): pr is PullRequest {
		return (pr as PullRequest).refs != null;
	}

	protected override async getProviderCurrentAccount({
		accessToken,
	}: AuthenticationSession): Promise<Account | undefined> {
		const api = await this.getProvidersApi();
		const currentUser = await api.getCurrentUser(this.id, { accessToken: accessToken });
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
}

export class GitLabIntegration extends GitLabIntegrationBase<HostingIntegrationId.GitLab> {
	readonly authProvider = authProvider;
	readonly id = HostingIntegrationId.GitLab;
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

export class GitLabSelfHostedIntegration extends GitLabIntegrationBase<SelfHostedIntegrationId.GitLabSelfHosted> {
	readonly authProvider = enterpriseAuthProvider;
	readonly id = SelfHostedIntegrationId.GitLabSelfHosted;
	protected readonly key = `${this.id}:${this.domain}` as const;
	readonly name = 'GitLab Self-Hosted';
	get domain(): string {
		return this._domain;
	}
	protected override get apiBaseUrl(): string {
		return `https://${this._domain}/api`;
	}

	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		private readonly _domain: string,
	) {
		super(container, authenticationService, getProvidersApi);
	}

	@log()
	override async connect(source: Sources): Promise<boolean> {
		if (
			!(await ensurePaidPlan(this.container, `Rich integration with ${this.name} is a Pro feature.`, {
				source: 'integrations',
				detail: { action: 'connect', integration: this.id },
			}))
		) {
			return false;
		}

		return super.connect(source);
	}
}
