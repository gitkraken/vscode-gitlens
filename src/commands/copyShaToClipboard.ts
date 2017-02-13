'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { copy } from 'copy-paste';

export default class CopyShaToClipboard extends EditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.CopyShaToClipboard);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, sha?: string): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        const line = editor.selection.active.line;
        const gitUri = GitUri.fromUri(uri, this.git);

        try {
            if (!sha) {
                const blameline = line - gitUri.offset;
                if (blameline < 0) return undefined;

                try {
                    const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                    if (!blame) return undefined;

                    sha = blame.commit.sha;
                }
                catch (ex) {
                    Logger.error('[GitLens.CopyShaToClipboard]', `getBlameForLine(${blameline})`, ex);
                    return window.showErrorMessage(`Unable to copy sha. See output channel for more details`);
                }
            }

            copy(sha);
            return undefined;
        }
        catch (ex) {
            Logger.error('GitLens.CopyShaToClipboard', ex);
            return window.showErrorMessage(`Unable to copy sha. See output channel for more details`);
        }
    }
}