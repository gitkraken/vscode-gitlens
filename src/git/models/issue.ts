import type { IssueOrPullRequest, IssueOrPullRequestState } from './issueOrPullRequest';
import type { ProviderReference } from './remoteProvider';
import type { RepositoryIdentityDescriptor } from './repositoryIdentities';

export function isIssue(issue: unknown): issue is Issue {
	return issue instanceof Issue;
}

export interface IssueShape extends IssueOrPullRequest {
	author: IssueMember;
	assignees: IssueMember[];
	repository?: IssueRepository;
	labels?: IssueLabel[];
	body?: string;
	project?: IssueProject;
}

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
		public readonly author: IssueMember,
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
