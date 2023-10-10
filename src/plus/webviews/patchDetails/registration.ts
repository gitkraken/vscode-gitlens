import type { DraftSelectedEvent } from '../../../eventBus';
import type { Serialized } from '../../../system/serialize';
import type { WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export type PatchDetailsWebviewShowingArgs = [Partial<DraftSelectedEvent['data']>];

export function registerPatchDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>, PatchDetailsWebviewShowingArgs>(
		{
			id: 'gitlens.views.patchDetails',
			fileName: 'patchDetails.html',
			title: 'Patch',
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
			return new PatchDetailsWebviewProvider(container, host);
		},
	);
}
