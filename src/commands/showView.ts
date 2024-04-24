import { Commands } from '../constants';
import type { Container } from '../container';
import type { GraphWebviewShowingArgs } from '../plus/webviews/graph/registration';
import { command } from '../system/command';
import type { CommandContext } from './base';
import { Command } from './base';

@command()
export class ShowViewCommand extends Command {
	constructor(private readonly container: Container) {
		super([
			Commands.ShowBranchesView,
			Commands.ShowCommitDetailsView,
			Commands.ShowCommitsView,
			Commands.ShowContributorsView,
			Commands.ShowDraftsView,
			Commands.ShowFileHistoryView,
			Commands.ShowGraphView,
			Commands.ShowHomeView,
			Commands.ShowAccountView,
			Commands.ShowLineHistoryView,
			Commands.ShowRemotesView,
			Commands.ShowRepositoriesView,
			Commands.ShowSearchAndCompareView,
			Commands.ShowStashesView,
			Commands.ShowTagsView,
			Commands.ShowTimelineView,
			Commands.ShowWorktreesView,
			Commands.ShowWorkspacesView,
		]);
	}

	protected override preExecute(context: CommandContext, ...args: unknown[]) {
		return this.execute(context, ...args);
	}

	async execute(context: CommandContext, ...args: unknown[]) {
		const command = context.command as Commands;
		switch (command) {
			case Commands.ShowBranchesView:
				return this.container.branchesView.show();
			case Commands.ShowCommitDetailsView:
				return this.container.commitDetailsView.show();
			case Commands.ShowCommitsView:
				return this.container.commitsView.show();
			case Commands.ShowContributorsView:
				return this.container.contributorsView.show();
			case Commands.ShowDraftsView:
				return this.container.draftsView.show();
			case Commands.ShowFileHistoryView:
				return this.container.fileHistoryView.show();
			case Commands.ShowHomeView:
				return this.container.homeView.show();
			case Commands.ShowAccountView:
				return this.container.accountView.show();
			case Commands.ShowGraphView:
				return this.container.graphView.show(undefined, ...(args as GraphWebviewShowingArgs));
			case Commands.ShowLineHistoryView:
				return this.container.lineHistoryView.show();
			case Commands.ShowRemotesView:
				return this.container.remotesView.show();
			case Commands.ShowRepositoriesView:
				return this.container.repositoriesView.show();
			case Commands.ShowSearchAndCompareView:
				return this.container.searchAndCompareView.show();
			case Commands.ShowStashesView:
				return this.container.stashesView.show();
			case Commands.ShowTagsView:
				return this.container.tagsView.show();
			case Commands.ShowTimelineView:
				return this.container.timelineView.show();
			case Commands.ShowWorktreesView:
				return this.container.worktreesView.show();
			case Commands.ShowWorkspacesView:
				return this.container.workspacesView.show();
		}

		return Promise.resolve(undefined);
	}
}
