'use strict';
import { TextEditor, TextEditorEdit } from 'vscode';
import { Commands, EditorCommand } from './commands';
import { GitService } from '../gitService';

export class ToggleCodeLensCommand extends EditorCommand {

    constructor(private git: GitService) {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return this.git.toggleCodeLens(editor);
    }
}