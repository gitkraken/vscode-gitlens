'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem } from './quickPickItems';
import { FileCommitsQuickPick } from './quickPicks';

export default class ShowQuickFileHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, maxCount?: number, commit?: GitCommit, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        if (!uri) {
            return commands.executeCommand(Commands.ShowQuickRepoHistory);
        }

        const gitUri = GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            if (!commit) {
                const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath, undefined, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

                let pick = await FileCommitsQuickPick.show(log, uri, maxCount, this.git.config.advanced.maxQuickHistory, goBackCommand);
                if (!pick) return undefined;

                if (pick instanceof CommandQuickPickItem) {
                    return pick.execute();
                }

                commit = pick.commit;
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                new GitUri(commit.uri, commit),
                commit.sha, commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: null
                }, Commands.ShowQuickFileHistory, [uri, maxCount, undefined, goBackCommand]),
                { showFileHistory: false });
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}