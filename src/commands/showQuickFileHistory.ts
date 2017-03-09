'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitProvider, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, FileHistoryQuickPick } from '../quickPicks';
import * as path from 'path';

export class ShowQuickFileHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, maxCount?: number, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        if (!uri) {
            return commands.executeCommand(Commands.ShowQuickRepoHistory);
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath, undefined, maxCount);
            if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

            let pick = await FileHistoryQuickPick.show(log, uri, gitUri.sha, maxCount, this.git.config.advanced.maxQuickHistory, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to history of \u00a0$(file-text) ${path.basename(pick.commit.fileName)}`
                }, Commands.ShowQuickFileHistory, [uri, maxCount, goBackCommand]),
                { showFileHistory: false });
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}