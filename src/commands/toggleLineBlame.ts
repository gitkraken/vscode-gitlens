'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { CurrentLineController, LineAnnotationType } from '../currentLineController';
import { Commands, EditorCommand } from './common';
import { configuration } from '../configuration';
import { Logger } from '../logger';

export interface ToggleLineBlameCommandArgs {
    type?: LineAnnotationType;
}

export class ToggleLineBlameCommand extends EditorCommand {

    constructor(
        private readonly currentLineController: CurrentLineController
    ) {
        super(Commands.ToggleLineBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ToggleLineBlameCommandArgs = {}): Promise<any> {
        if (editor === undefined) return undefined;

        try {
            if (args.type === undefined) {
                args = { ...args, type: configuration.get<LineAnnotationType>(configuration.name('blame')('line')('annotationType').value) };
            }

            return this.currentLineController.toggleAnnotations(editor, args.type!);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleLineBlameCommand');
            return window.showErrorMessage(`Unable to toggle line blame annotations. See output channel for more details`);
        }
    }
}