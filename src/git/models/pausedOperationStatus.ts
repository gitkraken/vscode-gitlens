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
	/** The original HEAD of the branch being rebased (before rebase started) */
	source: GitRevisionReference;

	steps: {
		current: { number: number; commit: GitRevisionReference | undefined };
		total: number;
	};

	/** True if the rebase has started processing commits (step > 0) */
	hasStarted: boolean;
	/** True if we're confident the rebase is paused and waiting for user action (REBASE_HEAD exists) */
	isPaused: boolean;
	/** True if this is an interactive rebase (git rebase -i), false for non-interactive (e.g. git pull --rebase) */
	isInteractive: boolean;
}

export interface GitRevertStatus {
	type: 'revert';
	repoPath: string;
	HEAD: GitRevisionReference;
	current: GitBranchReference;
	incoming: GitRevisionReference;

	mergeBase?: never;
}
