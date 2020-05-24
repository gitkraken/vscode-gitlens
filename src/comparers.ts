'use strict';
import { TextEditor, Uri } from 'vscode';

abstract class Comparer<T> {
	abstract equals(lhs: T, rhs: T): boolean;
}

class UriComparer extends Comparer<Uri> {
	equals(lhs: Uri | undefined, rhs: Uri | undefined, options: { exact?: boolean } = { exact: false }) {
		if (lhs === rhs) return true;
		if (lhs == null || rhs == null) return false;

		if (options.exact) {
			return lhs.toString() === rhs.toString();
		}
		return lhs.scheme === rhs.scheme && lhs.fsPath === rhs.fsPath;
	}
}

class TextEditorComparer extends Comparer<TextEditor> {
	equals(
		lhs: TextEditor | undefined,
		rhs: TextEditor | undefined,
		options: { useId: boolean; usePosition: boolean } = { useId: false, usePosition: false },
	) {
		if (lhs === rhs) return true;
		if (lhs == null || rhs == null) return false;

		if (options.usePosition && lhs.viewColumn !== rhs.viewColumn) return false;

		if (options.useId && (lhs.document != null || rhs.document != null)) {
			if ((lhs as any).id !== (rhs as any).id) return false;

			return true;
		}

		return lhs.document === rhs.document;
	}
}

const textEditorComparer = new TextEditorComparer();
const uriComparer = new UriComparer();
export { textEditorComparer as TextEditorComparer, uriComparer as UriComparer };
