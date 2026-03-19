import type { Range } from 'vscode';
import { Selection } from 'vscode';
import type { LineRange } from '@gitlens/git/models/lineRange.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';

export function rangeToLineRange(range: Range): LineRange {
	return {
		startLine: range.start.line + 1,
		startCharacter: range.start.character + 1,
		endLine: range.end.line + 1,
		endCharacter: range.end.character + 1,
	};
}

export function diffRangeToEditorLine(range: DiffRange | undefined): number {
	if (range == null) return 0;

	return (range.active === 'end' ? range.endLine : range.startLine) - 1;
}

export function diffRangeToSelection(range: DiffRange): Selection {
	if (range.active === 'end') {
		return new Selection(range.startLine - 1, range.startCharacter - 1, range.endLine - 1, range.endCharacter - 1);
	}
	return new Selection(range.endLine - 1, range.endCharacter - 1, range.startLine - 1, range.startCharacter - 1);
}

export function editorLineToDiffRange(editorLine: number | undefined): DiffRange {
	if (editorLine == null || editorLine < 0) {
		return { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1, active: 'start' };
	}

	return { startLine: editorLine + 1, startCharacter: 1, endLine: editorLine + 1, endCharacter: 1, active: 'start' };
}

export function selectionToDiffRange(selection: Selection | undefined): DiffRange {
	if (selection == null) return { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1, active: 'start' };

	const { anchor, active } = selection;
	if (anchor.line >= active.line) {
		return {
			startLine: active.line + 1,
			startCharacter: active.character + 1,
			endLine: anchor.line + 1,
			endCharacter: anchor.character + 1,
			active: 'start',
		};
	}
	return {
		startLine: anchor.line + 1,
		startCharacter: anchor.character + 1,
		endLine: active.line + 1,
		endCharacter: active.character + 1,
		active: 'end',
	};
}
