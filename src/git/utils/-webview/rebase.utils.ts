import type { Tab } from 'vscode';
import { version as codeVersion, ConfigurationTarget, Uri, ViewColumn, window, workspace } from 'vscode';
import type { Container } from '../../../container';
import { executeCoreCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getTabUri } from '../../../system/-webview/vscode/tabs';
import { exists } from '../../../system/-webview/vscode/uris';
import { areUrisEqual } from '../../../system/uri';
import { compare } from '../../../system/version';

export function getOpenRebaseEditorTab(todoUri: Uri): Tab | undefined {
	for (const group of window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (areUrisEqual(getTabUri(tab), todoUri)) return tab;
		}
	}

	return undefined;
}

/**
 * Gets the repository URI from a git-rebase-todo
 *
 * For normal repos: .git/rebase-merge/git-rebase-todo
 * For worktrees: .git/worktrees/<name>/rebase-merge/git-rebase-todo
 */
export async function getRepoUriFromRebaseTodo(rebaseTodoUri: Uri): Promise<Uri> {
	// Navigate up to the directory containing rebase-merge -- could be either .git (normal repo) or .git/worktrees/<name> (worktree)
	const root = Uri.joinPath(rebaseTodoUri, '..', '..');

	// Check if this is a worktree by looking for a 'gitdir' file -- only exists in .git/worktrees/<name>/ folders
	const gitdir = Uri.joinPath(root, 'gitdir');

	try {
		// Try to read the gitdir file (only exists in worktrees)
		const worktreePath = new TextDecoder().decode(await workspace.fs.readFile(gitdir)).trim();
		// Remove the trailing .git to get the worktree path
		return Uri.joinPath(Uri.file(worktreePath), '..');
	} catch {
		// No gitdir means this is a normal repository, so go up one more level from .git to get the repo root
		return Uri.joinPath(root, '..');
	}
}

export async function reopenRebaseTodoEditor(mode: 'default' | 'gitlens.rebase'): Promise<void> {
	if (mode === 'default') {
		return executeCoreCommand('workbench.action.reopenTextEditor');
	}

	if (compare(codeVersion, '1.100.0') >= 0) {
		return executeCoreCommand('reopenActiveEditorWith', mode);
	}

	return executeCoreCommand('workbench.action.reopenWithEditor');
}

export function isRebaseTodoEditorEnabled(): boolean {
	const associations = configuration.inspectCore('workbench.editorAssociations')?.globalValue;
	if (Array.isArray(associations)) {
		const association = associations.find(a => a.filenamePattern === 'git-rebase-todo');
		return association != null ? association.viewType === 'gitlens.rebase' : true;
	}

	if (associations == null) return true;

	const association = associations['git-rebase-todo'];
	return association != null ? association === 'gitlens.rebase' : true;
}

export interface OpenRebaseEditorOptions {
	viewColumn?: ViewColumn;
}

export async function openRebaseEditor(
	container: Container,
	repoPath: string,
	options?: OpenRebaseEditorOptions,
): Promise<void> {
	const svc = container.git.getRepositoryService(repoPath);
	const status = await svc.pausedOps?.getPausedOperationStatus?.();
	if (status?.type !== 'rebase') return;

	const gitDir = await svc.config.getGitDir?.();
	if (gitDir == null) return;

	const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
	if (getOpenRebaseEditorTab(rebaseTodoUri) != null) return;

	// Ensure the file exists before attempting to open it (avoids race condition during rebase setup)
	if (!(await exists(rebaseTodoUri))) return;

	// Only try to open beside if there is an active tab
	if (options?.viewColumn === ViewColumn.Beside && window.tabGroups.activeTabGroup.activeTab == null) {
		options.viewColumn = ViewColumn.Active;
	}

	await executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
		preview: false,
		viewColumn: options?.viewColumn,
	});
}

export async function setRebaseTodoEditorEnablement(enabled: boolean): Promise<void> {
	let associations = configuration.inspectCore('workbench.editorAssociations')?.globalValue;
	if (Array.isArray(associations)) {
		associations = associations.reduce<Record<string, string>>((accumulator, current) => {
			accumulator[current.filenamePattern] = current.viewType;
			return accumulator;
		}, Object.create(null));
	}

	if (associations == null) {
		if (enabled) return;

		associations = { 'git-rebase-todo': 'default' };
	} else {
		associations['git-rebase-todo'] = enabled ? 'gitlens.rebase' : 'default';
	}

	await configuration.updateAny('workbench.editorAssociations', associations, ConfigurationTarget.Global);
}
