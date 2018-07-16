'use strict';
import { MessageItem, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitStashCommit } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickpicks';
import { Command, CommandContext, Commands, isCommandViewContextWithCommit } from './common';

export interface StashDeleteCommandArgs {
    confirm?: boolean;
    stashItem?: { stashName: string; message: string; repoPath: string };

    goBackCommand?: CommandQuickPickItem;
}

export class StashDeleteCommand extends Command {
    constructor() {
        super(Commands.StashDelete);
    }

    protected async preExecute(context: CommandContext, args: StashDeleteCommandArgs = { confirm: true }) {
        if (isCommandViewContextWithCommit<GitStashCommit>(context)) {
            args = { ...args };
            args.stashItem = context.node.commit;
            return this.execute(args);
        }

        return this.execute(args);
    }

    async execute(args: StashDeleteCommandArgs = { confirm: true }) {
        args = { ...args };
        if (
            args.stashItem === undefined ||
            args.stashItem.stashName === undefined ||
            args.stashItem.repoPath === undefined
        ) {
            return undefined;
        }

        if (args.confirm === undefined) {
            args.confirm = true;
        }

        try {
            if (args.confirm) {
                const message =
                    args.stashItem.message.length > 80
                        ? `${args.stashItem.message.substring(0, 80)}${GlyphChars.Ellipsis}`
                        : args.stashItem.message;
                const result = await window.showWarningMessage(
                    `Delete stashed changes '${message}'?`,
                    { title: 'Yes' } as MessageItem,
                    { title: 'No', isCloseAffordance: true } as MessageItem
                );
                if (result === undefined || result.title !== 'Yes') {
                    return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
                }
            }

            return await Container.git.stashDelete(args.stashItem.repoPath, args.stashItem.stashName);
        }
        catch (ex) {
            Logger.error(ex, 'StashDeleteCommand');
            return window.showErrorMessage(`Unable to delete stash. See output channel for more details`);
        }
    }
}
