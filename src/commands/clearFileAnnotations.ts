'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { AnnotationController } from '../annotations/annotationController';
import { Commands, EditorCommand } from './common';
import { Logger } from '../logger';

export class ClearFileAnnotationsCommand extends EditorCommand {

    constructor(private annotationController: AnnotationController) {
        super(Commands.ClearFileAnnotations);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<any> {
        if (editor === undefined || editor.document === undefined || editor.document.isDirty) return undefined;

        try {
            return this.annotationController.clear(editor.viewColumn || -1);
        }
        catch (ex) {
            Logger.error(ex, 'ClearFileAnnotationsCommand');
            return window.showErrorMessage(`Unable to clear file annotations. See output channel for more details`);
        }
    }
}