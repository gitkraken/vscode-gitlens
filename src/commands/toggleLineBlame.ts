import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import { ActiveEditorCommand } from './base';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.ToggleLineBlame);
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
