import type { Serialized } from '../../../system/serialize';
import type { WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export function registerPatchDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>>(
		{
			id: 'gitlens.views.patchDetails',
			fileName: 'patchDetails.html',
			title: 'Patch Details',
			contextKeyPrefix: `gitlens:webviewView:patchDetails`,
			trackingFeature: 'patchDetailsView',
			plusFeature: true,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { PatchDetailsWebviewProvider } = await import(
				/* webpackChunkName: "patchDetails" */ './patchDetailsWebview'
			);
			return new PatchDetailsWebviewProvider(container, host, { mode: 'default' });
		},
	);
}
