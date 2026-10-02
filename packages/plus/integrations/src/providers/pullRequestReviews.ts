import type { GitPullRequest } from '@gitkraken/provider-apis';
import { GitPullRequestReviewState } from '@gitkraken/provider-apis';
import type { PullRequestReviewer } from '@gitlens/git/models/pullRequest.js';
import { PullRequestReviewDecision, PullRequestReviewState } from '@gitlens/git/models/pullRequest.js';
import { fromProviderAccount, toProviderAccount } from './accounts.js';

/**
 * The GitLens-local extension of provider-apis' review shape, in two parts: a `DISMISSED` state the upstream
 * `GitPullRequestReviewState` has no member for, and the head-commit oid a review was submitted against
 * (optional, so a raw SDK review stays assignable — only the GitHub path populates it).
 *
 * Both exist for the same case: on GitHub the `dismiss stale reviews` rule flips an approval to dismissed on
 * the next push, which is exactly the "the PR moved past my review" situation the oid detects. Dropping such a
 * review instead would hand a consumer a PR out of the `reviewed-by:@me` set with no review row at all,
 * indistinguishable from never having reviewed it.
 *
 * It also carries GitHub's code-owner flag on a request, which provider-apis doesn't report, so its rows leave it
 * unset.
 */
export const providerPullRequestReviewStateDismissed = 'DISMISSED' as const;
export type ProviderPullRequestReview = Omit<NonNullable<GitPullRequest['reviews']>[number], 'state'> & {
	state: GitPullRequestReviewState | typeof providerPullRequestReviewStateDismissed;
	commitOid?: string;
	isCodeOwner?: boolean;
	/** See {@link PullRequestReviewer.isMyGroup}. Only the Azure DevOps reads that resolve the user's groups set it. */
	isMyGroup?: boolean;
};
/**
 * The review list as it travels on {@link ProviderPullRequest}: `null` when the read carried no review data at
 * all, as opposed to an empty array for a pull request nobody has reviewed.
 */
export type ProviderPullRequestReviews = ProviderPullRequestReview[] | null;

export const toProviderPullRequestReviewState = {
	[PullRequestReviewState.Approved]: GitPullRequestReviewState.Approved,
	[PullRequestReviewState.ChangesRequested]: GitPullRequestReviewState.ChangesRequested,
	[PullRequestReviewState.Commented]: GitPullRequestReviewState.Commented,
	[PullRequestReviewState.ReviewRequested]: GitPullRequestReviewState.ReviewRequested,
	[PullRequestReviewState.Dismissed]: providerPullRequestReviewStateDismissed,
	// A review the author started but never submitted. Visible only to that author and carrying no verdict, so
	// it stays unmapped and is dropped by the projection.
	[PullRequestReviewState.Pending]: null,
};

export const fromProviderPullRequestReviewState = {
	[GitPullRequestReviewState.Approved]: PullRequestReviewState.Approved,
	[GitPullRequestReviewState.ChangesRequested]: PullRequestReviewState.ChangesRequested,
	[GitPullRequestReviewState.Commented]: PullRequestReviewState.Commented,
	[GitPullRequestReviewState.ReviewRequested]: PullRequestReviewState.ReviewRequested,
	[providerPullRequestReviewStateDismissed]: PullRequestReviewState.Dismissed,
};

export function toProviderReviews(reviewers: PullRequestReviewer[]): ProviderPullRequestReviews {
	// Only `Pending` maps to null (see `toProviderPullRequestReviewState`), so this drops exactly the reviews
	// that carry no verdict rather than defaulting them to `ReviewRequested` — which would report an unsubmitted
	// draft as a pending request from that reviewer.
	return reviewers
		.filter(r => r.state !== PullRequestReviewState.Pending)
		.map(reviewer => ({
			reviewer: toProviderAccount(reviewer.reviewer),
			state: toProviderPullRequestReviewState[reviewer.state] ?? GitPullRequestReviewState.ReviewRequested,
			commitOid: reviewer.commitOid,
			isCodeOwner: reviewer.isCodeOwner,
			...(reviewer.isMyGroup ? { isMyGroup: true } : {}),
		}));
}

