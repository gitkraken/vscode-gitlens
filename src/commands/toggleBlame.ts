'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import BlameAnnotationController from '../blameAnnotationController';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider from '../gitProvider';
import { Logger } from '../logger';

export default class ToggleBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private annotationController: BlameAnnotationController) {
        super(Commands.ToggleBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.annotationController.toggleBlameAnnotation(editor, sha);
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        try {
            const blame = await this.git.getBlameForLine(uri.fsPath, editor.selection.active.line);
            return this.annotationController.toggleBlameAnnotation(editor, blame && blame.commit.sha);
        }
        catch (ex) {
            Logger.error('[GitLens.ToggleBlameCommand]', `getBlameForLine(${editor.selection.active.line})`, ex);
            return window.showErrorMessage(`Unable to show blame annotations. See output channel for more details`);
        }
    }
}