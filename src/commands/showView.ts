import { window } from 'vscode';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import type { GraphWebviewShowingArgs } from '../plus/webviews/graph/registration';
import { command, executeCoreCommand } from '../system/vscode/command';
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

	async notifyWhenNoRepository(featureName?: string) {
		if (this.container.git.openRepositoryCount > 0) {
			return;
		}

		const message = featureName
			? `No repository detected. To view ${featureName}, open a folder containing a git repository or clone from a URL in Source Control.`
			: 'No repository detected. To use GitLens, open a folder containing a git repository or clone from a URL in Source Control.';

		const openRepo = { title: 'Open a Folder or Repo', isCloseAffordance: true };
		const result = await window.showInformationMessage(message, openRepo);
		if (result === openRepo) {
			void executeCoreCommand('workbench.view.scm');
		}
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
				return this.container.views.showView('branches');
			case Commands.ShowCommitDetailsView:
				void this.notifyWhenNoRepository('Inspect');
				return this.container.views.commitDetails.show();
			case Commands.ShowCommitsView:
				return this.container.views.showView('commits');
			case Commands.ShowContributorsView:
				return this.container.views.showView('contributors');
			case Commands.ShowDraftsView:
				return this.container.views.showView('drafts');
			case Commands.ShowFileHistoryView:
				return this.container.views.showView('fileHistory');
			case Commands.ShowGraphView:
				void this.notifyWhenNoRepository('the Commit Graph');
				return this.container.views.graph.show(undefined, ...(args as GraphWebviewShowingArgs));
			case Commands.ShowHomeView:
				return this.container.views.home.show(undefined, ...(args as HomeWebviewShowingArgs));
			case Commands.ShowLaunchpadView:
				return this.container.views.showView('launchpad');
			case Commands.ShowLineHistoryView:
				return this.container.views.showView('lineHistory');
			case Commands.ShowRemotesView:
				return this.container.views.showView('remotes');
			case Commands.ShowRepositoriesView:
				return this.container.views.showView('repositories');
			case Commands.ShowSearchAndCompareView:
				return this.container.views.showView('searchAndCompare');
			case Commands.ShowStashesView:
				return this.container.views.showView('stashes');
			case Commands.ShowTagsView:
				return this.container.views.showView('tags');
			case Commands.ShowTimelineView:
				return this.container.views.timeline.show();
			case Commands.ShowWorktreesView:
				return this.container.views.showView('worktrees');
			case Commands.ShowWorkspacesView:
				return this.container.views.showView('workspaces');
		}

		return Promise.resolve(undefined);
	}
}
