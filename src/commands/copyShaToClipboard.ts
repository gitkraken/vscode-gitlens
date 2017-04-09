'use strict';
import { Iterables } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export class CopyShaToClipboardCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.CopyShaToClipboard);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string): Promise<any> {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            // If we don't have an editor then get the sha of the last commit to the branch
            if (!uri) {
                if (!this.git.repoPath) return undefined;

                const log = await this.git.getLogForRepo(this.git.repoPath, undefined, 1);
                if (!log) return undefined;

                sha = Iterables.first(log.commits.values()).sha;
                copy(sha);
                return undefined;
            }

            const gitUri = await GitUri.fromUri(uri, this.git);

            if (!sha) {
                if (editor && editor.document && editor.document.isDirty) return undefined;

                const line = (editor && editor.selection.active.line) || gitUri.offset;
                const blameline = line - gitUri.offset;
                if (blameline < 0) return undefined;

                try {
                    const blame = await this.git.getBlameForLine(gitUri, blameline);
                    if (!blame) return undefined;

                    sha = blame.commit.sha;
                }
                catch (ex) {
                    Logger.error(ex, 'CopyShaToClipboardCommand', `getBlameForLine(${blameline})`);
                    return window.showErrorMessage(`Unable to copy commit id. See output channel for more details`);
                }
            }

            copy(sha);
            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'CopyShaToClipboardCommand');
            return window.showErrorMessage(`Unable to copy commit id. See output channel for more details`);
        }
    }
}