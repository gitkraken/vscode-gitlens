'use strict';
import {
	CancellationToken,
	commands,
	ConfigurationChangeEvent,
	ProgressLocation,
	TreeItem,
	TreeItemCollapsibleState,
	window,
} from 'vscode';
import { BranchesViewConfig, configuration, ViewBranchesLayout, ViewFilesLayout } from '../configuration';
import { Container } from '../container';
import {
	GitBranch,
	GitBranchReference,
	GitLogCommit,
	GitReference,
	GitRevisionReference,
	Repository,
	RepositoryChange,
	RepositoryChangeEvent,
} from '../git/git';
import { GitUri } from '../git/gitUri';
import {
	BranchesNode,
	BranchNode,
	BranchOrTagFolderNode,
	ContextValues,
	MessageNode,
	RemoteNode,
	RemotesNode,
	RepositoriesNode,
	RepositoryNode,
	SubscribeableViewNode,
	unknownGitUri,
	ViewNode,
} from './nodes';
import { debug, gate } from '../system';
import { ViewBase } from './viewBase';

export class BranchesRepositoryNode extends SubscribeableViewNode<BranchesView> {
	private child: BranchesNode | undefined;

	constructor(
		uri: GitUri,
		view: BranchesView,
		parent: ViewNode,
		public readonly repo: Repository,
		private readonly root: boolean,
	) {
		super(uri, view, parent);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new BranchesNode(this.uri, this.view, this, this.repo);

			void this.ensureSubscription();
		}
		return this.child.getChildren();
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			this.repo.formattedName ?? this.uri.repoPath ?? '',
			TreeItemCollapsibleState.Expanded,
		);
		item.contextValue = ContextValues.RepositoryFolder;

		void this.ensureSubscription();

		return item;
	}

	@gate()
	@debug()
	async refresh(reset: boolean = false) {
		await this.child?.triggerChange(reset);

		await this.ensureSubscription();
	}

	@debug()
	protected subscribe() {
		return this.repo.onDidChange(this.onRepositoryChanged, this);
	}

	@debug({
		args: {
			0: (e: RepositoryChangeEvent) =>
				`{ repository: ${e.repository ? e.repository.name : ''}, changes: ${e.changes.join()} }`,
		},
	})
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Closed)) {
			this.dispose();
			void this.parent?.triggerChange(true);

			return;
		}

		if (e.changed(RepositoryChange.Heads)) {
			void this.triggerChange(true);
			if (this.root) {
				void this.parent?.triggerChange(true);
			}
		}
	}
}

export class BranchesViewNode extends ViewNode<BranchesView> {
	private children: BranchesRepositoryNode[] | undefined;

	constructor(view: BranchesView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children != null) {
			for (const child of this.children) {
				child.dispose?.();
			}
			this.children = undefined;
		}

		const repositories = await Container.git.getOrderedRepositories();
		if (repositories.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

		const root = repositories.length === 1;
		this.children = repositories.map(
			r => new BranchesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, root),
		);

