import type { PullRequestShape } from '../models/pullRequest.js';
import { getPullRequestNumberFromUrl } from './pullRequest.utils.js';

export interface BranchLandedPullRequestCandidate {
	readonly pullRequest: Pick<PullRequestShape, 'id' | 'url' | 'title' | 'state' | 'refs'>;
	/**
	 * Commits on the branch that are in neither this pull request's head nor the merge target, when known. Only read
	 * for a merged pull request whose head isn't the tip; leaving it `undefined` leaves that pull request undecided.
	 */
	readonly newCommits?: number;
}

export interface BranchLandedState {
	/** An open pull request's head is the tip, so the branch is live and nothing landed, whatever git evidence says */
	live?: true;
	landed?: {
		via: 'pr';
		confidence: 'highest';
		/** `id` is the pull request's display number where its url names one */
		pullRequest: { id: string; url: string; title?: string };
	};
	/** The pull request merged, but the branch has commits it didn't carry — so the branch itself hasn't landed */
	successor?: { pullRequest: { id: string; url: string }; newCommits: number };
}

/**
 * What a branch's pull requests say about whether its work landed. The head sha decides, never recency:
 * - an open pull request whose head is the tip is live (`live`), so nothing landed
 * - a merged pull request whose head is the tip landed
 * - else the merged pull request with the fewest new commits (the first on a tie): none → landed, some → successor
 *
 * A pull request without a head sha (some non-GitHub hosts) never decides, so git evidence can.
 */
export function getBranchLandedState(
	tipSha: string | undefined,
	candidates: readonly BranchLandedPullRequestCandidate[],
): BranchLandedState {
	if (!tipSha) return {};

	let atTip: BranchLandedPullRequestCandidate | undefined;
	let best: BranchLandedPullRequestCandidate | undefined;
	for (const candidate of candidates) {
		const { state, refs } = candidate.pullRequest;
		const headSha = refs?.head?.sha;
		if (!headSha) continue;

		if (headSha === tipSha) {
			if (state === 'opened') return { live: true };

			if (state === 'merged') {
				atTip ??= candidate;
			}
			continue;
		}

		if (state !== 'merged' || candidate.newCommits == null) continue;

		if (best?.newCommits == null || candidate.newCommits < best.newCommits) {
			best = candidate;
		}
	}

	if (atTip != null) return { landed: toLanded(atTip.pullRequest) };
	if (best?.newCommits == null) return {};
	if (best.newCommits === 0) return { landed: toLanded(best.pullRequest) };

	const { id, url } = toLandedPullRequest(best.pullRequest);
	return {
		successor: {
			pullRequest: { id: id, url: url },
			newCommits: best.newCommits,
		},
	};
}

function toLanded(pr: BranchLandedPullRequestCandidate['pullRequest']): NonNullable<BranchLandedState['landed']> {
	return {
		via: 'pr',
		confidence: 'highest',
		pullRequest: toLandedPullRequest(pr),
	};
}

function toLandedPullRequest(pr: BranchLandedPullRequestCandidate['pullRequest']): {
	id: string;
	url: string;
	title?: string;
} {
	return {
		id: getPullRequestNumberFromUrl(pr.url) ?? pr.id,
		url: pr.url,
		title: pr.title,
	};
}
