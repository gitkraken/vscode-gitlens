import { Commands } from '../constants';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import type { SearchQuery } from '../git/search';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { SearchResultsNode } from '../views/nodes/searchResultsNode';
import type { CommandContext } from './base';
import { Command, isCommandContextViewNodeHasRepository } from './base';

export interface SearchCommitsCommandArgs {
	search?: Partial<SearchQuery>;
	repoPath?: string;

	prefillOnly?: boolean;

	openPickInView?: boolean;
	showResultsInSideBar?: boolean;
}

@command()
export class SearchCommitsCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.SearchCommits, Commands.SearchCommitsInView]);
	}

	protected override preExecute(context: CommandContext, args?: SearchCommitsCommandArgs) {
		if (context.command === Commands.SearchCommitsInView) {
			args = { ...args };
			args.showResultsInSideBar = true;
		} else if (context.type === 'viewItem') {
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
		}

		return this.execute(args);
	}

	async execute(args?: SearchCommitsCommandArgs) {
		await executeGitCommand({
			command: 'search',
			prefillOnly: args?.prefillOnly,
			state: {
				repo: args?.repoPath,
				...args?.search,
				showResultsInSideBar:
					configuration.get('gitCommands.search.showResultsInSideBar') ?? args?.showResultsInSideBar,
				openPickInView: args?.openPickInView ?? false,
			},
		});
	}
}
