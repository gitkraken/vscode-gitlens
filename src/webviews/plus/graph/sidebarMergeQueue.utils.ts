/**
 * INTERIM (goals S6): the Graph sidebar's pull request list comes from provider-apis' repository-scoped read, which
 * selects no merge queue, so GitHub.com's queue is read separately per base branch and joined in by number here.
 * Remove this module, and its call sites in `graphPanelsService.ts`, once provider-apis carries the entry on its rows.
 */
import type { PullRequest, PullRequestMergeQueueEntry, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { getPullRequestNumberFromUrl } from '@gitlens/git/utils/pullRequest.utils.js';

/** The distinct base branches of the open pull requests — the queues worth asking about. */
export function getMergeQueueBaseBranches(prs: readonly PullRequest[]): string[] {
	const branches = new Set<string>();
	for (const pr of prs) {
		if (pr.state !== 'opened') continue;

		const base = pr.refs?.base?.branch;
		if (base) {
			branches.add(base);
		}
	}
	return [...branches];
}

/**
 * The pull request's queue as the merge-queue helpers read it: its own entry when its read selected one, else the
 * joined entry for its number. `PullRequest` is readonly, so the join is a view over it rather than a copy.
 */
export function joinPullRequestMergeQueue(
	pr: PullRequest,
	mergeQueueByNumber: ReadonlyMap<number, PullRequestMergeQueueEntry> | undefined,
): Pick<PullRequestShape, 'state' | 'updatedDate' | 'mergeQueue' | 'mergeQueueRemoval'> {
	if (pr.mergeQueue != null || mergeQueueByNumber == null) return pr;

	// `PullRequest.id` is the number only on the provider-native path; the URL carries it on both.
	const entry = mergeQueueByNumber.get(Number(getPullRequestNumberFromUrl(pr.url) ?? pr.id));
	return entry != null
		? { state: pr.state, updatedDate: pr.updatedDate, mergeQueue: entry, mergeQueueRemoval: pr.mergeQueueRemoval }
		: pr;
}
