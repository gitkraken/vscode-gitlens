import * as l10n from '@vscode/l10n';
import { exhaustiveArray } from '@gitlens/utils/array.js';

export const launchpadActionCategories = [
	'mergeable',
	'unassigned-reviewers',
	'failed-checks',
	'conflicts',
	'needs-my-review',
	'changes-requested',
	'reviewer-commented',
	'waiting-for-review',
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
	['draft', l10n.t('Draft')],
	['other', l10n.t('Other')],
	['snoozed', l10n.t('Snoozed')],
]);

export const launchpadCategoryToGroupMap = new Map<LaunchpadActionCategory, LaunchpadGroup>([
	['mergeable', 'mergeable'],
	['conflicts', 'blocked'],
	['failed-checks', 'blocked'],
	['unassigned-reviewers', 'blocked'],
	['needs-my-review', 'needs-review'],
	['changes-requested', 'follow-up'],
	['reviewer-commented', 'follow-up'],
	['waiting-for-review', 'waiting-for-review'],
	['draft', 'draft'],
	['other', 'other'],
]);

export const sharedCategoryToLaunchpadActionCategoryMap = new Map<string, LaunchpadActionCategory>([
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

export type LaunchpadAction =
	| 'merge'
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
	['needs-my-review', ['open']],
	['changes-requested', ['open']],
	['reviewer-commented', ['open']],
	['waiting-for-review', ['open']],
	['draft', ['open']],
	['other', []],
]);

export const actionGroupMap = new Map<
	LaunchpadActionCategory,
	readonly [label: string, detail: (author: string | null, createdDateRelative: string | null) => string]
>([
	['mergeable', [l10n.t('Ready to Merge'), () => l10n.t('Ready to merge')]],
	['unassigned-reviewers', [l10n.t('Unassigned Reviewers'), () => l10n.t('You need to assign reviewers')]],
	['failed-checks', [l10n.t('Failed Checks'), () => l10n.t('You need to resolve the failing checks')]],
	['conflicts', [l10n.t('Resolve Conflicts'), () => l10n.t('You need to resolve merge conflicts')]],
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
