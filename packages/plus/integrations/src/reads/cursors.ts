import type { IntegrationIds } from '../constants.js';
import { toPageCursor } from '../providers/utils/providerPaging.js';
import { hostFromDomain } from '../utils/domain.utils.js';
import { pageToCursor } from './paging.js';

/**
 * The COMPOSITE cursors, for the two reads a single provider cursor can't address.
 *
 * A plain paged read threads the provider's own opaque continuation. These two fan out instead — the
 * issue-tracker read over a window of projects, the broaden read over a set of orgs — so one round produces
 * several provider positions plus the bookkeeping needed to resume: which scopes failed and should be retried,
 * and which are already drained and must NOT be re-read (a cursor-only provider handed a fresh page-1 request
 * answers with its first page again, duplicating items).
 *
 * Both encodings are opaque to consumers and are parsed defensively: a cursor is caller-supplied data that may
 * be stale, truncated, or from another read entirely, so anything unrecognized degrades to "no cursor" (which
 * falls back to page paging) rather than throwing or being forwarded to a provider as a foreign string.
 */

// ---------------------------------------------------------------------------------------------------------
// Issue-tracker page cursor (Jira/Linear/Trello: resource → project, paginated by a window of PROJECTS)
// ---------------------------------------------------------------------------------------------------------

export interface IssueTrackerPageCursor {
	type: 'issue-tracker-page';
	currentPage: number;
	unpaged?: boolean;
	nextPage?: number;
	retryPages?: number[];
	retryProjects?: string[];
	completedProjects?: string[];
}

