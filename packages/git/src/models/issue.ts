import { loggable } from '@gitlens/utils/decorators/log.js';
import type { RequireSome, RequireSomeWithProps } from '@gitlens/utils/types.js';
import type { IssueOrPullRequest, IssueOrPullRequestState } from './issueOrPullRequest.js';
import type { ProviderReference } from './remoteProvider.js';
import type { RepositoryIdentityDescriptor } from './repositoryIdentities.js';

/** Selects which issue states a read should include. `all` covers open + closed. */
export type IssueStateFilter = 'open' | 'closed' | 'all';

export interface IssueShape extends IssueOrPullRequest {
	/** `undefined` when the provider can't resolve the author, e.g. a deleted GitHub account */
	author: IssueMember | undefined;
	assignees: IssueMember[];
	repository?: IssueRepository;
	labels?: IssueLabel[];
	body?: string;
	project?: IssueProject;
}

@loggable(i => i.id)
export class Issue implements IssueShape {
	readonly type = 'issue';

	constructor(
		public readonly provider: ProviderReference,
		public readonly id: string,
		public readonly nodeId: string | undefined,
		public readonly title: string,
		public readonly url: string,
		public readonly createdDate: Date,
		public readonly updatedDate: Date,
		public readonly closed: boolean,
		public readonly state: IssueOrPullRequestState,
		public readonly author: IssueMember | undefined,
		public readonly assignees: IssueMember[],
		public readonly repository?: IssueRepository,
		public readonly closedDate?: Date,
		public readonly labels?: IssueLabel[],
		public readonly commentsCount?: number,
		public readonly thumbsUpCount?: number,
		public readonly body?: string,
		public readonly project?: IssueProject,
		public readonly number?: string,
	) {}

	static is(issue: unknown): issue is Issue {
		return issue instanceof Issue;
	}
}

export const enum RepositoryAccessLevel {
	Admin = 100,
	Maintain = 40,
	Write = 30,
	Triage = 20,
	Read = 10,
	None = 0,
}

export interface IssueLabel {
	color?: string;
	name: string;
}

export interface IssueMember {
	id: string;
	name: string;
	/** The provider's handle for this person, when it has one — GitHub's login, Azure's `uniqueName` (a UPN,
	 *  so an email), Bitbucket's mutable `nickname`. Display/labelling only: it is neither guaranteed present
	 *  (GitLab's native mapper has none) nor a stable identity, so never key a match off it. */
	username?: string;
	avatarUrl?: string;
	url?: string;
}

export interface IssueProject {
	id: string;
	name: string;
	resourceId: string;
	resourceName: string;
}

export interface IssueRepository {
	owner: string;
	repo: string;
	accessLevel?: RepositoryAccessLevel;
	url?: string;
	id?: string;
}

export type IssueRepositoryIdentityDescriptor = RequireSomeWithProps<
	RequireSome<RepositoryIdentityDescriptor<string>, 'provider'>,
	'provider',
	'id' | 'domain' | 'repoDomain' | 'repoName'
> &
	RequireSomeWithProps<RequireSome<RepositoryIdentityDescriptor<string>, 'remote'>, 'remote', 'domain'>;
