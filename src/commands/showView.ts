import { window } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/vscode/command';
import type { HomeWebviewShowingArgs } from '../webviews/home/registration';
import type { GraphWebviewShowingArgs } from '../webviews/plus/graph/registration';
import type { CommandContext } from './base';
import { GlCommandBase } from './base';

@command()
export class ShowViewCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([
			GlCommand.ShowAccountView,
			GlCommand.ShowBranchesView,
			GlCommand.ShowCommitDetailsView,
			GlCommand.ShowCommitsView,
			GlCommand.ShowContributorsView,
			GlCommand.ShowDraftsView,
			GlCommand.ShowFileHistoryView,
			GlCommand.ShowGraphView,
			GlCommand.ShowHomeView,
			GlCommand.ShowLaunchpadView,
			GlCommand.ShowLineHistoryView,
			GlCommand.ShowRemotesView,
			GlCommand.ShowRepositoriesView,
			GlCommand.ShowSearchAndCompareView,
			GlCommand.ShowStashesView,
			GlCommand.ShowTagsView,
			GlCommand.ShowTimelineView,
			GlCommand.ShowWorktreesView,
			GlCommand.ShowWorkspacesView,
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
		const command = context.command;
		switch (command) {
			case GlCommand.ShowAccountView:
				return this.container.views.home.show(
					undefined,
					...([{ focusAccount: true }, ...args] as HomeWebviewShowingArgs),
				);
			case GlCommand.ShowBranchesView:
				return this.container.views.showView('branches');
			case GlCommand.ShowCommitDetailsView:
				void this.notifyWhenNoRepository('Inspect');
				return this.container.views.commitDetails.show();
			case GlCommand.ShowCommitsView:
				return this.container.views.showView('commits');
			case GlCommand.ShowContributorsView:
				return this.container.views.showView('contributors');
			case GlCommand.ShowDraftsView:
				return this.container.views.showView('drafts');
			case GlCommand.ShowFileHistoryView:
				return this.container.views.showView('fileHistory');
			case GlCommand.ShowGraphView:
				void this.notifyWhenNoRepository('the Commit Graph');
				return this.container.views.graph.show(undefined, ...(args as GraphWebviewShowingArgs));
			case GlCommand.ShowHomeView:
				return this.container.views.home.show(undefined, ...(args as HomeWebviewShowingArgs));
			case GlCommand.ShowLaunchpadView:
				return this.container.views.showView('launchpad');
			case GlCommand.ShowLineHistoryView:
				return this.container.views.showView('lineHistory');
			case GlCommand.ShowRemotesView:
				return this.container.views.showView('remotes');
			case GlCommand.ShowRepositoriesView:
				return this.container.views.showView('repositories');
			case GlCommand.ShowSearchAndCompareView:
				return this.container.views.showView('searchAndCompare');
			case GlCommand.ShowStashesView:
				return this.container.views.showView('stashes');
			case GlCommand.ShowTagsView:
				return this.container.views.showView('tags');
			case GlCommand.ShowTimelineView:
				return this.container.views.timeline.show();
			case GlCommand.ShowWorktreesView:
				return this.container.views.showView('worktrees');
			case GlCommand.ShowWorkspacesView:
				return this.container.views.showView('workspaces');
		}

		return Promise.resolve(undefined);
	}
}
