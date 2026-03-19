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
	| { status: 'clean' }
	| { status: 'conflicts'; conflict: MergeConflicts; stoppedOnFirstConflict?: boolean }
	| { status: 'error'; reason: ConflictDetectionErrorReason; message: string };
