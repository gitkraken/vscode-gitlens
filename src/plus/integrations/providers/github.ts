import type { AuthenticationSession } from 'vscode';
import type { Container } from '../../../container';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { log } from '../../../system/decorators/log';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import { ProviderId, providersMetadata } from './models';
import type { SupportedProviderIds } from './providerIntegration';
import { ensurePaidPlan, ProviderIntegration } from './providerIntegration';
import type { ProvidersApi } from './providersApi';

const metadata = providersMetadata[ProviderId.GitHub];
const enterpriseMetadata = providersMetadata[ProviderId.GitHubEnterprise];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });
const enterpriseAuthProvider = Object.freeze({
	id: enterpriseMetadata.id,
	scopes: enterpriseMetadata.scopes,
});

export type GitHubRepositoryDescriptor =
	| {
			owner: string;
			name: string;
	  }
	| Record<string, never>;

export class GitHubIntegration extends ProviderIntegration<GitHubRepositoryDescriptor> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id: SupportedProviderIds = ProviderId.GitHub;
	readonly name: string = 'GitHub';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.github.com';
	}

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.container.github)?.getAccountForCommit(this, accessToken, repo.owner, repo.name, ref, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderAccountForEmail(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.container.github)?.getAccountForEmail(this, accessToken, repo.owner, repo.name, email, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderDefaultBranch(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return (await this.container.github)?.getDefaultBranch(this, accessToken, repo.owner, repo.name, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.github)?.getIssueOrPullRequest(
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

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const { include, ...opts } = options ?? {};

		const toGitHubPullRequestState = (await import(/* webpackChunkName: "github" */ '../../github/models'))
			.toGitHubPullRequestState;
		return (await this.container.github)?.getPullRequestForBranch(
			this,
			accessToken,
			repo.owner,
			repo.name,
			branch,
			{
				...opts,
				include: include?.map(s => toGitHubPullRequestState(s)),
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		ref: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.github)?.getPullRequestForCommit(this, accessToken, repo.owner, repo.name, ref, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderRepositoryMetadata(
		{ accessToken }: AuthenticationSession,
		repo: GitHubRepositoryDescriptor,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.container.github)?.getRepositoryMetadata(this, accessToken, repo.owner, repo.name, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyPullRequests(
		{ accessToken }: AuthenticationSession,
		repo?: GitHubRepositoryDescriptor,
	): Promise<SearchedPullRequest[] | undefined> {
		return (await this.container.github)?.searchMyPullRequests(this, accessToken, {
			repos: repo != null ? [`${repo.owner}/${repo.name}`] : undefined,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyIssues(
		{ accessToken }: AuthenticationSession,
		repo?: GitHubRepositoryDescriptor,
	): Promise<SearchedIssue[] | undefined> {
		return (await this.container.github)?.searchMyIssues(this, accessToken, {
			repos: repo != null ? [`${repo.owner}/${repo.name}`] : undefined,
			baseUrl: this.apiBaseUrl,
		});
	}
}

export class GitHubEnterpriseIntegration extends GitHubIntegration {
	override readonly authProvider = enterpriseAuthProvider;
	override readonly id = ProviderId.GitHubEnterprise;
	override readonly name = 'GitHub Enterprise';
	override get domain(): string {
		return this._domain;
	}
	protected override get apiBaseUrl(): string {
		return `https://${this._domain}/api/v3`;
	}
	protected override get key(): `${SupportedProviderIds}:${string}` {
		return `${this.id}:${this.domain}`;
	}

	constructor(
		container: Container,
		override readonly api: ProvidersApi,
		private readonly _domain: string,
	) {
		super(container, api);
	}

	@log()
	override async connect(): Promise<boolean> {
		if (!(await ensurePaidPlan('GitHub Enterprise instance', this.container))) {
			return false;
		}

		return super.connect();
	}
}
