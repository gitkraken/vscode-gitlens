import type { TextDocument, Uri } from 'vscode';
import { Position, Range, workspace, WorkspaceEdit } from 'vscode';
import type {
	ParsedRebaseTodo,
	ProcessedRebaseCommitEntry,
	ProcessedRebaseEntry,
	ProcessedRebaseTodo,
	RebaseTodoAction,
} from '../../git/models/rebase';
import { parseRebaseTodo } from '../../git/parsers/rebaseTodoParser';
import {
	formatRebaseTodoEntryLine,
	formatUpdateRefLine,
	processRebaseEntries,
} from '../../git/utils/-webview/rebase.parsing.utils';
import { map } from '../../system/iterable';
import type { MoveEntryParams } from './protocol';
import { maxSmallIntegerV8 } from './rebaseWebviewProvider';

/** Encapsulates all read/write operations on the rebase todo file */
export class RebaseTodoDocument {
	/** Cached parsed/processed todo file, invalidated when document version changes */
	private _parsedCache?: { version: number; parsed: ParsedRebaseTodo; processed: ProcessedRebaseTodo };

	constructor(private readonly document: TextDocument) {}

	/** Gets parsed and processed todo entries, using cache if document hasn't changed */
	get parsed(): { parsed: ParsedRebaseTodo; processed: ProcessedRebaseTodo } {
		if (this._parsedCache?.version === this.document.version) return this._parsedCache;

		const parsed = parseRebaseTodo(this.document.getText());
		const processed = processRebaseEntries(parsed.entries);
		this._parsedCache = { version: this.document.version, parsed: parsed, processed: processed };
		return this._parsedCache;
	}

	get uri(): Uri {
		return this.document.uri;
	}

	/**
	 * Calculates the target index for a move operation
	 * @returns Target index, or null if the move is invalid/no-op
	 */
	calculateMoveTargetIndex(params: MoveEntryParams, currentIndex: number, entryCount: number): number | null {
		if (params.relative) {
			// Relative move: +1 (down) or -1 (up)
			const targetIndex = currentIndex + params.to;
			// Boundary check
			if (targetIndex < 0 || targetIndex >= entryCount) return null;
			return targetIndex;
		}

		// Absolute move (drag)
		if (currentIndex === params.to) return null;
		return params.to;
	}

	async changeActions(changes: { sha: string; action: RebaseTodoAction }[]): Promise<void> {
		if (!changes.length) return;

		const { commits } = this.parsed.processed;
		const edit = new WorkspaceEdit();

		// Build a map of sha -> requested action for quick lookup
		const requestedActions = new Map(changes.map(e => [e.sha, e.action]));

		// Simulate the new entries state to check constraints
		const newEntries = map(commits.values(), e => {
			const requestedAction = requestedActions.get(e.sha);
			return requestedAction != null ? { ...e, action: requestedAction } : e;
		});

		// Check if oldest entry would become squash/fixup (invalid)
		const [oldestEntry] = newEntries;
		if (!oldestEntry) return;

		const oldestNeedsReset = oldestEntry.action === 'squash' || oldestEntry.action === 'fixup';

		for (const { sha, action: requestedAction } of changes) {
			const entry = commits.get(sha);
			if (entry == null) continue;

			// Determine final action
			let action = requestedAction;
			if (oldestNeedsReset && sha === oldestEntry.sha) {
				// User tried to set first entry to squash/fixup - reset to pick
				action = 'pick';
			}

			const range = this.document.validateRange(
				new Range(new Position(entry.line, 0), new Position(entry.line, maxSmallIntegerV8)),
			);

			// Preserve flag (e.g., fixup -c, fixup -C) if present
			const flagPart = entry.flag ? ` ${entry.flag}` : '';
			edit.replace(this.document.uri, range, `${action}${flagPart} ${entry.sha} ${entry.message}`);
		}

		// If oldest entry needs reset and wasn't in the batch, reset it
		if (oldestNeedsReset && !requestedActions.has(oldestEntry.sha)) {
			const originalOldest = commits.get(oldestEntry.sha);
			if (originalOldest != null) {
				const range = this.document.validateRange(
					new Range(
						new Position(originalOldest.line, 0),
						new Position(originalOldest.line, maxSmallIntegerV8),
					),
				);
				const flagPart = originalOldest.flag ? ` ${originalOldest.flag}` : '';
				edit.replace(
					this.document.uri,
					range,
					`pick${flagPart} ${originalOldest.sha} ${originalOldest.message}`,
				);
			}
		}

		await workspace.applyEdit(edit);
	}

	async clear(): Promise<void> {
		const edit = new WorkspaceEdit();
		edit.delete(this.document.uri, new Range(0, 0, this.document.lineCount, 0));
		await workspace.applyEdit(edit);
	}

	/** Ensures the oldest commit has a valid action (not squash/fixup) by changing it to pick */
	async ensureValidOldestAction(oldestCommit: ProcessedRebaseCommitEntry): Promise<void> {
		if (oldestCommit.action !== 'squash' && oldestCommit.action !== 'fixup') return;

		const range = this.document.validateRange(
			new Range(new Position(oldestCommit.line, 0), new Position(oldestCommit.line, maxSmallIntegerV8)),
		);
		const edit = new WorkspaceEdit();
		edit.replace(this.document.uri, range, `pick ${oldestCommit.sha} ${oldestCommit.message}`);
		await workspace.applyEdit(edit);
	}

