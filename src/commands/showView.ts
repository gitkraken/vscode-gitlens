import { window } from 'vscode';
import type { Container } from '../container.js';
import { command, executeCoreCommand } from '../system/-webview/command.js';
import type { HomeWebviewShowingArgs } from '../webviews/home/registration.js';
import type { GraphWebviewShowingArgs } from '../webviews/plus/graph/registration.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';

@command()
export class ShowViewCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super([
			'gitlens.showAccountView',
			'gitlens.showBranchesView',
			'gitlens.showCommitDetailsView',
			'gitlens.showCommitsView',
			'gitlens.showContributorsView',
			'gitlens.showDraftsView',
			'gitlens.showFileHistoryView',
			'gitlens.showGraphView',
			'gitlens.showHomeView',
			'gitlens.showLaunchpadView',
			'gitlens.showLineHistoryView',
			'gitlens.showRemotesView',
			'gitlens.showRepositoriesView',
			'gitlens.showSearchAndCompareView',
			'gitlens.showStashesView',
			'gitlens.showTagsView',
			'gitlens.showTimelineView',
			'gitlens.showWelcomeView',
			'gitlens.showWorktreesView',
			'gitlens.showWorkspacesView',
		]);
	}

	protected override preExecute(context: CommandContext, ...args: unknown[]): Promise<void> {
		return this.execute(context, ...args);
	}

	async waitForRepo(): Promise<void> {
		if (this.container.git.openRepositoryCount > 0) return;

		// Wait for repository discovery to complete
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}
	}

	async waitForRepoOrNotify(featureName?: string): Promise<void> {
		await this.waitForRepo();
		if (this.container.git.openRepositoryCount > 0) return;

		const message = featureName
			? `No repository detected. To view ${featureName}, open a folder containing a git repository or clone from a URL in Source Control.`
			: 'No repository detected. To use GitLens, open a folder containing a git repository or clone from a URL in Source Control.';

		const openRepo = { title: 'Open a Folder or Repo', isCloseAffordance: true };
		const result = await window.showInformationMessage(message, openRepo);
		if (result === openRepo) {
			void executeCoreCommand('workbench.view.scm');
		}
	}

	async execute(context: CommandContext, ...args: unknown[]): Promise<void> {
		const command = context.command;
		switch (command) {
			case 'gitlens.showAccountView':
				return this.container.views.home.show(
					undefined,
					...([{ focusAccount: true }, ...args] as HomeWebviewShowingArgs),
				);
			case 'gitlens.showBranchesView':
				await this.waitForRepo();
				return this.container.views.showView('branches');
			case 'gitlens.showCommitDetailsView':
				await this.waitForRepoOrNotify('Inspect');
				return this.container.views.commitDetails.show();
			case 'gitlens.showCommitsView':
				await this.waitForRepo();
				return this.container.views.showView('commits');
			case 'gitlens.showContributorsView':
				await this.waitForRepo();
				return this.container.views.showView('contributors');
			case 'gitlens.showDraftsView':
				return this.container.views.showView('drafts');
			case 'gitlens.showFileHistoryView':
				await this.waitForRepo();
				return this.container.views.showView('fileHistory');
			case 'gitlens.showGraphView':
				await this.waitForRepoOrNotify('the Commit Graph');
				return this.container.views.graph.show(undefined, ...(args as GraphWebviewShowingArgs));
			case 'gitlens.showHomeView':
				return this.container.views.home.show(undefined, ...(args as HomeWebviewShowingArgs));
			case 'gitlens.showLaunchpadView':
				return this.container.views.showView('launchpad');
			case 'gitlens.showLineHistoryView':
				await this.waitForRepo();
				return this.container.views.showView('lineHistory');
			case 'gitlens.showRemotesView':
				await this.waitForRepo();
				return this.container.views.showView('remotes');
			case 'gitlens.showRepositoriesView':
				await this.waitForRepo();
				return this.container.views.showView('repositories');
			case 'gitlens.showSearchAndCompareView':
				return this.container.views.showView('searchAndCompare');
			case 'gitlens.showStashesView':
				await this.waitForRepo();
				return this.container.views.showView('stashes');
			case 'gitlens.showTagsView':
				await this.waitForRepo();
				return this.container.views.showView('tags');
			case 'gitlens.showTimelineView':
				await this.waitForRepo();
				return this.container.views.timeline.show();
			case 'gitlens.showWelcomeView':
				return this.container.views.welcome.show();
			case 'gitlens.showWorktreesView':
				await this.waitForRepo();
				return this.container.views.showView('worktrees');
			case 'gitlens.showWorkspacesView':
				return this.container.views.showView('workspaces');
		}

		return Promise.resolve(undefined);
	}
}
