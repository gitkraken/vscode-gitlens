import type { IssueEtagFields } from '../models/integration.js';
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

function toJiraIssueState(status: JiraIssueStatusResponse): NonNullable<ProviderIssue['state']> {
	return {
		id: status.id,
		name: status.name,
		color: status.statusCategory.colorName,
		category: toStatusCategory(status.statusCategory.key),
	};
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
		state: toJiraIssueState(status),
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

/**
 * The most keys one bulk fetch takes. Atlassian allows up to 1000 for a request that names its fields explicitly, but
 * documents 100 as the default limit.
 */
export const jiraBulkFetchMaxKeys = 100;

/**
 * One issue of a bulk fetch that asks for `status` and `updated` only. The bulk fetch is API v3 while the full read is
 * v2, but these two fields have the same shape in both: the v2 and v3 OpenAPI specs define the same `StatusDetails`
 * and `StatusCategory`, and a live comparison found both fields byte-identical. v3 differs in rich-text fields, which
 * it returns as ADF, so this request must never widen to `description`. `self` differs too, and is never read.
 */
export type JiraIssueEtagResponse = {
	id: string;
	key: string;
	fields: Partial<Pick<JiraIssueByKeyResponse['fields'], 'status' | 'updated'>>;
};

type JiraBulkFetchResponse = {
	issues?: JiraIssueEtagResponse[];
	/**
	 * Only issues Jira could not return for a retriable error or a payload constraint, by numeric issue id rather than
	 * the key asked for. Issues that don't exist or aren't visible are NOT listed here, nor in `issues`: they are
	 * silently omitted, so a bulk fetch never proves an absence.
	 */
	issueErrors?: { id?: string; errorMessage?: string }[];
};

/**
 * The cheap check behind the batch issue read's etags: `status` and `updated` of up to {@link jiraBulkFetchMaxKeys}
 * issues of one site in ONE request, where {@link requestJiraIssueByKey} reads one issue per request. Jira returns the
 * issues in its own order, each under its CURRENT key (a lowercase or moved key resolves to the issue it names now), and
 * omits the ones it can't find, so a caller matches them to its keys by key, never by position.
 */
export async function requestJiraIssuesEtagFields(
	request: ProviderRequestFunction,
	accessToken: string,
	resourceId: string,
	keys: readonly string[],
): Promise<{ issues: JiraIssueEtagResponse[]; errorCount: number }> {
	const response = await request<JiraBulkFetchResponse | null>({
		url: `${jiraCloudApiUrl}/${encodeURIComponent(resourceId)}/rest/api/3/issue/bulkfetch`,
		method: 'POST',
		headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ issueIdsOrKeys: keys, fields: ['status', 'updated'] }),
	});

	const issues = response.body?.issues;
	if (!Array.isArray(issues)) throw new Error('Jira bulk fetch returned no issues');

	return { issues: issues, errorCount: response.body?.issueErrors?.length ?? 0 };
}

/**
 * A bulk-fetched issue's change state, as the fields the full row's etag reads. {@link fromJiraIssueByKey} maps the
 * status with the same {@link toJiraIssueState} and never sets `closedDate`, so `toIssueShape` (with
 * `reliableStateCategory`) closes exactly the issues whose status category is done. Throws on a missing status or an
 * unparseable `updated`, so the target falls through to the full read rather than matching an etag that would ignore
 * its update time.
 */
export function toJiraIssueEtagFields(issue: JiraIssueEtagResponse): IssueEtagFields {
	const { status, updated } = issue.fields;
	if (status?.statusCategory == null) throw new Error(`Jira bulk fetch returned no status for ${issue.key}`);

	const updatedDate = new Date(updated ?? Number.NaN);
	if (Number.isNaN(updatedDate.getTime())) {
		throw new Error(`Jira bulk fetch returned no update time for ${issue.key}`);
	}

	return { state: toJiraIssueState(status).category === 'DONE' ? 'closed' : 'opened', updatedDate: updatedDate };
}
