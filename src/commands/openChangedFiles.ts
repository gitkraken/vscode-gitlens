'use strict';
import { Arrays } from '../system';
import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri, openEditor } from './common';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';

export interface OpenChangedFilesCommandArgs {
    uris?: Uri[];
}

export class OpenChangedFilesCommand extends ActiveEditorCommand {

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.OpenChangedFiles);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenChangedFilesCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            if (args.uris === undefined) {
                args = { ...args };

                const repoPath = await this.git.getRepoPath(uri);
                if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open changed files`);

                const status = await this.git.getStatusForRepo(repoPath);
                if (status === undefined) return window.showWarningMessage(`Unable to open changed files`);

                args.uris = Arrays.filterMap(status.files,
                    f => f.status !== 'D' ? f.Uri : undefined);
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