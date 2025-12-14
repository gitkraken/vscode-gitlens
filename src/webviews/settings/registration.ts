import { Disposable, ViewColumn } from 'vscode';
import type { GlCommands } from '../../constants.commands';
import { registerCommand } from '../../system/-webview/command';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export type SettingsWebviewShowingArgs = [string];

export function registerSettingsWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.settings', SettingsWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.settings', State, State, SettingsWebviewShowingArgs>(
		{ id: 'gitlens.showSettingsPage' },
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
): Disposable {
	return Disposable.from(
		...(
			[
				'gitlens.showSettingsPage!file-annotations',
				'gitlens.showSettingsPage!branches-view',
				'gitlens.showSettingsPage!commits-view',
				'gitlens.showSettingsPage!contributors-view',
				'gitlens.showSettingsPage!file-history-view',
				'gitlens.showSettingsPage!line-history-view',
				'gitlens.showSettingsPage!remotes-view',
				'gitlens.showSettingsPage!repositories-view',
				'gitlens.showSettingsPage!search-compare-view',
				'gitlens.showSettingsPage!stashes-view',
				'gitlens.showSettingsPage!tags-view',
				'gitlens.showSettingsPage!worktrees-view',
				'gitlens.showSettingsPage!commit-graph',
				'gitlens.showSettingsPage!autolinks',
			] satisfies GlCommands[]
		).map(c => {
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
