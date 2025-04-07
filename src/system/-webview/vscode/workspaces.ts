import type { WorkspaceFolder } from 'vscode';
import { Uri, workspace } from 'vscode';
import { normalizePath } from '../../path';
import { executeCoreCommand } from '../command';
import { relative } from '../path';

export function getWorkspaceFriendlyPath(uri: Uri): string {
	const folder = workspace.getWorkspaceFolder(uri);
	if (folder == null) return normalizePath(uri.fsPath);

	const relativePath = normalizePath(relative(folder.uri.fsPath, uri.fsPath));
	return relativePath || folder.name;
}

export function isWorkspaceFolder(folder: unknown): folder is WorkspaceFolder {
	if (folder == null || typeof folder !== 'object') return false;

	if ('uri' in folder && folder.uri instanceof Uri && 'name' in folder && 'index' in folder) {
		return true;
	}

	return false;
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
