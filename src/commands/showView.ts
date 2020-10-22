'use strict';
import { commands } from 'vscode';
import { command, Command, CommandContext, Commands } from './common';
import { configuration } from '../configuration';
import { ContextKeys, GlobalState, setContext } from '../constants';
import { Container } from '../container';

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

	protected preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.ShowBranchesView:
				return Container.branchesView.show();
			case Commands.ShowCommitsView:
				return Container.commitsView.show();
			case Commands.ShowContributorsView:
				return Container.contributorsView.show();
			case Commands.ShowFileHistoryView:
				return Container.fileHistoryView.show();
			case Commands.ShowLineHistoryView:
				if (!Container.config.views.lineHistory.enabled) {
					await configuration.updateEffective('views', 'lineHistory', 'enabled', true);
				}
				return Container.lineHistoryView.show();
			case Commands.ShowRemotesView:
				return Container.remotesView.show();
			case Commands.ShowRepositoriesView:
				if (!Container.config.views.lineHistory.enabled) {
					await configuration.updateEffective('views', 'repositories', 'enabled', true);
				}
				return Container.repositoriesView.show();
			case Commands.ShowSearchAndCompareView:
				return Container.searchAndCompareView.show();
			case Commands.ShowStashesView:
				return Container.stashesView.show();
			case Commands.ShowTagsView:
				return Container.tagsView.show();
			case Commands.ShowWelcomeView:
				await setContext(ContextKeys.ViewsWelcomeVisible, true);
				void Container.context.globalState.update(GlobalState.WelcomeViewVisible, true);
				void (await commands.executeCommand('gitlens.views.welcome.focus'));
		}

		return Promise.resolve(undefined);
	}
}
