import type { ProviderAccount, ProviderIssue, ProviderRequestFunction } from './models.js';

const jiraCloudApiUrl = 'https://api.atlassian.com/ex/jira';
const jiraIssueByKeyFields = [
	'assignee',
	'comment',
	'created',
	'creator',
	'description',
	'issuetype',
	'labels',
	'project',
	'status',
	'summary',
	'updated',
	'votes',
];

type JiraIssueMemberResponse = {
	accountId?: string;
	displayName?: string | null;
	emailAddress?: string | null;
	avatarUrls?: Record<string, string | undefined>;
};

type JiraIssueStatusResponse = {
	id: string;
	name: string;
	statusCategory: {
		colorName: string;
		key: string;
		name: string;
	};
};

type JiraIssueByKeyResponse = {
	id: string;
	key: string;
	fields: {
		assignee?: JiraIssueMemberResponse | null;
		comment?: { comments?: unknown[]; total?: number };
		created: string;
		creator?: JiraIssueMemberResponse | null;
		description?: string | null;
		issuetype?: { name?: string | null };
		labels?: string[];
		project?: { id?: string | null; key?: string | null; name?: string | null };
		status: JiraIssueStatusResponse;
		summary: string;
		updated: string;
		votes?: { votes?: number | null };
	};
};

function toAccount(member: JiraIssueMemberResponse | null | undefined): ProviderAccount | null {
	if (member == null) return null;

	return {
		id: member.accountId ?? '',
		name: member.displayName ?? null,
		username: member.displayName ?? null,
		email: member.emailAddress ?? null,
		avatarUrl: member.avatarUrls?.['48x48'] ?? null,
		url: null,
	};
}

function toStatusCategory(key: string): 'TO_DO' | 'IN_PROGRESS' | 'DONE' {
	switch (key.toLowerCase()) {
		case 'new':
			return 'TO_DO';
		case 'indeterminate':
			return 'IN_PROGRESS';
		case 'done':
			return 'DONE';
		default:
			return 'TO_DO';
	}
}

function toIssueWebUrl(resourceUrl: string, key: string): string {
	const url = new URL(resourceUrl);
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

function fromJiraIssueByKey(issue: JiraIssueByKeyResponse, resourceId: string, resourceUrl: string): ProviderIssue {
	const assignee = toAccount(issue.fields.assignee);
	const project = issue.fields.project;
	const status = issue.fields.status;

	return {
		id: issue.id,
		commentCount: issue.fields.comment?.total ?? issue.fields.comment?.comments?.length ?? null,
		number: issue.key,
		title: issue.fields.summary,
		url: toIssueWebUrl(resourceUrl, issue.key),
		closedDate: null,
		createdDate: new Date(issue.fields.created),
		author: toAccount(issue.fields.creator),
		updatedDate: new Date(issue.fields.updated),
		assignees: assignee != null ? [assignee] : [],
		description: issue.fields.description ?? null,
		repository: null,
		project:
			project != null
				? {
						name: project.name ?? '',
						resourceId: resourceId,
						key: project.key ?? null,
						namespace: null,
						id: project.id ?? null,
					}
				: undefined,
		state: {
			id: status.id,
			name: status.name,
			color: status.statusCategory.colorName,
			category: toStatusCategory(status.statusCategory.key),
		},
		type: issue.fields.issuetype?.name ?? null,
		upvoteCount: issue.fields.votes?.votes ?? null,
		labels: (issue.fields.labels ?? []).map(label => ({
			color: null,
			description: null,
			id: null,
			name: label,
		})),
	};
}

/**
 * The SDK's Jira point read performs resource and field discovery before the issue GET. This focused path uses
 * caller-supplied resource identity so a cold lookup remains one upstream request.
 */
export async function requestJiraIssueByKey(
	request: ProviderRequestFunction,
	accessToken: string,
	resourceId: string,
	resourceUrl: string,
	key: string,
): Promise<ProviderIssue> {
	const url = new URL(
		`${jiraCloudApiUrl}/${encodeURIComponent(resourceId)}/rest/api/2/issue/${encodeURIComponent(key)}`,
	);
	url.searchParams.set('fields', jiraIssueByKeyFields.join(','));

	const response = await request<JiraIssueByKeyResponse>({
		url: url.toString(),
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	return fromJiraIssueByKey(response.body, resourceId, resourceUrl);
}
