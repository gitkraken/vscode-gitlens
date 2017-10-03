'use strict';
import { Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { AnnotationController, FileAnnotationType } from '../annotations/annotationController';
import { ActiveEditorCommand, Commands, getCommandUri, openEditor } from './common';
import { Logger } from '../logger';

export interface OpenFileRevisionCommandArgs {
    uri?: Uri;
    line?: number;
    showOptions?: TextDocumentShowOptions;
    annotationType?: FileAnnotationType;
}

export class OpenFileRevisionCommand extends ActiveEditorCommand {

    static getMarkdownCommandArgs(args: OpenFileRevisionCommandArgs): string;
    static getMarkdownCommandArgs(uri: Uri, annotationType?: FileAnnotationType, line?: number): string;
    static getMarkdownCommandArgs(argsOrUri: OpenFileRevisionCommandArgs | Uri, annotationType?: FileAnnotationType, line?: number): string {
        let args: OpenFileRevisionCommandArgs | Uri;
        if (argsOrUri instanceof Uri) {
            const uri = argsOrUri;

            args = {
                uri: uri,
                line: line,
                annotationType: annotationType
            };
        }
        else {
            args = argsOrUri;
        }

        return super.getMarkdownCommandArgsCore<OpenFileRevisionCommandArgs>(Commands.OpenFileRevision, args);
    }

    constructor(private annotationController: AnnotationController) {
        super(Commands.OpenFileRevision);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenFileRevisionCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor === undefined ? 0 : editor.selection.active.line;
        }

        try {
            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            const e = await openEditor(args.uri!, args.showOptions);
            if (args.annotationType === undefined) return e;

            return this.annotationController.showAnnotations(e!, args.annotationType, args.line);
        }
        catch (ex) {
            Logger.error(ex, 'OpenFileRevisionCommand');
            return window.showErrorMessage(`Unable to open in file revision. See output channel for more details`);
        }
    }
}