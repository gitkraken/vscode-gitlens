import { executeGitCommand } from '../commands/gitCommands.actions';
import { Commands } from '../constants';
import type { Container } from '../container';
import { SearchPattern } from '../git/search';
import { command } from '../system/command';
import { SearchResultsNode } from '../views/nodes';
import { Command, CommandContext, isCommandContextViewNodeHasRepository } from './base';

export interface SearchCommitsCommandArgs {
	search?: Partial<SearchPattern>;
	repoPath?: string;

	prefillOnly?: boolean;

	showResultsInSideBar?: boolean;
}

@command()
export class SearchCommitsCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.SearchCommits, Commands.SearchCommitsInView]);
	}

	protected override preExecute(context: CommandContext, args?: SearchCommitsCommandArgs) {
		if (context.type === 'viewItem') {
			args = { ...args };
			args.showResultsInSideBar = true;

			if (context.node instanceof SearchResultsNode) {
				args.repoPath = context.node.repoPath;
				args.search = context.node.search;
				args.prefillOnly = true;
			}

			if (isCommandContextViewNodeHasRepository(context)) {
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
				showResultsInSideBar:
					this.container.config.gitCommands.search.showResultsInSideBar ?? args?.showResultsInSideBar,
			},
		}));
	}
}
