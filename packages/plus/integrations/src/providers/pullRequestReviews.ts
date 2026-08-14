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
 */
export const providerPullRequestReviewStateDismissed = 'DISMISSED' as const;
export type ProviderPullRequestReview = Omit<NonNullable<GitPullRequest['reviews']>[number], 'state'> & {
	state: GitPullRequestReviewState | typeof providerPullRequestReviewStateDismissed;
	commitOid?: string;
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
		}));
}

export function toReviewRequests(reviews: ProviderPullRequestReviews): PullRequestReviewer[] | undefined {
	return reviews == null
		? undefined
		: reviews
				?.filter(r => r.state === GitPullRequestReviewState.ReviewRequested)
				.map(r => ({
					isCodeOwner: false, // TODO: Find this value, and implement in the shared lib if needed
					reviewer: fromProviderAccount(r.reviewer),
					state: PullRequestReviewState.ReviewRequested,
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
					isCodeOwner: false, // TODO: Find this value, and implement in the shared lib if needed
					reviewer: fromProviderAccount(r.reviewer),
					state: fromProviderPullRequestReviewState[r.state],
					commitOid: r.commitOid,
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
