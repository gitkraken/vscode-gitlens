import type { GitPausedOperationStatus } from '../models/pausedOperationStatus.js';
import type { GitReference } from '../models/reference.js';

/**
 * Gets the ref for the incoming side of a conflict:
 * - rebase: REBASE_HEAD (the commit being applied)
 * - revert: parent of REVERT_HEAD (git's "theirs" in a revert is the state before the reverted commit)
 * - cherry-pick/merge: the operation-specific HEAD (CHERRY_PICK_HEAD, MERGE_HEAD)
 */
export function getConflictIncomingRef(status: GitPausedOperationStatus): string | undefined {
	if (status.type === 'rebase') return status.steps.current.commit?.ref ?? status.HEAD.ref;
	if (status.type === 'revert') return `${status.HEAD.ref}^`;
	return status.HEAD.ref;
}

/**
 * Gets the reference representing the "current" (ours/HEAD) side of the operation
 * For rebase, falls back to `onto` when no branch/tag points at the onto commit
 */
export function getConflictCurrentRef(status: GitPausedOperationStatus): GitReference | undefined {
	if (status.type === 'rebase') return status.current ?? status.onto;
	return status.current;
}

export const pausedOperationStatusStringsByType = {
	'cherry-pick': {
		label: 'Cherry picking',
		conflicts: 'Resolve conflicts to continue cherry picking',
		directionality: 'into',
	},
	merge: {
		label: 'Merging',
		conflicts: 'Resolve conflicts to continue merging',
		directionality: 'into',
	},
	rebase: {
		label: 'Rebasing',
		conflicts: 'Resolve conflicts to continue rebasing',
		directionality: 'onto',
		pending: 'Pending rebase of',
	},
	revert: {
		label: 'Reverting',
		conflicts: 'Resolve conflicts to continue reverting',
		directionality: 'in',
	},
} as const;
