import type { Uri } from 'vscode';
import { Disposable, ViewColumn } from 'vscode';
import { GlCommand } from '../../../constants.commands';
import { registerCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getScmResourceFolderUri, isScmResourceState } from '../../../system/-webview/scm';
import type { ViewFileNode } from '../../../views/nodes/abstract/viewFileNode';
import type { WebviewPanelsProxy, WebviewsController, WebviewViewProxy } from '../../webviewsController';
import type { State } from './protocol';

export type TimelineWebviewShowingArgs = [Uri | ViewFileNode];

export function registerTimelineWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.timeline', TimelineWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.timeline', State, State, TimelineWebviewShowingArgs>(
		{ id: GlCommand.ShowTimelinePage, options: { preserveInstance: true } },
		{
			id: 'gitlens.timeline',
			fileName: 'timeline.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Visual History',
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

export function registerTimelineWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.timeline', TimelineWebviewShowingArgs, State> {
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
): Disposable {
	return Disposable.from(
		registerCommand(GlCommand.ShowFileInTimeline, (...args: TimelineWebviewShowingArgs) => {
			const [arg] = args;
			if (isScmResourceState(arg)) {
				args = [arg.resourceUri];
			}
			return void panels.show(undefined, ...args);
		}),
		registerCommand(GlCommand.ShowFolderInTimeline, (...args: TimelineWebviewShowingArgs) => {
			const uri = getScmResourceFolderUri(args);
			if (uri != null) {
				args = [uri];
			}
			void panels.show(undefined, ...args);
		}),

		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
