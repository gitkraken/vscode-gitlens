'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { BlameAnnotationController } from '../blameAnnotationController';
import { Commands, EditorCommand } from './commands';
import { Logger } from '../logger';

export class ShowBlameCommand extends EditorCommand {

    constructor(private annotationController: BlameAnnotationController) {
        super(Commands.ShowBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string): Promise<any> {
        try {
            if (sha) {
                return this.annotationController.showBlameAnnotation(editor, sha);
            }

            return this.annotationController.showBlameAnnotation(editor, editor.selection.active.line);
        }
        catch (ex) {
            Logger.error('GitLens.ShowBlameCommand', ex);
            return window.showErrorMessage(`Unable to show blame annotations. See output channel for more details`);
        }
    }
}