import { Uri, workspace } from 'vscode';
import type {
	ProcessedRebaseCommitEntry,
	ProcessedRebaseEntry,
	ProcessedRebaseTodo,
	RebaseTodoCommandAction,
	RebaseTodoCommitAction,
	RebaseTodoEntry,
	RebaseTodoMergesAction,
} from '../../models/rebase';
import { parseRebaseTodo } from '../../parsers/rebaseTodoParser';
import { commandRebaseActions, commitRebaseActions, mergesRebaseActions } from '../rebase.utils';

export function formatRebaseTodoEntryLine(entry: ProcessedRebaseEntry, overrideAction?: string): string {
	const action = overrideAction ?? entry.action;
	if (entry.type === 'commit') {
		const flagPart = entry.flag ? ` ${entry.flag}` : '';
		return `${action}${flagPart} ${entry.sha} ${entry.message}`;
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
 * Checks if this is a --rebase-merges rebase that preserves merge commits
 * These use label/reset/merge commands forming a DAG that the reorder UI cannot safely edit
 */
function isRebasingMerges(entries: RebaseTodoEntry[]): boolean {
	return entries.some(e => mergesRebaseActions.has(e.action as RebaseTodoMergesAction));
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
 * - Detects rebases that preserve merges (--rebase-merges with label/reset/merge)
 */
export function processRebaseEntries(entries: RebaseTodoEntry[], done?: boolean): ProcessedRebaseTodo {
	const preservesMerges = isRebasingMerges(entries);

	// For rebases that preserve merges, return empty - the UI will show read-only mode
	if (preservesMerges) return { entries: [], commits: new Map(), preservesMerges: true };

	const result: ProcessedRebaseEntry[] = [];
	const commits = new Map<string, ProcessedRebaseCommitEntry>();

	// Track the last commit to attach update-refs to
	let lastCommit: ProcessedRebaseCommitEntry | undefined;

	for (const entry of entries) {
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

	return { entries: result, commits: commits, preservesMerges: false };
}

export interface ParsedRebaseDone {
	readonly entries: RebaseTodoEntry[];
}

/**
 * Reads and parses the rebase 'done' file from the rebase-merge directory
 * @param rebaseTodoUri URI of the git-rebase-todo file (done file is in the same directory)
 * @returns Parsed entries, or undefined if no done file exists
 */
export async function readAndParseRebaseDoneFile(rebaseTodoUri: Uri): Promise<ParsedRebaseDone | undefined> {
	try {
		const doneUri = Uri.joinPath(rebaseTodoUri, '..', 'done');
		const doneContent = new TextDecoder().decode(await workspace.fs.readFile(doneUri));
		if (!doneContent.trim()) return undefined;

		const parsed = parseRebaseTodo(doneContent);
		return { entries: parsed.entries };
	} catch {
		// File doesn't exist or can't be read - not in an active rebase
		return undefined;
	}
}
