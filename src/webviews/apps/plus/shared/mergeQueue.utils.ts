import * as l10n from '@vscode/l10n';
import type { PullRequestMergeQueueEntry } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import { isPullRequestInMergeQueue } from '@gitlens/git/utils/pullRequest.utils.js';
import { formatPlural } from '@gitlens/utils/plural.js';

/** The merge-queue fields the webviews read — satisfied by both the model's entry and the serialized one. */
export interface MergeQueueEntryLike extends Pick<PullRequestMergeQueueEntry, 'state' | 'url' | 'position'> {
	/** A date on the model's entry, a timestamp (ms) on the serialized one. */
	readonly estimatedMergeAt?: Date | number;
}

/** The slice of any webview pull request shape the merge-queue rule needs. */
export interface QueueablePullRequest {
	readonly state: string | undefined;
	readonly mergeQueue?: MergeQueueEntryLike;
}

/** The pull request's merge-queue entry while it's open and queued, otherwise `undefined`. Any entry state counts,
 *  Unmergeable included: until the pull request merges or leaves the queue, the queue owns its branch. */
export function getQueuedPullRequestEntry(pr: QueueablePullRequest | undefined): MergeQueueEntryLike | undefined {
	return pr != null && isPullRequestInMergeQueue(pr) ? pr.mergeQueue : undefined;
}

/** Whether the pull request is waiting in a merge queue — the signal to stop suggesting branch-changing actions
 *  (push, force push, rebase or merge with the merge target, recompose, rebase stack). */
export function isPullRequestQueued(pr: QueueablePullRequest | undefined): boolean {
	return pr != null && isPullRequestInMergeQueue(pr);
}

export function isMergeQueueEntryFailing(entry: MergeQueueEntryLike): boolean {
	return entry.state === PullRequestMergeQueueState.Unmergeable;
}

/** The merge-target relationship, reduced to what the queue rule distinguishes. */
export type MergeTargetQueueState = 'merged' | 'conflicts' | 'behind' | 'in-sync';

/**
 * How a merge-target surface treats its state while the pull request is queued:
 * - `default` — not queued, or a state the queue doesn't change (merged, in sync): render as usual.
 * - `warning` — conflicts: still shown as a warning, but with no Rebase/Merge action.
 * - `queue-handled` — behind: reads as the queue's job, with no Rebase/Merge action.
 */
export type MergeTargetQueueTreatment = 'default' | 'warning' | 'queue-handled';

/** The one queue rule the merge-target chip, the WIP pane's merge-target step and the branch sheet's merge-target
 *  card all apply, so their verdict implementations can stay separate without drifting on it. */
export function getMergeTargetQueueTreatment(
	pr: QueueablePullRequest | undefined,
	state: MergeTargetQueueState,
): MergeTargetQueueTreatment {
	if (!isPullRequestQueued(pr)) return 'default';

	switch (state) {
		case 'conflicts':
			return 'warning';
		case 'behind':
			return 'queue-handled';
		default:
			return 'default';
	}
}

/** The single note shown in place of the branch-changing suggestions a queued pull request withholds. Says nothing
 *  about what those actions would do to the queue, which is unverified. */
export function getMergeQueueNote(): string {
	return l10n.t(
		"This pull request is in the merge queue, so changes to its branch aren't suggested until it merges or leaves the queue.",
	);
}

/** A merge target the branch is behind, worded as the queue's job rather than something to rebase or merge. */
export function formatQueueHandledBehind(count: number, target: string): string {
	return formatPlural(
		l10n.t(
			'{count, plural, one{{count} commit behind {target}, handled by the merge queue} other{{count} commits behind {target}, handled by the merge queue}}',
		),
		{ count: count, target: target },
	);
}
