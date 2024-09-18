import type { Uri } from 'vscode';
import { Disposable, ViewColumn } from 'vscode';
import { Commands } from '../../../constants.commands';
import { registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import type { ViewFileNode } from '../../../views/nodes/abstract/viewFileNode';
import type { WebviewPanelsProxy, WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export type TimelineWebviewShowingArgs = [Uri | ViewFileNode];

export function registerTimelineWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State, State, TimelineWebviewShowingArgs>(
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
			const { TimelineWebviewProvider } = await import(
				/* webpackChunkName: "webview-timeline" */ './timelineWebview'
			);
			return new TimelineWebviewProvider(container, host);
		},
	);
}

export function registerTimelineWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, State, TimelineWebviewShowingArgs>(
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
			const { TimelineWebviewProvider } = await import(
				/* webpackChunkName: "webview-timeline" */ './timelineWebview'
			);
			return new TimelineWebviewProvider(container, host);
		},
	);
}

export function registerTimelineWebviewCommands<T>(panels: WebviewPanelsProxy<TimelineWebviewShowingArgs, T>) {
	return Disposable.from(
		registerCommand(
			Commands.ShowInTimeline,
			(...args: TimelineWebviewShowingArgs) => void panels.show(undefined, ...args),
		),
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
