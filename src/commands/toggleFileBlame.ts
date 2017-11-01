'use strict';
import { TextEditor, TextEditorEdit, Uri, window, workspace } from 'vscode';
import { AnnotationController, FileAnnotationType } from '../annotations/annotationController';
import { Commands, EditorCommand } from './common';
import { UriComparer } from '../comparers';
import { ExtensionKey, IConfig } from '../configuration';
import { Logger } from '../logger';

export interface ToggleFileBlameCommandArgs {
    sha?: string;
    type?: FileAnnotationType;
}

export class ToggleFileBlameCommand extends EditorCommand {

    constructor(
        private readonly annotationController: AnnotationController
    ) {
        super(Commands.ToggleFileBlame);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Promise<any> {
        if (editor === undefined || editor.document.isDirty) return undefined;

        // Handle the case where we are focused on a non-editor editor (output, debug console)
        if (uri !== undefined && !UriComparer.equals(uri, editor.document.uri)) {
            const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
            if (e !== undefined && !e.document.isDirty) {
                editor = e;
            }
        }

        try {
            if (args.type === undefined) {
                args = { ...args };

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