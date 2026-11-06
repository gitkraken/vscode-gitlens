/**
 * Merge-queue wording and routing shared by the host (Launchpad, the merge flow, views) and the webviews (Graph PR and
 * branch sheets), so every surface describes a queued or removed pull request — and decides between merging and
 * queueing — the same way. Pure: no `vscode`, no container.
 */
import * as l10n from '@vscode/l10n';
import type {
	PullRequestMergeQueueActionFailureReason,
	PullRequestStackInfo,
} from '@gitlens/git/models/pullRequest.js';
import {
	getPullRequestMergeQueueRemovalKind,
	getStackedMergeCount,
	isPullRequestInMergeQueue,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { fromNow } from '@gitlens/utils/date.js';

/** The merge-queue removal fields the status text reads — satisfied by the model's removal and the serialized one. */
export interface MergeQueueStatusRemoval {
	readonly reason: string;
	/** A date on the model's removal, a timestamp (ms) on the serialized one. */
	readonly removedAt: Date | number;
}

/** Whether a merge-queue removal means the pull request's queue run failed, rather than someone removing it. */
export function isMergeQueueRemovalFailed(removal: Pick<MergeQueueStatusRemoval, 'reason'>): boolean {
	return getPullRequestMergeQueueRemovalKind(removal.reason) === 'failed';
}

/**
 * Describes a pull request's removal from its merge queue ("Removed from the merge queue 5 minutes ago — checks
 * failed"). Only a failed run names its reason: the provider's other reasons are undocumented identifiers, not text.
 */
export function formatMergeQueueRemoval(removal: MergeQueueStatusRemoval): string {
	const time = fromNow(removal.removedAt);
	return isMergeQueueRemovalFailed(removal)
		? l10n.t('Removed from the merge queue {time} — checks failed', { time: time })
		: l10n.t('Removed from the merge queue {time}', { time: time });
}

/**
 * What a pull request's Merge action does:
 * - `queued` — it's already waiting in a merge queue, which merges it; there is nothing to merge.
 * - `enqueue` — its base branch accepts it only through a merge queue, so merging means adding it to the queue.
 * - `merge` — merge it directly. Also where `mergeQueueRequired` is unknown (not read), and for a stacked merge
 *   that lands more than one pull request, which keeps the stacked merge path.
 */
export type PullRequestMergeRoute = 'merge' | 'enqueue' | 'queued';

export function getPullRequestMergeRoute(
	pr: {
		readonly state?: string;
		readonly mergeQueue?: unknown;
		readonly mergeQueueRequired?: boolean;
		readonly stack?: Pick<PullRequestStackInfo, 'position' | 'size'>;
	},
	options?: { wholeStack?: boolean },
): PullRequestMergeRoute {
	if (isPullRequestInMergeQueue(pr)) return 'queued';
	if (pr.mergeQueueRequired === true && getStackedMergeCount(pr.stack, options) <= 1) return 'enqueue';

	return 'merge';
}

/**
 * The message for a failed attempt to add a pull request to its merge queue (`enqueue`) or remove it (`dequeue`),
 * worded from the failure's reason. Never the provider's own message, which is for logs.
 */
export function getMergeQueueActionFailureMessage(
	action: 'enqueue' | 'dequeue',
	number: string,
	reason: PullRequestMergeQueueActionFailureReason,
): string {
	if (action === 'dequeue') {
		switch (reason) {
			case 'permission':
				return l10n.t("Unable to remove #{number} from the merge queue: you don't have permission", {
					number: number,
				});
			case 'unsupported':
				return l10n.t(
					"Unable to remove #{number} from the merge queue: merge queues aren't supported for its provider",
					{ number: number },
				);
			default:
				return l10n.t('Unable to remove #{number} from the merge queue', { number: number });
		}
	}

	switch (reason) {
		case 'already-queued':
			return l10n.t("Unable to add #{number} to the merge queue: it's already queued", { number: number });
		case 'head-changed':
			return l10n.t('Unable to add #{number} to the merge queue: its branch changed, so try again', {
				number: number,
			});
		case 'not-allowed':
			return l10n.t("Unable to add #{number} to the merge queue: it doesn't meet the queue's requirements", {
				number: number,
			});
		case 'permission':
			return l10n.t("Unable to add #{number} to the merge queue: you don't have permission", {
				number: number,
			});
		case 'unsupported':
			return l10n.t(
				"Unable to add #{number} to the merge queue: merge queues aren't supported for its provider",
				{ number: number },
			);
		default:
			return l10n.t('Unable to add #{number} to the merge queue', { number: number });
	}
}
