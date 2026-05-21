import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../container.js';
import { command, executeCoreCommand } from '../system/-webview/command.js';
import { ActiveEditorCommand, GlCommandBase } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';

@command()
export class OpenInMergeConflictEditorCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.mergeConflict.openInEditor', 'gitlens.mergeConflict.openInEditor:scm/resourceState/context']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) {
			void window.showWarningMessage('No file is currently active to open in the GitLens Merge Editor.');
			return;
		}

		await executeCoreCommand('vscode.openWith', uri, 'gitlens.mergeConflict');
	}
}

@command()
export class SwitchMergeConflictToTextEditorCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.mergeConflict.switchToTextEditor:editor/title']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		await executeCoreCommand('vscode.openWith', uri, 'default');
	}
}

@command()
export class EnableMergeConflictEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.mergeConflict.enable']);
	}

	async execute(): Promise<void> {
		// `configuration.update` would write user settings; let the user toggle it themselves to
		// match the rebase-editor pattern. The command exists primarily to give the command palette
		// a discoverable entry that triggers the prompt.
		await executeCoreCommand('workbench.action.openSettings', 'gitlens.mergeConflictEditor.enabled');
	}
}
