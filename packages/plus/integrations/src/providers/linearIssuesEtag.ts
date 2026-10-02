import type { IssueEtagFields } from '../models/integration.js';
import type { ProviderRequestFunction } from './models.js';

const linearGraphQLUrl = 'https://api.linear.app/graphql';

/** The most issue numbers one cheap check asks of one team. */
export const linearIssuesEtagMaxNumbers = 50;

/**
 * Archived issues are left out of Linear's `issues` connection unless asked for, so `includeArchived` keeps an archived
 * issue answerable here as the full read's `issue(id:)` answers it.
 */
const linearIssuesEtagQuery = `
	query GetIssuesEtagFields($teamKey: String!, $numbers: [Float!]!) {
		issues(
			first: ${linearIssuesEtagMaxNumbers}
			includeArchived: true
			filter: { team: { key: { eq: $teamKey } }, number: { in: $numbers } }
		) {
			pageInfo {
				hasNextPage
			}
			nodes {
				identifier
				number
				updatedAt
				archivedAt
				state {
					type
				}
			}
		}
	}
`;

export type LinearIssueEtagNode = {
	identifier: string;
	number: number;
	updatedAt?: string | null;
	archivedAt?: string | null;
	state?: { type?: string | null } | null;
};

type LinearIssuesEtagResponse = {
	data?: {
		issues?: { pageInfo?: { hasNextPage?: boolean }; nodes?: LinearIssueEtagNode[] } | null;
	} | null;
	errors?: unknown[];
};

/**
 * The cheap check behind the batch issue read's etags: the change state of up to {@link linearIssuesEtagMaxNumbers}
 * issues of one team in ONE GraphQL request, where the full read sends provider-apis' `issue(id:)` once per issue.
 * Linear returns only the issues it found, in its own order, so a caller matches them by number, never by position.
 *
 * Sent as provider-apis sends every Linear request: the token as the whole `Authorization` header, with no scheme.
 * GraphQL `errors` reject the whole request, as provider-apis rejects them, but keep the response so a throttling
 * code is still classified as one. A next page also rejects it: with every number unique within a team, more
 * issues than were asked for means the filter was not applied as written.
 */
export async function requestLinearIssuesEtagFields(
	request: ProviderRequestFunction,
	accessToken: string,
	teamKey: string,
	numbers: readonly number[],
): Promise<LinearIssueEtagNode[]> {
	const response = await request<LinearIssuesEtagResponse | null>({
		url: linearGraphQLUrl,
		method: 'POST',
		headers: { Authorization: accessToken, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: linearIssuesEtagQuery, variables: { teamKey: teamKey, numbers: numbers } }),
	});

	const body = response.body;
	if (body?.errors != null) {
		const error = new Error(`Linear GraphQL errors: ${JSON.stringify(body.errors)}`);
		Object.assign(error, { response: response });
		throw error;
	}

	const issues = body?.data?.issues;
	if (!Array.isArray(issues?.nodes)) throw new Error('Linear returned no issues');
	if (issues.pageInfo?.hasNextPage !== false) throw new Error('Linear returned more issues than were asked for');

	return issues.nodes;
}

/**
 * A cheap-checked issue's change state, as the fields the full row's etag reads. The full read's row is provider-apis'
 * Linear issue normalizer (0.61.0) then `fromProviderIssue`, so this mirrors both:
 *
 * - provider-apis maps `state.type` to a category — `completed` and `canceled` to `DONE`, `started` to `IN_PROGRESS`,
 *   anything else (`backlog`, `unstarted`, `triage`) to `TO_DO`, and no state to none — and sets `closedDate` from
 *   `archivedAt` (a falsy value reads as none);
 * - `fromProviderIssue` closes an issue that has a `closedDate` or a `DONE` category, so an archived issue is closed
 *   whatever its state.
 *
 * Throws on a missing or unparseable `updatedAt`, so the target falls through to the full read rather than matching an
 * etag the full row would compute from a fallback date (`fromProviderIssue` falls back to `closedDate`, then
 * `createdDate`).
 */
export function toLinearIssueEtagFields(issue: LinearIssueEtagNode): IssueEtagFields {
	const updatedDate = new Date(issue.updatedAt || Number.NaN);
	if (Number.isNaN(updatedDate.getTime())) {
		throw new Error(`Linear returned no update time for ${issue.identifier}`);
	}

	const type = issue.state?.type;
	const closed = Boolean(issue.archivedAt) || type === 'completed' || type === 'canceled';
	return { state: closed ? 'closed' : 'opened', updatedDate: updatedDate };
}
