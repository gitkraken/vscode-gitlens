'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, StashListQuickPick } from '../quickPicks';

export class ShowQuickStashListCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickStashList);
    }

    async execute(editor: TextEditor, uri?: Uri, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri, this.git.repoPath);
            if (!repoPath) return window.showWarningMessage(`Unable to show stash list`);

            const stash = await this.git.getStashList(repoPath);
            const pick = await StashListQuickPick.show(stash, undefined, goBackCommand);
            if (!pick) return undefined;

            if (pick instanceof CommandQuickPickItem) {
                return pick.execute();
            }

            return commands.executeCommand(Commands.ShowQuickCommitDetails, new GitUri(pick.commit.uri, pick.commit), pick.commit.sha, pick.commit,
                new CommandQuickPickItem({
                    label: `go back \u21A9`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 to the stash list`
                }, Commands.ShowQuickStashList, [uri, goBackCommand]));
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickStashListCommand');
            return window.showErrorMessage(`Unable to show stash list. See output channel for more details`);
        }
    }
}