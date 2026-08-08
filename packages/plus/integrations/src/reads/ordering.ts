import type { IssueShape, IssueSorting } from '@gitlens/git/models/issue.js';
import { defaultIssueSort } from '@gitlens/git/models/issue.js';
import { getIssueComparator } from '@gitlens/git/utils/issue.utils.js';

/**
 * How an issue read decides what order to request, and how to order a page it assembled itself.
 *
 * Its own module rather than more of `filters.ts` because it answers a different question. That file validates what
 * a caller asked to NARROW to; this one resolves what a caller asked to ORDER by — and unlike a filter, an order
 * doesn't only have to be expressible by the provider, it also has to survive the read's own merging. Every issue
 * read makes both decisions in the same shape, so they are resolved here once rather than at each read.
 */

/**
 * Why {@link resolveIssueSort} refused a key, carrying what the refusal has to say — the same shape
 * `IssueSearchCriteriaRejection` uses for the filtered search, and for the same reason.
 *
 * The payload travels WITH the rejection rather than being re-read at the warning: the check already held both
 * values, so handing them back is what lets a caller word the refusal without re-deriving anything TypeScript
 * can no longer narrow (which is how this grew five non-null assertions), and it makes it impossible for the
 * message to name a supported list the check didn't use.
 */
export type UnsupportedIssueSortRejection = {
	reason: 'unsupported-sort';
	/** The key the caller asked for. Non-optional, unlike the `sort` a successful resolve returns. */
	requested: IssueSorting;
	/** Every key this surface CAN express, for the message. `undefined` when the read can't be ordered at all. */
	supported: IssueSorting[] | undefined;
};

/**
 * Resolves the order an issue read should request: validates a caller-supplied key against what one provider
 * surface can express server-side, and supplies this facade's default when the caller asked for none.
 *
 * Three outcomes, and each is a decision rather than a convenience:
 * - A key the surface can't express is REJECTED and the read refused whole, never resolved to the nearest
 *   supported key. Same reason a dropped filter isn't dropped: the provider serves at most a bounded window of
 *   matches, so a list ordered by something else is a DIFFERENT subset than the one asked for, and the cursor that
 *   comes with it describes that other subset — indistinguishable, from the result, from the order requested.
 * - An omitted key becomes {@link defaultIssueSort}, because leaving it to the provider is what makes the same
 *   read return different things on different hosts (Azure by creation, Jira by nothing at all). The default is
 *   this facade's promise; the SDK deliberately has no opinion.
 * - An omitted key on a surface that can't express even the default returns `undefined`, leaving that provider's
 *   own order. A default the caller never asked for must not refuse a read that works today.
 *
 * Takes the supported list rather than an `IntegrationIds`, unlike the filter validators, because which list
 * applies is the CALLER's decision — `supportedIssueSorts` for a repo-scoped or tracker read,
 * `supportedAccountWideIssueSorts` for an account-wide one — and that branch already exists at the call site
 * (`repos` present or not). Resolving it in here would duplicate it.
 */
export function resolveIssueSort(
	supported: IssueSorting[] | undefined,
	sort: IssueSorting | undefined,
): { rejection?: UnsupportedIssueSortRejection; sort?: IssueSorting } {
	if (sort == null) {
		return supported?.includes(defaultIssueSort) ? { sort: defaultIssueSort } : {};
	}
	if (!supported?.includes(sort)) {
		return { rejection: { reason: 'unsupported-sort', requested: sort, supported: supported } };
	}

	return { sort: sort };
}

/**
 * Why a merged page can't honor the key it was given: the read fans out over several provider queries and no
 * normalized issue carries the field to merge on.
 *
 * Named for the same reason {@link UnsupportedIssueSortRejection} is, and kept separate from it because the two
 * refusals are different claims: that one says the PROVIDER can't express the key, this one says the provider
 * can but this READ's shape can't — the same key against the same provider succeeds on a single scope.
 */
export type UnmergeableIssueSort = {
	/** The key the caller asked for, which a single-scope read of this provider would have honored. */
	requested: IssueSorting;
};

/**
 * What a read does with the order it resolved, once it also knows whether the page it is about to build MERGES
 * several provider queries.
 *
 * Both facts are bound here, at the one point a read knows them, rather than consulted separately at the refusal
 * and again at the sort. That is the difference this type buys: `merged` and the comparator were each tested twice
 * per read, and the two tests are the same decision — whether the requested order survives this page's shape.
 */
export type IssueOrdering = {
	/** The key to send to the provider, or `undefined` to leave the provider's own order. */
	readonly sort: IssueSorting | undefined;
	/**
	 * Set when the requested key cannot be honored: this page merges several queries, and no normalized issue
	 * carries the field to merge on. The read refuses rather than serving concatenated per-scope runs, which would
	 * look ordered without being so. `undefined` for a single-query page, where the provider did the ordering.
	 *
	 * Carries the key rather than being a bare flag, for the same reason {@link UnsupportedIssueSortRejection}
	 * does: the refusal needs it, and re-reading `sort` at the call site needs an assertion for an invariant this
	 * type would otherwise not express.
	 */
	readonly unmergeable: UnmergeableIssueSort | undefined;
	/**
	 * Orders a merged page. A no-op for a single-query page (the provider already ordered it, and re-sorting could
	 * only reproduce that order while hiding a provider that ignored the key) and for a read with no key at all.
	 *
	 * Returns a new array rather than sorting in place: the input is often the provider's own `values`, and a read
	 * that mutates what it was handed is a surprise waiting for the next caller to share that reference.
	 */
	order(items: IssueShape[]): IssueShape[];
};

/**
 * Binds a resolved sort key to the shape of the page about to be built.
 *
 * `merged` is the caller's own count of provider queries reduced to the only thing that matters: GitHub sends one
 * search however many repositories are named, GitLab one per repository, Azure and the trackers one per project,
 * and every account-wide read is a union of several. Above one, the union is what gets published, and only a field
 * an {@link IssueShape} carries can order it.
 */
export function toIssueOrdering(sort: IssueSorting | undefined, merged: boolean): IssueOrdering {
	const comparator = sort != null ? getIssueComparator(sort) : undefined;
	return {
		sort: sort,
		unmergeable: merged && sort != null && comparator == null ? { requested: sort } : undefined,
		order: (items: IssueShape[]) => (merged && comparator != null ? [...items].sort(comparator) : items),
	};
}
