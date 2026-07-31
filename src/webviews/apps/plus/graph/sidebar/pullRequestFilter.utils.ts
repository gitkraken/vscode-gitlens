import { getPullRequestIdentityFromMaybeUrl } from '@gitlens/git/utils/pullRequest.utils.js';
import { parseFilterTerms } from '../../../shared/utils/filter-match.js';

/** Whether the query is a URL, i.e. something pasted rather than typed as search text. */
const urlRegex = /^(?:https?:\/\/|www\.)\S+$/i;

/**
 * Query → terms for pull request lists.
 *
 * A pasted PR URL matches nothing under plain text filtering — it is neither a substring of the row
 * nor a plausible subsequence of it. Since these lists are already repo-scoped, the PR number alone
 * identifies the row, and {@link getPullRequestIdentityFromMaybeUrl} extracts it from every shape a
 * copied URL takes (`/files`, `#discussion_r1`, `?diff=split`).
 *
 * Gated on the query actually looking like a URL: that helper matches `/(\d+)` anywhere, so an
 * unguarded call would turn a branch-name search like `bug/2-fix` into a search for PR #2.
 */
export function parsePullRequestFilterTerms(query: string): string[] {
	const trimmed = query.trim();
	if (urlRegex.test(trimmed)) {
		const identity = getPullRequestIdentityFromMaybeUrl(trimmed);
		// A URL with no PR number in it (e.g. a bare repo URL) falls through and matches nothing,
		// which is the honest answer — it names no pull request.
		if (identity != null) return [identity.prNumber];
	}

	return parseFilterTerms(query);
}

/**
 * Folds a looked-up pull request into the displayed list. Kept out of the panel's resource on
 * purpose: the resource is the repo's *open* pull requests and backs the rail's count badge, so a
 * merged one found by search must render without inflating that count.
 */
export function withSearchedPullRequest<T extends { number: string }>(items: T[], searched: T | undefined): T[] {
	if (searched == null || items.some(i => i.number === searched.number)) return items;

	return [...items, searched];
}

/** The PR number a query addresses, or `undefined` when it isn't addressing one. Drives the
 *  "search for this PR" fallback when filtering comes up empty. */
export function getPullRequestNumberFromQuery(query: string): string | undefined {
	const trimmed = query.trim();
	if (!urlRegex.test(trimmed) && !/^#?\d+$/.test(trimmed)) return undefined;

	return getPullRequestIdentityFromMaybeUrl(trimmed)?.prNumber;
}
