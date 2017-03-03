'use strict';
import { Iterables } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitProvider, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export class CopyMessageToClipboardCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.CopyMessageToClipboard);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, message?: string): Promise<any> {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            // If we don't have an editor then get the message of the last commit to the repository
            if (!uri) {
                const log = await this.git.getLogForRepo(this.repoPath, undefined, 1);
                if (!log) return undefined;

                message = Iterables.first(log.commits.values()).message;
                copy(message);
                return undefined;
            }

            const gitUri = GitUri.fromUri(uri, this.git);

            if (!message) {
                if (!sha) {
                    if (editor && editor.document && editor.document.isDirty) return undefined;

                    const line = (editor && editor.selection.active.line) || gitUri.offset;
                    const blameline = line - gitUri.offset;
                    if (blameline < 0) return undefined;

                    try {
                        const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                        if (!blame) return undefined;

                        if (blame.commit.isUncommitted) return undefined;

                        sha = blame.commit.sha;
                        if (!gitUri.repoPath) {
                            gitUri.repoPath = blame.commit.repoPath;
                        }
                    }
                    catch (ex) {
                        Logger.error('[GitLens.CopyMessageToClipboardCommand]', `getBlameForLine(${blameline})`, ex);
                        return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
                    }
                }

                // Get the full commit message -- since blame only returns the summary
                const log = await this.git.getLogForFile(gitUri.fsPath, sha, gitUri.repoPath, undefined, 1);
                if (!log) return undefined;

                const commit = log.commits.get(sha);
                if (!commit) return undefined;

                message = commit.message;
            }

            copy(message);
            return undefined;
        }
        catch (ex) {
            Logger.error('GitLens.CopyMessageToClipboardCommand', ex);
            return window.showErrorMessage(`Unable to copy message. See output channel for more details`);
        }
    }
}