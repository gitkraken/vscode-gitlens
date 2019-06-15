'use strict';
import { Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem } from '../quickpicks';
import {
    command,
    Command,
    CommandContext,
    Commands,
    getRepoPathOrPrompt,
    isCommandViewContextWithFile,
    isCommandViewContextWithRepo,
    isCommandViewContextWithRepoPath
} from './common';

export interface StashSaveCommandArgs {
    message?: string;
    repoPath?: string;
    uris?: Uri[];

    goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashSaveCommand extends Command {
    constructor() {
        super([Commands.StashSave, Commands.StashSaveFiles]);
    }

    protected preExecute(context: CommandContext, args: StashSaveCommandArgs = {}) {
        if (isCommandViewContextWithFile(context)) {
            args = { ...args };
            args.uris = [GitUri.fromFile(context.node.file, context.node.file.repoPath || context.node.repoPath)];
        }
        else if (isCommandViewContextWithRepo(context)) {
            args = { ...args };
            args.repoPath = context.node.repo.path;
        }
        else if (isCommandViewContextWithRepoPath(context)) {
            args = { ...args };
            args.repoPath = context.node.repoPath;
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
        args = { ...args };

        const uri = args.uris !== undefined && args.uris.length !== 0 ? args.uris[0] : undefined;
        if (args.repoPath === undefined) {
            args.repoPath = await getRepoPathOrPrompt(
                `Stash changes for which repository${GlyphChars.Ellipsis}`,
                args.goBackCommand,
                uri
            );
        }
        if (!args.repoPath) return undefined;

        try {
            if (args.message == null) {
                args.message = await window.showInputBox({
                    prompt: 'Please provide a stash message',
                    placeHolder: 'Stash message'
                });
                if (args.message === undefined) {
                    return args.goBackCommand === undefined ? undefined : args.goBackCommand.execute();
                }
            }

            return await Container.git.stashSave(args.repoPath, args.message, args.uris);
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
