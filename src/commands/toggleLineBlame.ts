'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { Container } from '../container';
import { Logger } from '../logger';
import { ActiveEditorCommand, command, Commands } from './common';

@command()
export class ToggleLineBlameCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleLineBlame);
    }

    async execute(editor: TextEditor, uri?: Uri): Promise<any> {
        try {
            return Container.lineAnnotations.toggle(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleLineBlameCommand');
            return window.showErrorMessage(
                `Unable to toggle line blame annotations. See output channel for more details`
            );
        }
    }
}
