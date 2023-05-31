import type { ColorTheme, TextDocument, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { version as codeVersion, ColorThemeKind, env, ViewColumn, window, workspace } from 'vscode';
import { ImageMimetypes, Schemes } from '../constants';
import { isGitUri } from '../git/gitUri';
import { executeCoreCommand } from './command';
import { configuration } from './configuration';
import { Logger } from './logger';
import { extname } from './path';
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
	options?: TextDocumentShowOptions & { throwOnError?: boolean },
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

export function findOrOpenEditors(uris: Uri[]): void {
	const normalizedUris = new Map(uris.map(uri => [uri.toString(), uri]));

	for (const e of window.visibleTextEditors) {
		// Don't include diff editors
		if (e?.viewColumn != null) {
			normalizedUris.delete(e.document.uri.toString());
		}
	}

	for (const uri of normalizedUris.values()) {
		void executeCoreCommand('vscode.open', uri, { background: true, preview: false });
	}
}

export function getEditorIfActive(document: TextDocument): TextEditor | undefined {
	const editor = window.activeTextEditor;
	return editor != null && editor.document === document ? editor : undefined;
}

export function getQuickPickIgnoreFocusOut() {
	return !configuration.get('advanced.quickPick.closeOnFocusOut');
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
	options: TextDocumentShowOptions & { rethrow?: boolean } = {},
): Promise<TextEditor | undefined> {
	const { rethrow, ...opts } = options;
	try {
		if (isGitUri(uri)) {
			uri = uri.documentUri();
		}

		if (uri.scheme === Schemes.GitLens && ImageMimetypes[extname(uri.fsPath)]) {
			await executeCoreCommand('vscode.open', uri);

			return undefined;
		}

		const document = await workspace.openTextDocument(uri);
		return window.showTextDocument(document, {
			preserveFocus: false,
			preview: true,
			viewColumn: ViewColumn.Active,
			...opts,
		});
	} catch (ex) {
		const msg: string = ex?.toString() ?? '';
		if (msg.includes('File seems to be binary and cannot be opened as text')) {
			await executeCoreCommand('vscode.open', uri);

			return undefined;
		}

		if (rethrow) throw ex;

		Logger.error(ex, 'openEditor');
		return undefined;
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
			step: stepId ? `${extensionId}#${walkthroughId}#${stepId}` : undefined,
		},
		openToSide,
	));
}

export const enum OpenWorkspaceLocation {
	CurrentWindow = 'currentWindow',
	NewWindow = 'newWindow',
	AddToWorkspace = 'addToWorkspace',
}

export function openWorkspace(
	uri: Uri,
	options: { location?: OpenWorkspaceLocation; name?: string } = { location: OpenWorkspaceLocation.CurrentWindow },
): void {
	if (options?.location === OpenWorkspaceLocation.AddToWorkspace) {
		const count = workspace.workspaceFolders?.length ?? 0;
		return void workspace.updateWorkspaceFolders(count, 0, { uri: uri, name: options?.name });
	}

	return void executeCoreCommand('vscode.openFolder', uri, {
		forceNewWindow: options?.location === OpenWorkspaceLocation.NewWindow,
	});
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

export function supportedInVSCodeVersion(feature: 'input-prompt-links') {
	switch (feature) {
		case 'input-prompt-links':
			return satisfies(codeVersion, '>= 1.76');
		default:
			return false;
	}
}
