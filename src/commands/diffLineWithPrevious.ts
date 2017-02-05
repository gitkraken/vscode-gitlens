'use strict';
import { commands, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';

export default class DiffLineWithPreviousCommand extends EditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.DiffLineWithPrevious);
    }

    async execute(editor: TextEditor): Promise<any>;
    async execute(editor: TextEditor, edit: TextEditorEdit, uri: Uri): Promise<any>;
    async execute(editor: TextEditor, edit?: TextEditorEdit, uri?: Uri, commit?: GitCommit, line?: number): Promise<any> {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        line = line || editor.selection.active.line;

        if (!commit || GitProvider.isUncommitted(commit.sha)) {
            const gitUri = GitUri.fromUri(uri, this.git);
            const blameline = line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri.fsPath, blameline, gitUri.sha, gitUri.repoPath);
                if (!blame) return window.showWarningMessage(`Unable to open diff. File is probably not under source control`);

                // If the line is uncommitted, find the previous commit
                commit = blame.commit;
                if (commit.isUncommitted) {
                    try {
                        const prevBlame = await this.git.getBlameForLine(commit.previousUri.fsPath, blame.line.originalLine + 1, commit.previousSha, commit.repoPath);
                        if (!prevBlame) return undefined;

                        const prevCommit = prevBlame.commit;
                        commit = new GitCommit(commit.repoPath, commit.sha, commit.fileName, commit.author, commit.date, commit.message, commit.lines, commit.originalFileName, prevCommit.sha, prevCommit.fileName);
                        line = blame.line.originalLine + 1 + gitUri.offset;
                    }
                    catch (ex) {
                        Logger.error('[GitLens.DiffWithPreviousLineCommand]', `getBlameForLine(${blame.line.originalLine}, ${commit.previousSha})`, ex);
                        return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
                    }
                }
            }
            catch (ex) {
                Logger.error('[GitLens.DiffWithPreviousLineCommand]', `getBlameForLine(${blameline})`, ex);
                return window.showErrorMessage(`Unable to open diff. See output channel for more details`);
            }
        }

        return commands.executeCommand(Commands.DiffWithPrevious, commit.uri, commit, line);
    }
}