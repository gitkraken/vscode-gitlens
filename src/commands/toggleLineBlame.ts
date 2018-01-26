'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { Container } from '../container';
import { Logger } from '../logger';

export class ToggleLineBlameCommand extends EditorCommand {

    constructor() {
        super(Commands.ToggleLineBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        if (editor === undefined) return undefined;

        try {
            return Container.lineAnnotations.toggleAnnotations(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleLineBlameCommand');
            return window.showErrorMessage(`Unable to toggle line blame annotations. See output channel for more details`);
        }
    }
}