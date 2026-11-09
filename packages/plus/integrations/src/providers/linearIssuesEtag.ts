import type { IssueSyncedWith } from '@gitlens/git/models/issue.js';
import type { IssueEtagFields } from '../models/integration.js';
import { linearSyncedWithEtagKeys } from '../models/integration.js';
import type { ProviderRequestFunction } from './models.js';
import { isLinearRateLimitedBody } from './providerErrors.js';

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
				syncedWith {
					id
					service
					metadata {
						... on ExternalEntityInfoGithubMetadata {
							owner
							repo
							number
						}
					}
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
	syncedWith?:
		| {
				id?: string | null;
				service?: string | null;
				metadata?: { owner?: string | null; repo?: string | null; number?: number | null } | null;
		  }[]
		| null;
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
 * code is still classified as one. The exception is the one provider-apis makes too: errors that all sit under
 * `syncedWith`, a nullable list, leave every other field whole. An issue whose list Linear failed to resolve falls
 * through to its full read (see {@link toLinearIssueEtagFields}); one whose list resolved but a link's coordinates
 * didn't keys that link without them, as the full read's row carries it. Unlike provider-apis, a throttled response
 * still throws here, so it is classified as a rate limit. A next page also rejects it: with every number unique within
 * a team, more issues than were asked for means the filter was not applied as written.
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
	const syncedWithOnly =
		body?.data != null &&
		Array.isArray(body.errors) &&
		body.errors.every(
			e =>
				typeof e === 'object' &&
				e != null &&
				'path' in e &&
				Array.isArray(e.path) &&
				e.path.includes('syncedWith'),
		) &&
		!isLinearRateLimitedBody(body);
	if (body?.errors != null && !syncedWithOnly) {
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
 * Linear issue normalizer (0.65.0, `syncedWith` since GKDEV-3662) then `fromProviderIssue`, so this mirrors both:
 *
 * - provider-apis maps `state.type` to a category — `completed` to `DONE`, `canceled` and `duplicate` to `CANCELED`,
 *   `started` to `IN_PROGRESS`, anything else (`backlog`, `unstarted`, `triage`) to `TO_DO`, and no state to none —
 *   and sets `closedDate` from `archivedAt` (a falsy value reads as none);
 * - `fromProviderIssue` closes an issue that has a `closedDate` or a terminal category, so an archived issue is closed
 *   whatever its state.
 * - provider-apis keeps a `syncedWith` entry for a GitHub link with an id, with its coordinates only when owner, repo
 *   and a positive integer number are all there, so the etag lists each such link the same way.
 *
 * Throws on a missing or unparseable `updatedAt`, so the target falls through to the full read rather than matching an
 * etag the full row would compute from a fallback date (`fromProviderIssue` falls back to `closedDate`, then
 * `createdDate`). Throws on a `syncedWith` Linear failed to resolve too: an unknown list must not match a full row
 * read while Linear could resolve it, nor one read while it couldn't, which would keep that row unknown.
 */
export function toLinearIssueEtagFields(issue: LinearIssueEtagNode): IssueEtagFields {
	const updatedDate = new Date(issue.updatedAt || Number.NaN);
	if (Number.isNaN(updatedDate.getTime())) {
		throw new Error(`Linear returned no update time for ${issue.identifier}`);
	}

	if (issue.syncedWith == null) {
		throw new Error(`Linear could not resolve the sync links of ${issue.identifier}`);
	}

	const type = issue.state?.type;
	const closed = Boolean(issue.archivedAt) || type === 'completed' || type === 'canceled' || type === 'duplicate';
	return {
		state: closed ? 'closed' : 'opened',
		updatedDate: updatedDate,
		syncedWithKeys: linearSyncedWithEtagKeys(
			issue.syncedWith.flatMap((synced): IssueSyncedWith[] => {
				if (synced.service !== 'github' || !synced.id) return [];

				const { owner, repo, number } = synced.metadata ?? {};
				return [
					owner && repo && typeof number === 'number' && Number.isInteger(number) && number > 0
						? { provider: 'github', id: synced.id, owner: owner, repo: repo, number: number }
						: { provider: 'github', id: synced.id },
				];
			}),
		),
	};
}
