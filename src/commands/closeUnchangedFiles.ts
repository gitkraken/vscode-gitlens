'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorTracker } from '../activeEditorTracker';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri } from './common';
import { TextEditorComparer, UriComparer } from '../comparers';
import { BuiltInCommands } from '../constants';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface CloseUnchangedFilesCommandArgs {
    uris?: Uri[];
}

export class CloseUnchangedFilesCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.CloseUnchangedFiles);
    }

    async run(context: CommandContext, args: CloseUnchangedFilesCommandArgs = {}): Promise<any> {
        // Since we can change the args and they could be cached -- make a copy
        switch (context.type) {
            case 'uri':
                return this.execute(context.editor, context.uri, { ...args });
            case 'scm-states':
                return undefined;
            case 'scm-groups':
                // const group = context.scmResourceGroups[0];
                // args.uris = group.resourceStates.map(_ => _.resourceUri);
                return this.execute(undefined, undefined, { ...args });
            default:
                return this.execute(context.editor, undefined, { ...args });
        }
    }

    async execute(editor: TextEditor | undefined, uri?: Uri, args: CloseUnchangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                const repoPath = await this.git.getRepoPathFromUri(uri);
                if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to close unchanged files`);

                const status = await this.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to close unchanged files`);

                args.uris = status.files.map(_ => _.Uri);
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
                        (editor.document.isDirty || args.uris.some(_ => UriComparer.equals(_, editor!.document && editor!.document.uri)))) {
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