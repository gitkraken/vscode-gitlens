'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import BlameAnnotationController from '../blameAnnotationController';
import { Commands, EditorCommand } from '../commands';
import { Logger } from '../logger';

export default class ToggleBlameCommand extends EditorCommand {

    constructor(private annotationController: BlameAnnotationController) {
        super(Commands.ToggleBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string): Promise<any> {
        try {
            if (sha) {
                return this.annotationController.toggleBlameAnnotation(editor, sha);
            }

            return this.annotationController.toggleBlameAnnotation(editor, editor.selection.active.line);
        }
        catch (ex) {
            Logger.error('GitLens.ToggleBlameCommand', ex);
            return window.showErrorMessage(`Unable to show blame annotations. See output channel for more details`);
        }
    }
}