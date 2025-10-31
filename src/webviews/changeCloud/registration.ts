import { ViewColumn } from 'vscode';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController';
import { ChangeCloudWebviewProvider } from './changeCloudWebview';
import type { State } from './protocol';

export type ChangeCloudWebviewShowingArgs = [];

export function registerChangeCloudWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.changeCloud', ChangeCloudWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.changeCloud', State, State, ChangeCloudWebviewShowingArgs>(
		{ id: 'gitlens.showChangeCloudPage' },
		{
			id: 'gitlens.changeCloud',
			fileName: 'changeCloud.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Change Cloud',
			contextKeyPrefix: `gitlens:webview:changeCloud`,
			trackingFeature: 'changeCloudWebview',
			type: 'changeCloud',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: false,
			},
		},
		async (container, host) => {
			return Promise.resolve(new ChangeCloudWebviewProvider(container, host));
		},
	);
}
