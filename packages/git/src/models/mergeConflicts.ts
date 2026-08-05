export interface MergeConflicts {
	repoPath: string;
	branch: string;
	target: string;
	files: MergeConflictFile[];
	shas?: string[];
}

export interface MergeConflictFile {
	path: string;
}

export type ConflictDetectionErrorReason = 'unsupported' | 'noParent' | 'noMergeBase' | 'refNotFound' | 'other';

export type ConflictDetectionResult =
	// `treeOid` is the tree the simulated integration produced, when the provider computed one — callers layer further simulations onto it
	| { status: 'clean'; treeOid?: string }
	| { status: 'conflicts'; conflict: MergeConflicts; stoppedOnFirstConflict?: boolean; treeOid?: string }
	| { status: 'error'; reason: ConflictDetectionErrorReason; message: string };
