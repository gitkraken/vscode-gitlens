import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';

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
