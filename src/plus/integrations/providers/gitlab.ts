import type { AuthenticationSession } from 'vscode';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import { ProviderId, providersMetadata } from './models';
import type { RepositoryDescriptor, SupportedProviderIds } from './providerIntegration';
import { ProviderIntegration } from './providerIntegration';

const metadata = providersMetadata[ProviderId.GitLab];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

interface GitLabRepositoryDescriptor extends RepositoryDescriptor {
	owner: string;
	name: string;
}

export class GitLabIntegration extends ProviderIntegration<GitLabRepositoryDescriptor> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id: SupportedProviderIds = ProviderId.GitLab;
	readonly name: string = 'GitLab';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://gitlab.com/api/v4';
	}

	// TODO: implement
	protected override async getProviderAccountForCommit(
		_session: AuthenticationSession,
		_repo: GitLabRepositoryDescriptor,
		_ref: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderAccountForEmail(
		_session: AuthenticationSession,
		_repo: GitLabRepositoryDescriptor,
		_email: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderDefaultBranch(
		_session: AuthenticationSession,
		_repo: GitLabRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderIssueOrPullRequest(
		_session: AuthenticationSession,
		_repo: GitLabRepositoryDescriptor,
		_id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		_session: AuthenticationSession,
		_repo: GitLabRepositoryDescriptor,
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
		_repo: GitLabRepositoryDescriptor,
		_ref: string,
	): Promise<PullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: GitLabRepositoryDescriptor,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyPullRequests(
		_session: AuthenticationSession,
		_repo?: GitLabRepositoryDescriptor,
	): Promise<SearchedPullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repo?: GitLabRepositoryDescriptor,
	): Promise<SearchedIssue[] | undefined> {
		return Promise.resolve(undefined);
	}
}
