'use strict';
import { TextEditor, TextEditorEdit } from 'vscode';
import { EditorCommand } from './commands';
import { Commands} from '../constants';
import GitProvider from '../gitProvider';

export default class ToggleCodeLensCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ToggleCodeLens);
    }

    execute(editor: TextEditor, edit: TextEditorEdit) {
        return this.git.toggleCodeLens(editor);
    }
}