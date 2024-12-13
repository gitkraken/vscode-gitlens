import type { AuthenticationSession, CancellationToken } from 'vscode';
import { HostingIntegrationId } from '../../../constants.integrations';
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
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthentication';
import type { ResourceDescriptor } from '../integration';
import { HostingIntegration } from '../integration';
import { providersMetadata } from './models';

const metadata = providersMetadata[HostingIntegrationId.Bitbucket];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

interface BitbucketRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

export class BitbucketIntegration extends HostingIntegration<
	HostingIntegrationId.Bitbucket,
	BitbucketRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = HostingIntegrationId.Bitbucket;
	protected readonly key = this.id;
	readonly name: string = 'Bitbucket';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.bitbucket.org/2.0';
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

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_id: string,
	): Promise<Issue | undefined> {
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
		_cancellation?: CancellationToken,
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
