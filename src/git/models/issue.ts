import { Uri } from 'vscode';
import { Schemes } from '../../constants';
import type { Container } from '../../container';
import type { RepositoryIdentityDescriptor } from '../../gk/models/repositoryIdentities';
import type { ProviderReference } from './remoteProvider';
import type { Repository } from './repository';

export type IssueOrPullRequestType = 'issue' | 'pullrequest';
export type IssueOrPullRequestState = 'opened' | 'closed' | 'merged';
export enum RepositoryAccessLevel {
	Admin = 100,
	Maintain = 40,
	Write = 30,
	Triage = 20,
	Read = 10,
	None = 0,
}

export interface IssueOrPullRequest {
	readonly type: IssueOrPullRequestType;
	readonly provider: ProviderReference;
	readonly id: string;
	readonly nodeId: string | undefined;
	readonly title: string;
	readonly url: string;
	readonly createdDate: Date;
	readonly updatedDate: Date;
	readonly closedDate?: Date;
	readonly closed: boolean;
	readonly state: IssueOrPullRequestState;
	readonly commentsCount?: number;
	readonly thumbsUpCount?: number;
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

export interface IssueRepository {
	owner: string;
	repo: string;
	accessLevel?: RepositoryAccessLevel;
	url?: string;
}

export interface IssueProject {
	id: string;
	name: string;
	resourceId: string;
}

export interface IssueShape extends IssueOrPullRequest {
	author: IssueMember;
	assignees: IssueMember[];
	repository?: IssueRepository;
	labels?: IssueLabel[];
	body?: string;
	project?: IssueProject;
}

export interface SearchedIssue {
	issue: IssueShape;
	reasons: string[];
}

export function serializeIssueOrPullRequest(value: IssueOrPullRequest): IssueOrPullRequest {
	const serialized: IssueOrPullRequest = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		nodeId: value.nodeId,
		title: value.title,
		url: value.url,
		createdDate: value.createdDate,
		updatedDate: value.updatedDate,
		closedDate: value.closedDate,
		closed: value.closed,
		state: value.state,
	};
	return serialized;
}

export function serializeIssue(value: IssueShape): IssueShape {
	const serialized: IssueShape = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		nodeId: value.nodeId,
		title: value.title,
		url: value.url,
		createdDate: value.createdDate,
		updatedDate: value.updatedDate,
		closedDate: value.closedDate,
		closed: value.closed,
		state: value.state,
		author: {
			id: value.author.id,
			name: value.author.name,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		repository:
			value.repository == null
				? undefined
				: {
						owner: value.repository.owner,
						repo: value.repository.repo,
						url: value.repository.url,
				  },
		project:
			value.project == null
				? undefined
				: {
						id: value.project.id,
						name: value.project.name,
						resourceId: value.project.resourceId,
				  },
		assignees: value.assignees.map(assignee => ({
			id: assignee.id,
			name: assignee.name,
			avatarUrl: assignee.avatarUrl,
			url: assignee.url,
		})),
		labels:
			value.labels == null
				? undefined
				: value.labels.map(label => ({
						color: label.color,
						name: label.name,
				  })),
		commentsCount: value.commentsCount,
		thumbsUpCount: value.thumbsUpCount,
		body: value.body,
	};
	return serialized;
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
	) {}
}

export type IssueRepositoryIdentityDescriptor = RequireSomeWithProps<
	RequireSome<RepositoryIdentityDescriptor<string>, 'provider'>,
	'provider',
	'id' | 'domain' | 'repoDomain' | 'repoName'
> &
	RequireSomeWithProps<RequireSome<RepositoryIdentityDescriptor<string>, 'remote'>, 'remote', 'domain'>;

export function getRepositoryIdentityForIssue(issue: IssueShape | Issue): IssueRepositoryIdentityDescriptor {
	if (issue.repository == null) throw new Error('Missing repository');

	return {
		remote: {
			url: issue.repository.url,
			domain: issue.provider.domain,
		},
		name: `${issue.repository.owner}/${issue.repository.repo}`,
		provider: {
			id: issue.provider.id,
			domain: issue.provider.domain,
			repoDomain: issue.repository.owner,
			repoName: issue.repository.repo,
			repoOwnerDomain: issue.repository.owner,
		},
	};
}

export function getVirtualUriForIssue(issue: IssueShape | Issue): Uri | undefined {
	if (issue.repository == null) throw new Error('Missing repository');
	if (issue.provider.id !== 'github') return undefined;

	const uri = Uri.parse(issue.repository.url ?? issue.url);
	return uri.with({ scheme: Schemes.Virtual, authority: 'github', path: uri.path });
}

export async function getOrOpenIssueRepository(
	container: Container,
	issue: IssueShape | Issue,
	options?: { promptIfNeeded?: boolean; skipVirtual?: boolean },
): Promise<Repository | undefined> {
	const identity = getRepositoryIdentityForIssue(issue);
	let repo = await container.repositoryIdentity.getRepository(identity, {
		openIfNeeded: true,
		keepOpen: false,
		prompt: false,
	});

	if (repo == null && !options?.skipVirtual) {
		const virtualUri = getVirtualUriForIssue(issue);
		if (virtualUri != null) {
			repo = await container.git.getOrOpenRepository(virtualUri, { closeOnOpen: true, detectNested: false });
		}
	}

	if (repo == null && options?.promptIfNeeded) {
		repo = await container.repositoryIdentity.getRepository(identity, {
			openIfNeeded: true,
			keepOpen: false,
			prompt: true,
		});
	}

	return repo;
}
