'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorTracker } from '../trackers/activeEditorTracker';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { TextEditorComparer, UriComparer } from '../comparers';
import { BuiltInCommands } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface CloseUnchangedFilesCommandArgs {
    uris?: Uri[];
}

export class CloseUnchangedFilesCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.CloseUnchangedFiles);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: CloseUnchangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                args = { ...args };

                const repoPath = await Container.git.getRepoPath(uri);
                if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to close unchanged files`);

                const status = await Container.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to close unchanged files`);

                args.uris = status.files.map(f => f.uri);
            }

            if (args.uris.length === 0) return commands.executeCommand(BuiltInCommands.CloseAllEditors);

            const editorTracker = new ActiveEditorTracker();

            let count = 0;
            let previous = undefined;
            let editor = window.activeTextEditor;
            while (true) {
                if (editor !== undefined) {
                    if (TextEditorComparer.equals(previous, editor, { useId: true, usePosition: true })) {
                        break;
                    }

                    if (editor.document !== undefined &&
                        (editor.document.isDirty || args.uris.some(uri => UriComparer.equals(uri, editor!.document && editor!.document.uri)))) {
                        const lastPrevious = previous;
                        previous = editor;
                        editor = await editorTracker.awaitNext(500);

                        if (TextEditorComparer.equals(lastPrevious, editor, { useId: true, usePosition: true })) {
                            break;
                        }
                        continue;
                    }
                }

                previous = editor;
                editor = await editorTracker.awaitClose(500);

                if (previous === undefined && editor === undefined) {
                    count++;
                    // This is such a shitty hack, but I can't figure out any other reliable way to know that we've cycled through all the editors :(
                    if (count >= 4) {
                        break;
                    }
                }
                else {
                    count = 0;
                }
            }

            editorTracker.dispose();

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CloseUnchangedFilesCommand');
            return window.showErrorMessage(`Unable to close unchanged files. See output channel for more details`);
        }
    }
}