import type { AuthenticationSession } from 'vscode';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../../git/models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import type { RepositoryDescriptor } from '../providerIntegration';
import { ProviderIntegration } from '../providerIntegration';
import { HostedProviderId, providersMetadata } from './models';

const metadata = providersMetadata[HostedProviderId.Bitbucket];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

interface BitbucketRepositoryDescriptor extends RepositoryDescriptor {
	owner: string;
	name: string;
}

export class BitbucketIntegration extends ProviderIntegration<
	HostedProviderId.Bitbucket,
	BitbucketRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = HostedProviderId.Bitbucket;
	protected readonly key = this.id;
	readonly name: string = 'Bitbucket';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.bitbucket.org/2.0';
	}

	// TODO: implement
	protected override async getProviderAccountForCommit(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_ref: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderAccountForEmail(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_email: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderDefaultBranch(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderIssueOrPullRequest(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
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
		_repo: BitbucketRepositoryDescriptor,
		_ref: string,
	): Promise<PullRequest | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyPullRequests(
		_session: AuthenticationSession,
		_repos?: BitbucketRepositoryDescriptor[],
	): Promise<SearchedPullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: BitbucketRepositoryDescriptor[],
	): Promise<SearchedIssue[] | undefined> {
		return Promise.resolve(undefined);
	}
}
