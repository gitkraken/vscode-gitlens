'use strict';
import { InputBoxOptions, window } from 'vscode';
import { GitService } from '../gitService';
import { Command, Commands } from './common';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export class StashSaveCommand extends Command {

    constructor(private git: GitService) {
        super(Commands.StashSave);
    }

    async execute(message?: string, unstagedOnly: boolean = false, goBackCommand?: CommandQuickPickItem) {
        if (!this.git.config.insiders) return undefined;
        if (!this.git.repoPath) return undefined;

        try {
            if (message == null) {
                message = await window.showInputBox({
                    prompt: `Please provide a stash message`,
                    placeHolder: `Stash message`
                } as InputBoxOptions);
                if (message === undefined) return goBackCommand && goBackCommand.execute();
            }

            return await this.git.stashSave(this.git.repoPath, message, unstagedOnly);
        }
        catch (ex) {
            Logger.error(ex, 'StashSaveCommand');
            return window.showErrorMessage(`Unable to save stash. See output channel for more details`);
        }
    }
}