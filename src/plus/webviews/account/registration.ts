import type { WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export function registerAccountWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State>(
		{
			id: 'gitlens.views.account',
			fileName: 'account.html',
			title: 'GitKraken Account',
			contextKeyPrefix: `gitlens:webviewView:account`,
			trackingFeature: 'accountView',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { AccountWebviewProvider } = await import(/* webpackChunkName: "account" */ './accountWebview');
			return new AccountWebviewProvider(container, host);
		},
	);
}
