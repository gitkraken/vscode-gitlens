'use strict';
import * as path from 'path';
import { Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { ActiveEditorCommand, Commands, getCommandUri, openEditor } from './common';

export interface OpenWorkingFileCommandArgs {
    uri?: Uri;
    line?: number;
    showOptions?: TextDocumentShowOptions;
    annotationType?: FileAnnotationType;
}

export class OpenWorkingFileCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.OpenWorkingFile);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenWorkingFileCommandArgs = {}) {
        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        try {
            if (args.uri == null) {
                uri = getCommandUri(uri, editor);
                if (uri == null) return undefined;

                args.uri = await GitUri.fromUri(uri);
                if (args.uri instanceof GitUri && args.uri.sha) {
                    const [fileName, repoPath] = await Container.git.findWorkingFileName(
                        args.uri.fsPath,
                        args.uri.repoPath
                    );
                    if (fileName !== undefined && repoPath !== undefined) {
                        args.uri = new GitUri(Uri.file(path.resolve(repoPath, fileName)), repoPath);
                    }
                }
            }

            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            const e = await openEditor(args.uri, { ...args.showOptions, rethrow: true });
            if (args.annotationType === undefined) return e;

            return Container.fileAnnotations.show(e!, args.annotationType, args.line);
        }
        catch (ex) {
            Logger.error(ex, 'OpenWorkingFileCommand');
            return window.showErrorMessage(`Unable to open working file. See output channel for more details`);
        }
    }
}
