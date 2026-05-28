import { Disposable, ViewColumn } from 'vscode';
import { isUri } from '@gitlens/utils/uri.js';
import type { Container } from '../../../container.js';
import { registerCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { loadChunk } from '../../../system/-webview/loadChunk.js';
import { getScmResourceFolderUri, isScm, isScmResourceState } from '../../../system/-webview/scm.js';
import { isViewFileNode, isViewNode } from '../../../views/nodes/utils/-webview/node.utils.js';
import type { WebviewPanelsProxy, WebviewsController, WebviewViewProxy } from '../../webviewsController.js';
import type { State, TimelineScope } from './protocol.js';
import { isTimelineScope } from './utils/-webview/timeline.utils.js';

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
			webviewHostOptions: { retainContextWhenHidden: true, enableFindWidget: false },
			allowMultipleInstances: configuration.get('visualHistory.allowMultiple'),
		},
		async (container, host) => {
			const { TimelineWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-timeline" */ './timelineWebview.js'),
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
			webviewHostOptions: { retainContextWhenHidden: true },
		},
		async (container, host) => {
			const { TimelineWebviewProvider } = await loadChunk(
				() => import(/* webpackChunkName: "webview-timeline" */ './timelineWebview.js'),
			);
			return new TimelineWebviewProvider(container, host);
		},
	);
}

export function registerTimelineWebviewCommands<T>(
	container: Container,
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
			return show(isUri(args[0]) ? { type: 'file', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.file:editor', (...args: unknown[]) => {
			return show(isUri(args[0]) ? { type: 'file', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.file:explorer', (...args: unknown[]) => {
			return show(isUri(args[0]) ? { type: 'file', uri: args[0] } : undefined);
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
			return show(isUri(args[0]) ? { type: 'folder', uri: args[0] } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.folder:scm', (...args: unknown[]) => {
			const uri = getScmResourceFolderUri(args);
			return show(uri ? { type: 'folder', uri: uri } : undefined);
		}),

		registerCommand('gitlens.visualizeHistory.repo:scm', (...args: unknown[]) => {
			const uri = isScm(args[0]) ? args[0].rootUri : container.git.getBestRepositoryOrFirst()?.uri;
			return show(uri ? { type: 'repo', uri: uri } : undefined);
		}),
		registerCommand('gitlens.visualizeHistory.repo:views', (...args: unknown[]) => {
			const [arg] = args;

			let uri;
			if (isViewNode(arg, 'repo-folder')) {
				uri = arg.uri;
			} else {
				uri = container.git.getBestRepositoryOrFirst()?.uri;
			}

			return show(uri ? { type: 'repo', uri: uri } : undefined);
		}),

		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
