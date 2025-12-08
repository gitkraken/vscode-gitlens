import type { RebaseTodoCommandAction, RebaseTodoCommitAction, RebaseTodoMergesAction } from '../models/rebase';

/** Commit actions that have SHAs and are editable */
export const commitRebaseActions = new Set<RebaseTodoCommitAction>([
	'pick',
	'reword',
	'edit',
	'squash',
	'fixup',
	'drop',
]);

/** Command actions that are movable but not editable */
export const commandRebaseActions = new Set<RebaseTodoCommandAction>(['exec', 'break', 'noop']);

/** Actions that indicate --rebase-merges mode */
export const mergesRebaseActions = new Set<RebaseTodoMergesAction>(['label', 'reset', 'merge']);
