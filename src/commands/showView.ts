import { Commands } from '../constants.commands';
import type { Container } from '../container';
import type { GraphWebviewShowingArgs } from '../plus/webviews/graph/registration';
import { command } from '../system/vscode/command';
import type { HomeWebviewShowingArgs } from '../webviews/home/registration';
import type { CommandContext } from './base';
import { Command } from './base';

@command()
export class ShowViewCommand extends Command {
	constructor(private readonly container: Container) {
		super([
			Commands.ShowAccountView,
			Commands.ShowBranchesView,
			Commands.ShowCommitDetailsView,
			Commands.ShowCommitsView,
			Commands.ShowContributorsView,
			Commands.ShowDraftsView,
			Commands.ShowFileHistoryView,
			Commands.ShowGraphView,
			Commands.ShowHomeView,
			Commands.ShowLaunchpadView,
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
			case Commands.ShowAccountView:
				return this.container.views.home.show(
					undefined,
					...([{ focusAccount: true }, ...args] as HomeWebviewShowingArgs),
				);
			case Commands.ShowBranchesView:
				return this.container.views.branches.show();
			case Commands.ShowCommitDetailsView:
				return this.container.views.commitDetails.show();
			case Commands.ShowCommitsView:
				return this.container.views.commits.show();
			case Commands.ShowContributorsView:
				return this.container.views.contributors.show();
			case Commands.ShowDraftsView:
				return this.container.views.drafts.show();
			case Commands.ShowFileHistoryView:
				return this.container.views.fileHistory.show();
			case Commands.ShowGraphView:
				return this.container.views.graph.show(undefined, ...(args as GraphWebviewShowingArgs));
			case Commands.ShowHomeView:
				return this.container.views.home.show(undefined, ...(args as HomeWebviewShowingArgs));
			case Commands.ShowLaunchpadView:
				return this.container.views.launchpad.show();
			case Commands.ShowLineHistoryView:
				return this.container.views.lineHistory.show();
			case Commands.ShowRemotesView:
				return this.container.views.remotes.show();
			case Commands.ShowRepositoriesView:
				return this.container.views.repositories.show();
			case Commands.ShowSearchAndCompareView:
				return this.container.views.searchAndCompare.show();
			case Commands.ShowStashesView:
				return this.container.views.stashes.show();
			case Commands.ShowTagsView:
				return this.container.views.tags.show();
			case Commands.ShowTimelineView:
				return this.container.views.timeline.show();
			case Commands.ShowWorktreesView:
				return this.container.views.worktrees.show();
			case Commands.ShowWorkspacesView:
				return this.container.views.workspaces.show();
		}

		return Promise.resolve(undefined);
	}
}
