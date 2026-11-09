import * as l10n from '@vscode/l10n';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeQueueState } from '@gitlens/git/models/pullRequest.js';
import {
	formatPullRequestMergeQueueStatus,
	isPullRequestInMergeQueue,
	isPullRequestMergeQueueRemovalCurrent,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { exhaustiveArray } from '@gitlens/utils/array.js';
import {
	formatMergeQueueRemoval,
	isMergeQueueRemovalFailed,
} from '../../integrations/utils/pullRequest.mergeQueue.utils.js';

export const launchpadActionCategories = [
	'mergeable',
	'unassigned-reviewers',
	'failed-checks',
	'conflicts',
	'needs-my-review',
	'changes-requested',
	'reviewer-commented',
	'queue-failing',
	'waiting-for-review',
	'queued',
	'draft',
	'other',
] as const;
export type LaunchpadActionCategory = (typeof launchpadActionCategories)[number];

export const launchpadGroups = [
	'current-branch',
	'pinned',
	'mergeable',
	'blocked',
	'follow-up',
	'needs-review',
	'waiting-for-review',
	'merge-queue',
	'draft',
	'other',
	'snoozed',
] as const;
export type LaunchpadGroup = (typeof launchpadGroups)[number];

export const launchpadPriorityGroups = exhaustiveArray<LaunchpadPriorityGroup>()([
	'mergeable',
	'blocked',
	'follow-up',
	'needs-review',
]) as readonly LaunchpadGroup[];
export type LaunchpadPriorityGroup = Extract<LaunchpadGroup, 'mergeable' | 'blocked' | 'follow-up' | 'needs-review'>;

export const launchpadGroupIconMap = new Map<LaunchpadGroup, `$(${string})`>([
	['current-branch', '$(git-branch)'],
	['pinned', '$(pinned)'],
	['mergeable', '$(rocket)'],
	['blocked', '$(error)'], //bracket-error
	['follow-up', '$(report)'],
	['needs-review', '$(comment-unresolved)'], // feedback
	['waiting-for-review', '$(gitlens-clock)'],
	['merge-queue', '$(history)'],
	['draft', '$(git-pull-request-draft)'],
	['other', '$(ellipsis)'],
	['snoozed', '$(bell-slash)'],
]);

export const launchpadGroupLabelMap = new Map<LaunchpadGroup, string>([
	['current-branch', l10n.t('Current Branch')],
	['pinned', l10n.t('Pinned')],
	['mergeable', l10n.t('Ready to Merge')],
	['blocked', l10n.t('Blocked')],
	['follow-up', l10n.t('Requires Follow-up')],
	['needs-review', l10n.t('Needs Your Review')],
	['waiting-for-review', l10n.t('Waiting for Review')],
	['merge-queue', l10n.t('In Merge Queue')],
	['draft', l10n.t('Draft')],
	['other', l10n.t('Other')],
	['snoozed', l10n.t('Snoozed')],
]);

export const launchpadCategoryToGroupMap = new Map<LaunchpadActionCategory, LaunchpadGroup>([
	['mergeable', 'mergeable'],
	['conflicts', 'blocked'],
	['failed-checks', 'blocked'],
	['unassigned-reviewers', 'blocked'],
	['queue-failing', 'blocked'],
	['needs-my-review', 'needs-review'],
	['changes-requested', 'follow-up'],
	['reviewer-commented', 'follow-up'],
	['waiting-for-review', 'waiting-for-review'],
	['queued', 'merge-queue'],
	['draft', 'draft'],
	['other', 'other'],
]);

const sharedCategoryToLaunchpadActionCategoryMap = new Map<string, LaunchpadActionCategory>([
	['readyToMerge', 'mergeable'],
	['unassignedReviewers', 'unassigned-reviewers'],
	['failingCI', 'failed-checks'],
	['conflicts', 'conflicts'],
	['needsMyReview', 'needs-my-review'],
	['changesRequested', 'changes-requested'],
	['reviewerCommented', 'reviewer-commented'],
	['waitingForReview', 'waiting-for-review'],
	['draft', 'draft'],
	['other', 'other'],
]);

/** The pull request fields the merge-queue category and detail read. */
export type LaunchpadMergeQueuePullRequest = Pick<
	PullRequestShape,
	'state' | 'updatedDate' | 'mergeQueue' | 'mergeQueueRemoval'
>;

/**
 * The category a pull request waiting in a merge queue — or just removed from one by a failed queue run — takes instead
 * of the one `getActionablePullRequests` gave it, or `undefined` otherwise. The shared categorizer knows nothing about
 * merge queues, so a queued, approved, green pull request comes back "Ready to Merge", and so does one whose queue run
 * just failed (it looks healthy again once removed) — every site that maps a shared category applies this after it so
 * none of them can disagree. A removal by hand isn't a failure, so it keeps the shared category.
 */
export function getMergeQueueActionCategory(pr: LaunchpadMergeQueuePullRequest): LaunchpadActionCategory | undefined {
	if (isPullRequestInMergeQueue(pr)) {
		return pr.mergeQueue.state === PullRequestMergeQueueState.Unmergeable ? 'queue-failing' : 'queued';
	}

	return isPullRequestMergeQueueRemovalCurrent(pr) && isMergeQueueRemovalFailed(pr.mergeQueueRemoval)
		? 'queue-failing'
		: undefined;
}

/** The merge-queue status a Launchpad item's detail shows: where it stands in its queue, or its removal from one while
 *  that still describes it. `undefined` when neither applies. */
export function getLaunchpadMergeQueueStatus(pr: LaunchpadMergeQueuePullRequest): string | undefined {
	if (isPullRequestInMergeQueue(pr)) return formatPullRequestMergeQueueStatus(pr.mergeQueue);
	if (isPullRequestMergeQueueRemovalCurrent(pr)) return formatMergeQueueRemoval(pr.mergeQueueRemoval);

	return undefined;
}

/**
 * The Launchpad category for a pull request the shared categorizer gave `sharedCategory`: the merge-queue category
 * while it's queued or failed out of its queue (see {@link getMergeQueueActionCategory}), otherwise the shared category's mapping. A shared
 * category this map doesn't know yet (provider-apis can add some) is `other` rather than nothing.
 */
export function getLaunchpadActionCategory(
	sharedCategory: string,
	pr: LaunchpadMergeQueuePullRequest,
): LaunchpadActionCategory {
	return getMergeQueueActionCategory(pr) ?? sharedCategoryToLaunchpadActionCategoryMap.get(sharedCategory) ?? 'other';
}

export type LaunchpadAction =
	| 'merge'
	| 'dequeue'
	| 'rebase-stack'
	| 'open'
	| 'soft-open'
	| 'switch'
	| 'open-worktree'
	| 'start-review'
	| 'show-overview'
	| 'open-changes'
	| 'open-in-graph';

export const prActionsMap = new Map<LaunchpadActionCategory, LaunchpadAction[]>([
	['mergeable', ['merge']],
	['unassigned-reviewers', ['open']],
	['failed-checks', ['open']],
	['conflicts', ['open']],
	['queue-failing', ['open']],
	['needs-my-review', ['open']],
	['changes-requested', ['open']],
	['reviewer-commented', ['open']],
	['waiting-for-review', ['open']],
	['queued', ['open', 'dequeue']],
	['draft', ['open']],
	['other', []],
]);

export const actionGroupMap = new Map<
	LaunchpadActionCategory,
	readonly [
		label: string,
		detail: (
			author: string | null,
			createdDateRelative: string | null,
			pr: LaunchpadMergeQueuePullRequest,
		) => string,
	]
>([
	['mergeable', [l10n.t('Ready to Merge'), () => l10n.t('Ready to merge')]],
	['unassigned-reviewers', [l10n.t('Unassigned Reviewers'), () => l10n.t('You need to assign reviewers')]],
	['failed-checks', [l10n.t('Failed Checks'), () => l10n.t('You need to resolve the failing checks')]],
	['conflicts', [l10n.t('Resolve Conflicts'), () => l10n.t('You need to resolve merge conflicts')]],
	[
		'queue-failing',
		[
			l10n.t('Failing in Merge Queue'),
			(_author, _createdDateRelative, pr) =>
				isPullRequestInMergeQueue(pr)
					? l10n.t('The merge queue will remove this pull request')
					: (getLaunchpadMergeQueueStatus(pr) ?? l10n.t('The merge queue will remove this pull request')),
		],
	],
	[
		'needs-my-review',
		[
			l10n.t('Needs Your Review'),
			author =>
				author == null
					? l10n.t('An unknown author requested your review')
					: l10n.t('{author} requested your review', { author: author }),
		],
	],
	[
		'changes-requested',
		[l10n.t('Changes Requested'), () => l10n.t('Reviewers requested changes before this can be merged')],
	],
	[
		'reviewer-commented',
		[l10n.t('Reviewers Commented'), () => l10n.t('Reviewers have commented on this pull request')],
	],
	[
		'waiting-for-review',
		[l10n.t('Waiting for Review'), () => l10n.t('Waiting for reviewers to approve this pull request')],
	],
	[
		'queued',
		[
			l10n.t('In Merge Queue'),
			(_author, _createdDateRelative, pr) => getLaunchpadMergeQueueStatus(pr) ?? l10n.t('Queued to merge'),
		],
	],
	['draft', [l10n.t('Draft'), () => l10n.t('Continue working on your draft')]],
	[
		'other',
		[
			l10n.t('Other'),
			(author, createdDateRelative) => {
				if (author == null) {
					return createdDateRelative == null
						? l10n.t('Opened')
						: l10n.t('Opened {createdDateRelative}', { createdDateRelative: createdDateRelative });
				}

				return createdDateRelative == null
					? l10n.t('Opened by {author}', { author: author })
					: l10n.t('Opened by {author} {createdDateRelative}', {
							author: author,
							createdDateRelative: createdDateRelative,
						});
			},
		],
	],
]);
