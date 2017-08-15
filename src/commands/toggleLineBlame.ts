'use strict';
import { TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { CurrentLineController, LineAnnotationType } from '../currentLineController';
import { Commands, EditorCommand } from './common';
import { ExtensionKey, IConfig } from '../configuration';
import { Logger } from '../logger';

export interface ToggleLineBlameCommandArgs {
    type?: LineAnnotationType;
}

export class ToggleLineBlameCommand extends EditorCommand {

    constructor(private currentLineController: CurrentLineController) {
        super(Commands.ToggleLineBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ToggleLineBlameCommandArgs = {}): Promise<any> {
        if (editor === undefined || editor.document === undefined || editor.document.isDirty) return undefined;

        try {
            if (args.type === undefined) {
                args = { ...args };

                const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
                args.type = cfg.blame.line.annotationType;
            }

            return this.currentLineController.toggleAnnotations(editor, args.type);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleLineBlameCommand');
            return window.showErrorMessage(`Unable to toggle line blame annotations. See output channel for more details`);
        }
    }
}