'use strict';
import { MessageItem, window } from 'vscode';
import { Command, Commands } from './common';
import { GlyphChars } from '../constants';
import { GitService } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export interface StashDeleteCommandArgs {
    confirm?: boolean;
    stashItem?: { stashName: string, message: string };

    goBackCommand?: CommandQuickPickItem;
}

export class StashDeleteCommand extends Command {

    constructor(private git: GitService) {
        super(Commands.StashDelete);
    }

    async execute(args: StashDeleteCommandArgs = { confirm: true }) {
        if (!this.git.repoPath) return undefined;

        if (args.stashItem === undefined || args.stashItem.stashName === undefined) return undefined;

        if (args.confirm === undefined) {
            args.confirm = true;
        }

        try {
            if (args.confirm) {
                const message = args.stashItem.message.length > 80 ? `${args.stashItem.message.substring(0, 80)}${GlyphChars.Ellipsis}` : args.stashItem.message;
                const result = await window.showWarningMessage(`Delete stashed changes '${message}'?`, { title: 'Yes' } as MessageItem, { title: 'No', isCloseAffordance: true } as MessageItem);
                if (result === undefined || result.title !== 'Yes') return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
            }

            return await this.git.stashDelete(this.git.repoPath, args.stashItem.stashName);
        }
        catch (ex) {
            Logger.error(ex, 'StashDeleteCommand');
            return window.showErrorMessage(`Unable to delete stash. See output channel for more details`);
        }
    }
}