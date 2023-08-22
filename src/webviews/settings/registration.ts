import { Disposable, ViewColumn } from 'vscode';
import { Commands } from '../../constants';
import { registerCommand } from '../../system/command';
import type { WebviewPanelProxy, WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerSettingsWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(
		Commands.ShowSettingsPage,
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
			const { SettingsWebviewProvider } = await import(/* webpackChunkName: "settings" */ './settingsWebview');
			return new SettingsWebviewProvider(container, host);
		},
	);
}

export function registerSettingsWebviewCommands(webview: WebviewPanelProxy) {
	return Disposable.from(
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
			Commands.ShowSettingsPageAndJumpToCommitGraph,
			Commands.ShowSettingsPageAndJumpToAutolinks,
		].map(c => {
			// The show and jump commands are structured to have a # separating the base command from the anchor
			let anchor: string | undefined;
			const match = /.*?#(.*)/.exec(c);
			if (match != null) {
				[, anchor] = match;
			}

			return registerCommand(c, (...args: any[]) => void webview.show(undefined, anchor, ...args));
		}),
	);
}
