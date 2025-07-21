import type { AuthenticationSession, CancellationToken, EventEmitter } from 'vscode';
import { GitSelfManagedHostIntegrationId } from '../../../constants.integrations';
import type { Container } from '../../../container';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService';
import type { IntegrationConnectionChangeEvent } from '../integrationService';
import { GitHostIntegration } from '../models/gitHostIntegration';
import type { IntegrationKey } from '../models/integration';
import type { AzureRepositoryDescriptor } from './azure/models';
import { providersMetadata } from './models';
import type { ProvidersApi } from './providersApi';

const serverMetadata = providersMetadata[GitSelfManagedHostIntegrationId.AzureDevOpsServer];
const serverAuthProvider = Object.freeze({ id: serverMetadata.id, scopes: serverMetadata.scopes });

export class AzureDevOpsServerIntegration extends GitHostIntegration<
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	AzureRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = serverAuthProvider;
	readonly id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	protected readonly key: IntegrationKey<GitSelfManagedHostIntegrationId.AzureDevOpsServer>;
	readonly name: string = 'Azure DevOps Server';

	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: EventEmitter<IntegrationConnectionChangeEvent>,
		readonly domain: string,
	) {
		super(container, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}`;
	}

	protected get apiBaseUrl(): string {
		const protocol = this._session?.protocol ?? 'https:';
		return `${protocol}//${this.domain}`;
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount({
		accessToken,
	}: AuthenticationSession): Promise<Account | undefined> {
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const azure = await this.container.azure;
			const user = azure ? await azure.getCurrentUser(this, accessToken, this.apiBaseUrl) : undefined;
			this._accounts.set(
				accessToken,
				user
					? {
							provider: this,
							id: user.id,
							name: user.name ?? undefined,
							email: user.email ?? undefined,
							avatarUrl: user.avatarUrl ?? undefined,
							username: user.username ?? undefined,
						}
					: undefined,
			);
		}

		return this._accounts.get(accessToken);
	}

	protected override async mergeProviderPullRequest(
		{ accessToken: _accessToken }: AuthenticationSession,
		_pr: PullRequest,
		_options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		return Promise.resolve(false);
	}

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<UnidentifiedAuthor | undefined> {
		return (await this.container.azure)?.getAccountForCommit(
			this,
			accessToken,
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
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		id: string,
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.azure)?.getIssueOrPullRequest(this, accessToken, repo.owner, repo.name, id, {
			baseUrl: this.apiBaseUrl,
			type: type,
		});
	}

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_project: any,
		_id: string,
	): Promise<any> {
		// TODO: Implement Azure DevOps Server issue retrieval
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForBranch(this, accessToken, repo.owner, repo.name, branch, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		repo: AzureRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.azure)?.getPullRequestForCommit(
			this,
			accessToken,
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyPullRequests(
		_session: AuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<PullRequest[] | undefined> {
		// TODO: Implement Azure DevOps Server pull request search
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		// TODO: Implement Azure DevOps Server issue search
		return Promise.resolve(undefined);
	}
}
