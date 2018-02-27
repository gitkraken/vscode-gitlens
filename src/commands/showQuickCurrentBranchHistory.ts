'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCachedCommand, Commands, getCommandUri } from './common';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem } from '../quickPicks/quickPicks';
import { ShowQuickBranchHistoryCommandArgs } from './showQuickBranchHistory';

export interface ShowQuickCurrentBranchHistoryCommandArgs {
    goBackCommand?: CommandQuickPickItem;
}

export class ShowQuickCurrentBranchHistoryCommand extends ActiveEditorCachedCommand {

    constructor() {
        super(Commands.ShowQuickCurrentBranchHistory);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: ShowQuickCurrentBranchHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        try {
            const repoPath = await Container.git.getRepoPath(uri);
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to show branch history`);

            const branch = await Container.git.getBranch(repoPath);
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