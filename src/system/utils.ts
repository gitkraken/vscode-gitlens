import type { ColorTheme, TextDocument, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { version as codeVersion, ColorThemeKind, env, ViewColumn, window, workspace } from 'vscode';
import { ImageMimetypes, Schemes } from '../constants';
import { isGitUri } from '../git/gitUri';
import { executeCoreCommand } from './command';
import { configuration } from './configuration';
import { Logger } from './logger';
import { extname, normalizePath, relative } from './path';
import { satisfies } from './version';

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

export function getQuickPickIgnoreFocusOut() {
	return !configuration.get('advanced.quickPick.closeOnFocusOut');
}

export function getWorkspaceFriendlyPath(uri: Uri): string {
	const folder = workspace.getWorkspaceFolder(uri);
	if (folder == null) return normalizePath(uri.fsPath);

	const relativePath = normalizePath(relative(folder.uri.fsPath, uri.fsPath));
	return relativePath || folder.name;
}

export function hasVisibleTextEditor(uri?: Uri): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	if (uri == null) return window.visibleTextEditors.some(e => isTextEditor(e));

	const url = uri.toString();
	return window.visibleTextEditors.some(e => e.document.uri.toString() === url && isTextEditor(e));
}

export function isActiveDocument(document: TextDocument): boolean {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document;
}

export function isDarkTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Dark || theme.kind === ColorThemeKind.HighContrast;
}

export function isLightTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Light || theme.kind === ColorThemeKind.HighContrastLight;
}

export function isVirtualUri(uri: Uri): boolean {
	return uri.scheme === Schemes.Virtual || uri.scheme === Schemes.GitHub;
}

export function isVisibleDocument(document: TextDocument): boolean {
	if (window.visibleTextEditors.length === 0) return false;

	return window.visibleTextEditors.some(e => e.document === document);
}

export function isTextEditor(editor: TextEditor): boolean {
	const scheme = editor.document.uri.scheme;
	return scheme !== Schemes.DebugConsole && scheme !== Schemes.Output && scheme !== Schemes.Terminal;
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

		if (background || (uri.scheme === Schemes.GitLens && ImageMimetypes[extname(uri.fsPath)])) {
			await executeCoreCommand('vscode.open', uri, { background: background, ...options });

			return undefined;
		}

		const document = await workspace.openTextDocument(uri);
		return window.showTextDocument(document, {
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

export async function openUrl(url: string): Promise<boolean>;
export async function openUrl(url?: string): Promise<boolean | undefined>;
export async function openUrl(url?: string): Promise<boolean | undefined> {
	if (url == null) return undefined;

	// Pass a string to openExternal to avoid double encoding issues: https://github.com/microsoft/vscode/issues/85930
	// vscode.d.ts currently says it only supports a Uri, but it actually accepts a string too
	return (env.openExternal as unknown as (target: string) => Thenable<boolean>)(url);
}
