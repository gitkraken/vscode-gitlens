import type { Disposable } from 'vscode';
import { ViewColumn } from 'vscode';
import { registerCommand } from '../../system/-webview/command.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController.js';
import type { State } from './protocol.js';

export type StyleguideWebviewShowingArgs = [];

/**
 * Registers the dev-only color/token styleguide panel. Gated behind DEBUG in container.ts and the
 * `gitlens:debugging` context on its command, so it never appears in production builds.
 */
export function registerStyleguideWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.styleguide', StyleguideWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.styleguide', State, State, StyleguideWebviewShowingArgs>(
		{ id: 'gitlens.showStyleguide' },
		{
			id: 'gitlens.styleguide',
			fileName: 'styleguide.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'GitLens Styleguide',
			contextKeyPrefix: `gitlens:webview:styleguide`,
			trackingFeature: 'styleguideWebview',
			type: 'styleguide',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: { retainContextWhenHidden: false, enableFindWidget: true },
		},
		async (_container, host) => {
			const { StyleguideWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-styleguide" */ './styleguideWebview.js'),
			);
			return new StyleguideWebviewProvider(host);
		},
	);
}

export function registerStyleguideWebviewCommands<T>(
	panels: WebviewPanelsProxy<'gitlens.styleguide', StyleguideWebviewShowingArgs, T>,
): Disposable {
	return registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true));
}
