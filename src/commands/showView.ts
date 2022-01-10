'use strict';
import { commands } from 'vscode';
import { ContextKeys, setContext, SyncedState } from '../constants';
import { Container } from '../container';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class ShowViewCommand extends Command {
	constructor() {
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
				return Container.instance.branchesView.show();
			case Commands.ShowCommitsView:
				return Container.instance.commitsView.show();
			case Commands.ShowContributorsView:
				return Container.instance.contributorsView.show();
			case Commands.ShowFileHistoryView:
				return Container.instance.fileHistoryView.show();
			case Commands.ShowLineHistoryView:
				return Container.instance.lineHistoryView.show();
			case Commands.ShowRemotesView:
				return Container.instance.remotesView.show();
			case Commands.ShowRepositoriesView:
				return Container.instance.repositoriesView.show();
			case Commands.ShowSearchAndCompareView:
				return Container.instance.searchAndCompareView.show();
			case Commands.ShowStashesView:
				return Container.instance.stashesView.show();
			case Commands.ShowTagsView:
				return Container.instance.tagsView.show();
			case Commands.ShowWelcomeView:
				await setContext(ContextKeys.ViewsWelcomeVisible, true);
				void Container.instance.context.globalState.update(SyncedState.WelcomeViewVisible, true);
				void (await commands.executeCommand('gitlens.views.welcome.focus'));
		}

		return Promise.resolve(undefined);
	}
}
