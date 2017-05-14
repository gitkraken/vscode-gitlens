'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { BlameAnnotationController } from '../blameAnnotationController';
import { Commands, EditorCommand } from './common';
import { Logger } from '../logger';

export interface ShowBlameCommandArgs {
    sha?: string;
}

export class ShowBlameCommand extends EditorCommand {

    constructor(private annotationController: BlameAnnotationController) {
        super(Commands.ShowBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowBlameCommandArgs = {}): Promise<any> {
        if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

        try {
            return this.annotationController.showBlameAnnotation(editor, args.sha !== undefined ? args.sha : editor.selection.active.line);
        }
        catch (ex) {
            Logger.error(ex, 'ShowBlameCommand');
            return window.showErrorMessage(`Unable to show blame annotations. See output channel for more details`);
        }
    }
}