	/**
	 * Moves an entry to a new position in the todo file.
	 *
	 * VS Code's WorkspaceEdit uses ORIGINAL line numbers, so we must order
	 * operations carefully to avoid conflicts:
	 * - Moving DOWN: insert first (at higher line), then delete (at lower line)
	 * - Moving UP: delete first (at higher line), then insert (at lower line)
	 *
	 * When moving commits with update-refs, the update-ref lines follow their commit.
	 */
	async moveEntry(
		entry: ProcessedRebaseEntry,
		targetEntry: ProcessedRebaseEntry,
		isDropAtEnd: boolean,
		isRelativeMove: boolean,
	): Promise<void> {
		const edit = new WorkspaceEdit();

		// Build the line text to insert (entry + any update-refs)
		const lines = [formatRebaseTodoEntryLine(entry)];
		if (entry.type === 'commit' && entry.updateRefs?.length) {
			for (const updateRef of entry.updateRefs) {
				lines.push(formatUpdateRefLine(updateRef.ref));
			}
		}
		const insertText = `${lines.join('\n')}\n`;

		// Calculate delete range (entry line + any update-ref lines)
		let deleteEndLine = entry.line + 1;
		if (entry.type === 'commit' && entry.updateRefs?.length) {
			// Update-ref lines follow the commit, find the last one
			const lastUpdateRefLine = Math.max(...entry.updateRefs.map(r => r.line));
			deleteEndLine = lastUpdateRefLine + 1;
		}
		const deleteRange = this.document.validateRange(
			new Range(new Position(entry.line, 0), new Position(deleteEndLine, 0)),
		);

		// Calculate the effective end line of the target entry (including its update-refs)
		let targetEndLine = targetEntry.line + 1;
		if (targetEntry.type === 'commit' && targetEntry.updateRefs?.length) {
			const lastTargetUpdateRefLine = Math.max(...targetEntry.updateRefs.map(r => r.line));
			targetEndLine = lastTargetUpdateRefLine + 1;
		}

		const isMovingDown = entry.line < targetEntry.line;

		if (isMovingDown) {
			// Moving DOWN: insert first, then delete
			// If dropping at end or relative move (swap), we insert AFTER the target (at targetEndLine)
			// If absolute move (drag/drop onto), we insert BEFORE the target (at targetEntry.line)
			const insertLine = isDropAtEnd || isRelativeMove ? targetEndLine : targetEntry.line;

			edit.insert(this.document.uri, new Position(insertLine, 0), insertText);
			edit.delete(this.document.uri, deleteRange);
		} else {
			// Moving UP: delete first, then insert
			// Always insert at targetEntry.line (before target)
			edit.delete(this.document.uri, deleteRange);
			edit.insert(this.document.uri, new Position(targetEntry.line, 0), insertText);
		}

		await workspace.applyEdit(edit);
	}

	/**
	 * Reorders entries by rewriting the affected lines.
	 * Update-ref lines follow their associated commits.
	 */
	async reorderEntries(
		newEntries: ProcessedRebaseEntry[],
		fixOldestCommit?: ProcessedRebaseCommitEntry,
	): Promise<void> {
		// Collect all line numbers that belong to entries and their update-refs
		const entryLines = new Set<number>();
		for (const entry of this.parsed.processed.entries) {
			entryLines.add(entry.line);
			if (entry.type === 'commit' && entry.updateRefs?.length) {
				for (const updateRef of entry.updateRefs) {
					entryLines.add(updateRef.line);
				}
			}
		}

		// Find the range of lines that contain entries (first to last entry line)
		const sortedLines = [...entryLines].sort((a, b) => a - b);
		if (sortedLines.length === 0) return;

		const firstLine = sortedLines[0];
		const lastLine = sortedLines[sortedLines.length - 1];

		// Build new content with entries in new order, each followed by its update-refs
		const newLines: string[] = [];
		for (const entry of newEntries) {
			const overrideAction = fixOldestCommit && entry.id === fixOldestCommit.id ? 'pick' : undefined;
			newLines.push(formatRebaseTodoEntryLine(entry, overrideAction));

			// Add update-ref lines after commit entries
			if (entry.type === 'commit' && entry.updateRefs?.length) {
				for (const updateRef of entry.updateRefs) {
					newLines.push(formatUpdateRefLine(updateRef.ref));
				}
			}
		}

		// Replace all entry lines with the new content
		const edit = new WorkspaceEdit();
		const range = this.document.validateRange(
			new Range(new Position(firstLine, 0), new Position(lastLine, maxSmallIntegerV8)),
		);
		edit.replace(this.document.uri, range, newLines.join('\n'));

		await workspace.applyEdit(edit);
	}

	async save(): Promise<boolean> {
		return this.document.save();
	}

	/** Checks if the move would leave a squash/fixup as the oldest commit entry */
	wouldLeaveSquashAsOldest(entries: ProcessedRebaseEntry[], fromIndex: number, toIndex: number): boolean {
		// Simulate the move
		const entry = entries[fromIndex];
		const newEntries = [...entries];
		newEntries.splice(fromIndex, 1);
		newEntries.splice(toIndex, 0, entry);

		// Find the oldest commit entry
		const oldestCommit = newEntries.find(e => e.type === 'commit');
		if (!oldestCommit) return false;

		return oldestCommit.action === 'squash' || oldestCommit.action === 'fixup';
	}
}
