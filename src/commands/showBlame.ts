'use strict'
import {TextEditor, TextEditorEdit, Uri} from 'vscode';
import BlameAnnotationController from '../blameAnnotationController';
import {EditorCommand} from './commands';
import {Commands} from '../constants';
import GitProvider from '../gitProvider';

export default class ShowBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private annotationController: BlameAnnotationController) {
        super(Commands.ShowBlame);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.annotationController.toggleBlameAnnotation(editor, sha);
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return;
            uri = editor.document.uri;
        }

        return this.git.getBlameForLine(uri.fsPath, editor.selection.active.line)
            .then(blame => this.annotationController.showBlameAnnotation(editor, blame && blame.commit.sha))
            .catch(ex => console.error('[GitLens.ShowBlameCommand]', `getBlameForLine(${editor.selection.active.line})`, ex));
    }
}