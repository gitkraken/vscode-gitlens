'use strict';
import { GitStatusFile } from './status';

export interface GitMergeStatus {
	repoPath: string;
	into: string;
	mergeBase: string | undefined;
	incoming: string | undefined;
	conflicts: GitStatusFile[];
}
