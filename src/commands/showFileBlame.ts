'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand } from './common';
import { configuration, FileAnnotationType  } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';

export interface ShowFileBlameCommandArgs {
    sha?: string;
    type?: FileAnnotationType;
}

export class ShowFileBlameCommand extends EditorCommand {

    constructor() {
        super(Commands.ShowFileBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowFileBlameCommandArgs = {}): Promise<any> {
        if (editor === undefined) return undefined;

        try {
            if (args.type === undefined) {
                args = { ...args, type: configuration.get<FileAnnotationType>(configuration.name('blame')('file')('annotationType').value) };
            }

            return Container.annotations.showAnnotations(editor, args.type!, args.sha !== undefined ? args.sha : editor.selection.active.line);
        }
        catch (ex) {
            Logger.error(ex, 'ShowFileBlameCommand');
            return window.showErrorMessage(`Unable to show file blame annotations. See output channel for more details`);
        }
    }
}