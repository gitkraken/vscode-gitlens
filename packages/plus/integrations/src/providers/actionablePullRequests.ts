import type { GitPullRequestReviewState, PullRequestWithUniqueID } from '@gitkraken/provider-apis';
import { GitProviderUtils } from '@gitkraken/provider-apis';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type {
	ActionablePullRequestAccount,
	ActionablePullRequestEnrichedItems,
	ActionablePullRequestFields,
	ActionablePullRequestInput,
} from '../models/actionablePullRequest.js';
import { GitPullRequestMergeableState, toProviderPullRequest } from './models.js';
import type { ProviderPullRequestReview } from './pullRequestReviews.js';
import { providerPullRequestReviewStateDismissed } from './pullRequestReviews.js';
import { encodeEntityIdentifier, getEntityIdentifierInput } from './utils.js';

// Launchpad's categorization over provider-apis' categorizer. Kept apart from `models.ts` so the public facade can
// re-export these: their signatures are in the neutral `ActionablePullRequest*` types, and the SDK stays an
// implementation detail of this module.

/**
 * Converts a pull request into the input {@link getActionablePullRequests} categorizes, with the entity-identifier
 * `uuid` that keys its pins and snoozes.
 */
export function toActionablePullRequestInput(pr: PullRequest): ActionablePullRequestInput {
	const { reviews, mergeableState, ...providerPr } = toProviderPullRequest(pr);
	// Built as the SDK's own type, which the neutral one mirrors, so a field the SDK requires can't go missing.
	const input: PullRequestWithUniqueID = {
		...providerPr,
		// The SDK's type requires a mergeability, and its categorizer only acts on a known one, so an unfetched
		// one goes over as its own `UNKNOWN`. Except on Bitbucket Cloud, which reports no mergeability at all:
		// Launchpad's "Ready to merge" needs one, so its rows go over as `MERGEABLE`, as provider-apis' own
		// Bitbucket rows already do.
		mergeableState:
			mergeableState ??
			(pr.provider.id === GitCloudHostIntegrationId.Bitbucket
				? GitPullRequestMergeableState.Mergeable
				: GitPullRequestMergeableState.Unknown),
		// The SDK boundary: `getActionablePullRequests` categorizes by review state and only knows
		// provider-apis' own vocabulary, so the locally-added dismissed state is dropped here rather than
		// handed over as a value it would fall through on. Our own projection keeps it — see
		// `providerPullRequestReviewStateDismissed`. `commitOid` rides along on the surviving reviews: it is an
		// extra property the SDK ignores, not a value it could misread.
		reviews:
			reviews?.filter(
				(r): r is ProviderPullRequestReview & { state: GitPullRequestReviewState } =>
					r.state !== providerPullRequestReviewStateDismissed,
			) ?? null,
		uuid: encodeEntityIdentifier(getEntityIdentifierInput(pr)),
	};
	return input;
}

/**
 * Categorizes pull requests for the viewer (Launchpad's action categories), using provider-apis' categorizer.
 *
 * Generic so a caller's extra properties survive: the categorizer spreads each input into its output. The casts
 * only cross the SDK's nominal string enums, whose values the neutral types share (see the parity test).
 */
export function getActionablePullRequests<T extends ActionablePullRequestInput>(
	pullRequests: T[],
	viewer: Pick<ActionablePullRequestAccount, 'id'> | null,
	options?: { enrichedItemsByUniqueId?: ActionablePullRequestEnrichedItems },
): (T & ActionablePullRequestFields)[] {
	return GitProviderUtils.getActionablePullRequests(
		pullRequests as unknown as PullRequestWithUniqueID[],
		viewer,
		options,
	) as unknown as (T & ActionablePullRequestFields)[];
}
