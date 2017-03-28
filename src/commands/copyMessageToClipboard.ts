'use strict';
import { Iterables } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export class CopyMessageToClipboardCommand extends ActiveEditorCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.CopyMessageToClipboard);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, message?: string): Promise<any> {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            // If we don't have an editor then get the message of the last commit to the branch
            if (!uri) {
                const log = await this.git.getLogForRepo(this.repoPath, undefined, 1);
                if (!log) return undefined;

                message = Iterables.first(log.commits.values()).message;
                copy(message);
                return undefined;
            }

            const gitUri = await GitUri.fromUri(uri, this.git);

            if (!message) {
                if (!sha) {
                    if (editor && editor.document && editor.document.isDirty) return undefined;

                    const line = (editor && editor.selection.active.line) || gitUri.offset;
                    const blameline = line - gitUri.offset;
                    if (blameline < 0) return undefined;

                    try {
                        const blame = await this.git.getBlameForLine(gitUri, blameline);
                        if (!blame) return undefined;

                        if (blame.commit.isUncommitted) return undefined;

                        sha = blame.commit.sha;
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
                const commit = await this.git.getLogCommit(gitUri.repoPath, gitUri.fsPath, sha);
                if (!commit) return undefined;

                message = commit.message;
            }

            copy(message);
            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CopyMessageToClipboardCommand');
            return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
        }
    }
}