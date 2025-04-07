import type { TextDocument, TextDocumentShowOptions, TextEditor } from 'vscode';
import { Uri, ViewColumn, window, workspace } from 'vscode';
import { imageMimetypes, Schemes } from '../../../constants';
import { isGitUri } from '../../../git/gitUri';
import { Logger } from '../../logger';
import { extname } from '../../path';
import { executeCoreCommand } from '../command';
import { isTextDocument } from './documents';
import { isTrackableUri } from './uris';

export function getOpenTextEditor(uri: Uri): TextEditor | undefined {
	const active = window.activeTextEditor;
	const normalizedUri = uri.toString();

	for (const e of [...(active != null ? [active] : []), ...window.visibleTextEditors]) {
		// Don't include diff editors
		if (e.document.uri.toString() === normalizedUri && e?.viewColumn != null) {
			return e;
		}
	}

	return undefined;
}

export function getOpenTextEditorIfActive(document: TextDocument): TextEditor | undefined {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document ? editor : undefined;
}

export function getOpenTextEditorIfVisible(uri: Uri): TextEditor | undefined;
export function getOpenTextEditorIfVisible(document: TextDocument): TextEditor | undefined;
export function getOpenTextEditorIfVisible(documentOrUri: TextDocument | Uri): TextEditor | undefined {
	if (documentOrUri instanceof Uri) {
		const uriString = documentOrUri.toString();
		return window.visibleTextEditors.find(e => e.document.uri.toString() === uriString);
	}

	return window.visibleTextEditors.find(e => e.document === documentOrUri);
}

export async function getOrOpenTextEditor(
	uri: Uri,
	options?: TextDocumentShowOptions & { background?: boolean; throwOnError?: boolean },
): Promise<TextEditor | undefined> {
	const e = getOpenTextEditor(uri);
	if (e != null) {
		if (!options?.preserveFocus) {
			await window.showTextDocument(e.document, { ...options, viewColumn: e.viewColumn });
		}

		return e;
	}

	return openTextEditor(uri, { viewColumn: window.activeTextEditor?.viewColumn, ...options });
}

export function getOtherVisibleTextEditors(editor: TextEditor): TextEditor[] {
	return window.visibleTextEditors.filter(
		e => e !== editor && e.document.uri.toString() === editor.document.uri.toString(),
	);
}

export function hasVisibleTrackableTextEditor(uri?: Uri): boolean {
	const editors = window.visibleTextEditors;
	if (!editors.length) return false;

	if (uri == null) return editors.some(e => isTrackableTextEditor(e));

	const uriString = uri.toString();
	return editors.some(e => e.document.uri.toString() === uriString && isTrackableTextEditor(e));
}

export function isTextEditor(editor: unknown): editor is TextEditor {
	if (editor == null || typeof editor !== 'object') return false;

	if ('document' in editor && isTextDocument(editor.document) && 'viewColumn' in editor && 'selections' in editor) {
		return true;
	}

	return false;
}

export function isTrackableTextEditor(editor: TextEditor): boolean {
	return isTrackableUri(editor.document.uri);
}

export async function openChangesEditor(
	resources: { uri: Uri; lhs: Uri | undefined; rhs: Uri | undefined }[],
	title: string,
	options?: TextDocumentShowOptions & { sourceViewColumn?: ViewColumn },
): Promise<void> {
	try {
		if (options?.viewColumn === ViewColumn.Beside) {
			let column = (options?.sourceViewColumn ?? window.tabGroups.activeTabGroup?.viewColumn ?? 0) + 1;
			if (column > ViewColumn.Nine) {
				column = ViewColumn.One;
			}

			if (window.tabGroups.all.some(g => g.viewColumn === column)) {
				await executeCoreCommand('workbench.action.focusRightGroup');
			} else {
				await executeCoreCommand('workbench.action.newGroupRight');
			}
		}
		await executeCoreCommand(
			'vscode.changes',
			title,
			resources.map(r => [r.uri, r.lhs, r.rhs]),
		);
	} catch (ex) {
		Logger.error(ex, 'openChangesEditor');
		debugger;
	}
}
export async function openDiffEditor(
	lhs: Uri,
	rhs: Uri,
	title: string,
	options?: TextDocumentShowOptions,
): Promise<void> {
	try {
		await executeCoreCommand('vscode.diff', lhs, rhs, title, options);
	} catch (ex) {
		Logger.error(ex, 'openDiffEditor');
		debugger;
	}
}

interface MergeEditorInputData {
	uri: Uri;
	title?: string;
	detail?: string;
	description?: string;
}

export interface MergeEditorInputs {
	base: Uri;
	input1: MergeEditorInputData;
	input2: MergeEditorInputData;
	output: Uri;
}

export async function openMergeEditor(
	inputs: MergeEditorInputs,
	options?: TextDocumentShowOptions & { sourceViewColumn?: ViewColumn },
): Promise<void> {
	try {
		if (options?.viewColumn === ViewColumn.Beside) {
			let column = (options?.sourceViewColumn ?? window.tabGroups.activeTabGroup?.viewColumn ?? 0) + 1;
			if (column > ViewColumn.Nine) {
				column = ViewColumn.One;
			}

			if (window.tabGroups.all.some(g => g.viewColumn === column)) {
				await executeCoreCommand('workbench.action.focusRightGroup');
			} else {
				await executeCoreCommand('workbench.action.newGroupRight');
			}
		}

		await executeCoreCommand('_open.mergeEditor', inputs);
	} catch (ex) {
		Logger.error(ex, 'openMergeEditor');
		debugger;
	}
}

export type OpenSettingsEditorOptions =
	| string
	| {
			openToSide?: boolean;
			query?: string;
			revealSetting?: {
				key: string;
				edit?: boolean;
			};
			focusSearch?: boolean;
	  };

export async function openSettingsEditor(queryOrOptions: OpenSettingsEditorOptions): Promise<void> {
	await executeCoreCommand('workbench.action.openSettings', queryOrOptions);
}

export async function openTextEditor(
	uri: Uri,
	options?: TextDocumentShowOptions & { background?: boolean; throwOnError?: boolean },
): Promise<TextEditor | undefined> {
	let background;
	let throwOnError;
	if (options != null) {
		({ background, throwOnError, ...options } = options);
	}

	try {
		if (isGitUri(uri)) {
			uri = uri.documentUri();
		}

		if (background || (uri.scheme === Schemes.GitLens && imageMimetypes[extname(uri.fsPath)])) {
			await executeCoreCommand('vscode.open', uri, { background: background, ...options });

			return undefined;
		}

		const document = await workspace.openTextDocument(uri);
		return await window.showTextDocument(document, {
			preserveFocus: false,
			preview: true,
			viewColumn: ViewColumn.Active,
			...options,
		});
	} catch (ex) {
		const msg: string = ex?.toString() ?? '';
		if (msg.includes('File seems to be binary and cannot be opened as text')) {
			await executeCoreCommand('vscode.open', uri);

			return undefined;
		}

		if (throwOnError) throw ex;

		Logger.error(ex, 'openEditor');
		return undefined;
	}
}

export function openTextEditors(uris: Uri[], options?: TextDocumentShowOptions & { background?: boolean }): void {
	const normalizedUris = new Map(uris.map(uri => [uri.toString(), uri]));

	for (const e of window.visibleTextEditors) {
		// Don't include diff editors
		if (e?.viewColumn != null) {
			normalizedUris.delete(e.document.uri.toString());
		}
	}

	options = { background: true, preview: false, ...options };
	for (const uri of normalizedUris.values()) {
		void executeCoreCommand('vscode.open', uri, options);
	}
}
