'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './common';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitFileDetailsQuickPick } from '../quickPicks';
import * as path from 'path';

export class ShowQuickCommitFileDetailsCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickCommitFileDetails);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, commit?: GitCommit | GitLogCommit, goBackCommand?: CommandQuickPickItem, fileLog?: IGitLog) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        let workingFileName = commit && commit.workingFileName;

        const gitUri = await GitUri.fromUri(uri, this.git);

        if (!sha) {
            if (!editor) return undefined;

            const blameline = editor.selection.active.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (!blame) return window.showWarningMessage(`Unable to show commit file details. File is probably not under source control`);

                sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;

                commit = blame.commit;
                workingFileName = path.relative(commit.repoPath, gitUri.fsPath);
            }
            catch (ex) {
                Logger.error(ex, 'ShowQuickCommitFileDetailsCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
            }
        }

        try {
            if (!commit || (commit.type !== 'file' && commit.type !== 'stash')) {
                if (fileLog) {
                    commit = fileLog.commits.get(sha);
                    // If we can't find the commit, kill the fileLog
                    if (!commit) {
                        fileLog = undefined;
                    }
                }

                if (!fileLog) {
                    commit = await this.git.getLogCommit(commit ? commit.repoPath : gitUri.repoPath, commit ? commit.uri.fsPath : gitUri.fsPath, sha, { previous: true });
                    if (!commit) return window.showWarningMessage(`Unable to show commit file details`);
                }
            }

            // Attempt to the most recent commit -- so that we can find the real working filename if there was a rename
            commit.workingFileName = workingFileName;
            commit.workingFileName = await this.git.findWorkingFileName(commit);

            const shortSha = sha.substring(0, 8);

            if (!goBackCommand) {
                // Create a command to get back to the commit details
                goBackCommand = new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(git-commit) ${shortSha}`
                }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), sha, commit]);
            }

            const pick = await CommitFileDetailsQuickPick.show(this.git, commit as GitLogCommit, uri, goBackCommand,
                // Create a command to get back to where we are right now
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(file-text) ${path.basename(commit.fileName)} in \u00a0$(git-commit) ${shortSha}`
                }, Commands.ShowQuickCommitFileDetails, [new GitUri(commit.uri, commit), sha, commit, goBackCommand]),
                fileLog);

            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickCommitFileDetailsCommand');
            return window.showErrorMessage(`Unable to show commit file details. See output channel for more details`);
        }
    }
}