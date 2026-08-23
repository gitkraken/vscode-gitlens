import { getPullRequestNumberFromUrl } from '@gitlens/git/utils/pullRequest.utils.js';
import type { GraphSidebarPullRequest } from '../../../../plus/graph/protocol.js';
import { parseFilterTerms } from '../../../shared/utils/filter-match.js';

/** Whether the query is a URL, i.e. something pasted rather than typed as search text. */
const urlRegex = /^(?:https?:\/\/|www\.)\S+$/i;

/**
 * Query → terms for pull request lists.
 *
 * A pasted PR URL matches nothing under plain text filtering — it is neither a substring of the row
 * nor a plausible subsequence of it. Since these lists are already repo-scoped, the PR number alone
 * identifies the row, and {@link getPullRequestNumberFromUrl} extracts it from every shape a copied URL
 * takes (`/files`, `#discussion_r1`, `?diff=split`) — anchored on the provider's pull request segment, so
 * a digit-leading owner (`github.com/1Password/x/pull/456`) can't be mistaken for the number.
 *
 * Still gated on the query actually looking like a URL: the helper anchors on a path segment, not a whole
 * url, so an unguarded call would turn a branch-name search like `feature/pull/16` into a search for PR
 * #16.
 */
export function parsePullRequestFilterTerms(query: string): string[] {
	const trimmed = query.trim();
	if (urlRegex.test(trimmed)) {
		// A URL carrying no recognizable number falls through and matches nothing, which is the honest
		// answer — it names no pull request.
		const prNumber = getPullRequestNumberFromUrl(trimmed);
		if (prNumber != null) return [prNumber];
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
 *  "search for this PR" fallback when filtering comes up empty. Two shapes address a PR: a pasted URL,
 *  read the same anchored way {@link parsePullRequestFilterTerms} reads one, and a number typed on its
 *  own — anything else (a branch name carrying digits, say) addresses no pull request. */
export function getPullRequestNumberFromQuery(query: string): string | undefined {
	const trimmed = query.trim();
	if (urlRegex.test(trimmed)) return getPullRequestNumberFromUrl(trimmed);

	return /^#?(\d+)$/.exec(trimmed)?.[1];
}

/** How a {@link searchPullRequest} ended. */
export type PullRequestSearchResult =
	| { kind: 'found'; pr: GraphSidebarPullRequest }
	| { kind: 'not-found' }
	| { kind: 'superseded' };

/**
 * Looks up the pull request `number` addresses — the engine behind the "Not in open pull requests →
 * search" fallbacks shared by the sidebar's pull requests panel and the scope popover's Focus pane.
 * Both lists hold only *open* pull requests, so a pasted URL for a merged or closed one finds nothing
 * until we go ask, mirroring how Launchpad falls back to `getPullRequest` when its query names a PR
 * outside the loaded set.
 *
 * Rejects when the lookup fails; each caller decides how failure reads (both map it to not-found).
 */
export async function searchPullRequest(
	number: string,
	options: {
		/** The live filter query — re-parsed once the lookup settles, so a query that moved on to a
		 *  different pull request while the request was in flight reports `superseded` rather than
		 *  silently injecting a PR nobody is asking about anymore. */
		getQuery: () => string;
		/** Resolves a pull request the loaded list doesn't hold. */
		find: (number: string) => Promise<GraphSidebarPullRequest | undefined>;
	},
): Promise<PullRequestSearchResult> {
	const pr = await options.find(number);
	if (getPullRequestNumberFromQuery(options.getQuery()) !== number) return { kind: 'superseded' };

	return pr != null ? { kind: 'found', pr: pr } : { kind: 'not-found' };
}
