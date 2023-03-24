import { Commands, ContextKeys } from '../../constants';
import type { WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerWelcomeWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(Commands.ShowWelcomePage, 'gitlens.welcome', {
		fileName: 'welcome.html',
		iconPath: 'images/gitlens-icon.png',
		title: 'Welcome to GitLens',
		contextKeyPrefix: `${ContextKeys.WebviewPrefix}welcome`,
		trackingFeature: 'welcomeWebview',
		plusFeature: false,
		resolveWebviewProvider: async function (container, id, host) {
			const { WelcomeWebviewProvider } = await import(/* webpackChunkName: "welcome" */ './welcomeWebview');
			return new WelcomeWebviewProvider(container, id, host);
		},
	});
}
