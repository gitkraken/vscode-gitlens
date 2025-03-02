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
