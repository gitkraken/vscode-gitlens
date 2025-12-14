import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { abortPausedOperation } from '../git/actions/pausedOperation';
import { reopenRebaseTodoEditor } from '../git/utils/-webview/rebase.utils';
import { command } from '../system/-webview/command';
import { getOpenTextDocument } from '../system/-webview/vscode/documents';
import { closeTab } from '../system/-webview/vscode/tabs';
import { ActiveEditorCommand, GlCommandBase } from './commandBase';
import { getCommandUri } from './commandBase.utils';

@command()
export class DisableRebaseEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.rebase.disableEditor', 'gitlens.rebase.disableEditor:editor/title']);
	}

	execute(): Promise<void> {
		return this.container.rebaseEditor.setEnabled(false);
	}
}

@command()
export class EnableRebaseEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.rebase.enableEditor', 'gitlens.rebase.enableEditor:editor/title']);
	}

	execute(): Promise<void> {
		return this.container.rebaseEditor.setEnabled(true);
	}
}

@command()
export class RebaseAbort extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.rebase.abort:editor/title']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		await abortPausedOperation(this.container.git.getRepositoryService(uri));
		await closeTab(uri);
	}
}

@command()
export class RebaseContinue extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.rebase.continue:editor/title']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const document = editor?.document ?? getOpenTextDocument(uri);
		await document?.save();
		await closeTab(uri);
	}
}

@command()
export class ReopenRebaseAsInteractiveEditor extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.rebase.reopenAsInteractiveEditor:editor/title']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		await reopenRebaseTodoEditor('gitlens.rebase');
	}
}

@command()
export class ReopenRebaseAsTextEditor extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.rebase.reopenAsTextEditor:editor/title']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		await reopenRebaseTodoEditor('default');
	}
}
