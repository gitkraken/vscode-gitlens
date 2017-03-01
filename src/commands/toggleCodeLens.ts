'use strict';
import { TextEditor, TextEditorEdit } from 'vscode';
import { Commands, EditorCommand } from './commands';
import GitProvider from '../gitProvider';

export class ToggleCodeLensCommand extends EditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return this.git.toggleCodeLens(editor);
    }
}