'use strict';
import { commands, Uri, window } from 'vscode';
import { Command } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem } from './quickPickItems';
import { RepoCommitsQuickPick } from './quickPicks';

export default class ShowQuickRepoHistoryCommand extends Command {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(uri?: Uri, maxCount?: number, commit?: GitCommit, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            const document = window.activeTextEditor && window.activeTextEditor.document;
            if (document) {
                uri = document.uri;
            }
        }

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            let repoPath: string;
            if (uri instanceof Uri) {
                const gitUri = GitUri.fromUri(uri, this.git);
                repoPath = gitUri.repoPath;

                if (!repoPath) {
                    repoPath = await this.git.getRepoPathFromFile(gitUri.fsPath);
                }
            }

            if (!repoPath) {
                repoPath = this.repoPath;
            }
            if (!repoPath) return window.showWarningMessage(`Unable to show repository history`);

            if (!commit) {
                const log = await this.git.getLogForRepo(this.repoPath, undefined, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show repository history`);

                const pick = await RepoCommitsQuickPick.show(log, uri, maxCount, this.git.config.advanced.maxQuickHistory, goBackCommand);
                if (!pick) return undefined;

                if (pick instanceof CommandQuickPickItem) {
                    return pick.execute();
                }

                commit = pick.commit;
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                new GitUri(commit.uri, commit),
                commit.sha, undefined,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: null
                }, Commands.ShowQuickRepoHistory, [uri, maxCount, undefined, goBackCommand]));
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', ex);
            return window.showErrorMessage(`Unable to show repository history. See output channel for more details`);
        }
    }
}