'use strict';
import { Iterables } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from '../commands';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export default class CopyShaToClipboardCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.CopyShaToClipboard);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string): Promise<any> {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            // If we don't have an editor then get the sha of the last commit to the repository
            if (!uri) {
                const log = await this.git.getLogForRepo(this.repoPath, undefined, 1);
                if (!log) return undefined;

                sha = Iterables.first(log.commits.values()).sha;
                copy(sha);
                return undefined;
            }

            const line = editor.selection.active.line;
            const gitUri = GitUri.fromUri(uri, this.git);

            if (!sha) {
                const blameline = line - gitUri.offset;
                if (blameline < 0) return undefined;

                try {
                    const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                    if (!blame) return undefined;

                    sha = blame.commit.sha;
                }
                catch (ex) {
                    Logger.error('[GitLens.CopyShaToClipboardCommand]', `getBlameForLine(${blameline})`, ex);
                    return window.showErrorMessage(`Unable to copy sha. See output channel for more details`);
                }
            }

            copy(sha);
            return undefined;
        }
        catch (ex) {
            Logger.error('GitLens.CopyShaToClipboardCommand', ex);
            return window.showErrorMessage(`Unable to copy sha. See output channel for more details`);
        }
    }
}