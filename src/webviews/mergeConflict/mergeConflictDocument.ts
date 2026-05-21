import type { TextDocument } from 'vscode';
import { Position, Range, workspace, WorkspaceEdit } from 'vscode';
import type { ParsedConflicts } from '../../git/utils/-webview/conflictHunks.utils.js';
import { applyResolutions, parseConflictHunks } from '../../git/utils/-webview/conflictHunks.utils.js';

const maxSafeInt = 2 ** 30 - 1;

/** Encapsulates read/write operations on the working-tree conflicted file. */
export class MergeConflictDocument {
	private _parsedCache?: { version: number; parsed: ParsedConflicts };

	constructor(private readonly document: TextDocument) {}

	get parsed(): ParsedConflicts {
		if (this._parsedCache?.version === this.document.version) return this._parsedCache.parsed;

		const parsed = parseConflictHunks(this.document.getText());
		this._parsedCache = { version: this.document.version, parsed: parsed };
		return parsed;
	}

	get uri(): TextDocument['uri'] {
		return this.document.uri;
	}

	get textDocument(): TextDocument {
		return this.document;
	}

	/**
	 * Rewrite the working-tree file with the supplied per-hunk resolutions. Unresolved hunks
	 * keep their original conflict markers untouched.
	 */
	async writeResolutions(resolutions: ReadonlyMap<number, readonly string[]>): Promise<boolean> {
		if (resolutions.size === 0) return false;
		return this.writeText(applyResolutions(this.parsed, resolutions));
	}

	/** Rewrite the working-tree file to exactly the supplied text. */
	async writeText(text: string): Promise<boolean> {
		const edit = new WorkspaceEdit();
		const fullRange = this.document.validateRange(
			new Range(new Position(0, 0), new Position(this.document.lineCount, maxSafeInt)),
		);
		edit.replace(this.document.uri, fullRange, text);
		return workspace.applyEdit(edit);
	}

	save(): Thenable<boolean> {
		return this.document.save();
	}
}
