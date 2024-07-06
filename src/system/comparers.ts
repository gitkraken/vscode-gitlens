import type { TextEditor, Uri } from 'vscode';

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
		options: { usePosition: boolean } = { usePosition: false },
	) {
		if (lhs === rhs) return true;
		if (lhs == null || rhs == null) return false;

		if (options.usePosition && lhs.viewColumn !== rhs.viewColumn) return false;

		return lhs.document === rhs.document;
	}
}

const textEditorComparer = new TextEditorComparer();
const uriComparer = new UriComparer();
export { textEditorComparer as TextEditorComparer, uriComparer as UriComparer };
