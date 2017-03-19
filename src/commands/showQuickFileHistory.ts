'use strict';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from '../commands';
import { GitService, GitUri, IGitLog } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, FileHistoryQuickPick } from '../quickPicks';
import * as path from 'path';

export class ShowQuickFileHistoryCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, range?: Range, maxCount?: number, goBackCommand?: CommandQuickPickItem, log?: IGitLog, nextPageCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        if (!uri) return commands.executeCommand(Commands.ShowQuickRepoHistory);

        const gitUri = await GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        const progressCancellation = FileHistoryQuickPick.showProgress(gitUri);
        try {
            if (!log) {
                log = await this.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, gitUri.sha, range, maxCount);
                if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);
            }

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await FileHistoryQuickPick.show(this.git, log, gitUri, progressCancellation, goBackCommand, nextPageCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitFileDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to history of \u00a0$(file-text) ${path.basename(pick.commit.fileName)}${gitUri.sha ? ` from \u00a0$(git-commit) ${gitUri.shortSha}` : ''}`
                }, Commands.ShowQuickFileHistory, [uri, range, maxCount, goBackCommand, log]),
                log);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'data.repoPath, ', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
        finally {
            progressCancellation.dispose();
        }
    }
}