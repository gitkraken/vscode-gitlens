'use strict';
import {
	CancellationToken,
	commands,
	ConfigurationChangeEvent,
	Event,
	EventEmitter,
	ProgressLocation,
	window
} from 'vscode';
import {
	configuration,
	RepositoriesViewConfig,
	ViewBranchesLayout,
	ViewFilesLayout,
	ViewsConfig,
	ViewShowBranchComparison
} from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLogCommit, GitService, GitStashCommit } from '../git/gitService';
import {
	BranchesNode,
	BranchNode,
	BranchOrTagFolderNode,
	CompareBranchNode,
	RepositoriesNode,
	RepositoryNode,
	StashesNode,
	StashNode,
	ViewNode
} from './nodes';
import { gate } from '../system';
import { ViewBase } from './viewBase';

export class RepositoriesView extends ViewBase<RepositoriesNode> {
	constructor() {
		super('gitlens.views.repositories', 'Repositories');
	}

	private _onDidChangeAutoRefresh = new EventEmitter<void>();
	get onDidChangeAutoRefresh(): Event<void> {
		return this._onDidChangeAutoRefresh.event;
	}

	getRoot() {
		return new RepositoriesNode(this);
	}

	protected get location(): string {
		return this.config.location;
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setBranchesLayoutToList'),
			() => this.setBranchesLayout(ViewBranchesLayout.List),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setBranchesLayoutToTree'),
			() => this.setBranchesLayout(ViewBranchesLayout.Tree),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToAuto'),
			() => this.setFilesLayout(ViewFilesLayout.Auto),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToList'),
			() => this.setFilesLayout(ViewFilesLayout.List),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToTree'),
			() => this.setFilesLayout(ViewFilesLayout.Tree),
			this
		);

		commands.registerCommand(
			this.getQualifiedCommand('setAutoRefreshToOn'),
			() => this.setAutoRefresh(Container.config.views.repositories.autoRefresh, true),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setAutoRefreshToOff'),
			() => this.setAutoRefresh(Container.config.views.repositories.autoRefresh, false),
			this
		);

		commands.registerCommand(
			this.getQualifiedCommand('setBranchComparisonToWorking'),
			n => this.setBranchComparison(n, ViewShowBranchComparison.Working),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setBranchComparisonToBranch'),
			n => this.setBranchComparison(n, ViewShowBranchComparison.Branch),
			this
		);
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			!configuration.changed(e, 'views', 'repositories') &&
			!configuration.changed(e, 'views') &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'sortBranchesBy') &&
			!configuration.changed(e, 'sortTagsBy')
		) {
			return;
		}

		if (configuration.changed(e, 'views', 'repositories', 'autoRefresh')) {
			void this.setAutoRefresh(Container.config.views.repositories.autoRefresh);
		}

		if (configuration.changed(e, 'views', 'repositories', 'location')) {
			this.initialize(this.config.location, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root !== undefined) {
			void this.refresh(true);
		}
	}

	get autoRefresh() {
		return (
			this.config.autoRefresh &&
			Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsRepositoriesAutoRefresh, true)
		);
	}

	get config(): ViewsConfig & RepositoriesViewConfig {
		return { ...Container.config.views, ...Container.config.views.repositories };
	}

	findCommitNode(commit: GitLogCommit | { repoPath: string; ref: string }, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(commit.repoPath);

		return this.findNode((n: any) => n.commit !== undefined && n.commit.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 6,
			canTraverse: n => {
				// Only search for commit nodes in the same repo within BranchNodes
				if (n instanceof RepositoriesNode) return true;

				if (
					n instanceof RepositoryNode ||
					n instanceof BranchesNode ||
					n instanceof BranchOrTagFolderNode ||
					n instanceof BranchNode
				) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			},
			token: token
		});
	}

	findStashNode(stash: GitStashCommit | { repoPath: string; ref: string }, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(stash.repoPath);

		return this.findNode(StashNode.getId(stash.repoPath, stash.ref), {
			maxDepth: 3,
			canTraverse: n => {
				// Only search for stash nodes in the same repo within a StashesNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof StashesNode) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			},
			token: token
		});
	}

	@gate<RepositoriesView['revealCommit']>(() => '')
	revealCommit(
		commit: GitLogCommit | { repoPath: string; ref: string },
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		}
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing commit '${GitService.shortenSha(commit.ref)}' in the Repositories view...`,
				cancellable: true
			},
			async (progress, token) => {
				const node = await this.findCommitNode(commit, token);
				if (node === undefined) return node;

				// Not sure why I need to reveal each parent, but without it the node won't be revealed
				const nodes: ViewNode[] = [];

				let parent: ViewNode | undefined = node;
				while (parent !== undefined) {
					nodes.push(parent);
					parent = parent.getParent();
				}
				nodes.pop();

				for (const n of nodes.reverse()) {
					try {
						await this.reveal(n, options);
					} catch {}
				}

				return node;
			}
		);
	}

	@gate<RepositoriesView['revealStash']>(() => '')
	async revealStash(
		stash: GitStashCommit | { repoPath: string; ref: string; stashName: string },
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		}
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing stash '${stash.stashName}' in the Repositories view...`,
				cancellable: true
			},
			async (progress, token) => {
				const node = await this.findStashNode(stash, token);
				if (node !== undefined) {
					await this.reveal(node, options);
				}

				return node;
			}
		);
	}

	@gate<RepositoriesView['revealStashes']>(() => '')
	async revealStashes(
		repoPath: string,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		}
	) {
		const repoNodeId = RepositoryNode.getId(repoPath);

		const node = await this.findNode(StashesNode.getId(repoPath), {
			maxDepth: 2,
			canTraverse: n => {
				// Only search for stashes nodes in the same repo
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			}
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	private async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
		if (enabled) {
			if (workspaceEnabled === undefined) {
				workspaceEnabled = Container.context.workspaceState.get<boolean>(
					WorkspaceState.ViewsRepositoriesAutoRefresh,
					true
				);
			} else {
				await Container.context.workspaceState.update(
					WorkspaceState.ViewsRepositoriesAutoRefresh,
					workspaceEnabled
				);
			}
		}

		setCommandContext(CommandContext.ViewsRepositoriesAutoRefresh, enabled && workspaceEnabled);

		this._onDidChangeAutoRefresh.fire();
	}

	private setBranchComparison(node: ViewNode, comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (!(node instanceof CompareBranchNode)) return undefined;

		return node.setComparisonType(comparisonType);
	}

	private setBranchesLayout(layout: ViewBranchesLayout) {
		return configuration.updateEffective('views', 'repositories', 'branches', 'layout', layout);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', 'repositories', 'files', 'layout', layout);
	}
}
