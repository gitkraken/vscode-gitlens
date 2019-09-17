'use strict';
import { commands, Uri } from 'vscode';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { CommandQuickPickItem } from '../quickpicks';
import {
	command,
	Command,
	CommandContext,
	Commands,
	isCommandViewContextWithFile,
	isCommandViewContextWithRepo,
	isCommandViewContextWithRepoPath
} from './common';
import { GitCommandsCommandArgs } from '../commands';

const enum ResourceGroupType {
	Merge,
	Index,
	WorkingTree
}

export interface StashSaveCommandArgs {
	message?: string;
	repoPath?: string;
	uris?: Uri[];
	keepStaged?: boolean;

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class StashSaveCommand extends Command {
	constructor() {
		super([Commands.StashSave, Commands.StashSaveFiles]);
	}

	protected preExecute(context: CommandContext, args?: StashSaveCommandArgs) {
		if (isCommandViewContextWithFile(context)) {
			args = { ...args };
			args.repoPath = context.node.file.repoPath || context.node.repoPath;
			args.uris = [GitUri.fromFile(context.node.file, args.repoPath)];
		} else if (isCommandViewContextWithRepo(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
		} else if (isCommandViewContextWithRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
		} else if (context.type === 'scm-states') {
			args = { ...args };

			if (!context.scmResourceStates.some(s => (s as any).resourceGroupType === ResourceGroupType.Index)) {
				args.keepStaged = true;
			}

			args.uris = context.scmResourceStates.map(s => s.resourceUri);
		} else if (context.type === 'scm-groups') {
			args = { ...args };

			if (!context.scmResourceGroups.some(g => g.id === 'index')) {
				args.keepStaged = true;
			}

			args.uris = context.scmResourceGroups.reduce<Uri[]>(
				(a, b) => a.concat(b.resourceStates.map(s => s.resourceUri)),
				[]
			);
		}

		return this.execute(args);
	}

	async execute(args?: StashSaveCommandArgs) {
		args = { ...args };

		let repo;
		if (args.uris !== undefined || args.repoPath !== undefined) {
			repo = await Container.git.getRepository((args.uris && args.uris[0]) || args.repoPath!);
		}

		const gitCommandArgs: GitCommandsCommandArgs = {
			command: 'stash',
			state: {
				subcommand: 'push',
				repo: repo,
				message: args.message,
				uris: args.uris,
				flags: args.keepStaged ? ['--keep-index'] : undefined
			}
		};
		return commands.executeCommand(Commands.GitCommands, gitCommandArgs);
	}
}
