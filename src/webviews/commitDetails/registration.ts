import type { CommitSelectedEvent } from '../../eventBus';
import type { Serialized } from '../../system/serialize';
import type { WebviewsController, WebviewViewProxy } from '../webviewsController';
import type { ShowWipArgs, State } from './protocol';

export type CommitDetailsWebviewShowingArgs = [Partial<CommitSelectedEvent['data']> | ShowWipArgs];

export function registerCommitDetailsWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.commitDetails', CommitDetailsWebviewShowingArgs, Serialized<State>> {
	return controller.registerWebviewView<
		'gitlens.views.commitDetails',
		State,
		Serialized<State>,
		CommitDetailsWebviewShowingArgs
	>(
		{
			id: 'gitlens.views.commitDetails',
			fileName: 'commitDetails.html',
			title: 'Inspect',
			contextKeyPrefix: `gitlens:webviewView:commitDetails`,
			trackingFeature: 'commitDetailsView',
			type: 'commitDetails',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { CommitDetailsWebviewProvider } = await import(
				/* webpackChunkName: "webview-commitDetails" */ './commitDetailsWebview'
			);
			return new CommitDetailsWebviewProvider(container, host, { attachedTo: 'default' });
		},
	);
}

export function registerGraphDetailsWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.graphDetails', CommitDetailsWebviewShowingArgs, Serialized<State>> {
	return controller.registerWebviewView<
		'gitlens.views.graphDetails',
		State,
		Serialized<State>,
		CommitDetailsWebviewShowingArgs
	>(
		{
			id: 'gitlens.views.graphDetails',
			fileName: 'commitDetails.html',
			title: 'Commit Graph Inspect',
			contextKeyPrefix: `gitlens:webviewView:graphDetails`,
			trackingFeature: 'graphDetailsView',
			type: 'graphDetails',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { CommitDetailsWebviewProvider } = await import(
				/* webpackChunkName: "webview-commitDetails" */ './commitDetailsWebview'
			);
			return new CommitDetailsWebviewProvider(container, host, { attachedTo: 'graph' });
		},
	);
}
