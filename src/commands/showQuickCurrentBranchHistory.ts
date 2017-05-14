'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { ShowQuickBranchHistoryCommandArgs } from './showQuickBranchHistory';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export interface ShowQuickCurrentBranchHistoryCommandArgs {
    goBackCommand?: CommandQuickPickItem;
}

export class ShowQuickCurrentBranchHistoryCommand extends ActiveEditorCachedCommand {

    constructor(private git: GitService) {
        super(Commands.ShowQuickCurrentBranchHistory);
    }

    async execute(editor: TextEditor, uri?: Uri, args: ShowQuickCurrentBranchHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            const repoPath = await this.git.getRepoPathFromUri(uri);
            if (!repoPath) return window.showWarningMessage(`Unable to show branch history`);

            const branch = await this.git.getBranch(repoPath);
            if (branch === undefined) return undefined;

            return commands.executeCommand(Commands.ShowQuickBranchHistory,
                uri,
                {
                    branch: branch.name,
                    goBackCommand: args.goBackCommand
                } as ShowQuickBranchHistoryCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'ShowQuickCurrentBranchHistoryCommand');
            return window.showErrorMessage(`Unable to show branch history. See output channel for more details`);
        }
    }
}