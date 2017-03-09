'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitProvider, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepoHistoryQuickPick } from '../quickPicks';

export class ShowQuickRepoHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, maxCount?: number, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri, this.repoPath);
            if (!repoPath) return window.showWarningMessage(`Unable to show repository history`);

            const log = await this.git.getLogForRepo(repoPath, undefined, maxCount);
            if (!log) return window.showWarningMessage(`Unable to show repository history`);

            const pick = await RepoHistoryQuickPick.show(log, uri, maxCount, this.git.config.advanced.maxQuickHistory, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to repository history`
                }, Commands.ShowQuickRepoHistory, [uri, maxCount, goBackCommand]));
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', ex);
            return window.showErrorMessage(`Unable to show repository history. See output channel for more details`);
        }
    }
}