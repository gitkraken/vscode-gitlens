'use strict';
import { GitBranchReference, GitRevisionReference } from './models';

export interface GitMergeStatus {
	type: 'merge';
	repoPath: string;
	HEAD: GitRevisionReference;
	mergeBase: string | undefined;
	current: GitBranchReference;
	incoming: GitBranchReference | undefined;
}
