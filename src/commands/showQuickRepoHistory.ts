'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from '../commands';
import { GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepoHistoryQuickPick } from '../quickPicks';

export class ShowQuickRepoHistoryCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService, private repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, branch?: string, maxCount?: number, goBackCommand?: CommandQuickPickItem, log?: IGitLog, nextPageCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        const gitUri = uri && await GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        branch = branch || (await this.git.getBranch(this.git.repoPath)).name;

        const progressCancellation = RepoHistoryQuickPick.showProgress(branch);
        try {
            const repoPath = (gitUri && gitUri.repoPath) || await this.git.getRepoPathFromUri(uri, this.repoPath);
            if (!repoPath) return window.showWarningMessage(`Unable to show history`);

            if (progressCancellation.token.isCancellationRequested) return undefined;

            if (!log) {
                log = await this.git.getLogForRepo(repoPath, (gitUri && gitUri.sha) || branch, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show history`);
            }

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await RepoHistoryQuickPick.show(log, gitUri, branch, progressCancellation, goBackCommand, nextPageCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to \u00a0$(git-branch) ${branch} history`
                }, Commands.ShowQuickRepoHistory, [uri, branch, maxCount, goBackCommand, log]),
                log);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', ex);
            return window.showErrorMessage(`Unable to show history. See output channel for more details`);
        }
        finally {
            progressCancellation.dispose();
        }
    }
}