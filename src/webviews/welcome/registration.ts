import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewsController, WebviewViewProxy } from '../webviewsController.js';
import type { State } from './protocol.js';

export type WelcomeWebviewShowingArgs = [{ mode?: 'main' | 'graph' }?];

export function registerWelcomeWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.welcome', WelcomeWebviewShowingArgs, State> {
	return controller.registerWebviewView<'gitlens.views.welcome', State, State, WelcomeWebviewShowingArgs>(
		{
			id: 'gitlens.views.welcome',
			fileName: 'welcome.html',
			title: 'Welcome',
			contextKeyPrefix: `gitlens:webviewView:welcome`,
			trackingFeature: 'welcomeView',
			type: 'welcome',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { WelcomeWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-welcome" */ './welcomeWebview.js'),
			);
			return new WelcomeWebviewProvider(container, host);
		},
	);
}
