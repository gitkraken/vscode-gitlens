export type PausedOperationType = 'cherry-pick' | 'merge' | 'rebase' | 'revert';

export type PausedOperationStatus = {
	type: PausedOperationType;
	steps?: { total: number };
};

/** `name` is Title Case for actions; `prose` is the sentence form. */
export const pausedOperationStatusStringsByType = {
	'cherry-pick': {
		name: 'Cherry Pick',
		prose: 'Cherry-pick',
		label: 'Cherry picking',
		conflicts: 'Resolve conflicts to continue cherry picking',
		directionality: 'into',
	},
	merge: {
		name: 'Merge',
		prose: 'Merge',
		label: 'Merging',
		conflicts: 'Resolve conflicts to continue merging',
		directionality: 'into',
	},
	rebase: {
		name: 'Rebase',
		prose: 'Rebase',
		label: 'Rebasing',
		conflicts: 'Resolve conflicts to continue rebasing',
		directionality: 'onto',
		pending: 'Pending rebase of',
	},
	revert: {
		name: 'Revert',
		prose: 'Revert',
		label: 'Reverting',
		conflicts: 'Resolve conflicts to continue reverting',
		directionality: 'in',
	},
} as const;

export type PausedOperationVariant = 'conflicts' | 'pending' | 'ready';

export const pausedOperationVariantIcons: Readonly<Record<PausedOperationVariant, string>> = Object.freeze({
	conflicts: 'warning',
	pending: 'circle-outline',
	ready: 'check',
});

/** Unresolved conflicts outrank a rebase that has not reached its first step. */
export function getPausedOperationVariant(
	status: PausedOperationStatus,
	hasConflicts: boolean,
): PausedOperationVariant {
	if (hasConflicts) return 'conflicts';
	if (status.type === 'rebase' && status.steps?.total === 0) return 'pending';
	return 'ready';
}
