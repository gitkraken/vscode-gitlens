import type { TextEditor } from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import type { SearchQuery } from '../../../constants.search';
import type { Source } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { GitUri } from '../../../git/gitUri';
import type { GitReference } from '../../../git/models/reference';
import type { Repository } from '../../../git/models/repository';
import { executeCommand, executeCoreCommand, registerCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getContext } from '../../../system/-webview/context';
import { getScmResourceFolderUri, getScmResourceUri, isScm } from '../../../system/-webview/scm';
import { ViewNode } from '../../../views/nodes/abstract/viewNode';
import type { BranchNode } from '../../../views/nodes/branchNode';
import type { CommitFileNode } from '../../../views/nodes/commitFileNode';
import type { CommitNode } from '../../../views/nodes/commitNode';
import { PullRequestNode } from '../../../views/nodes/pullRequestNode';
import type { StashNode } from '../../../views/nodes/stashNode';
import type { TagNode } from '../../../views/nodes/tagNode';
import type {
	WebviewPanelShowCommandArgs,
	WebviewPanelsProxy,
	WebviewsController,
	WebviewViewProxy,
} from '../../webviewsController';
import type { State } from './protocol';

export type GraphWebviewShowingArgs = [
	Repository | { ref: GitReference } | { repository: Repository; search: SearchQuery } | undefined,
];

export type ShowInCommitGraphCommandArgs =
	| { ref: GitReference; preserveFocus?: boolean; source?: Source; viewColumn?: ViewColumn }
	| { repository: Repository; search: SearchQuery; preserveFocus?: boolean; viewColumn?: ViewColumn }
	| Repository
	| BranchNode
	| CommitNode
	| CommitFileNode
	| PullRequestNode
	| StashNode
	| TagNode;