		if (root) {
			const [child] = this.children;

			const branches = await child.repo.getBranches({ filter: b => !b.remote });
			this.view.description = branches.length === 0 ? undefined : `(${branches.length})`;

			return child.getChildren();
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Branches', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class BranchesView extends ViewBase<BranchesViewNode, BranchesViewConfig> {
	protected readonly configKey = 'branches';

	constructor() {
		super('gitlens.views.branches', 'Branches');
	}

	getRoot() {
		return new BranchesViewNode(this);
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setLayoutToList'),
			() => this.setLayout(ViewBranchesLayout.List),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setLayoutToTree'),
			() => this.setLayout(ViewBranchesLayout.Tree),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToAuto'),
			() => this.setFilesLayout(ViewFilesLayout.Auto),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToList'),
			() => this.setFilesLayout(ViewFilesLayout.List),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToTree'),
			() => this.setFilesLayout(ViewFilesLayout.Tree),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this);
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'sortBranchesBy')
		) {
			return false;
		}

		return true;
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.initializing(e)) {
			this.initialize(undefined, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root != null) {
			void this.refresh(true);
		}
	}

	findBranch(branch: GitBranchReference, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(branch.repoPath);

		if (branch.remote) {
			return this.findNode((n: any) => n.branch !== undefined && n.branch.ref === branch.ref, {
				allowPaging: true,
				maxDepth: 6,
				canTraverse: n => {
					// Only search for branch nodes in the same repo within BranchesNode
					if (n instanceof RepositoriesNode) return true;

					if (n instanceof RemoteNode) {
						if (!n.id.startsWith(repoNodeId)) return false;

						return branch.remote && n.remote.name === GitBranch.getRemote(branch.name); //branch.getRemoteName();
					}

					if (
						n instanceof RepositoryNode ||
						n instanceof BranchesNode ||
						n instanceof RemotesNode ||
						n instanceof BranchOrTagFolderNode
					) {
						return n.id.startsWith(repoNodeId);
					}

					return false;
				},
				token: token,
			});
		}

		return this.findNode((n: any) => n.branch !== undefined && n.branch.ref === branch.ref, {
			allowPaging: true,
			maxDepth: 5,
			canTraverse: n => {
				// Only search for branch nodes in the same repo within BranchesNode
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RepositoryNode || n instanceof BranchesNode || n instanceof BranchOrTagFolderNode) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			},
			token: token,
		});
	}

	async findCommit(commit: GitLogCommit | { repoPath: string; ref: string }, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(commit.repoPath);

		// Get all the branches the commit is on
		let branches = await Container.git.getCommitBranches(commit.repoPath, commit.ref);
		if (branches.length !== 0) {
			return this.findNode((n: any) => n.commit !== undefined && n.commit.ref === commit.ref, {
				allowPaging: true,
				maxDepth: 6,
				canTraverse: async n => {
					// Only search for commit nodes in the same repo within BranchNodes
					if (n instanceof RepositoriesNode) return true;

					if (n instanceof BranchNode) {
						if (n.id.startsWith(repoNodeId) && branches.includes(n.branch.name)) {
							await n.showMore({ until: commit.ref });
							return true;
						}
					}

					if (
						n instanceof RepositoryNode ||
						n instanceof BranchesNode ||
						n instanceof BranchOrTagFolderNode
					) {
						return n.id.startsWith(repoNodeId);
					}

					return false;
				},
				token: token,
			});
		}

		// If we didn't find the commit on any local branches, check remote branches
		branches = await Container.git.getCommitBranches(commit.repoPath, commit.ref, { remotes: true });
		if (branches.length === 0) return undefined;

		const remotes = branches.map(b => b.split('/', 1)[0]);

		return this.findNode((n: any) => n.commit !== undefined && n.commit.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 8,
			canTraverse: n => {
				// Only search for commit nodes in the same repo within BranchNodes
				if (n instanceof RepositoriesNode) return true;

				if (n instanceof RemoteNode) {
					return n.id.startsWith(repoNodeId) && remotes.includes(n.remote.name);
				}

				if (n instanceof BranchNode) {
					return n.id.startsWith(repoNodeId) && branches.includes(n.branch.name);
				}

				if (n instanceof RepositoryNode || n instanceof RemotesNode || n instanceof BranchOrTagFolderNode) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			},
			token: token,
		});
	}

	@gate(() => '')
	revealBranch(
		branch: GitBranchReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${GitReference.toString(branch, { icon: false })} in the Repositories view...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findBranch(branch, token);
				if (node === undefined) return node;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	@gate(() => '')
	async revealCommit(
		commit: GitRevisionReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${GitReference.toString(commit, { icon: false })} in the Repositories view...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findCommit(commit, token);
				if (node === undefined) return node;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	private setLayout(layout: ViewBranchesLayout) {
		return configuration.updateEffective('views', this.configKey, 'branches', 'layout', layout);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', this.configKey, 'files', 'layout', layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
