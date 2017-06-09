'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, StashListQuickPick } from '../quickPicks';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

export interface ShowQuickStashListCommandArgs {
    goBackCommand?: CommandQuickPickItem;
}

export class ShowQuickStashListCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickStashList);
    }

    async execute(editor: TextEditor, uri?: Uri, args: ShowQuickStashListCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri);
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to show stashed changes`);

            const stash = await this.git.getStashList(repoPath);
            if (stash === undefined) return window.showWarningMessage(`Unable to show stashed changes`);

            // Create a command to get back to here
            const currentCommand = new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: `\u00a0 \u2014 \u00a0\u00a0 to stashed changes`
            }, Commands.ShowQuickStashList, [
                    uri,
                    {
                        goBackCommand: args.goBackCommand
                    } as ShowQuickStashListCommandArgs
                ]);

            const pick = await StashListQuickPick.show(this.git, stash, 'list', args.goBackCommand, currentCommand);
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            return commands.executeCommand(Commands.ShowQuickCommitDetails,
                new GitUri(pick.commit.uri, pick.commit),
                {
                    commit: pick.commit,
                    sha: pick.commit.sha,
                    goBackCommand: currentCommand
                } as ShowQuickCommitDetailsCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickStashListCommand');
            return window.showErrorMessage(`Unable to show stashed changes. See output channel for more details`);
        }
    }
}