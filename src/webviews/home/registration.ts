import type { WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerHomeWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State>('gitlens.views.home', {
		fileName: 'home.html',
		title: 'Home',
		contextKeyPrefix: `gitlens:webviewView:home`,
		trackingFeature: 'homeView',
		plusFeature: false,
		resolveWebviewProvider: async function (container, id, host) {
			const { HomeWebviewProvider } = await import(/* webpackChunkName: "home" */ './homeWebview');
			return new HomeWebviewProvider(container, id, host);
		},
	});
}
