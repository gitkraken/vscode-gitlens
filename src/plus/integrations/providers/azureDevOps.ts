import type { AuthenticationSession } from 'vscode';
import type { PagedResult } from '../../../git/gitProvider';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { Logger } from '../../../system/logger';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import type { RepositoryDescriptor } from '../providerIntegration';
import { ProviderIntegration } from '../providerIntegration';
import type { ProviderRepository } from './models';
import { HostedProviderId, providersMetadata } from './models';

const metadata = providersMetadata[HostedProviderId.AzureDevOps];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

interface AzureRepositoryDescriptor extends RepositoryDescriptor {
	owner: string;
	name: string;
}

export class AzureDevOpsIntegration extends ProviderIntegration<
	HostedProviderId.AzureDevOps,
	AzureRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = HostedProviderId.AzureDevOps;
	protected readonly key = this.id;
	readonly name: string = 'Azure DevOps';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://dev.azure.com';
	}

	async getReposForAzureProject(
		namespace: string,
		project: string,
		options?: { cursor?: string },
	): Promise<PagedResult<ProviderRepository> | undefined> {
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			return await this.api.getReposForAzureProject(namespace, project, { cursor: options?.cursor });
		} catch (ex) {
			Logger.error(ex, 'getReposForAzureProject');
			return undefined;
		}
	}

	// TODO: implement
	protected override async getProviderAccountForCommit(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_ref: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
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
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForCommit(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_ref: string,
	): Promise<PullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyPullRequests(
		_session: AuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<SearchedPullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: AzureRepositoryDescriptor[],
	): Promise<SearchedIssue[] | undefined> {
		return Promise.resolve(undefined);
	}
}
