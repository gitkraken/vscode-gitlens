import { workspace } from 'vscode';
import { configuration } from '../../configuration';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { registerCommand } from '../../system/command';
import { WebviewWithConfigBase } from '../webviewWithConfigBase';
import type { State } from './protocol';

const anchorRegex = /.*?#(.*)/;

export class SettingsWebview extends WebviewWithConfigBase<State> {
	constructor(container: Container) {
		super(
			container,
			'gitlens.settings',
			'settings.html',
			'images/gitlens-icon.png',
			'GitLens Settings',
			Commands.ShowSettingsPage,
		);

		this.disposables.push(
			...[
				Commands.ShowSettingsPageAndJumpToBranchesView,
				Commands.ShowSettingsPageAndJumpToCommitsView,
				Commands.ShowSettingsPageAndJumpToContributorsView,
				Commands.ShowSettingsPageAndJumpToFileHistoryView,
				Commands.ShowSettingsPageAndJumpToLineHistoryView,
				Commands.ShowSettingsPageAndJumpToRemotesView,
				Commands.ShowSettingsPageAndJumpToRepositoriesView,
				Commands.ShowSettingsPageAndJumpToSearchAndCompareView,
				Commands.ShowSettingsPageAndJumpToStashesView,
				Commands.ShowSettingsPageAndJumpToTagsView,
				Commands.ShowSettingsPageAndJumpToWorkTreesView,
				Commands.ShowSettingsPageAndJumpToViews,
				Commands.ShowSettingsPageAndJumpToAutolinks,
			].map(c => {
				// The show and jump commands are structured to have a # separating the base command from the anchor
				let anchor: string | undefined;
				const match = anchorRegex.exec(c);
				if (match != null) {
					[, anchor] = match;
				}

				return registerCommand(c, () => this.onShowCommand(anchor), this);
			}),
		);
	}

	protected override includeBootstrap(): State {
		const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		return {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
			scope: 'user',
			scopes: scopes,
		};
	}
}
