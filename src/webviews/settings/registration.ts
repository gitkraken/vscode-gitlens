import { Disposable, ViewColumn } from 'vscode';
import { registerCommand } from '../../system/-webview/command.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController.js';
import type { State } from './protocol.js';
import { settingsPageAnchorCommands } from './settingsPageAnchors.js';

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
				// The native find widget can't see into the per-category shadow DOM
				// (only ~1 of 29 categories is in the document at a time) — the app
				// intercepts mod+F and routes it to its own search instead
				enableFindWidget: false,
			},
		},
		async (container, host) => {
			const { SettingsWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-settings" */ './settingsWebview.js'),
			);
			return new SettingsWebviewProvider(container, host);
		},
	);
}

export function registerSettingsWebviewCommands<T>(
	panels: WebviewPanelsProxy<'gitlens.settings', SettingsWebviewShowingArgs, T>,
): Disposable {
	return Disposable.from(
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		...settingsPageAnchorCommands.map(c => {
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
