import type { ConflictDetectionErrorReason, ConflictDetectionResult } from '../models/mergeConflicts.js';

export function createConflictDetectionError(reason: ConflictDetectionErrorReason): ConflictDetectionResult {
	return { status: 'error', reason: reason, message: getConflictDetectionErrorMessage(reason) };
}

function getConflictDetectionErrorMessage(reason: ConflictDetectionErrorReason): string {
	switch (reason) {
		case 'unsupported':
			return 'Unable to detect conflicts because Git 2.38 or later is required';
		case 'noParent':
			return 'Unable to detect conflicts because the selection includes the initial commit';
		case 'noMergeBase':
			return "Unable to detect conflicts because the branches don't share a common history";
		case 'refNotFound':
			return "Unable to detect conflicts because the branch or commit doesn't exist";
		case 'other':
		default:
			return 'Unable to detect conflicts';
	}
}
