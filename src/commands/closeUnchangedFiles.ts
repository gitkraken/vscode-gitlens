'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorTracker } from '../activeEditorTracker';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { TextEditorComparer, UriComparer } from '../comparers';
import { GitService } from '../gitService';
import { Logger } from '../logger';

export interface CloseUnchangedFilesCommandArgs {
    uris?: Uri[];
}

export class CloseUnchangedFilesCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.CloseUnchangedFiles);
    }

    async execute(editor: TextEditor, uri?: Uri, args: CloseUnchangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                const repoPath = await this.git.getRepoPathFromUri(uri);
                if (!repoPath) return window.showWarningMessage(`Unable to close unchanged files`);

                const status = await this.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to close unchanged files`);

                args.uris = status.files.map(_ => _.Uri);
            }

            const editorTracker = new ActiveEditorTracker();

            let active = window.activeTextEditor;
            let editor = active;
            do {
                if (editor !== undefined) {
                    if ((editor.document !== undefined && editor.document.isDirty) ||
                        args.uris.some(_ => UriComparer.equals(_, editor!.document && editor!.document.uri))) {
                        // If we didn't start with a valid editor, set one once we find it
                        if (active === undefined) {
                            active = editor;
                        }
                        editor = await editorTracker.awaitNext(500);
                    }
                    else {
                        if (active === editor) {
                            active = undefined;
                        }
                        editor = await editorTracker.awaitClose(500);
                    }
                }
                else {
                    if (active === editor) {
                        active = undefined;
                    }
                    editor = await editorTracker.awaitClose(500);
                }
            } while ((active === undefined && editor === undefined) || !TextEditorComparer.equals(active, editor, { useId: true, usePosition: true }));

            editorTracker.dispose();

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CloseUnchangedFilesCommand');
            return window.showErrorMessage(`Unable to close unchanged files. See output channel for more details`);
        }
    }
}