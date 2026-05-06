import type { GitFileConflictStatus } from '../models/fileStatus.js';

export type ConflictResolutionAction = 'take-ours' | 'take-theirs' | 'delete' | 'unsupported';

export function classifyConflictAction(
	status: GitFileConflictStatus,
	resolution: 'current' | 'incoming',
): ConflictResolutionAction {
	const takeCurrent = resolution === 'current';

	if (status === 'DD') return 'delete';
	if (status === 'UD' && !takeCurrent) return 'delete';
	if (status === 'DU' && takeCurrent) return 'delete';

	// `git checkout --{ours,theirs}` fails when the requested stage is absent.
	// Single-file UI filters these out; bulk resolve surfaces them as failures.
	if (status === 'UA' && takeCurrent) return 'unsupported';
	if (status === 'AU' && !takeCurrent) return 'unsupported';

	return takeCurrent ? 'take-ours' : 'take-theirs';
}

// Stage Current is invalid when the current side has no content to take (added/deleted only by them, or both deleted)
export function canStageCurrent(status: GitFileConflictStatus): boolean {
	return status !== 'UA' && status !== 'DD';
}

// Stage Incoming is invalid when the incoming side has no content to take (added/deleted only by us, or both deleted)
export function canStageIncoming(status: GitFileConflictStatus): boolean {
	return status !== 'AU' && status !== 'DD';
}
