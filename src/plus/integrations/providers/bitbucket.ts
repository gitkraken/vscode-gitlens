import type { AuthenticationSession, CancellationToken } from 'vscode';
import { HostingIntegrationId } from '../../../constants.integrations';
import type { Account } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
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
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.bitbucket)?.getIssueOrPullRequest(this, accessToken, repo.owner, repo.name, id, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_id: string,
	): Promise<Issue | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.bitbucket)?.getPullRequestForBranch(
			this,
			accessToken,
			repo.owner,
			repo.name,
			branch,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
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
	): Promise<PullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: BitbucketRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		return Promise.resolve(undefined);
	}
}

const bitbucketCloudDomainRegex = /^bitbucket\.org$/i;
export function isBitbucketCloudDomain(domain: string | undefined): boolean {
	return domain != null && bitbucketCloudDomainRegex.test(domain);
}
