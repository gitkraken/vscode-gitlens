'use strict';
import { commands } from 'vscode';
import { Container } from '../container';
import { GitStashCommit } from '../git/gitService';
import { CommandQuickPickItem } from '../quickpicks';
import {
    command,
    Command,
    CommandContext,
    Commands,
    isCommandViewContextWithCommit,
    isCommandViewContextWithRepo
} from './common';
import { GitCommandsCommandArgs } from '../commands';

export interface StashApplyCommandArgs {
    deleteAfter?: boolean;
    repoPath?: string;
    stashItem?: { stashName: string; message: string; repoPath: string };

    goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashApplyCommand extends Command {
    constructor() {
        super(Commands.StashApply);
    }

    protected preExecute(context: CommandContext, args: StashApplyCommandArgs = { deleteAfter: false }) {
        if (isCommandViewContextWithCommit<GitStashCommit>(context)) {
            args = { ...args };
            args.stashItem = context.node.commit;
        }
        else if (isCommandViewContextWithRepo(context)) {
            args = { ...args };
            args.repoPath = context.node.repo.path;
        }

        return this.execute(args);
    }

    async execute(args: StashApplyCommandArgs = { deleteAfter: false }) {
        let repo;
        if (args.stashItem !== undefined || args.repoPath !== undefined) {
            repo = await Container.git.getRepository((args.stashItem && args.stashItem.repoPath) || args.repoPath!);
        }

        const gitCommandArgs: GitCommandsCommandArgs = {
            command: 'stash',
            state: {
                subcommand: args.deleteAfter ? 'pop' : 'apply',
                repo: repo,
                stash: args.stashItem
            }
        };
        return commands.executeCommand(Commands.GitCommands, gitCommandArgs);
    }
}
