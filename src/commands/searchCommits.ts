'use strict';
import { commands } from 'vscode';
import { SearchResultsCommitsNode } from '../views/nodes';
import { Container } from '../container';
import { Command, command, CommandContext, Commands, isCommandViewContextWithRepo } from './common';
import { GitCommandsCommandArgs } from '../commands';
import { SearchPattern } from '../git/gitService';

export interface SearchCommitsCommandArgs {
	search?: Partial<SearchPattern>;
	repoPath?: string;

	prefillOnly?: boolean;

	showInView?: boolean;
}

@command()
export class SearchCommitsCommand extends Command {
	constructor() {
		super([Commands.SearchCommits, Commands.SearchCommitsInView]);
	}

	protected preExecute(context: CommandContext, args?: SearchCommitsCommandArgs) {
		if (context.type === 'viewItem') {
			args = { ...args };
			args.showInView = true;

			if (context.node instanceof SearchResultsCommitsNode) {
				args.repoPath = context.node.repoPath;
				args.search = context.node.search;
				args.prefillOnly = true;
			}

			if (isCommandViewContextWithRepo(context)) {
				args.repoPath = context.node.repo.path;
			}
		} else if (context.command === Commands.SearchCommitsInView) {
			args = { ...args };
			args.showInView = true;
		}

		return this.execute(args);
	}

	async execute(args?: SearchCommitsCommandArgs) {
		args = { ...args };

		let repo;
		if (args.repoPath !== undefined) {
			repo = await Container.git.getRepository(args.repoPath);
		}

		const gitCommandArgs: GitCommandsCommandArgs = {
			command: 'search',
			prefillOnly: args.prefillOnly,
			state: {
				repo: repo,
				...args.search,
				showResultsInView: args.showInView
			}
		};
		return commands.executeCommand(Commands.GitCommands, gitCommandArgs);
	}
}