/** Positive safe integers only, deduped; `undefined` when nothing survives (so the field is omitted). */
function positiveIntegers(values: unknown): number[] | undefined {
	if (!Array.isArray(values)) return undefined;

	const valid = values.filter(
		(value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
	);
	return valid.length > 0 ? [...new Set(valid)] : undefined;
}

/** Non-empty strings only, deduped; `undefined` when nothing survives (so the field is omitted). */
function nonEmptyStrings(values: unknown): string[] | undefined {
	if (!Array.isArray(values)) return undefined;

	const valid = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
	return valid.length > 0 ? [...new Set(valid)] : undefined;
}

export function parseIssueTrackerPageCursor(cursor: string | undefined): IssueTrackerPageCursor | undefined {
	if (cursor == null) return undefined;

	try {
		const parsed = JSON.parse(cursor) as Partial<IssueTrackerPageCursor>;
		if (
			parsed.type !== 'issue-tracker-page' ||
			typeof parsed.currentPage !== 'number' ||
			!Number.isSafeInteger(parsed.currentPage) ||
			parsed.currentPage < 1
		) {
			return undefined;
		}

		const retryPages = positiveIntegers(parsed.retryPages);
		const retryProjects = nonEmptyStrings(parsed.retryProjects);
		const completedProjects = nonEmptyStrings(parsed.completedProjects);
		return {
			type: 'issue-tracker-page',
			currentPage: parsed.currentPage,
			...(parsed.unpaged === true ? { unpaged: true } : {}),
			...(typeof parsed.nextPage === 'number' && Number.isSafeInteger(parsed.nextPage) && parsed.nextPage > 0
				? { nextPage: parsed.nextPage }
				: {}),
			...(retryPages != null ? { retryPages: retryPages } : {}),
			...(retryProjects != null ? { retryProjects: retryProjects } : {}),
			...(completedProjects != null ? { completedProjects: completedProjects } : {}),
		};
	} catch {
		return undefined;
	}
}

export function toIssueTrackerPageCursor(options: {
	currentPage: number;
	unpaged?: boolean;
	nextPage?: number;
	retryPages: readonly number[];
	retryProjects: readonly string[];
	completedProjects?: readonly string[];
}): string | undefined {
	const retryPages = [...new Set(options.retryPages)].sort((a, b) => a - b);
	const retryProjects = [...new Set(options.retryProjects)].sort();
	const completedProjects =
		retryPages.length > 0 || retryProjects.length > 0 || options.nextPage != null
			? [...new Set(options.completedProjects ?? [])].sort()
			: [];
	if (retryPages.length === 0 && retryProjects.length === 0 && options.nextPage == null) {
		return undefined;
	}
	// Nothing to carry beyond the next window: emit the plain page cursor instead of a composite one, so an
	// ordinary forward read round-trips through the same encoding every other paged read uses.
	if (
		retryPages.length === 0 &&
		retryProjects.length === 0 &&
		completedProjects.length === 0 &&
		options.nextPage != null &&
		options.unpaged !== true
	) {
		return toPageCursor(options.nextPage);
	}
	return JSON.stringify({
		type: 'issue-tracker-page',
		currentPage: options.currentPage,
		...(options.unpaged === true ? { unpaged: true } : {}),
		...(options.nextPage != null ? { nextPage: options.nextPage } : {}),
		...(retryPages.length > 0 ? { retryPages: retryPages } : {}),
		...(retryProjects.length > 0 ? { retryProjects: retryProjects } : {}),
		...(completedProjects.length > 0 ? { completedProjects: completedProjects } : {}),
	} satisfies IssueTrackerPageCursor);
}

// ---------------------------------------------------------------------------------------------------------
// Broaden-issues cursor bundle (one provider position per org in the fan-out)
// ---------------------------------------------------------------------------------------------------------

/** Identifies one org slice of the fan-out. Connection and domain are part of the key: two accounts, or two
 * self-managed hosts, can each have an org of the same name. */
export interface BroadenIssuesOrgKey {
	providerId: IntegrationIds;
	name: string;
	connectionId?: string;
	domain?: string;
}

/** One org's position in the bundle: either the provider's own cursor, or a page to retry after a failure. */
export interface BroadenIssuesOrgCursor {
	providerId: IntegrationIds;
	org: string;
	connectionId?: string;
	domain?: string;
	cursor?: string;
	retryPage?: number;
}

export type BroadenIssuesExhaustedOrg = Omit<BroadenIssuesOrgCursor, 'cursor' | 'retryPage'>;

/** Whether a bundle entry addresses the same org slice as `org`, comparing domains by host. */
function matchesOrg(
	entry: { providerId?: IntegrationIds; org?: string; connectionId?: string; domain?: string },
	org: BroadenIssuesOrgKey,
): boolean {
	return (
		entry.providerId === org.providerId &&
		entry.org === org.name &&
		entry.connectionId === org.connectionId &&
		(hostFromDomain(entry.domain) ?? entry.domain) === (hostFromDomain(org.domain) ?? org.domain)
	);
}

/**
 * The cursor to send for one org in this round: its entry in the bundle, or a synthesized page cursor.
 *
 * A single-org fan-out has no bundle to key into — its cursor IS the provider's, threaded straight through.
 */
export function getBroadenIssuesCursor(
	cursor: string | undefined,
	org: BroadenIssuesOrgKey,
	page: number,
	orgCount: number,
): string | undefined {
	if (orgCount === 1) return cursor ?? pageToCursor(page);

	if (cursor != null) {
		try {
			const parsed = JSON.parse(cursor) as { cursors?: BroadenIssuesOrgCursor[] };
			const match = parsed.cursors?.find(c => matchesOrg(c, org));
			if (match?.cursor != null) return match.cursor;
			if (typeof match?.retryPage === 'number' && Number.isSafeInteger(match.retryPage) && match.retryPage > 0) {
				return toPageCursor(match.retryPage);
			}
		} catch {}
	}

	return pageToCursor(page);
}

/**
 * Whether a prior round already drained this org (multi-org fan-out only). Once an org runs out of pages while
 * another org keeps paging, the bundle records it as exhausted so the next round skips it instead of re-issuing
 * a page-1 read — which cursor-only providers (having no page-number cursor to honor) would answer with their
 * first page again, duplicating results.
 */
export function isBroadenIssuesOrgExhausted(
	cursor: string | undefined,
	org: BroadenIssuesOrgKey,
	orgCount: number,
): boolean {
	if (orgCount === 1 || cursor == null) return false;

	try {
		const parsed = JSON.parse(cursor) as { exhausted?: BroadenIssuesExhaustedOrg[] };
		return parsed.exhausted?.some(e => matchesOrg(e, org)) ?? false;
	} catch {
		return false;
	}
}

/** Encodes the round's per-org positions. A single-org fan-out emits that org's cursor directly, unwrapped. */
export function toBroadenIssuesCursor(
	cursors: BroadenIssuesOrgCursor[],
	exhausted: BroadenIssuesExhaustedOrg[],
	orgCount: number,
): string | undefined {
	if (cursors.length === 0) return undefined;
	if (orgCount === 1) {
		return cursors[0].cursor ?? (cursors[0].retryPage != null ? toPageCursor(cursors[0].retryPage) : undefined);
	}

	// Carry the exhausted orgs alongside the still-active cursors so the next round can skip them (see
	// isBroadenIssuesOrgExhausted). Only meaningful while at least one org still has more to read.
	return JSON.stringify({ cursors: cursors, exhausted: exhausted });
}
