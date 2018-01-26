'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { UriComparer } from '../comparers';
import { configuration, FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';

export interface ToggleFileBlameCommandArgs {
    sha?: string;
    type?: FileAnnotationType;
}

export class ToggleFileBlameCommand extends EditorCommand {

    constructor() {
        super(Commands.ToggleFileBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Promise<any> {
        if (editor === undefined) return undefined;

        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (uri !== undefined && !UriComparer.equals(uri, editor.document.uri)) {
            const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
            if (e !== undefined) {
                editor = e;
            }
        }

        try {
            if (args.type === undefined) {
                args = { ...args, type: configuration.get<FileAnnotationType>(configuration.name('blame')('file')('annotationType').value) };
            }

            return Container.annotations.toggleAnnotations(editor, args.type!, args.sha !== undefined ? args.sha : editor.selection.active.line);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleFileBlameCommand');
            return window.showErrorMessage(`Unable to toggle file ${args.type} annotations. See output channel for more details`);
        }
    }
}