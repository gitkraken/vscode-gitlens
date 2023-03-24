import { Commands, ContextKeys } from '../../../constants';
import type { WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export function registerFocusWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(Commands.ShowFocusPage, 'gitlens.focus', {
		fileName: 'focus.html',
		iconPath: 'images/gitlens-icon.png',
		title: 'Focus View',
		contextKeyPrefix: `${ContextKeys.WebviewPrefix}focus`,
		trackingFeature: 'focusWebview',
		plusFeature: true,
		resolveWebviewProvider: async function (container, id, host) {
			const { FocusWebviewProvider } = await import(/* webpackChunkName: "focus" */ './focusWebview');
			return new FocusWebviewProvider(container, id, host);
		},
	});
}
