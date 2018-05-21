'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { UriComparer } from '../comparers';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';

export interface ToggleFileBlameCommandArgs {
    sha?: string;
    type?: FileAnnotationType;
}

export class ToggleFileBlameCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.ToggleFileBlame);
    }

    async execute(editor: TextEditor, uri?: Uri, args: ToggleFileBlameCommandArgs = {}): Promise<any> {
        // if (editor == null) return undefined;

        if (editor != null) {
            // Handle the case where we are focused on a non-editor editor (output, debug console)
            if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
                const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
                if (e !== undefined) {
                    editor = e;
                }
            }
        }

        try {
            if (args.type === undefined) {
                args = { ...args, type: FileAnnotationType.Blame };
            }

            return Container.fileAnnotations.toggle(editor, args.type!, args.sha !== undefined ? args.sha : editor && editor.selection.active.line);
        }
        catch (ex) {
            Logger.error(ex, 'ToggleFileBlameCommand');
            return window.showErrorMessage(`Unable to toggle file ${args.type} annotations. See output channel for more details`);
        }
    }
}