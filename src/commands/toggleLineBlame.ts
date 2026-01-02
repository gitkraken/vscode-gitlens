import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { command } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { ActiveEditorCommand } from './commandBase.js';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.toggleLineBlame');
	}

	async execute(editor: TextEditor, _uri?: Uri): Promise<void> {
		try {
			await this.container.lineAnnotations.toggle(editor);
		} catch (ex) {
			Logger.error(ex, 'ToggleLineBlameCommand');
			void showGenericErrorMessage('Unable to toggle line blame annotations');
		}
	}
}
