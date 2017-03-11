'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitProvider, GitUri, IGitLog } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepoHistoryQuickPick, showQuickPickProgress } from '../quickPicks';

export class ShowQuickRepoHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, private repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, sha?: string, maxCount?: number | undefined, goBackCommand?: CommandQuickPickItem, log?: IGitLog) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        const progressCancellation = showQuickPickProgress(`Loading repository history \u2014 ${maxCount ? ` limited to ${maxCount} commits` : ` this may take a while`}\u2026`);
        try {
            if (!log) {
                const repoPath = await this.git.getRepoPathFromUri(uri, this.repoPath);
                if (!repoPath) return window.showWarningMessage(`Unable to show repository history`);

                if (progressCancellation.token.isCancellationRequested) return undefined;

                log = await this.git.getLogForRepo(repoPath, sha, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show repository history`);
            }

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await RepoHistoryQuickPick.show(log, uri, sha, progressCancellation, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to repository history`
                }, Commands.ShowQuickRepoHistory, [uri, sha, maxCount, goBackCommand, log]),
                log);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', ex);
            return window.showErrorMessage(`Unable to show repository history. See output channel for more details`);
        }
        finally {
            progressCancellation.dispose();
        }
    }
}