import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { command } from '../system/command';
import { ActiveEditorCommand } from './base';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.ToggleLineBlame);
	}

	async execute(editor: TextEditor, _uri?: Uri): Promise<void> {
		try {
			await this.container.lineAnnotations.toggle(editor);
		} catch (ex) {
			Logger.error(ex, 'ToggleLineBlameCommand');
			void window.showErrorMessage(
				'Unable to toggle line blame annotations. See output channel for more details',
			);
		}
	}
}
