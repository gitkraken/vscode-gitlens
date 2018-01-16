'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { UriComparer } from '../comparers';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';

export class ToggleFileRecentChangesCommand extends EditorCommand {

    constructor() {
        super(Commands.ToggleFileRecentChanges);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        if (editor === undefined) return undefined;

        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (uri !== undefined && !UriComparer.equals(uri, editor.document.uri)) {
            const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
            if (e !== undefined) {
                editor = e;
            }
        }

        try {
            return Container.annotations.toggleAnnotations(editor, FileAnnotationType.RecentChanges);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleFileRecentChangesCommand');
            return window.showErrorMessage(`Unable to toggle recent file changes annotations. See output channel for more details`);
        }
    }
}