import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, command, Commands } from './common';
import { Container } from '../container';
import { Logger } from '../logger';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ToggleLineBlame);
	}

	async execute(editor: TextEditor, uri?: Uri): Promise<void> {
		try {
			void (await Container.lineAnnotations.toggle(editor));
		} catch (ex) {
			Logger.error(ex, 'ToggleLineBlameCommand');
			window.showErrorMessage('Unable to toggle line blame annotations. See output channel for more details');
		}
	}
}
