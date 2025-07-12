import type { Issue, IssueRepositoryIdentityDescriptor, IssueShape } from '../models/issue';

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
						resourceName: value.project.resourceName,
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
