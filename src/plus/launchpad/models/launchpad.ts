export const launchpadActionCategories = [
	'mergeable',
	'unassigned-reviewers',
	'failed-checks',
	'conflicts',
	'needs-my-review',
	'code-suggestions',
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

export const launchpadPriorityGroups = [
	'mergeable',
	'blocked',
	'follow-up',
	'needs-review',
] satisfies readonly LaunchpadPriorityGroup[] as readonly LaunchpadGroup[];
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
	['current-branch', 'Current Branch'],
	['pinned', 'Pinned'],
	['mergeable', 'Ready to Merge'],
	['blocked', 'Blocked'],
	['follow-up', 'Requires Follow-up'],
	['needs-review', 'Needs Your Review'],
	['waiting-for-review', 'Waiting for Review'],
	['draft', 'Draft'],
	['other', 'Other'],
	['snoozed', 'Snoozed'],
]);

export const launchpadCategoryToGroupMap = new Map<LaunchpadActionCategory, LaunchpadGroup>([
	['mergeable', 'mergeable'],
	['conflicts', 'blocked'],
	['failed-checks', 'blocked'],
	['unassigned-reviewers', 'blocked'],
	['needs-my-review', 'needs-review'],
	['code-suggestions', 'follow-up'],
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
	| 'switch-and-code-suggest'
	| 'open-worktree'
	| 'code-suggest'
	| 'show-overview'
	| 'open-changes'
	| 'open-in-graph';

export type LaunchpadTargetAction = {
	action: 'open-suggestion';
	target: string;
};

export const prActionsMap = new Map<LaunchpadActionCategory, LaunchpadAction[]>([
	['mergeable', ['merge']],
	['unassigned-reviewers', ['open']],
	['failed-checks', ['open']],
	['conflicts', ['open']],
	['needs-my-review', ['open']],
	['code-suggestions', ['open']],
	['changes-requested', ['open']],
	['reviewer-commented', ['open']],
	['waiting-for-review', ['open']],
	['draft', ['open']],
	['other', []],
]);

export const actionGroupMap = new Map<LaunchpadActionCategory, string[]>([
	['mergeable', ['Ready to Merge', 'Ready to merge']],
	['unassigned-reviewers', ['Unassigned Reviewers', 'You need to assign reviewers']],
	['failed-checks', ['Failed Checks', 'You need to resolve the failing checks']],
	['conflicts', ['Resolve Conflicts', 'You need to resolve merge conflicts']],
	['needs-my-review', ['Needs Your Review', `\${author} requested your review`]],
	['code-suggestions', ['Code Suggestions', 'Code suggestions have been made on this pull request']],
	['changes-requested', ['Changes Requested', 'Reviewers requested changes before this can be merged']],
	['reviewer-commented', ['Reviewers Commented', 'Reviewers have commented on this pull request']],
	['waiting-for-review', ['Waiting for Review', 'Waiting for reviewers to approve this pull request']],
	['draft', ['Draft', 'Continue working on your draft']],
	['other', ['Other', `Opened by \${author} \${createdDateRelative}`]],
]);