export function toReviewRequests(reviews: ProviderPullRequestReviews): PullRequestReviewer[] | undefined {
	return reviews == null
		? undefined
		: reviews
				?.filter(r => r.state === GitPullRequestReviewState.ReviewRequested)
				.map(r => ({
					isCodeOwner: r.isCodeOwner,
					reviewer: fromProviderAccount(r.reviewer),
					state: PullRequestReviewState.ReviewRequested,
					...(r.isMyGroup ? { isMyGroup: true } : {}),
				}));
}

export function toCompletedReviews(reviews: ProviderPullRequestReviews): PullRequestReviewer[] | undefined {
	return reviews == null
		? undefined
		: reviews
				?.filter(
					r =>
						r.state !== GitPullRequestReviewState.ReviewRequested &&
						// provider-apis' own GitHub normalizer maps only its four known states, so a review it has no
						// member for (a real `DISMISSED` one, which its `latestReviews(first: 100)` selection does
						// return) arrives with `state: undefined` — a value its type says cannot happen. Publishing it
						// would put an unswitchable state on `PullRequestShape.latestReviews`, and mapping back would
						// hit `toProviderReviews`' fallback and report a dismissed review as an outstanding request.
						// Our own GitHub path never lands here: it carries `providerPullRequestReviewStateDismissed`.
						fromProviderPullRequestReviewState[r.state] != null,
				)
				.map(r => ({
					isCodeOwner: r.isCodeOwner,
					reviewer: fromProviderAccount(r.reviewer),
					state: fromProviderPullRequestReviewState[r.state],
					commitOid: r.commitOid,
					...(r.isMyGroup ? { isMyGroup: true } : {}),
				}));
}

export function toProviderReviewDecision(
	reviewDecision?: PullRequestReviewDecision,
	reviewers?: PullRequestReviewer[],
): GitPullRequestReviewState | null {
	switch (reviewDecision) {
		case PullRequestReviewDecision.Approved:
			return GitPullRequestReviewState.Approved;
		case PullRequestReviewDecision.ChangesRequested:
			return GitPullRequestReviewState.ChangesRequested;
		case PullRequestReviewDecision.ReviewRequired:
			return GitPullRequestReviewState.ReviewRequested;
		default: {
			if (reviewers?.some(r => r.state === PullRequestReviewState.ReviewRequested)) {
				return GitPullRequestReviewState.ReviewRequested;
			} else if (reviewers?.some(r => r.state === PullRequestReviewState.Commented)) {
				return GitPullRequestReviewState.Commented;
			}
			return null;
		}
	}
}

export const fromPullRequestReviewDecision = {
	[GitPullRequestReviewState.Approved]: PullRequestReviewDecision.Approved,
	[GitPullRequestReviewState.ChangesRequested]: PullRequestReviewDecision.ChangesRequested,
	[GitPullRequestReviewState.Commented]: undefined,
	[GitPullRequestReviewState.ReviewRequested]: PullRequestReviewDecision.ReviewRequired,
};

/** provider-apis' (0.61.0) review severity (`Us` in its bundle), by which it picks a review decision. */
const providerReviewDecisionSeverity: Partial<Record<string, number>> = {
	[GitPullRequestReviewState.Approved]: 0,
	[GitPullRequestReviewState.Commented]: 1,
	[GitPullRequestReviewState.ReviewRequested]: 2,
	[GitPullRequestReviewState.ChangesRequested]: 3,
};

/**
 * The review decision provider-apis' GitLab and Azure DevOps mappers derive from a pull request's review states (`ne`
 * in its bundle): the most severe state wins, starting from approved, and no states at all is no decision. A state it
 * doesn't rank (`undefined` here, for one provider-apis doesn't know) never outranks the decision so far. For a cheap
 * etag check, which must reproduce a full row's decision without provider-apis' mapping.
 */
export function decideProviderReviewDecision(
	states: readonly (GitPullRequestReviewState | undefined)[] | undefined,
): GitPullRequestReviewState | undefined {
	if (!states?.length) return undefined;

	return states.reduce<GitPullRequestReviewState>(
		(decided, state) =>
			state != null &&
			(providerReviewDecisionSeverity[state] ?? -1) > (providerReviewDecisionSeverity[decided] ?? -1)
				? state
				: decided,
		GitPullRequestReviewState.Approved,
	);
}
