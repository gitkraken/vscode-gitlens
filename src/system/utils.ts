import { TextDocument, TextEditor, window } from 'vscode';
import { Schemes } from '../constants';

export function getEditorIfActive(document: TextDocument): TextEditor | undefined {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document ? editor : undefined;
}

export function hasVisibleTextEditor(): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	return window.visibleTextEditors.some(e => isTextEditor(e));
}

export function isActiveDocument(document: TextDocument): boolean {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document;
}

export function isVisibleDocument(document: TextDocument): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	return window.visibleTextEditors.some(e => e.document === document);
}

export function isTextEditor(editor: TextEditor): boolean {
	const scheme = editor.document.uri.scheme;
	return scheme !== Schemes.Output && scheme !== Schemes.DebugConsole;
}
