'use strict';
import { commands, ConfigurationChangeEvent, Event, EventEmitter } from 'vscode';
import { configuration, RepositoriesViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { BranchesNode, BranchNode, RepositoriesNode, RepositoryNode, StashesNode, StashNode, ViewNode } from './nodes';
import { ViewBase } from './viewBase';
import { ViewShowBranchComparison } from '../config';
import { CompareBranchNode } from './nodes/compareBranchNode';
import { GitLogCommit, GitStashCommit } from '../git/git';

const emptyArray = (Object.freeze([]) as any) as any[];

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

	findCommitNode(commit: GitLogCommit | { repoPath: string; ref: string }) {
		const repoNodeId = RepositoryNode.getId(commit.repoPath);

		return this.findNode((n: any) => n.commit !== undefined && n.commit.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 2,
			getChildren: async n => {
				// Only search for commit nodes in the same repo within the root BranchNode
				if (n.id != null && n.id.startsWith(`gitlens${RepositoryNode.key}`)) {
					if (!n.id.startsWith(repoNodeId)) return emptyArray;

					if (n instanceof BranchNode) {
						if (!n.root) return emptyArray;
					} else if (!(n instanceof RepositoryNode) && !(n instanceof BranchesNode)) {
						return emptyArray;
					}
				}

				return n.getChildren();
			}
		});
	}

	findStashNode(stash: GitStashCommit | { repoPath: string; ref: string }) {
		const repoNodeId = RepositoryNode.getId(stash.repoPath);

		return this.findNode(StashNode.getId(stash.repoPath, stash.ref), {
			maxDepth: 2,
			getChildren: async n => {
				// Only search for stash nodes in the same repo within a StashesNode
				if (n.id != null && n.id.startsWith(`gitlens${RepositoryNode.key}`)) {
					if (!n.id.startsWith(repoNodeId)) return emptyArray;

					if (!(n instanceof RepositoryNode) && !(n instanceof StashesNode)) {
						return emptyArray;
					}
				}

				return n.getChildren();
			}
		});
	}

	async revealCommit(
		commit: GitLogCommit | { repoPath: string; ref: string },
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		}
	) {
		const node = await this.findCommitNode(commit);
		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	async revealStash(
		stash: GitStashCommit | { repoPath: string; ref: string },
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		}
	) {
		const node = await this.findStashNode(stash);
		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

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
			getChildren: async n => {
				// Only search for nodes in the same repo
				if (n.id != null && n.id.startsWith(`gitlens${RepositoryNode.key}`)) {
					if (!n.id.startsWith(repoNodeId)) return emptyArray;

					if (!(n instanceof RepositoryNode)) {
						return emptyArray;
					}
				}

				return n.getChildren();
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

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', 'repositories', 'files', 'layout', layout);
	}
}
