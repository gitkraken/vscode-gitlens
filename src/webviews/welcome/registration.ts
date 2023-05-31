import { ViewColumn } from 'vscode';
import { Commands } from '../../constants';
import type { WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerWelcomeWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(
		Commands.ShowWelcomePage,
		{
			id: 'gitlens.welcome',
			fileName: 'welcome.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Welcome to GitLens',
			contextKeyPrefix: `gitlens:webview:welcome`,
			trackingFeature: 'welcomeWebview',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: true,
			},
		},
		async (container, host) => {
			const { WelcomeWebviewProvider } = await import(/* webpackChunkName: "welcome" */ './welcomeWebview');
			return new WelcomeWebviewProvider(container, host);
		},
	);
}
