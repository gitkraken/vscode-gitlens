'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitCommit, GitProvider, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepoHistoryQuickPick } from '../quickPicks';

export class ShowQuickRepoHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, maxCount?: number, commit?: GitCommit, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            let repoPath: string;
            if (uri instanceof Uri) {
                const gitUri = await GitUri.fromUri(uri, this.git);
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
                const log = await this.git.getLogForRepo(repoPath, undefined, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show repository history`);

                const pick = await RepoHistoryQuickPick.show(log, uri, maxCount, this.git.config.advanced.maxQuickHistory, goBackCommand);
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