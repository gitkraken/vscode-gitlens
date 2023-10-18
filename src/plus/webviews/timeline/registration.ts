import { Disposable, ViewColumn } from 'vscode';
import { Commands } from '../../../constants';
import { registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import type { WebviewPanelsProxy, WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export function registerTimelineWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(
		{ id: Commands.ShowTimelinePage, options: { preserveInstance: true } },
		{
			id: 'gitlens.timeline',
			fileName: 'timeline.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Visual File History',
			contextKeyPrefix: `gitlens:webview:timeline`,
			trackingFeature: 'timelineWebview',
			plusFeature: true,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: false,
			},
			allowMultipleInstances: configuration.get('visualHistory.allowMultiple'),
		},
		async (container, host) => {
			const { TimelineWebviewProvider } = await import(/* webpackChunkName: "timeline" */ './timelineWebview');
			return new TimelineWebviewProvider(container, host);
		},
	);
}

export function registerTimelineWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State>(
		{
			id: 'gitlens.views.timeline',
			fileName: 'timeline.html',
			title: 'Visual File History',
			contextKeyPrefix: `gitlens:webviewView:timeline`,
			trackingFeature: 'timelineView',
			plusFeature: true,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { TimelineWebviewProvider } = await import(/* webpackChunkName: "timeline" */ './timelineWebview');
			return new TimelineWebviewProvider(container, host);
		},
	);
}

export function registerTimelineWebviewCommands(panels: WebviewPanelsProxy) {
	return Disposable.from(
		registerCommand(Commands.ShowInTimeline, (...args: unknown[]) => void panels.show(undefined, ...args)),
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
