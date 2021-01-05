'use strict';
import { GitBranchReference, GitRevisionReference } from './models';

export interface GitRebaseStatus {
	type: 'rebase';
	repoPath: string;
	HEAD: GitRevisionReference;
	mergeBase: string | undefined;
	current: GitBranchReference | undefined;
	incoming: GitBranchReference;

	step: number | undefined;
	stepCurrent: GitRevisionReference;
	steps: number | undefined;
}
