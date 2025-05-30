import type { TextDocument } from 'vscode';
import { Uri, window, workspace } from 'vscode';

export function getOpenTextDocument(uri: Uri): TextDocument | undefined {
	const normalizedUri = uri.toString();
	return workspace.textDocuments.find(d => d.uri.toString() === normalizedUri);
}

export function isActiveTextDocument(document: TextDocument): boolean {
	return window.activeTextEditor?.document === document;
}

export function isTextDocument(document: unknown): document is TextDocument {
	if (document == null || typeof document !== 'object') return false;

	if (
		'uri' in document &&
		document.uri instanceof Uri &&
		'fileName' in document &&
		'languageId' in document &&
		'isDirty' in document &&
		'isUntitled' in document
	) {
		return true;
	}

	return false;
}

export function isVisibleTextDocument(document: TextDocument): boolean {
	return window.visibleTextEditors.some(e => e.document === document);
}
