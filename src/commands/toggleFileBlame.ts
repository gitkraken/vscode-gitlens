'use strict';
import { TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { AnnotationController, FileAnnotationType } from '../annotations/annotationController';
import { Commands, EditorCommand } from './common';
import { ExtensionKey, IConfig } from '../configuration';
import { Logger } from '../logger';

export interface ToggleFileBlameCommandArgs {
    sha?: string;
    type?: FileAnnotationType;
}

export class ToggleFileBlameCommand extends EditorCommand {

    constructor(private annotationController: AnnotationController) {
        super(Commands.ToggleFileBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Promise<any> {
        if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

        try {
            if (args.type === undefined) {
                const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
                args.type = cfg.blame.file.annotationType;
            }

            return this.annotationController.toggleAnnotations(editor, args.type, args.sha !== undefined ? args.sha : editor.selection.active.line);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleFileBlameCommand');
            return window.showErrorMessage(`Unable to toggle file blame annotations. See output channel for more details`);
        }
    }
}