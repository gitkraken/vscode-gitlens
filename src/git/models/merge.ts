import type { GitBranchReference, GitRevisionReference } from './reference';

export interface GitMergeStatus {
	type: 'merge';
	repoPath: string;
	HEAD: GitRevisionReference;
	mergeBase: string | undefined;
	current: GitBranchReference;
	incoming: GitBranchReference | undefined;
}
