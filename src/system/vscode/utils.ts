import type { ColorTheme, Tab, TextDocument, TextDocumentShowOptions, TextEditor, WorkspaceFolder } from 'vscode';
import { version as codeVersion, ColorThemeKind, env, Uri, ViewColumn, window, workspace } from 'vscode';
import { imageMimetypes, Schemes, trackableSchemes } from '../../constants';
import { isGitUri } from '../../git/gitUri';
import { Logger } from '../logger';
import { extname, normalizePath } from '../path';
import { satisfies } from '../version';
import { executeCoreCommand } from './command';
import { configuration } from './configuration';
import { relative } from './path';

export function findTextDocument(uri: Uri): TextDocument | undefined {
	const normalizedUri = uri.toString();
	return workspace.textDocuments.find(d => d.uri.toString() === normalizedUri);
}

export function findEditor(uri: Uri): TextEditor | undefined {
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

export async function findOrOpenEditor(
	uri: Uri,
	options?: TextDocumentShowOptions & { background?: boolean; throwOnError?: boolean },
): Promise<TextEditor | undefined> {
	const e = findEditor(uri);
	if (e != null) {
		if (!options?.preserveFocus) {
			await window.showTextDocument(e.document, { ...options, viewColumn: e.viewColumn });
		}

		return e;
	}

	return openEditor(uri, { viewColumn: window.activeTextEditor?.viewColumn, ...options });
}

export function findOrOpenEditors(uris: Uri[], options?: TextDocumentShowOptions & { background?: boolean }): void {
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

export function getEditorCommand() {
	let editor;
	switch (env.appName) {
		case 'Visual Studio Code - Insiders':
			editor = 'code-insiders --wait --reuse-window';
			break;
		case 'Visual Studio Code - Exploration':
			editor = 'code-exploration --wait --reuse-window';
			break;
		case 'VSCodium':
			editor = 'codium --wait --reuse-window';
			break;
		case 'Cursor':
			editor = 'cursor --wait --reuse-window';
			break;
		default:
			editor = 'code --wait --reuse-window';
			break;
	}
	return editor;
}

export function getEditorIfActive(document: TextDocument): TextEditor | undefined {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document ? editor : undefined;
}

export function getEditorIfVisible(uri: Uri): TextEditor | undefined;
export function getEditorIfVisible(document: TextDocument): TextEditor | undefined;
export function getEditorIfVisible(documentOrUri: TextDocument | Uri): TextEditor | undefined {
	if (documentOrUri instanceof Uri) {
		const uriString = documentOrUri.toString();
		return window.visibleTextEditors.find(e => e.document.uri.toString() === uriString);
	}

	return window.visibleTextEditors.find(e => e.document === documentOrUri);
}

export function getQuickPickIgnoreFocusOut() {
	return !configuration.get('advanced.quickPick.closeOnFocusOut');
}

export function getTabUri(tab: Tab | undefined): Uri | undefined {
	const input = tab?.input;
	if (input == null || typeof input !== 'object') return undefined;

	if ('uri' in input && input.uri instanceof Uri) {
		return input.uri;
	}

	if ('modified' in input && input.modified instanceof Uri) {
		return input.modified;
	}

	return undefined;
}

export function getWorkspaceFriendlyPath(uri: Uri): string {
	const folder = workspace.getWorkspaceFolder(uri);
	if (folder == null) return normalizePath(uri.fsPath);

	const relativePath = normalizePath(relative(folder.uri.fsPath, uri.fsPath));
	return relativePath || folder.name;
}

export function hasVisibleTrackableTextEditor(uri?: Uri): boolean {
	const editors = window.visibleTextEditors;
	if (!editors.length) return false;

	if (uri == null) return editors.some(e => isTrackableTextEditor(e));

	const uriString = uri.toString();
	return editors.some(e => e.document.uri.toString() === uriString && isTrackableTextEditor(e));
}

export function isActiveDocument(document: TextDocument): boolean {
	return window.activeTextEditor?.document === document;
}

export function isDarkTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Dark || theme.kind === ColorThemeKind.HighContrast;
}

export function isLightTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Light || theme.kind === ColorThemeKind.HighContrastLight;
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

export function isTrackableUri(uri: Uri): boolean {
	return trackableSchemes.has(uri.scheme as Schemes);
}

export function isVirtualUri(uri: Uri): boolean {
	return uri.scheme === Schemes.Virtual || uri.scheme === Schemes.GitHub;
}

export function isVisibleDocument(document: TextDocument): boolean {
	return window.visibleTextEditors.some(e => e.document === document);
}

export function isWorkspaceFolder(folder: unknown): folder is WorkspaceFolder {
	if (folder == null || typeof folder !== 'object') return false;

	if ('uri' in folder && folder.uri instanceof Uri && 'name' in folder && 'index' in folder) {
		return true;
	}

	return false;
}

export async function openEditor(
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

export async function openChangesEditor(
	resources: { uri: Uri; lhs: Uri | undefined; rhs: Uri | undefined }[],
	title: string,
	_options?: TextDocumentShowOptions,
): Promise<void> {
	try {
		await executeCoreCommand(
			'vscode.changes',
			title,
			resources.map(r => [r.uri, r.lhs, r.rhs]),
		);
	} catch (ex) {
		Logger.error(ex, 'openChangesEditor');
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
	}
}

export async function openUrl(url: string): Promise<boolean>;
export async function openUrl(url?: string): Promise<boolean | undefined>;
export async function openUrl(url?: string): Promise<boolean | undefined> {
	if (url == null) return undefined;

	// Pass a string to openExternal to avoid double encoding issues: https://github.com/microsoft/vscode/issues/85930
	// vscode.d.ts currently says it only supports a Uri, but it actually accepts a string too
	return (env.openExternal as unknown as (target: string) => Thenable<boolean>)(url);
}

export async function openWalkthrough(
	extensionId: string,
	walkthroughId: string,
	stepId?: string,
	openToSide: boolean = true,
): Promise<void> {
	// Only open to side if there is an active tab
	if (openToSide && window.tabGroups.activeTabGroup.activeTab == null) {
		openToSide = false;
	}

	// Takes the following params: walkthroughID: string | { category: string, step: string } | undefined, toSide: boolean | undefined
	void (await executeCoreCommand(
		'workbench.action.openWalkthrough',
		{
			category: `${extensionId}#${walkthroughId}`,
			step: stepId,
		},
		openToSide,
	));
}

export type OpenWorkspaceLocation = 'currentWindow' | 'newWindow' | 'addToWorkspace';

export function openWorkspace(
	uri: Uri,
	options: { location?: OpenWorkspaceLocation; name?: string } = { location: 'currentWindow' },
): void {
	if (options?.location === 'addToWorkspace') {
		const count = workspace.workspaceFolders?.length ?? 0;
		return void workspace.updateWorkspaceFolders(count, 0, { uri: uri, name: options?.name });
	}

	return void executeCoreCommand('vscode.openFolder', uri, {
		forceNewWindow: options?.location === 'newWindow',
	});
}

export async function revealInFileExplorer(uri: Uri) {
	void (await executeCoreCommand('revealFileInOS', uri));
}

export function supportedInVSCodeVersion(feature: 'language-models') {
	switch (feature) {
		case 'language-models':
			return satisfies(codeVersion, '>= 1.90-insider');
		default:
			return false;
	}
}

export function tabContainsUri(tab: Tab | undefined, uri: Uri | undefined): boolean {
	const input = tab?.input;
	if (uri == null || input == null || typeof input !== 'object') return false;

	const uriString = uri.toString();
	if ('uri' in input && input.uri instanceof Uri) {
		return input.uri.toString() === uriString;
	}

	if ('modified' in input && input.modified instanceof Uri) {
		return input.modified.toString() === uriString;
	}

	if ('original' in input && input.original instanceof Uri) {
		return input.original.toString() === uriString;
	}

	return false;
}
