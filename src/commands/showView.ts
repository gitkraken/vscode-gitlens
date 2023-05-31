import { Commands } from '../constants';
import type { Container } from '../container';
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
			Commands.ShowFileHistoryView,
			Commands.ShowGraphView,
			Commands.ShowHomeView,
			Commands.ShowLineHistoryView,
			Commands.ShowRemotesView,
			Commands.ShowRepositoriesView,
			Commands.ShowSearchAndCompareView,
			Commands.ShowStashesView,
			Commands.ShowTagsView,
			Commands.ShowTimelineView,
			Commands.ShowWorktreesView,
		]);
	}

	protected override preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.ShowBranchesView:
				return this.container.branchesView.show();
			case Commands.ShowCommitDetailsView:
				return this.container.commitDetailsView.show();
			case Commands.ShowCommitsView:
				return this.container.commitsView.show();
			case Commands.ShowContributorsView:
				return this.container.contributorsView.show();
			case Commands.ShowFileHistoryView:
				return this.container.fileHistoryView.show();
			case Commands.ShowHomeView:
				return this.container.homeView.show();
			case Commands.ShowAccountView:
				return this.container.accountView.show();
			case Commands.ShowGraphView:
				return this.container.graphView.show();
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
		}

		return Promise.resolve(undefined);
	}
}
