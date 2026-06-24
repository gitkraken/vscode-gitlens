import { ViewColumn } from 'vscode';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController.js';
import type { State } from './protocol.js';

export type AllowedSignersWebviewShowingArgs = [repoPath: string];

export function registerAllowedSignersWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.allowedSigners', AllowedSignersWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.allowedSigners', State, State, AllowedSignersWebviewShowingArgs>(
		{ id: 'gitlens.git.editAllowedSigners' },
		{
			id: 'gitlens.allowedSigners',
			fileName: 'allowedSigners.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'SSH Allowed Signers',
			contextKeyPrefix: `gitlens:webview:allowedSigners`,
			trackingFeature: 'allowedSignersWebview',
			type: 'allowedSigners',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: false,
			},
		},
		async (container, host) => {
			const { AllowedSignersWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-allowedSigners" */ './allowedSignersWebview.js'),
			);
			return new AllowedSignersWebviewProvider(container, host);
		},
	);
}
