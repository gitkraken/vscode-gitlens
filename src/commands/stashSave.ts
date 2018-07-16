'use strict';
import { InputBoxOptions, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { CommandQuickPickItem, RepositoriesQuickPick } from '../quickpicks';
import { Command, CommandContext, Commands } from './common';

export interface StashSaveCommandArgs {
    message?: string;
    uris?: Uri[];

    goBackCommand?: CommandQuickPickItem;
}

export class StashSaveCommand extends Command {
    constructor() {
        super(Commands.StashSave);
    }

    protected async preExecute(context: CommandContext, args: StashSaveCommandArgs = {}): Promise<any> {
        if (context.type === 'scm-states') {
            args = { ...args };
            args.uris = context.scmResourceStates.map(s => s.resourceUri);
            return this.execute(args);
        }

        if (context.type === 'scm-groups') {
            args = { ...args };
            args.uris = context.scmResourceGroups.reduce<Uri[]>(
                (a, b) => a.concat(b.resourceStates.map(s => s.resourceUri)),
                []
            );
            return this.execute(args);
        }

        return this.execute(args);
    }

    async execute(args: StashSaveCommandArgs = {}) {
        let repoPath = await Container.git.getHighlanderRepoPath();
        if (!repoPath) {
            const pick = await RepositoriesQuickPick.show(
                `Stash changes for which repository${GlyphChars.Ellipsis}`,
                args.goBackCommand
            );
            if (pick instanceof CommandQuickPickItem) return pick.execute();
            if (pick === undefined) return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();

            repoPath = pick.repoPath;
        }

        try {
            if (args.message == null) {
                args = { ...args };
                args.message = await window.showInputBox({
                    prompt: `Please provide a stash message`,
                    placeHolder: `Stash message`
                } as InputBoxOptions);
                if (args.message === undefined) {
                    return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
                }
            }

            return await Container.git.stashSave(repoPath, args.message, args.uris);
        }
        catch (ex) {
            Logger.error(ex, 'StashSaveCommand');

            const msg = ex && ex.message;
            if (msg.includes('newer version of Git')) {
                return window.showErrorMessage(`Unable to save stash. ${msg}`);
            }
            return window.showErrorMessage(`Unable to save stash. See output channel for more details`);
        }
    }
}
