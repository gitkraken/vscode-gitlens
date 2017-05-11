'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './common';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitDetailsQuickPick, CommitWithFileStatusQuickPickItem } from '../quickPicks';
import * as path from 'path';

export class ShowQuickCommitDetailsCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickCommitDetails);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, commit?: GitCommit | GitLogCommit, goBackCommand?: CommandQuickPickItem, repoLog?: IGitLog) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        let repoPath = gitUri.repoPath;
        let workingFileName = path.relative(repoPath || '', gitUri.fsPath);

        if (!sha) {
            if (!editor) return undefined;

            const blameline = editor.selection.active.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (!blame) return window.showWarningMessage(`Unable to show commit details. File is probably not under source control`);

                sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;
                repoPath = blame.commit.repoPath;
                workingFileName = blame.commit.fileName;

                commit = blame.commit;
            }
            catch (ex) {
                Logger.error(ex, 'ShowQuickCommitDetailsCommand', `getBlameForLine(${blameline})`);
                return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
            }
        }

        try {
            if (!commit || (commit.type !== 'branch' && commit.type !== 'stash')) {
                if (repoLog) {
                    commit = repoLog.commits.get(sha!);
                    // If we can't find the commit, kill the repoLog
                    if (commit === undefined) {
                        repoLog = undefined;
                    }
                }

                if (repoLog === undefined) {
                    const log = await this.git.getLogForRepo(repoPath!, sha, 2);
                    if (log === undefined) return window.showWarningMessage(`Unable to show commit details`);

                    commit = log.commits.get(sha!);
                }
            }

            if (commit === undefined) return window.showWarningMessage(`Unable to show commit details`);

            if (!commit.workingFileName) {
                commit.workingFileName = workingFileName;
            }

            if (!goBackCommand) {
                // Create a command to get back to the branch history
                goBackCommand = new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to branch history`
                }, Commands.ShowQuickCurrentBranchHistory, [new GitUri(commit.uri, commit)]);
            }

            // Create a command to get back to where we are right now
            const currentCommand = new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(git-commit) ${commit.shortSha}`
            }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), sha, commit, goBackCommand, repoLog]);

            const pick = await CommitDetailsQuickPick.show(this.git, commit as GitLogCommit, uri, goBackCommand, currentCommand, repoLog);
            if (!pick) return undefined;

            if (!(pick instanceof CommitWithFileStatusQuickPickItem)) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails, pick.gitUri, pick.sha, commit, currentCommand);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickCommitDetailsCommand');
            return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
        }
    }
}