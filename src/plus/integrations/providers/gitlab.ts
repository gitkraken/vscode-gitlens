import type { AuthenticationSession, CancellationToken } from 'vscode';
import type { Container } from '../../../container';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	SearchedPullRequest,
} from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { log } from '../../../system/decorators/log';
import { ensurePaidPlan } from '../../utils';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationService,
} from '../authentication/integrationAuthentication';
import type { SupportedIntegrationIds } from '../integration';
import { HostingIntegration } from '../integration';
import { HostingIntegrationId, providersMetadata, SelfHostedIntegrationId } from './models';
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

export type GitLabRepositoryDescriptor = {
	key: string;
	owner: string;
	name: string;
};

abstract class GitLabIntegrationBase<ID extends SupportedIntegrationIds> extends HostingIntegration<
	ID,
	GitLabRepositoryDescriptor
> {
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

	protected override searchProviderMyPullRequests(
		_session: AuthenticationSession,
		_repo?: GitLabRepositoryDescriptor[],
	): Promise<SearchedPullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: GitLabRepositoryDescriptor[],
	): Promise<SearchedIssue[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async mergeProviderPullRequest(
		_session: AuthenticationSession,
		_pr: PullRequest | { id: string; headRefSha: string },
		_options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		return Promise.resolve(false);
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
	override async connect(): Promise<boolean> {
		if (
			!(await ensurePaidPlan(this.container, `Rich integration with ${this.name} is a Pro feature.`, {
				source: 'integrations',
				detail: { action: 'connect', integration: this.id },
			}))
		) {
			return false;
		}

		return super.connect();
	}
}
