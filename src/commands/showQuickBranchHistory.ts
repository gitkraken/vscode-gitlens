'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './common';
import { GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { BranchesQuickPick, BranchHistoryQuickPick, CommandQuickPickItem } from '../quickPicks';

export class ShowQuickBranchHistoryCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickBranchHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, branch?: string, maxCount?: number, goBackCommand?: CommandQuickPickItem, log?: IGitLog, nextPageCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        const gitUri = uri && await GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        let progressCancellation = branch === undefined ? undefined : BranchHistoryQuickPick.showProgress(branch);
        try {
            const repoPath = (gitUri && gitUri.repoPath) || this.git.repoPath;
            if (repoPath === undefined) return window.showWarningMessage(`Unable to show branch history`);

            if (branch === undefined) {
                const branches = await this.git.getBranches(repoPath);

                const pick = await BranchesQuickPick.show(branches, `Show history for branch\u2026`);
                if (!pick) return undefined;

                if (pick instanceof CommandQuickPickItem) {
                    return pick.execute();
                }

                branch = pick.branch.name;
                if (branch === undefined) return undefined;

                progressCancellation = BranchHistoryQuickPick.showProgress(branch);
            }

            if (!log) {
                log = await this.git.getLogForRepo(repoPath, (gitUri && gitUri.sha) || branch, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show branch history`);
            }

            if (progressCancellation !== undefined && progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await BranchHistoryQuickPick.show(this.git, log, gitUri, branch, progressCancellation!, goBackCommand, nextPageCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to \u00a0$(git-branch) ${branch} history`
                }, Commands.ShowQuickBranchHistory, [uri, branch, maxCount, goBackCommand, log]),
                log);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickBranchHistoryCommand');
            return window.showErrorMessage(`Unable to show branch history. See output channel for more details`);
        }
        finally {
            progressCancellation && progressCancellation.dispose();
        }
    }
}