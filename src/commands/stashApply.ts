'use strict';
import { MessageItem, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitStashCommit } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, RepositoriesQuickPick, StashListQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { Command, CommandContext, Commands, isCommandViewContextWithCommit } from './common';

export interface StashApplyCommandArgs {
    confirm?: boolean;
    deleteAfter?: boolean;
    stashItem?: { stashName: string; message: string; repoPath: string };

    goBackCommand?: CommandQuickPickItem;
}

export class StashApplyCommand extends Command {
    constructor() {
        super(Commands.StashApply);
    }

    protected async preExecute(
        context: CommandContext,
        args: StashApplyCommandArgs = { confirm: true, deleteAfter: false }
    ) {
        if (isCommandViewContextWithCommit<GitStashCommit>(context)) {
            args = { ...args };
            args.stashItem = context.node.commit;
            return this.execute(args);
        }

        return this.execute(args);
    }

    async execute(args: StashApplyCommandArgs = { confirm: true, deleteAfter: false }) {
        args = { ...args };

        if (args.stashItem === undefined || args.stashItem.stashName === undefined) {
            let goBackToRepositoriesCommand: CommandQuickPickItem | undefined;

            let repoPath = await Container.git.getActiveRepoPath();
            if (!repoPath) {
                const pick = await RepositoriesQuickPick.show(
                    `Apply stashed changes from which repository${GlyphChars.Ellipsis}`,
                    args.goBackCommand
                );
                if (pick instanceof CommandQuickPickItem) return pick.execute();
                if (pick === undefined) {
                    return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
                }

                goBackToRepositoriesCommand = new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to pick another repository`
                    },
                    Commands.StashApply,
                    [args]
                );

                repoPath = pick.repoPath;
            }

            const progressCancellation = StashListQuickPick.showProgress('apply');

            try {
                const stash = await Container.git.getStashList(repoPath);
                if (stash === undefined) return window.showInformationMessage(`There are no stashed changes`);

                if (progressCancellation.token.isCancellationRequested) return undefined;

                const currentCommand = new CommandQuickPickItem(
                    {
                        label: `go back ${GlyphChars.ArrowBack}`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to apply stashed changes`
                    },
                    Commands.StashApply,
                    [args]
                );

                const pick = await StashListQuickPick.show(
                    stash,
                    'apply',
                    progressCancellation,
                    goBackToRepositoriesCommand || args.goBackCommand,
                    currentCommand
                );
                if (pick instanceof CommandQuickPickItem) return pick.execute();
                if (pick === undefined) {
                    return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
                }

                args.goBackCommand = currentCommand;
                args.stashItem = pick.commit as GitStashCommit;
            }
            finally {
                progressCancellation.cancel();
            }
        }

        try {
            if (args.confirm) {
                const message =
                    args.stashItem.message.length > 80
                        ? `${args.stashItem.message.substring(0, 80)}${GlyphChars.Ellipsis}`
                        : args.stashItem.message;
                const result = await window.showWarningMessage(
                    `Apply stashed changes '${message}' to your working tree?`,
                    { title: 'Yes, delete after applying' } as MessageItem,
                    { title: 'Yes' } as MessageItem,
                    { title: 'No', isCloseAffordance: true } as MessageItem
                );
                if (result === undefined || result.title === 'No') {
                    return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
                }

                args.deleteAfter = result.title !== 'Yes';
            }

            return await Container.git.stashApply(args.stashItem.repoPath, args.stashItem.stashName, args.deleteAfter);
        }
        catch (ex) {
            Logger.error(ex, 'StashApplyCommand');
            if (ex.message.includes('Your local changes to the following files would be overwritten by merge')) {
                return window.showWarningMessage(
                    `Unable to apply stash. Your working tree changes would be overwritten.`
                );
            }
            else if (ex.message.includes('Auto-merging') && ex.message.includes('CONFLICT')) {
                return window.showInformationMessage(`Stash applied with conflicts`);
            }
            else {
                return Messages.showGenericErrorMessage('Unable to apply stash');
            }
        }
    }
}
