import type { PullRequestReviewDecision, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
import type { ActionablePullRequest } from '@gitlens/integrations/index.js';
import { getPullRequestFieldPresence } from '@gitlens/integrations/index.js';
import type { LaunchpadActionCategory } from '../models/launchpad.js';

/** The flags the shared categorizer set on an actionable pull request that {@link getReviewNotRequiredActionCategory}
 *  replays its cascade from. */
export type ReviewRequirementActionablePullRequest = Pick<
	ActionablePullRequest,
	'isDraft' | 'failingCI' | 'hasConflicts'
> & { readonly viewer: Pick<ActionablePullRequest['viewer'], 'shouldMerge'> };

/** Whether the pull request's own host can report its review decision — only GitHub and GitHub Enterprise do. */
export function isReviewDecisionReportingProvider(providerId: string): boolean {
	return (
		providerId === GitCloudHostIntegrationId.GitHub ||
		providerId === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
	);
}

/**
 * The category a pull request the shared categorizer called `unassigned-reviewers` takes instead when its host
 * definitively reports that no review is required, or `undefined` when that category stands (or `category` is any
 * other one, merge-queue categories included).
 *
 * "Definitively" means GitHub or GitHub Enterprise reported no decision (its `null`, which GitLens surfaces as an
 * `undefined` `reviewDecision`) on a read that selected it — the row's own read (by its field presence) or, for a row
 * whose read didn't, the follow-up read passed as `fetched`. A decision nothing fetched, or a host that has none, says
 * nothing, so it keeps today's verdict.
 *
 * The shared categorizer gives `unassignedReviewers` to any author-side pull request with no reviews, overwriting
 * whatever it set before; this replays its cascade without that rule (later wins). The review-driven categories can't
 * apply — they need reviews (or a review decision), and the row has neither.
 */
export function getReviewNotRequiredActionCategory(
	category: LaunchpadActionCategory,
	item: ReviewRequirementActionablePullRequest,
	pr: PullRequestShape,
	fetched?: { readonly reviewDecision: PullRequestReviewDecision | undefined },
): LaunchpadActionCategory | undefined {
	if (category !== 'unassigned-reviewers') return undefined;
	if (!isReviewDecisionReportingProvider(pr.provider.id)) return undefined;

	if (fetched != null) {
		if (fetched.reviewDecision != null) return undefined;
	} else if (getPullRequestFieldPresence(pr)?.reviewDecision !== 'fetched' || pr.reviewDecision != null) {
		return undefined;
	}

	let recomputed: LaunchpadActionCategory = 'other';
	if (item.viewer.shouldMerge) {
		recomputed = 'mergeable';
	}
	if (item.isDraft) {
		recomputed = 'draft';
	}
	if (item.failingCI) {
		recomputed = 'failed-checks';
	}
	if (item.hasConflicts) {
		recomputed = 'conflicts';
	}
	return recomputed;
}
