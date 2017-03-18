'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitCommit, GitLogCommit, GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitDetailsQuickPick, CommitWithFileStatusQuickPickItem } from '../quickPicks';

export class ShowQuickCommitDetailsCommand extends ActiveEditorCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.ShowQuickCommitDetails);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, commit?: GitCommit | GitLogCommit, goBackCommand?: CommandQuickPickItem, repoLog?: IGitLog) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        let repoPath = gitUri.repoPath;

        if (!sha) {
            if (!editor) return undefined;

            const blameline = editor.selection.active.line - gitUri.offset;
            if (blameline < 0) return undefined;

            try {
                const blame = await this.git.getBlameForLine(gitUri, blameline);
                if (!blame) return window.showWarningMessage(`Unable to show commit details. File is probably not under source control`);

                sha = blame.commit.isUncommitted ? blame.commit.previousSha : blame.commit.sha;
                repoPath = blame.commit.repoPath;

                commit = blame.commit;
            }
            catch (ex) {
                Logger.error('[GitLens.ShowQuickCommitDetailsCommand]', `getBlameForLine(${blameline})`, ex);
                return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
            }
        }

        try {
            if (!commit || !(commit instanceof GitLogCommit) || commit.type !== 'repo') {
                if (repoLog) {
                    commit = repoLog.commits.get(sha);
                    // If we can't find the commit, kill the repoLog
                    if (!commit) {
                        repoLog = undefined;
                    }
                }

                if (!repoLog) {
                    const log = await this.git.getLogForRepo(repoPath || this.repoPath, sha, 2);
                    if (!log) return window.showWarningMessage(`Unable to show commit details`);

                    commit = log.commits.get(sha);
                }
            }

            if (!goBackCommand) {
                // Create a command to get back to the repository history
                goBackCommand = new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to repository history`
                }, Commands.ShowQuickRepoHistory, [new GitUri(commit.uri, commit)]);
            }

            const pick = await CommitDetailsQuickPick.show(this.git, commit as GitLogCommit, uri, goBackCommand, repoLog);
            if (!pick) return undefined;

            if (!(pick instanceof CommitWithFileStatusQuickPickItem)) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails, pick.gitUri, pick.sha, undefined,
                // Create a command to get back to where we are right now
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to details of \u00a0$(git-commit) ${pick.shortSha}`
                }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), sha, commit, goBackCommand, repoLog]));
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickCommitDetailsCommand]', ex);
            return window.showErrorMessage(`Unable to show commit details. See output channel for more details`);
        }
    }
}