'use strict';
import { TextEditor, TextEditorEdit, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { Container } from '../container';
import { Logger } from '../logger';

export class ShowLineBlameCommand extends EditorCommand {

    constructor() {
        super(Commands.ShowLineBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit): Promise<any> {
        if (editor === undefined) return undefined;

        try {
            return Container.lineAnnotations.showAnnotations(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ShowLineBlameCommand');
            return window.showErrorMessage(`Unable to show line blame annotations. See output channel for more details`);
        }
    }
}