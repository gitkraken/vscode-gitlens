import type { CommitSelectedEvent } from '../../eventBus.js';
import { loadChunk } from '../../system/-webview/loadChunk.js';
import type { WebviewsController, WebviewViewProxy } from '../webviewsController.js';
import type { ShowWipArgs, State } from './protocol.js';

export type CommitDetailsWebviewShowingArgs = [Partial<CommitSelectedEvent['data']> | ShowWipArgs];

export function registerCommitDetailsWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.commitDetails', CommitDetailsWebviewShowingArgs, State> {
	return controller.registerWebviewView<'gitlens.views.commitDetails', State, State, CommitDetailsWebviewShowingArgs>(
		{
			id: 'gitlens.views.commitDetails',
			fileName: 'commitDetails.html',
			title: 'Inspect',
			contextKeyPrefix: `gitlens:webviewView:commitDetails`,
			trackingFeature: 'commitDetailsView',
			type: 'commitDetails',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: true,
			},
		},
		async (container, host) => {
			const { CommitDetailsWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-commitDetails" */ './commitDetailsWebview.js'),
			);
			return new CommitDetailsWebviewProvider(container, host);
		},
	);
}
