import type { Serialized } from '../../system/serialize';
import type { WebviewsController } from '../webviewsController';
import type { State } from './protocol';

export function registerCommitDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>>(
		{
			id: 'gitlens.views.commitDetails',
			fileName: 'commitDetails.html',
			title: 'Commit Details',
			contextKeyPrefix: `gitlens:webviewView:commitDetails`,
			trackingFeature: 'commitDetailsView',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { CommitDetailsWebviewProvider } = await import(
				/* webpackChunkName: "commitDetails" */ './commitDetailsWebview'
			);
			return new CommitDetailsWebviewProvider(container, host, { mode: 'default' });
		},
	);
}

export function registerGraphDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>>(
		{
			id: 'gitlens.views.graphDetails',
			fileName: 'commitDetails.html',
			title: 'Commit Graph Details',
			contextKeyPrefix: `gitlens:webviewView:graphDetails`,
			trackingFeature: 'graphDetailsView',
			plusFeature: false,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { CommitDetailsWebviewProvider } = await import(
				/* webpackChunkName: "commitDetails" */ './commitDetailsWebview'
			);
			return new CommitDetailsWebviewProvider(container, host, { mode: 'graph' });
		},
	);
}
