import type { GitBranchReference, GitRevisionReference, GitTagReference } from './reference';

export type GitPausedOperationStatus = GitCherryPickStatus | GitMergeStatus | GitRebaseStatus | GitRevertStatus;
export type GitPausedOperation =
	| GitCherryPickStatus['type']
	| GitMergeStatus['type']
	| GitRebaseStatus['type']
	| GitRevertStatus['type'];

export interface GitCherryPickStatus {
	type: 'cherry-pick';
	repoPath: string;
	HEAD: GitRevisionReference;
	current: GitBranchReference;
	incoming: GitRevisionReference;

	mergeBase?: never;
}

export interface GitMergeStatus {
	type: 'merge';
	repoPath: string;
	HEAD: GitRevisionReference;
	current: GitBranchReference;
	incoming: GitBranchReference | GitRevisionReference;

	mergeBase: string | undefined;
}

export interface GitRebaseStatus {
	type: 'rebase';
	repoPath: string;
	HEAD: GitRevisionReference;
	current: GitBranchReference | GitTagReference | undefined;
	incoming: GitBranchReference | GitRevisionReference;

	mergeBase: string | undefined;
	onto: GitRevisionReference;

	steps: {
		current: { number: number; commit: GitRevisionReference | undefined };
		total: number;
	};
}

export interface GitRevertStatus {
	type: 'revert';
	repoPath: string;
	HEAD: GitRevisionReference;
	current: GitBranchReference;
	incoming: GitRevisionReference;

	mergeBase?: never;
}

export const statusStringsByType = {
	'cherry-pick': {
		label: 'Cherry picking',
		conflicts: 'Resolve conflicts to continue cherry picking',
		directionality: 'into',
	},
	merge: {
		label: 'Merging',
		conflicts: 'Resolve conflicts to continue merging',
		directionality: 'into',
	},
	rebase: {
		label: 'Rebasing',
		conflicts: 'Resolve conflicts to continue rebasing',
		directionality: 'onto',
		pending: 'Pending rebase of',
	},
	revert: {
		label: 'Reverting',
		conflicts: 'Resolve conflicts to continue reverting',
		directionality: 'in',
	},
} as const;
