import type { Mutable } from '@gitlens/utils/types.js';
import type {
	ProcessedRebaseCommitEntry,
	ProcessedRebaseEntry,
	ProcessedRebaseTodo,
	RebaseTodoCommandAction,
	RebaseTodoCommitAction,
	RebaseTodoEntry,
	RebaseTodoMergesAction,
} from '../models/rebase.js';

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

export function formatRebaseTodoEntryLine(entry: ProcessedRebaseEntry, overrideAction?: string): string {
	const action = overrideAction ?? entry.action;
	if (entry.type === 'commit') {
		const flagPart = entry.flag ? ` ${entry.flag}` : '';
		return `${action}${flagPart} ${entry.sha} # ${entry.message}`;
	}

	// Command entries (exec, break, noop)
	if (entry.action === 'exec') {
		return `exec${entry.command ? ` ${entry.command}` : ''}`;
	}
	return entry.action; // break, noop
}

/** Formats an update-ref line for output */
export function formatUpdateRefLine(ref: string): string {
	return `update-ref ${ref}`;
}

/** Checks if an entry is a commit-based action */
type RebaseTodoCommitEntry = RebaseTodoEntry<RebaseTodoCommitAction> & { sha: string; message: string };
function isCommitEntry(entry: RebaseTodoEntry): entry is RebaseTodoCommitEntry {
	return (
		entry.sha != null && entry.message != null && commitRebaseActions.has(entry.action as RebaseTodoCommitAction)
	);
}

/** Checks if an entry is a command action (exec/break/noop) */
type RebaseTodoCommandEntry = RebaseTodoEntry<RebaseTodoCommandAction> & { command: string };
function isCommandEntry(entry: RebaseTodoEntry): entry is RebaseTodoCommandEntry {
	return commandRebaseActions.has(entry.action as RebaseTodoCommandAction);
}

/**
 * Checks if this is a --rebase-merges rebase that actually has merge commits
 * Only actual 'merge' commands indicate a true DAG that cannot be safely reordered.
 * If just label/reset are present (no merge), the history is linear and editable.
 */
function hasActualMergeCommands(entries: RebaseTodoEntry[]): boolean {
	return entries.some(e => e.action === 'merge');
}

/** Checks if an entry is a structural label/reset command (filtered from UI) */
function isStructuralEntry(entry: RebaseTodoEntry): boolean {
	return entry.action === 'label' || entry.action === 'reset';
}

/** Checks if an entry is an update-ref action */
type RebaseTodoUpdateRefEntry = RebaseTodoEntry<'update-ref'> & { ref: string };
function isUpdateRefEntry(entry: RebaseTodoEntry): entry is RebaseTodoUpdateRefEntry {
	return entry.action === 'update-ref' && entry.ref != null;
}

/**
 * Processes parsed rebase entries into a flat list with type discriminators.
 * - Adds `type: 'commit' | 'command'` to each entry
 * - Attaches update-ref entries to their preceding commits
 * - Filters out structural label/reset entries (they're preserved in the raw file)
 * - Detects rebases with actual merge commits (reordering disabled but actions allowed)
 */
export function processRebaseEntries(entries: RebaseTodoEntry[], done?: boolean): ProcessedRebaseTodo {
	// Only flag as preservesMerges if there are actual merge commands
	// label/reset alone (no merge) means linear history that can be edited
	const preservesMerges = hasActualMergeCommands(entries);

	const result: ProcessedRebaseEntry[] = [];
	const commits = new Map<string, ProcessedRebaseCommitEntry>();

	// Track the last commit to attach update-refs to
	let lastCommit: ProcessedRebaseCommitEntry | undefined;

	for (const entry of entries) {
		// Skip structural label/reset entries - they're preserved in the raw file
		// but not shown in the UI (the UI only shows commits and command actions)
		if (isStructuralEntry(entry)) continue;

		if (isCommitEntry(entry)) {
			const commitEntry: ProcessedRebaseCommitEntry = { ...entry, type: 'commit', id: entry.sha, done: done };
			result.push(commitEntry);
			commits.set(commitEntry.sha, commitEntry);
			lastCommit = commitEntry;
			continue;
		}

		if (isUpdateRefEntry(entry)) {
			// Attach update-ref to the preceding commit (with line number for reordering)
			if (lastCommit) {
				(lastCommit as Mutable<ProcessedRebaseCommitEntry>).updateRefs ??= [];
				lastCommit.updateRefs!.push({ ref: entry.ref, line: entry.line });
			}
			continue;
		}

		if (isCommandEntry(entry)) {
			result.push({ ...entry, type: 'command', id: `${done ? 'done:' : ''}line:${entry.line}`, done: done });
			continue;
		}
	}

	return { entries: result, commits: commits, preservesMerges: preservesMerges };
}
