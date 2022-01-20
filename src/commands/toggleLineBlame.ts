import { TextEditor, Uri, window } from 'vscode';
import type { Container } from '../container';
import { Logger } from '../logger';
import { ActiveEditorCommand, command, Commands } from './common';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.ToggleLineBlame);
	}

	async execute(editor: TextEditor, _uri?: Uri): Promise<void> {
		try {
			void (await this.container.lineAnnotations.toggle(editor));
		} catch (ex) {
			Logger.error(ex, 'ToggleLineBlameCommand');
			void window.showErrorMessage(
				'Unable to toggle line blame annotations. See output channel for more details',
			);
		}
	}
}
