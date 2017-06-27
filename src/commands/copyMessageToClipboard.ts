'use strict';
import { Iterables } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export interface CopyMessageToClipboardCommandArgs {
    message?: string;
    sha?: string;
}

export class CopyMessageToClipboardCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.CopyMessageToClipboard);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: CopyMessageToClipboardCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);

        try {
            args = { ...args };

            // If we don't have an editor then get the message of the last commit to the branch
            if (uri === undefined) {
                if (!this.git.repoPath) return undefined;

                const log = await this.git.getLogForRepo(this.git.repoPath, undefined, 1);
                if (!log) return undefined;

                args.message = Iterables.first(log.commits.values()).message;
                copy(args.message);
                return undefined;
            }

            const gitUri = await GitUri.fromUri(uri, this.git);

            if (args.message === undefined) {
                if (args.sha === undefined) {
                    if (editor !== undefined && editor.document !== undefined && editor.document.isDirty) return undefined;

                    const line = (editor && editor.selection.active.line) || gitUri.offset;
                    const blameline = line - gitUri.offset;
                    if (blameline < 0) return undefined;

                    try {
                        const blame = await this.git.getBlameForLine(gitUri, blameline);
                        if (!blame) return undefined;

                        if (blame.commit.isUncommitted) return undefined;

                        args.sha = blame.commit.sha;
                        if (!gitUri.repoPath) {
                            gitUri.repoPath = blame.commit.repoPath;
                        }
                    }
                    catch (ex) {
                        Logger.error(ex, 'CopyMessageToClipboardCommand', `getBlameForLine(${blameline})`);
                        return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
                    }
                }

                // Get the full commit message -- since blame only returns the summary
                const commit = await this.git.getLogCommit(gitUri.repoPath, gitUri.fsPath, args.sha);
                if (!commit) return undefined;

                args.message = commit.message;
            }

            copy(args.message);
            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CopyMessageToClipboardCommand');
            return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
        }
    }
}