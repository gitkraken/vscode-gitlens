'use strict';
import { MessageItem, window } from 'vscode';
import { GitService, GitStashCommit } from '../gitService';
import { Command, Commands } from './common';
import { CommitQuickPickItem, StashListQuickPick } from '../quickPicks';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export class StashApplyCommand extends Command {

    constructor(private git: GitService) {
        super(Commands.StashApply);
    }

    async execute(stashItem: { stashName: string, message: string }, confirm: boolean = true, deleteAfter: boolean = false, goBackCommand?: CommandQuickPickItem) {
        if (!this.git.config.insiders) return undefined;
        if (!this.git.repoPath) return undefined;

        if (!stashItem || !stashItem.stashName) {
            const stash = await this.git.getStashList(this.git.repoPath);
            if (!stash) return window.showInformationMessage(`There are no stashed changes`);

            const currentCommand = new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: `\u00a0 \u2014 \u00a0\u00a0 to apply stashed changes`
            }, Commands.StashApply, [stashItem, confirm, deleteAfter, goBackCommand]);

            const pick = await StashListQuickPick.show(this.git, stash, 'apply', goBackCommand, currentCommand);
            if (!pick || !(pick instanceof CommitQuickPickItem)) return goBackCommand && goBackCommand.execute();

            goBackCommand = currentCommand;
            stashItem = pick.commit as GitStashCommit;
        }

        try {
            if (confirm) {
                const message = stashItem.message.length > 80 ? `${stashItem.message.substring(0, 80)}\u2026` : stashItem.message;
                const result = await window.showWarningMessage(`Apply stashed changes '${message}' to your working tree?`, { title: 'Yes, delete after applying' } as MessageItem, { title: 'Yes' } as MessageItem, { title: 'No', isCloseAffordance: true } as MessageItem);
                if (!result || result.title === 'No') return goBackCommand && goBackCommand.execute();

                deleteAfter = result.title !== 'Yes';
            }

            return await this.git.stashApply(this.git.repoPath, stashItem.stashName, deleteAfter);
        }
        catch (ex) {
            Logger.error(ex, 'StashApplyCommand');
            if (ex.message.includes('Your local changes to the following files would be overwritten by merge')) {
                return window.showErrorMessage(`Unable to apply stash. Your working tree changes would be overwritten.`);
            }
            else {
                return window.showErrorMessage(`Unable to apply stash. See output channel for more details`);
            }
        }
    }
}