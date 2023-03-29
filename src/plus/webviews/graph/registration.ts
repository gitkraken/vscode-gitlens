import { Disposable, ViewColumn } from 'vscode';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import type { Repository } from '../../../git/models/repository';
import { executeCommand, registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import type { BranchNode } from '../../../views/nodes/branchNode';
import type { CommitFileNode } from '../../../views/nodes/commitFileNode';
import type { CommitNode } from '../../../views/nodes/commitNode';
import type { StashNode } from '../../../views/nodes/stashNode';
import type { TagNode } from '../../../views/nodes/tagNode';
import type { WebviewPanelProxy, WebviewsController } from '../../../webviews/webviewsController';
import type { ShowInCommitGraphCommandArgs, State } from './protocol';

export function registerGraphWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(
		Commands.ShowGraphPage,
		{
			id: 'gitlens.graph',
			fileName: 'graph.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Commit Graph',
			contextKeyPrefix: `gitlens:webview:graph`,
			trackingFeature: 'graphWebview',
			plusFeature: true,
			column: ViewColumn.Active,
			panelOptions: {
				retainContextWhenHidden: true,
				enableFindWidget: false,
			},
		},
		async (container, host) => {
			const { GraphWebviewProvider } = await import(/* webpackChunkName: "graph" */ './graphWebview');
			return new GraphWebviewProvider(container, host);
		},
		() => configuration.get('graph.experimental.location') === 'tab',
	);
}

export function registerGraphWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State>(
		{
			id: 'gitlens.views.graph',
			fileName: 'graph.html',
			title: 'Commit Graph',
			contextKeyPrefix: `gitlens:webviewView:graph`,
			trackingFeature: 'graphView',
			plusFeature: true,
			webviewViewOptions: {
				retainContextWhenHidden: true,
			},
		},
		async (container, host) => {
			const { GraphWebviewProvider } = await import(/* webpackChunkName: "graph" */ './graphWebview');
			return new GraphWebviewProvider(container, host);
		},
		() => configuration.get('graph.experimental.location') === 'view',
	);
}

export function registerGraphWebviewCommands(container: Container, webview: WebviewPanelProxy) {
	return Disposable.from(
		registerCommand(Commands.ShowGraph, (...args: any[]) =>
			configuration.get('graph.experimental.location') === 'view'
				? executeCommand(Commands.ShowGraphView, ...args)
				: executeCommand(Commands.ShowGraphPage, ...args),
		),
		registerCommand(
			Commands.ShowInCommitGraph,
			(
				args:
					| ShowInCommitGraphCommandArgs
					| Repository
					| BranchNode
					| CommitNode
					| CommitFileNode
					| StashNode
					| TagNode,
			) => {
				const preserveFocus = 'preserveFocus' in args ? args.preserveFocus ?? false : false;
				if (configuration.get('graph.experimental.location') === 'view') {
					void container.graphView.show({ preserveFocus: preserveFocus }, args);
				} else {
					void webview.show({ preserveFocus: preserveFocus }, args);
				}
			},
		),
	);
}
