'use strict';
import { TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { AnnotationController, FileAnnotationType } from '../annotations/annotationController';
import { Commands, EditorCommand } from './common';
import { ExtensionKey, IConfig } from '../configuration';
import { Logger } from '../logger';

export interface ShowFileBlameCommandArgs {
    sha?: string;
    type?: FileAnnotationType;
}

export class ShowFileBlameCommand extends EditorCommand {

    constructor(private annotationController: AnnotationController) {
        super(Commands.ShowFileBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowFileBlameCommandArgs = {}): Promise<any> {
        if (editor === undefined || editor.document.isDirty) return undefined;

        try {
            if (args.type === undefined) {
                args = { ...args };

                const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
                args.type = cfg.blame.file.annotationType;
            }

            return this.annotationController.showAnnotations(editor, args.type, args.sha !== undefined ? args.sha : editor.selection.active.line);
        }
        catch (ex) {
            Logger.error(ex, 'ShowFileBlameCommand');
            return window.showErrorMessage(`Unable to show file blame annotations. See output channel for more details`);
        }
    }
}