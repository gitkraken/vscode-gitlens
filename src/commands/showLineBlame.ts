'use strict';
import { TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { CurrentLineController, LineAnnotationType } from '../currentLineController';
import { Commands, EditorCommand } from './common';
import { ExtensionKey, IConfig } from '../configuration';
import { Logger } from '../logger';

export interface ShowLineBlameCommandArgs {
    type?: LineAnnotationType;
}

export class ShowLineBlameCommand extends EditorCommand {

    constructor(private currentLineController: CurrentLineController) {
        super(Commands.ShowLineBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowLineBlameCommandArgs = {}): Promise<any> {
        if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

        try {
            if (args.type === undefined) {
                args = { ...args };

                const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
                args.type = cfg.blame.line.annotationType;
            }

            return this.currentLineController.showAnnotations(editor, args.type);
        }
        catch (ex) {
            Logger.error(ex, 'ShowLineBlameCommand');
            return window.showErrorMessage(`Unable to show line blame annotations. See output channel for more details`);
        }
    }
}