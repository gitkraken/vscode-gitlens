import { Disposable, ViewColumn } from 'vscode';
import { Commands } from '../../constants.commands';
import { registerCommand } from '../../system/vscode/command';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export type SettingsWebviewShowingArgs = [string];

export function registerSettingsWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State, State, SettingsWebviewShowingArgs>(
		{ id: Commands.ShowSettingsPage },
		{
			id: 'gitlens.settings',
			fileName: 'settings.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'GitLens Settings',
			contextKeyPrefix: `gitlens:webview:settings`,
			trackingFeature: 'settingsWebview',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: true,
			},
		},
		async (container, host) => {
			const { SettingsWebviewProvider } = await import(
				/* webpackChunkName: "webview-settings" */ './settingsWebview'
			);
			return new SettingsWebviewProvider(container, host);
		},
	);
}

export function registerSettingsWebviewCommands<T>(panels: WebviewPanelsProxy<SettingsWebviewShowingArgs, T>) {
	return Disposable.from(
		...[
			Commands.ShowSettingsPageAndJumpToFileAnnotations,
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
			Commands.ShowSettingsPageAndJumpToCommitGraph,
			Commands.ShowSettingsPageAndJumpToAutolinks,
		].map(c => {
			// The show and jump commands are structured to have a ! separating the base command from the anchor
			let anchor: string | undefined;
			const match = /.*?!(.*)/.exec(c);
			if (match != null) {
				[, anchor] = match;
			}

			return registerCommand(c, () => void panels.show(undefined, ...(anchor ? [anchor] : [])));
		}),
	);
}
