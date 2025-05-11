import { Disposable, Uri, ViewColumn } from 'vscode';
import { registerCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getScmResourceFolderUri, isScmResourceState } from '../../../system/-webview/scm';
import { isViewFileNode, isViewNode } from '../../../views/nodes/utils/-webview/node.utils';
import type { WebviewPanelsProxy, WebviewsController, WebviewViewProxy } from '../../webviewsController';
import type { State, TimelineScope } from './protocol';
import { isTimelineScope } from './utils/-webview/timeline.utils';

export type TimelineCommandArgs = TimelineScope;
export type TimelineWebviewShowingArgs = [TimelineScope];

export function registerTimelineWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.timeline', TimelineWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.timeline', State, State, TimelineWebviewShowingArgs>(
		{ id: 'gitlens.showTimelinePage', options: { preserveInstance: true } },
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
			webviewHostOptions: { retainContextWhenHidden: false, enableFindWidget: false },
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
			webviewHostOptions: { retainContextWhenHidden: false },
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
	function show(scope?: TimelineScope | undefined): Promise<void> {
		if (scope == null) return panels.show();
		return panels.show(undefined, scope);
	}

	return Disposable.from(
		registerCommand('gitlens.visualizeHistory', (...args: unknown[]) => {
			return show(isTimelineScope(args[0]) ? args[0] : undefined);
		}),

		registerCommand('gitlens.visualizeHistory.file', (...args: unknown[]) => {
			return show(args[0] instanceof Uri ? { type: 'file', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.file:editor', (...args: unknown[]) => {
			return show(args[0] instanceof Uri ? { type: 'file', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.file:explorer', (...args: unknown[]) => {
			return show(args[0] instanceof Uri ? { type: 'file', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.file:scm', (...args: unknown[]) => {
			return show(isScmResourceState(args[0]) ? { type: 'file', uri: args[0].resourceUri } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.file:views', (...args: unknown[]) => {
			const [arg] = args;
			if (isViewFileNode(arg)) {
				return show({ type: 'file', uri: arg.uri });
			} else if (isViewNode(arg, 'folder')) {
				return show({ type: 'folder', uri: arg.uri });
			}
			return show();
		}),

		registerCommand('gitlens.visualizeHistory.folder:explorer', (...args: unknown[]) => {
			return show(args[0] instanceof Uri ? { type: 'folder', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.folder:scm', (...args: unknown[]) => {
			const uri = getScmResourceFolderUri(args);
			return show(uri ? { type: 'folder', uri: uri } : undefined);
		}),

		registerCommand('gitlens.visualizeHistory.repo:home', (...args: unknown[]) => {
			return show(
				args[0] instanceof Uri
					? { type: 'repo', uri: args[0] }
					: isTimelineScope(args[0])
					  ? args[0]
					  : undefined,
			);
		}),
		registerCommand('gitlens.visualizeHistory.branch:home', (...args: unknown[]) => {
			return show(isTimelineScope(args[0]) ? args[0] : undefined);
		}),

		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
