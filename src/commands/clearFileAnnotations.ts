'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { Container } from '../container';
import { Logger } from '../logger';

export class ClearFileAnnotationsCommand extends EditorCommand {

    constructor() {
        super([Commands.ClearFileAnnotations, Commands.ComputingFileAnnotations]);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        if (editor === undefined) return undefined;

        try {
            return Container.annotations.clear(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ClearFileAnnotationsCommand');
            return window.showErrorMessage(`Unable to clear file annotations. See output channel for more details`);
        }
    }
}