'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem } from './quickPickItems';
import { FileCommitsQuickPick } from './quickPicks';

export default class ShowQuickFileHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, maxCount?: number, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            if (!editor || !editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath, undefined, maxCount);
            if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

            let pick = await FileCommitsQuickPick.show(log, uri, maxCount, this.git.config.advanced.maxQuickHistory, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                new GitUri(pick.commit.uri, pick.commit),
                pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: null
                }, Commands.ShowQuickFileHistory, [uri, maxCount, goBackCommand]),
                { showFileHistory: false });
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}