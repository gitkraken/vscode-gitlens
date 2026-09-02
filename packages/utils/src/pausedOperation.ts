/** Dependency-free git vocabulary shared by `packages/git`, the host, and the renderer kernel
 *  (`@gitkraken/commit-graph-ui`), which must not depend on `@gitlens/git`; it lives here for that reason. */
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

/** The leading phrase naming the operation's state — shared by the paused-operation bar, the WIP header
 *  badge, and the graph's work-directory row so they can't disagree. Callers whose surface needs a
 *  different conflicts phrasing substitute their own for that variant only. */
export function getPausedOperationLabel(status: PausedOperationStatus, variant: PausedOperationVariant): string {
	const strings = pausedOperationStatusStringsByType[status.type];
	// Title Case throughout — these read as state names on a pill or a bar, not as prose.
	if (variant === 'conflicts') return `${strings.prose} Paused`;
	// The shared `pending` string trails a preposition for callers that append a ref inline (the tree
	// view). The bar's refs can shed, so it carries that "of" inside the refs group instead.
	if (variant === 'pending' && status.type === 'rebase') return 'Pending Rebase';

	return strings.label;
}
