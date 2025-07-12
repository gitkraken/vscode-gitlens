import type { SearchQuery } from '../constants.search';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { SearchResultsNode } from '../views/nodes/searchResultsNode';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasRepository } from './commandContext.utils';

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
		super(['gitlens.showCommitSearch', 'gitlens.views.searchAndCompare.searchCommits']);
	}

	protected override preExecute(context: CommandContext, args?: SearchCommitsCommandArgs): Promise<void> {
		if (context.command === 'gitlens.views.searchAndCompare.searchCommits') {
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

	async execute(args?: SearchCommitsCommandArgs): Promise<void> {
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
