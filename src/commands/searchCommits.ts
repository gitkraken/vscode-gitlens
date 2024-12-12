import { GlCommand } from '../constants.commands';
import type { SearchQuery } from '../constants.search';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { SearchResultsNode } from '../views/nodes/searchResultsNode';
import type { CommandContext } from './base';
import { GlCommandBase, isCommandContextViewNodeHasRepository } from './base';

export interface SearchCommitsCommandArgs {
	search?: Partial<SearchQuery>;
	repoPath?: string;

	prefillOnly?: boolean;

	openPickInView?: boolean;
	showResultsInSideBar?: boolean;
}

@command()
export class SearchCommitsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([GlCommand.SearchCommits, GlCommand.SearchCommitsInView]);
	}

	protected override preExecute(context: CommandContext, args?: SearchCommitsCommandArgs) {
		if (context.command === GlCommand.SearchCommitsInView) {
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
