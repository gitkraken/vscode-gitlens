'use strict';
import { TextEditor, TextEditorEdit } from 'vscode';
import { CodeLensController } from '../codeLensController';
import { Commands, EditorCommand } from './common';

export class ToggleCodeLensCommand extends EditorCommand {

    constructor(
        private readonly codeLensController: CodeLensController
    ) {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return this.codeLensController.toggleCodeLens(editor);
    }
}