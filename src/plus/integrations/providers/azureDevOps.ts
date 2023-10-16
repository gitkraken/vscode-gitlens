import type { AuthenticationSession } from 'vscode';
import type { PagedResult } from '../../../git/gitProvider';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { Logger } from '../../../system/logger';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import type { ProviderRepository } from './models';
import { ProviderId, providersMetadata } from './models';
import type { RepositoryDescriptor, SupportedProviderIds } from './providerIntegration';
import { ProviderIntegration } from './providerIntegration';

const metadata = providersMetadata[ProviderId.AzureDevOps];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

interface AzureRepositoryDescriptor extends RepositoryDescriptor {
	owner: string;
	name: string;
}

export class AzureDevOpsIntegration extends ProviderIntegration<AzureRepositoryDescriptor> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id: SupportedProviderIds = ProviderId.AzureDevOps;
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
		_repo?: AzureRepositoryDescriptor,
	): Promise<SearchedPullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repo?: AzureRepositoryDescriptor,
	): Promise<SearchedIssue[] | undefined> {
		return Promise.resolve(undefined);
	}
}
