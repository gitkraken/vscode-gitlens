'use strict';
import { commands } from 'vscode';
import { Container } from '../container';
import { CommandQuickPickItem } from '../quickpicks';
import { Command, command, Commands } from './common';
import { GitCommandsCommandArgs } from '../commands';

export interface ShowQuickStashListCommandArgs {
	repoPath?: string;

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickStashListCommand extends Command {
	constructor() {
		super(Commands.ShowQuickStashList);
	}

	async execute(args?: ShowQuickStashListCommandArgs) {
		args = { ...args };

		let repo;
		if (args.repoPath !== undefined) {
			repo = await Container.git.getRepository(args.repoPath);
		}

		const gitCommandArgs: GitCommandsCommandArgs = {
			command: 'stash',
			state: {
				subcommand: 'list',
				repo: repo
			}
		};
		return commands.executeCommand(Commands.GitCommands, gitCommandArgs);
	}
}
