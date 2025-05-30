import { Commands } from '../../../constants';
import type { WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export function registerTimelineWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(Commands.ShowTimelinePage, 'gitlens.timeline', {
		fileName: 'timeline.html',
		iconPath: 'images/gitlens-icon.png',
		title: 'Visual File History',
		contextKeyPrefix: `gitlens:webview:timeline`,
		trackingFeature: 'timelineWebview',
		plusFeature: true,
		resolveWebviewProvider: async function (container, id, host) {
			const { TimelineWebviewProvider } = await import(/* webpackChunkName: "timeline" */ './timelineWebview');
			return new TimelineWebviewProvider(container, id, host);
		},
	});
}

export function registerTimelineWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State>('gitlens.views.timeline', {
		fileName: 'timeline.html',
		title: 'Visual File History',
		contextKeyPrefix: `gitlens:webviewView:timeline`,
		trackingFeature: 'timelineView',
		plusFeature: true,
		resolveWebviewProvider: async function (container, id, host) {
			const { TimelineWebviewProvider } = await import(/* webpackChunkName: "timeline" */ './timelineWebview');
			return new TimelineWebviewProvider(container, id, host);
		},
	});
}
