import { Uri, workspace } from 'vscode';
import type { RebaseTodoAction, RebaseTodoEntry } from '@gitlens/git/models/rebase.js';
import { parseRebaseTodo } from '@gitlens/git/parsers/rebaseTodoParser.js';

export {
	formatRebaseTodoEntryLine,
	formatUpdateRefLine,
	processRebaseEntries,
} from '@gitlens/git/utils/rebase.utils.js';

/** A rebase todo action that, as the last completed entry, indicates the rebase is paused
 *  waiting for explicit user action (not just a conflict resolution). */
export type ActionablePauseAction = 'edit' | 'reword' | 'break' | 'exec';

/** Returns the action if it indicates the rebase is paused for user action, otherwise undefined. */
export function getActionablePauseAction(action: RebaseTodoAction | undefined): ActionablePauseAction | undefined {
	switch (action) {
		case 'edit':
		case 'reword':
		case 'break':
		case 'exec':
			return action;
		default:
			return undefined;
	}
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
