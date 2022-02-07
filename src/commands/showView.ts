import { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { SyncedState } from '../storage';
import { command, executeCommand } from '../system/command';
import { Command, CommandContext } from './base';

@command()
export class ShowViewCommand extends Command {
	constructor(private readonly container: Container) {
		super([
			Commands.ShowBranchesView,
			Commands.ShowCommitsView,
			Commands.ShowContributorsView,
			Commands.ShowFileHistoryView,
			Commands.ShowLineHistoryView,
			Commands.ShowRemotesView,
			Commands.ShowRepositoriesView,
			Commands.ShowSearchAndCompareView,
			Commands.ShowStashesView,
			Commands.ShowTagsView,
			Commands.ShowWelcomeView,
		]);
	}

	protected override preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.ShowBranchesView:
				return this.container.branchesView.show();
			case Commands.ShowCommitsView:
				return this.container.commitsView.show();
			case Commands.ShowContributorsView:
				return this.container.contributorsView.show();
			case Commands.ShowFileHistoryView:
				return this.container.fileHistoryView.show();
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
			case Commands.ShowWelcomeView:
				await setContext(ContextKeys.ViewsWelcomeVisible, true);
				void this.container.storage.store(SyncedState.WelcomeViewVisible, true);
				void (await executeCommand('gitlens.views.welcome.focus'));
		}

		return Promise.resolve(undefined);
	}
}
