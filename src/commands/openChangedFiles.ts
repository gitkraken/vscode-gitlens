'use strict';
import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri, openEditor } from './common';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface OpenChangedFilesCommandArgs {
    uris?: Uri[];
}

export class OpenChangedFilesCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenChangedFiles);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenChangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                args = { ...args };

                const repoPath = await this.git.getRepoPathFromUri(uri);
                if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open changed files`);

                const status = await this.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to open changed files`);

                args.uris = status.files.filter(_ => _.status !== 'D').map(_ => _.Uri);
            }

            for (const uri of args.uris) {
                await openEditor(uri, { preserveFocus: true, preview: false } as TextDocumentShowOptions);
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'OpenChangedFilesCommand');
            return window.showErrorMessage(`Unable to open changed files. See output channel for more details`);
        }
    }
}