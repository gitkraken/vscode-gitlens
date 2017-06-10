'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { AnnotationController, FileAnnotationType } from '../annotations/annotationController';
import { Commands, EditorCommand } from './common';
import { Logger } from '../logger';

export class ToggleFileRecentChangesCommand extends EditorCommand {

    constructor(private annotationController: AnnotationController) {
        super(Commands.ToggleFileRecentChanges);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

        try {
            return this.annotationController.toggleAnnotations(editor, FileAnnotationType.RecentChanges);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleFileRecentChangesCommand');
            return window.showErrorMessage(`Unable to toggle recent file changes annotations. See output channel for more details`);
        }
    }
}