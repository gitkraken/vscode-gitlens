'use strict';
import { executeGitCommand } from '../commands';
import { Command, command, CommandContext, Commands, isCommandViewContextWithRepo } from './common';
import { SearchPattern } from '../git/git';
import { SearchResultsNode } from '../views/nodes';

export interface SearchCommitsCommandArgs {
	search?: Partial<SearchPattern>;
	repoPath?: string;

	prefillOnly?: boolean;

	showResultsInSideBar?: boolean;
}

@command()
export class SearchCommitsCommand extends Command {
	constructor() {
		super([Commands.SearchCommits, Commands.SearchCommitsInView]);
	}

	protected preExecute(context: CommandContext, args?: SearchCommitsCommandArgs) {
		if (context.type === 'viewItem') {
			args = { ...args };
			args.showResultsInSideBar = true;

			if (context.node instanceof SearchResultsNode) {
				args.repoPath = context.node.repoPath;
				args.search = context.node.search;
				args.prefillOnly = true;
			}

			if (isCommandViewContextWithRepo(context)) {
				args.repoPath = context.node.repo.path;
			}
		} else if (context.command === Commands.SearchCommitsInView) {
			args = { ...args };
			args.showResultsInSideBar = true;
		}

		return this.execute(args);
	}

	async execute(args?: SearchCommitsCommandArgs) {
		void (await executeGitCommand({
			command: 'search',
			prefillOnly: args?.prefillOnly,
			state: {
				repo: args?.repoPath,
				...args?.search,
				showResultsInSideBar: args?.showResultsInSideBar,
			},
		}));
	}
}
