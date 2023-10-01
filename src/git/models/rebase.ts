import type { GitBranchReference, GitRevisionReference, GitTagReference } from './reference';

export interface GitRebaseStatus {
	type: 'rebase';
	repoPath: string;
	HEAD: GitRevisionReference;
	onto: GitRevisionReference;
	mergeBase: string | undefined;
	current: GitBranchReference | GitTagReference | undefined;
	incoming: GitBranchReference;

	steps: {
		current: { number: number; commit: GitRevisionReference | undefined };
		total: number;
	};
}
