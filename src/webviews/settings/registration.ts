import { Disposable, ViewColumn } from 'vscode';
import { GlCommand } from '../../constants.commands';
import { registerCommand } from '../../system/vscode/command';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export type SettingsWebviewShowingArgs = [string];

export function registerSettingsWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<'gitlens.settings', State, State, SettingsWebviewShowingArgs>(
		{ id: GlCommand.ShowSettingsPage },
		{
			id: 'gitlens.settings',
			fileName: 'settings.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'GitLens Settings',
			contextKeyPrefix: `gitlens:webview:settings`,
			trackingFeature: 'settingsWebview',
			type: 'settings',
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

export function registerSettingsWebviewCommands<T>(
	panels: WebviewPanelsProxy<'gitlens.settings', SettingsWebviewShowingArgs, T>,
) {
	return Disposable.from(
		...[
			GlCommand.ShowSettingsPageAndJumpToFileAnnotations,
			GlCommand.ShowSettingsPageAndJumpToBranchesView,
			GlCommand.ShowSettingsPageAndJumpToCommitsView,
			GlCommand.ShowSettingsPageAndJumpToContributorsView,
			GlCommand.ShowSettingsPageAndJumpToFileHistoryView,
			GlCommand.ShowSettingsPageAndJumpToLineHistoryView,
			GlCommand.ShowSettingsPageAndJumpToRemotesView,
			GlCommand.ShowSettingsPageAndJumpToRepositoriesView,
			GlCommand.ShowSettingsPageAndJumpToSearchAndCompareView,
			GlCommand.ShowSettingsPageAndJumpToStashesView,
			GlCommand.ShowSettingsPageAndJumpToTagsView,
			GlCommand.ShowSettingsPageAndJumpToWorkTreesView,
			GlCommand.ShowSettingsPageAndJumpToViews,
			GlCommand.ShowSettingsPageAndJumpToCommitGraph,
			GlCommand.ShowSettingsPageAndJumpToAutolinks,
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
