import { l10n, ViewColumn } from 'vscode';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy, WebviewsController, WebviewViewProxy } from '../webviewsController.js';
import type { State } from './protocol.js';

export type WelcomeWebviewShowingArgs = [{ mode?: 'main' | 'graph' }?];

export function registerWelcomeWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.welcome', WelcomeWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.welcome', State, State, WelcomeWebviewShowingArgs>(
		{ id: 'gitlens.showWelcomePage', options: { preserveInstance: true } },
		{
			id: 'gitlens.welcome',
			fileName: 'welcome.html',
			iconPath: 'images/gitlens-icon.png',
			title: l10n.t('Welcome'),
			contextKeyPrefix: `gitlens:webview:welcome`,
			trackingFeature: 'welcomeWebview',
			type: 'welcome',
			plusFeature: false,
			column: ViewColumn.Active,
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

export function registerWelcomeWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.welcome', WelcomeWebviewShowingArgs, State> {
	return controller.registerWebviewView<'gitlens.views.welcome', State, State, WelcomeWebviewShowingArgs>(
		{
			id: 'gitlens.views.welcome',
			fileName: 'welcome.html',
			title: l10n.t('Welcome'),
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
