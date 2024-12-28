import { Disposable, ViewColumn } from 'vscode';
import { isScm } from '../../../commands/base';
import { GlCommand } from '../../../constants.commands';
import type { Container } from '../../../container';
import type { GitReference } from '../../../git/models/reference';
import type { Repository } from '../../../git/models/repository';
import { executeCommand, executeCoreCommand, registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import { getContext } from '../../../system/vscode/context';
import { ViewNode } from '../../../views/nodes/abstract/viewNode';
import type { BranchNode } from '../../../views/nodes/branchNode';
import type { CommitFileNode } from '../../../views/nodes/commitFileNode';
import type { CommitNode } from '../../../views/nodes/commitNode';
import { PullRequestNode } from '../../../views/nodes/pullRequestNode';
import type { StashNode } from '../../../views/nodes/stashNode';
import type { TagNode } from '../../../views/nodes/tagNode';
import type { WebviewPanelShowCommandArgs, WebviewPanelsProxy, WebviewsController } from '../../webviewsController';
import type { ShowInCommitGraphCommandArgs, State } from './protocol';

export type GraphWebviewShowingArgs = [Repository | { ref: GitReference }];

export function registerGraphWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<'gitlens.graph', State, State, GraphWebviewShowingArgs>(
		{ id: GlCommand.ShowGraphPage, options: { preserveInstance: true } },
		{
			id: 'gitlens.graph',
			fileName: 'graph.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Commit Graph',
			contextKeyPrefix: `gitlens:webview:graph`,
			trackingFeature: 'graphWebview',
			type: 'graph',
			plusFeature: true,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: true,
				enableFindWidget: false,
			},
			allowMultipleInstances: configuration.get('graph.allowMultiple'),
		},
		async (container, host) => {
			const { GraphWebviewProvider } = await import(/* webpackChunkName: "webview-graph" */ './graphWebview');
			return new GraphWebviewProvider(container, host);
		},
	);
}

export function registerGraphWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<'gitlens.views.graph', State, State, GraphWebviewShowingArgs>(
		{
			id: 'gitlens.views.graph',
			fileName: 'graph.html',
			title: 'Commit Graph',
			contextKeyPrefix: `gitlens:webviewView:graph`,
			trackingFeature: 'graphView',
			type: 'graph',
			plusFeature: true,
			webviewHostOptions: {
				retainContextWhenHidden: true,
			},
		},
		async (container, host) => {
			const { GraphWebviewProvider } = await import(/* webpackChunkName: "webview-graph" */ './graphWebview');
			return new GraphWebviewProvider(container, host);
		},
	);
}

export function registerGraphWebviewCommands<T>(
	container: Container,
	panels: WebviewPanelsProxy<'gitlens.graph', GraphWebviewShowingArgs, T>,
) {
	return Disposable.from(
		registerCommand(GlCommand.ShowGraph, (...args: unknown[]) => {
			const [arg] = args;

			let showInGraphArg;
			if (isScm(arg)) {
				if (arg.rootUri != null) {
					const repo = container.git.getRepository(arg.rootUri);
					if (repo != null) {
						showInGraphArg = repo;
					}
				}
				args = [];
			} else if (arg instanceof ViewNode) {
				if (arg.is('repo-folder')) {
					showInGraphArg = arg.repo;
				}
				args = [];
			}

			if (showInGraphArg != null) {
				return executeCommand(GlCommand.ShowInCommitGraph, showInGraphArg);
			}

			if (configuration.get('graph.layout') === 'panel') {
				return executeCommand(GlCommand.ShowGraphView, ...args);
			}

			return executeCommand<WebviewPanelShowCommandArgs>(GlCommand.ShowGraphPage, undefined, ...args);
		}),
		registerCommand(`${panels.id}.switchToEditorLayout`, async () => {
			await configuration.updateEffective('graph.layout', 'editor');
			queueMicrotask(() => void executeCommand<WebviewPanelShowCommandArgs>(GlCommand.ShowGraphPage));
		}),
		registerCommand(`${panels.id}.switchToPanelLayout`, async () => {
			await configuration.updateEffective('graph.layout', 'panel');
			queueMicrotask(async () => {
				await executeCoreCommand('gitlens.views.graph.resetViewLocation');
				await executeCoreCommand('gitlens.views.graphDetails.resetViewLocation');
				void executeCommand(GlCommand.ShowGraphView);
			});
		}),
		registerCommand(GlCommand.ToggleGraph, (...args: any[]) => {
			if (getContext('gitlens:webviewView:graph:visible')) {
				void executeCoreCommand('workbench.action.closePanel');
			} else {
				void executeCommand(GlCommand.ShowGraphView, ...args);
			}
		}),
		registerCommand(GlCommand.ToggleMaximizedGraph, (...args: any[]) => {
			if (getContext('gitlens:webviewView:graph:visible')) {
				void executeCoreCommand('workbench.action.toggleMaximizedPanel');
			} else {
				void executeCommand(GlCommand.ShowGraphView, ...args);
				void executeCoreCommand('workbench.action.toggleMaximizedPanel');
			}
		}),
		registerCommand(
			GlCommand.ShowInCommitGraph,
			(
				args:
					| ShowInCommitGraphCommandArgs
					| Repository
					| BranchNode
					| CommitNode
					| CommitFileNode
					| PullRequestNode
					| StashNode
					| TagNode,
			) => {
				if (args instanceof PullRequestNode) {
					if (args.ref == null) return;

					args = { ref: args.ref };
				}

				const preserveFocus = 'preserveFocus' in args ? args.preserveFocus ?? false : false;
				if (configuration.get('graph.layout') === 'panel') {
					if (!container.views.graph.visible) {
						const instance = panels.getBestInstance({ preserveFocus: preserveFocus }, args);
						if (instance != null) {
							void instance.show({ preserveFocus: preserveFocus }, args);
							return;
						}
					}

					void container.views.graph.show({ preserveFocus: preserveFocus }, args);
				} else {
					void panels.show({ preserveFocus: preserveFocus }, args);
				}
			},
		),
		registerCommand(
			GlCommand.ShowInCommitGraphView,
			(
				args:
					| ShowInCommitGraphCommandArgs
					| Repository
					| BranchNode
					| CommitNode
					| CommitFileNode
					| PullRequestNode
					| StashNode
					| TagNode,
			) => {
				if (args instanceof PullRequestNode) {
					if (args.ref == null) return;

					args = { ref: args.ref };
				}

				const preserveFocus = 'preserveFocus' in args ? args.preserveFocus ?? false : false;
				void container.views.graph.show({ preserveFocus: preserveFocus }, args);
			},
		),
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
