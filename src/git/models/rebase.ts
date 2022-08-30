import type { GitBranchReference, GitRevisionReference } from './reference';

export interface GitRebaseStatus {
	type: 'rebase';
	repoPath: string;
	HEAD: GitRevisionReference;
	onto: GitRevisionReference;
	mergeBase: string | undefined;
	current: GitBranchReference | undefined;
	incoming: GitBranchReference;

	steps: {
		current: { number: number; commit: GitRevisionReference };
		total: number;
	};
}
