import type { CancellationToken, EventEmitter } from 'vscode';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../constants.integrations.js';
import type { Sources } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author.js';
import type { DefaultBranch } from '../../../git/models/defaultBranch.js';
import type { Issue, IssueShape } from '../../../git/models/issue.js';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest.js';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest.js';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '../../../git/models/resourceDescriptor.js';
import type { PullRequestUrlIdentity } from '../../../git/utils/pullRequest.utils.js';
import { debug } from '../../../system/decorators/log.js';
import { ensurePaidPlan } from '../../gk/utils/-webview/plus.utils.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { GitHubIntegrationIds } from './github/github.utils.js';
import { getGitHubPullRequestIdentityFromMaybeUrl } from './github/github.utils.js';
import { providersMetadata } from './models.js';
import type { ProvidersApi } from './providersApi.js';

const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
const authProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: metadata.id,
	scopes: metadata.scopes,
});

const enterpriseMetadata = providersMetadata[GitSelfManagedHostIntegrationId.GitHubEnterprise];
const enterpriseAuthProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: enterpriseMetadata.id,
	scopes: enterpriseMetadata.scopes,
});
const cloudEnterpriseMetadata = providersMetadata[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise];
const cloudEnterpriseAuthProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: cloudEnterpriseMetadata.id,
	scopes: cloudEnterpriseMetadata.scopes,
});

export type GitHubRepositoryDescriptor = RepositoryDescriptor;

abstract class GitHubIntegrationBase<ID extends GitHubIntegrationIds> extends GitHostIntegration<
	ID,
	GitHubRepositoryDescriptor
> {
	protected abstract get apiBaseUrl(): string;

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		return (await this.container.github)?.getAccountForCommit(
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
		repo: GitHubRepositoryDescriptor,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.container.github)?.getAccountForEmail(
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
		repo: GitHubRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return (await this.container.github)?.getDefaultBranch(
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
		repo: GitHubRepositoryDescriptor,
		{ id }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.github)?.getIssueOrPullRequest(
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
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		return (await this.container.github)?.getIssue(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
				includeBody: true,
			},
		);
	}

	protected override async getProviderPullRequest(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.github)?.getPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			parseInt(id, 10),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const { include, ...opts } = options ?? {};

		const toGitHubPullRequestState = (await import(/* webpackChunkName: "integrations" */ './github/models.js'))
			.toGitHubPullRequestState;
		return (await this.container.github)?.getPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
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
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.github)?.getPullRequestForCommit(
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

	protected override async getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.container.github)?.getRepositoryMetadata(
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

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<PullRequest[] | undefined> {
		return (await this.container.github)?.searchMyPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				silent: silent,
			},
			cancellation,
		);
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<IssueShape[] | undefined> {
		return (await this.container.github)?.searchMyIssues(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				includeBody: true,
			},
			cancellation,
		);
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined> {
		return (await this.container.github)?.searchPullRequests(
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
		const id = pr.nodeId;
		const headRefSha = pr.refs?.head?.sha;
		if (id == null || headRefSha == null) return false;
		return (
			(await this.container.github)?.mergePullRequest(this, toTokenWithInfo(this.id, session), id, headRefSha, {
				mergeMethod: options?.mergeMethod,
				baseUrl: this.apiBaseUrl,
			}) ?? false
		);
	}

	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
		options?: { avatarSize?: number },
	): Promise<Account | undefined> {
		return (await this.container.github)?.getCurrentAccount(this, toTokenWithInfo(this.id, session), {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override getProviderPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return getGitHubPullRequestIdentityFromMaybeUrl(search, this.id);
	}
}

export class GitHubIntegration extends GitHubIntegrationBase<GitCloudHostIntegrationId.GitHub> {
	readonly authProvider = authProvider;
	readonly id = GitCloudHostIntegrationId.GitHub;
	protected readonly key = this.id;
	readonly name: string = 'GitHub';
	get domain(): string {
		return metadata.domain;
	}

	protected override get apiBaseUrl(): string {
		return 'https://api.github.com';
	}

	override access(): Promise<boolean> {
		// Always allow GitHub cloud integration access
		return Promise.resolve(true);
	}

	// This is a special case for GitHub because we use VSCode's GitHub session, and it can be disconnected
	// outside of the extension.
	override async refresh(): Promise<void> {
		const authProvider = await this.authenticationService.get(this.authProvider.id);
		const session = await authProvider.getSession(this.authProviderDescriptor);
		if (session == null && this.maybeConnected) {
			void this.disconnect({ silent: true });
		} else {
			if (session?.accessToken !== this._session?.accessToken) {
				this._session = undefined;
			}
			super.refresh();
		}
	}
}

export class GitHubEnterpriseIntegration extends GitHubIntegrationBase<
	GitSelfManagedHostIntegrationId.GitHubEnterprise | GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
> {
	readonly authProvider;
	protected readonly key;
	readonly name = 'GitHub Enterprise';
	get domain(): string {
		return this._domain;
	}

	protected override get apiBaseUrl(): string {
		return `https://${this._domain}/api/v3`;
	}

	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: EventEmitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
		readonly id:
			| GitSelfManagedHostIntegrationId.GitHubEnterprise
			| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	) {
		super(container, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}` as const;
		this.authProvider =
			this.id === GitSelfManagedHostIntegrationId.GitHubEnterprise
				? enterpriseAuthProvider
				: cloudEnterpriseAuthProvider;
	}

	@debug()
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
