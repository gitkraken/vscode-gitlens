'use strict';
import { commands } from 'vscode';
import { Container } from '../container';
import { GitStashCommit } from '../git/gitService';
import { CommandQuickPickItem } from '../quickpicks';
import { command, Command, CommandContext, Commands, isCommandViewContextWithCommit } from './common';
import { GitCommandsCommandArgs } from '../commands';

export interface StashDeleteCommandArgs {
    repoPath?: string;
    stashItem?: { stashName: string; message: string; repoPath: string };

    goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashDeleteCommand extends Command {
    constructor() {
        super(Commands.StashDelete);
    }

    protected preExecute(context: CommandContext, args: StashDeleteCommandArgs = {}) {
        if (isCommandViewContextWithCommit<GitStashCommit>(context)) {
            args = { ...args };
            args.stashItem = context.node.commit;
        }

        return this.execute(args);
    }

    async execute(args: StashDeleteCommandArgs = {}) {
        let repo;
        if (args.stashItem !== undefined || args.repoPath !== undefined) {
            repo = await Container.git.getRepository((args.stashItem && args.stashItem.repoPath) || args.repoPath!);
        }

        const gitCommandArgs: GitCommandsCommandArgs = {
            command: 'stash',
            state: {
                subcommand: 'drop',
                repo: repo,
                stash: args.stashItem
            }
        };
        return commands.executeCommand(Commands.GitCommands, gitCommandArgs);
    }
}