export function registerGraphWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.graph', GraphWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.graph', State, State, GraphWebviewShowingArgs>(
		{ id: 'gitlens.showGraphPage', options: { preserveInstance: true } },
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

export function registerGraphWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.graph', GraphWebviewShowingArgs, State> {
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
): Disposable {
	function showInCommitGraph(args: ShowInCommitGraphCommandArgs): void {
		if (args instanceof PullRequestNode) {
			if (args.ref == null) return;

			args = { ref: args.ref };
		}

		const preserveFocus = 'preserveFocus' in args ? (args.preserveFocus ?? false) : false;
		const column = 'viewColumn' in args ? args.viewColumn : undefined;
		if (configuration.get('graph.layout') === 'panel') {
			if (!container.views.graph.visible) {
				const instance = panels.getBestInstance({ preserveFocus: preserveFocus }, args);
				if (instance != null) {
					void instance.show({ preserveFocus: preserveFocus, column: column }, args);
					return;
				}
			}

			void container.views.graph.show({ preserveFocus: preserveFocus }, args);
		} else {
			const instance = panels.getBestInstance({ preserveFocus: preserveFocus }, args);
			if (instance != null) {
				void instance.show({ preserveFocus: preserveFocus, column: column }, args);
				return;
			}

			if (container.views.graph.visible) {
				void container.views.graph.show({ preserveFocus: preserveFocus }, args);
				return;
			}

			void panels.show({ preserveFocus: preserveFocus, column: column }, args);
		}
	}

	async function openFileHistoryInGraph(...args: any[]): Promise<void> {
		const uri = getUriFromArgs(args);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (gitUri?.repoPath == null) return;

		const repository = container.git.getRepository(gitUri.repoPath);
		if (repository == null) return;

		const relativePath = container.git.getRelativePath(gitUri, gitUri.repoPath);
		const searchQuery: SearchQuery = {
			query: `file:"${relativePath}"`,
			filter: true,
			matchAll: false,
			matchCase: false,
			matchRegex: false,
		};

		showInCommitGraph({ repository: repository, search: searchQuery });
	}
	async function openFolderHistoryInGraph(...args: any[]): Promise<void> {
		const uri = getUriFromArgs(args);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (gitUri?.repoPath == null) return;

		const repository = container.git.getRepository(gitUri.repoPath);
		if (repository == null) return;

		const relativePath = container.git.getRelativePath(gitUri, gitUri.repoPath);
		const searchQuery: SearchQuery = {
			query: `file:"${relativePath}/**"`,
			filter: true,
			matchAll: false,
			matchCase: false,
			matchRegex: false,
		};

		showInCommitGraph({ repository: repository, search: searchQuery });
	}

	return Disposable.from(
		registerCommand('gitlens.showGraph', (...args: unknown[]) => {
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
				showInCommitGraph(showInGraphArg);
				return;
			}

			if (configuration.get('graph.layout') === 'panel') {
				return executeCommand('gitlens.showGraphView', ...args);
			}

			return executeCommand<WebviewPanelShowCommandArgs>('gitlens.showGraphPage', undefined, ...args);
		}),
		registerCommand(`${panels.id}.switchToEditorLayout`, async () => {
			await configuration.updateEffective('graph.layout', 'editor');
			queueMicrotask(
				() =>
					void executeCommand<WebviewPanelShowCommandArgs<GraphWebviewShowingArgs>>('gitlens.showGraphPage'),
			);
		}),
		registerCommand(`${panels.id}.switchToPanelLayout`, async () => {
			await configuration.updateEffective('graph.layout', 'panel');
			queueMicrotask(async () => {
				await executeCoreCommand('gitlens.views.graph.resetViewLocation');
				await executeCoreCommand('gitlens.views.graphDetails.resetViewLocation');
				void executeCommand('gitlens.showGraphView');
			});
		}),
		registerCommand('gitlens.toggleGraph', (...args: any[]) => {
			if (getContext('gitlens:webviewView:graph:visible')) {
				void executeCoreCommand('workbench.action.closePanel');
			} else {
				void executeCommand('gitlens.showGraphView', ...args);
			}
		}),
		registerCommand('gitlens.toggleMaximizedGraph', (...args: any[]) => {
			if (getContext('gitlens:webviewView:graph:visible')) {
				void executeCoreCommand('workbench.action.toggleMaximizedPanel');
			} else {
				void executeCommand('gitlens.showGraphView', ...args);
				void executeCoreCommand('workbench.action.toggleMaximizedPanel');
			}
		}),
		registerCommand('gitlens.showInCommitGraph', showInCommitGraph),
		registerCommand('gitlens.showInCommitGraphView', (args: ShowInCommitGraphCommandArgs) => {
			if (args instanceof PullRequestNode) {
				if (args.ref == null) return;

				args = { ref: args.ref };
			}

			const preserveFocus = 'preserveFocus' in args ? (args.preserveFocus ?? false) : false;
			void container.views.graph.show({ preserveFocus: preserveFocus }, args);
		}),
		registerCommand(`${panels.id}.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`${panels.id}.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
		registerCommand('gitlens.openFileHistoryInGraph', openFileHistoryInGraph),
		registerCommand('gitlens.openFileHistoryInGraph:editor', openFileHistoryInGraph),
		registerCommand('gitlens.openFileHistoryInGraph:explorer', openFileHistoryInGraph),
		registerCommand('gitlens.openFileHistoryInGraph:scm', async (...args: any[]): Promise<void> => {
			const uri = getScmResourceUri(args);
			await openFileHistoryInGraph(uri);
		}),
		registerCommand('gitlens.openFolderHistoryInGraph', openFolderHistoryInGraph),
		registerCommand('gitlens.openFolderHistoryInGraph:explorer', openFolderHistoryInGraph),
		registerCommand('gitlens.openFolderHistoryInGraph:scm', async (...args: any[]): Promise<void> => {
			const uri = getScmResourceFolderUri(args) ?? getUriFromArgs(args);
			await openFolderHistoryInGraph(uri);
		}),
	);
}

function getUriFromArgs(args: any[]): Uri | undefined {
	const scmUri = getScmResourceUri(args);
	if (scmUri) return scmUri;

	let uri: Uri | undefined;
	let editor: TextEditor | undefined;

	if (args.length > 0) {
		const [arg] = args;
		if (arg instanceof Uri) {
			uri = arg;
		} else if (arg?.uri instanceof Uri) {
			uri = arg.uri;
		} else if (arg?.editor != null) {
			editor = arg.editor;
		}
	}

	if (uri == null && editor == null) {
		editor = window.activeTextEditor;
	}

	if (uri == null && editor != null) {
		uri = editor.document.uri;
	}

	return uri;
}
