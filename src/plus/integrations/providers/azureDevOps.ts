import type { AuthenticationSession, CancellationToken } from 'vscode';
import { HostingIntegrationId } from '../../../constants.integrations';
import type { PagedResult } from '../../../git/gitProvider';
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
import { Logger } from '../../../system/logger';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import type { ResourceDescriptor } from '../integration';
import { HostingIntegration } from '../integration';
import type { ProviderRepository } from './models';
import { providersMetadata } from './models';

const metadata = providersMetadata[HostingIntegrationId.AzureDevOps];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

interface AzureRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

export class AzureDevOpsIntegration extends HostingIntegration<
	HostingIntegrationId.AzureDevOps,
	AzureRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = HostingIntegrationId.AzureDevOps;
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
			return await (
				await this.getProvidersApi()
			).getReposForAzureProject(namespace, project, { cursor: options?.cursor });
		} catch (ex) {
			Logger.error(ex, 'getReposForAzureProject');
			return undefined;
		}
	}

	protected override async mergeProviderPullRequest(
		_session: AuthenticationSession,
		_pr: PullRequest,
		_options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		return Promise.resolve(false);
	}

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

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_repo: AzureRepositoryDescriptor,
		_id: string,
	): Promise<Issue | undefined> {
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
		_cancellation?: CancellationToken,
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
