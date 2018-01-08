'use strict';
import { TextEditor, TextEditorEdit } from 'vscode';
import { Commands, EditorCommand } from './common';
import { Container } from '../container';

export class ToggleCodeLensCommand extends EditorCommand {

    constructor() {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return Container.codeLens.toggleCodeLens(editor);
    }
}