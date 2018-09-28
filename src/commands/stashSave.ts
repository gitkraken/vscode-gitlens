'use strict';
import { InputBoxOptions, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem } from '../quickpicks';
import { StatusFileNode } from '../views/nodes';
import { Command, CommandContext, Commands, getRepoPathOrPrompt } from './common';

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
        if (context.type === 'view') {
            args = { ...args };
            if (context.node instanceof StatusFileNode) {
                args.uris = [GitUri.fromFile(context.node.file, context.node.repoPath)];
            }
        }
        else if (context.type === 'scm-states') {
            args = { ...args };
            args.uris = context.scmResourceStates.map(s => s.resourceUri);
        }
        else if (context.type === 'scm-groups') {
            args = { ...args };
            args.uris = context.scmResourceGroups.reduce<Uri[]>(
                (a, b) => a.concat(b.resourceStates.map(s => s.resourceUri)),
                []
            );
        }

        return this.execute(args);
    }

    async execute(args: StashSaveCommandArgs = {}) {
        const uri = args.uris !== undefined && args.uris.length !== 0 ? args.uris[0] : undefined;
        const repoPath = await getRepoPathOrPrompt(
            uri,
            `Stash changes for which repository${GlyphChars.Ellipsis}`,
            args.goBackCommand
        );
        if (!repoPath) return undefined;

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
            return Messages.showGenericErrorMessage('Unable to save stash');
        }
    }
}
