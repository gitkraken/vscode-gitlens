import type { IssueMilestone, IssueOrPullRequest } from '../models/issueOrPullRequest.js';

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

/** Keeps `null` (none) apart from `undefined` (not read). */
export function serializeMilestone(value: IssueMilestone | null | undefined): IssueMilestone | null | undefined {
	if (value == null) return value;

	return {
		id: value.id,
		title: value.title,
		state: value.state,
		...(value.dueDate != null ? { dueDate: value.dueDate } : {}),
		...(value.url != null ? { url: value.url } : {}),
	};
}
