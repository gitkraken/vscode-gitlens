'use strict';
import { MessageItem, window } from 'vscode';
import { GitService } from '../gitService';
import { Command, Commands } from './common';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export class StashDeleteCommand extends Command {

    constructor(private git: GitService) {
        super(Commands.StashDelete);
    }

    async execute(stashItem: { stashName: string, message: string }, confirm: boolean = true, goBackCommand?: CommandQuickPickItem) {
        if (!this.git.config.insiders) return undefined;
        if (!this.git.repoPath) return undefined;
        if (!stashItem || !stashItem.stashName) return undefined;

        try {
            if (confirm) {
                const message = stashItem.message.length > 80 ? `${stashItem.message.substring(0, 80)}\u2026` : stashItem.message;
                const result = await window.showWarningMessage(`Delete stashed changes '${message}'?`, { title: 'Yes' } as MessageItem, { title: 'No', isCloseAffordance: true } as MessageItem);
                if (!result || result.title !== 'Yes') return goBackCommand && goBackCommand.execute();
            }

            return await this.git.stashDelete(this.git.repoPath, stashItem.stashName);
        }
        catch (ex) {
            Logger.error(ex, 'StashDeleteCommand');
            return window.showErrorMessage(`Unable to delete stash. See output channel for more details`);
        }
    }
}