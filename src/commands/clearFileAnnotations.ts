'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { UriComparer } from '../comparers';
import { Container } from '../container';
import { Logger } from '../logger';

export class ClearFileAnnotationsCommand extends EditorCommand {
    constructor() {
        super([Commands.ClearFileAnnotations, Commands.ComputingFileAnnotations]);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        if (editor == null) return undefined;

        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
            const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
            if (e !== undefined) {
                editor = e;
            }
        }

        try {
            return Container.fileAnnotations.clear(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ClearFileAnnotationsCommand');
            return window.showErrorMessage(`Unable to clear file annotations. See output channel for more details`);
        }
    }
}
