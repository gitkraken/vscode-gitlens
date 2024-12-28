import type { Uri } from 'vscode';
import { Disposable, ViewColumn } from 'vscode';
import { GlCommand } from '../../../constants.commands';
import { registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import type { ViewFileNode } from '../../../views/nodes/abstract/viewFileNode';
import type { WebviewPanelsProxy, WebviewsController } from '../../webviewsController';
import type { State } from './protocol';

export type TimelineWebviewShowingArgs = [Uri | ViewFileNode];

export function registerTimelineWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<'gitlens.timeline', State, State, TimelineWebviewShowingArgs>(
		{ id: GlCommand.ShowTimelinePage, options: { preserveInstance: true } },
		{
			id: 'gitlens.timeline',
			fileName: 'timeline.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Visual File History',
			contextKeyPrefix: `gitlens:webview:timeline`,
			trackingFeature: 'timelineWebview',
			type: 'timeline',
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
	return controller.registerWebviewView<'gitlens.views.timeline', State, State, TimelineWebviewShowingArgs>(
		{
			id: 'gitlens.views.timeline',
			fileName: 'timeline.html',
			title: 'Visual File History',
			contextKeyPrefix: `gitlens:webviewView:timeline`,
			trackingFeature: 'timelineView',
			type: 'timeline',
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

export function registerTimelineWebviewCommands<T>(
	panels: WebviewPanelsProxy<'gitlens.timeline', TimelineWebviewShowingArgs, T>,
) {
	return Disposable.from(
		registerCommand(
			GlCommand.ShowInTimeline,
			(...args: TimelineWebviewShowingArgs) => void panels.show(undefined, ...args),
		),
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
