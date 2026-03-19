import { Uri, workspace } from 'vscode';
import type { RebaseTodoEntry } from '@gitlens/git/models/rebase.js';
import { parseRebaseTodo } from '@gitlens/git/parsers/rebaseTodoParser.js';

export {
	formatRebaseTodoEntryLine,
	formatUpdateRefLine,
	processRebaseEntries,
} from '@gitlens/git/utils/rebase.utils.js';

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
