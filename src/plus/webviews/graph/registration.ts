import { Commands, ContextKeys } from '../../../constants';
import type { Repository } from '../../../git/models/repository';
import { registerCommand } from '../../../system/command';
import type { BranchNode } from '../../../views/nodes/branchNode';
import type { CommitFileNode } from '../../../views/nodes/commitFileNode';
import type { CommitNode } from '../../../views/nodes/commitNode';
import type { StashNode } from '../../../views/nodes/stashNode';
import type { TagNode } from '../../../views/nodes/tagNode';
import type { WebviewPanelProxy, WebviewsController } from '../../../webviews/webviewsController';
import type { ShowInCommitGraphCommandArgs, State } from './protocol';

export function registerGraphWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(Commands.ShowGraphPage, 'gitlens.graph', {
		fileName: 'graph.html',
		iconPath: 'images/gitlens-icon.png',
		title: 'Commit Graph',
		contextKeyPrefix: `${ContextKeys.WebviewPrefix}graph`,
		trackingFeature: 'graphWebview',
		plusFeature: true,
		panelOptions: {
			retainContextWhenHidden: true,
			enableFindWidget: false,
		},
		resolveWebviewProvider: async function (container, id, host) {
			const { GraphWebviewProvider } = await import(/* webpackChunkName: "graph" */ './graphWebview');
			return new GraphWebviewProvider(container, id, host);
		},
	});
}

export function registerGraphWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State>('gitlens.views.graph', {
		fileName: 'graph.html',
		title: 'Commit Graph',
		contextKeyPrefix: `${ContextKeys.WebviewViewPrefix}graph`,
		trackingFeature: 'graphView',
		plusFeature: true,
		resolveWebviewProvider: async function (container, id, host) {
			const { GraphWebviewProvider } = await import(/* webpackChunkName: "graph" */ './graphWebview');
			return new GraphWebviewProvider(container, id, host);
		},
	});
}

export function registerGraphWebviewCommands(webview: WebviewPanelProxy) {
	return registerCommand(
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
			void webview.show({ preserveFocus: preserveFocus }, args);
		},
	);
}
