'use strict'
import {TextEditor, TextEditorEdit, Uri} from 'vscode';
import BlameAnnotationController from '../blameAnnotationController';
import {EditorCommand} from './commands';
import {Commands} from '../constants';
import GitProvider from '../gitProvider';

export default  class ToggleBlameCommand extends EditorCommand {
    constructor(private git: GitProvider, private blameController: BlameAnnotationController) {
        super(Commands.ToggleBlame);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string) {
        if (sha) {
            return this.blameController.toggleBlameAnnotation(editor, sha);
        }

        if (!(uri instanceof Uri)) {
            if (!editor.document) return;
            uri = editor.document.uri;
        }

        return this.git.getBlameForLine(uri.fsPath, editor.selection.active.line)
            .catch(ex => console.error('[GitLens.ToggleBlameCommand]', `getBlameForLine(${editor.selection.active.line})`, ex))
            .then(blame => this.blameController.toggleBlameAnnotation(editor, blame && blame.commit.sha));
    }
}

export class ToggleCodeLensCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return this.git.toggleCodeLens(editor);
    }
}