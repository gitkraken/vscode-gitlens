import { ContextKeys } from '../../constants';
import type { Serialized } from '../../system/serialize';
import type { WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerCommitDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>>('gitlens.views.commitDetails', {
		fileName: 'commitDetails.html',
		title: 'Commit Details',
		contextKeyPrefix: `${ContextKeys.WebviewViewPrefix}commitDetails`,
		trackingFeature: 'commitDetailsView',
		plusFeature: false,
		resolveWebviewProvider: async function (container, id, host) {
			const { CommitDetailsWebviewProvider } = await import(
				/* webpackChunkName: "commitDetails" */ './commitDetailsWebview'
			);
			return new CommitDetailsWebviewProvider(container, id, host);
		},
	});
}
