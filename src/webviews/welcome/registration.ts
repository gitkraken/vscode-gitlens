import { ViewColumn } from 'vscode';
import type { WebviewPanelsProxy, WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export type WelcomeWebviewShowingArgs = [];

export function registerWelcomeWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.welcome', WelcomeWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.welcome', State, State, WelcomeWebviewShowingArgs>(
		{ id: 'gitlens.showWelcomePage' },
		{
			id: 'gitlens.welcome',
			fileName: 'welcome.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Welcome to GitLens',
			contextKeyPrefix: `gitlens:webview:welcome`,
			trackingFeature: 'welcomeWebview',
			type: 'welcome',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: false,
			},
		},
		async (container, host) => {
			const { WelcomeWebviewProvider } = await import(
				/* webpackChunkName: "webview-welcome" */ './welcomeWebview'
			);
			return new WelcomeWebviewProvider(container, host);
		},
	);
}
