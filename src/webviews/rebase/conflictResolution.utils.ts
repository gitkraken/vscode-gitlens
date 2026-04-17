import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';

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
