'use strict';
import { InputBoxOptions, window } from 'vscode';
import { GitService } from '../gitService';
import { Command, Commands } from './common';
import { Logger } from '../logger';

export class StashSaveCommand extends Command {

    constructor(private git: GitService) {
        super(Commands.StashSave);
    }

    async execute(message?: string, unstagedOnly: boolean = false) {
        if (!this.git.config.insiders) return undefined;

        try {
            if (message == null) {
                message = await window.showInputBox({
                    prompt: `Please provide a stash message`,
                    placeHolder: `Stash message`
                } as InputBoxOptions);
                if (message === undefined) return undefined;
            }

            return await this.git.stashSave(this.git.repoPath, message, unstagedOnly);
        }
        catch (ex) {
            Logger.error(ex, 'StashSaveCommand');
            return window.showErrorMessage(`Unable to save stash. See output channel for more details`);
        }
    }
}