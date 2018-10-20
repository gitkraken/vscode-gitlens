'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { UriComparer } from '../comparers';
import { isTextEditor } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Commands, EditorCommand } from './common';

export class ClearFileAnnotationsCommand extends EditorCommand {
    constructor() {
        super([Commands.ClearFileAnnotations, Commands.ComputingFileAnnotations]);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (editor != null && !isTextEditor(editor)) {
            if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
                const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
                if (e !== undefined) {
                    editor = e;
                }
            }
        }

        try {
            return Container.fileAnnotations.clear(editor);
        }
        catch (ex) {
            Logger.error(ex, 'ClearFileAnnotationsCommand');
            return Messages.showGenericErrorMessage('Unable to clear file annotations');
        }
    }
}
