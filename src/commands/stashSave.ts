'use strict';
import { InputBoxOptions, window } from 'vscode';
import { GitService } from '../gitService';
import { Command, Commands } from './common';
import { Logger } from '../logger';
import { CommandQuickPickItem } from '../quickPicks';

export interface StashSaveCommandArgs {
    message?: string;
    unstagedOnly?: boolean;

    goBackCommand?: CommandQuickPickItem;
}

export class StashSaveCommand extends Command {

    constructor(private git: GitService) {
        super(Commands.StashSave);
    }

    async execute(args: StashSaveCommandArgs = { unstagedOnly: false }) {
        if (!this.git.repoPath) return undefined;

        args = { ...args };
        if (args.unstagedOnly === undefined) {
            args.unstagedOnly = false;
        }

        try {
            if (args.message == null) {
                args.message = await window.showInputBox({
                    prompt: `Please provide a stash message`,
                    placeHolder: `Stash message`
                } as InputBoxOptions);
                if (args.message === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
            }

            return await this.git.stashSave(this.git.repoPath, args.message, args.unstagedOnly);
        }
        catch (ex) {
            Logger.error(ex, 'StashSaveCommand');
            return window.showErrorMessage(`Unable to save stash. See output channel for more details`);
        }
    }
}