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
import { configuration, HistoryViewConfig, ViewFilesLayout } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import {
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
	CompareBranchNode,
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

export class HistoryRepositoryNode extends SubscribeableViewNode<HistoryView> {
	private children: (BranchNode | CompareBranchNode)[] | undefined;

	constructor(
		uri: GitUri,
		view: HistoryView,
		parent: ViewNode,
		public readonly repo: Repository,
		private readonly root: boolean,
	) {
		super(uri, view, parent);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const branch = await this.repo.getBranch();
			if (branch == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

			this.children = [
				new BranchNode(this.uri, this.view, this, branch, true, {
					expanded: true,
					showCurrent: false,
					showTracking: true,
				}),
			];

			if (this.view.config.showBranchComparison !== false) {
				this.children.push(new CompareBranchNode(this.uri, this.view, this, branch));
			}

			void this.ensureSubscription();
		}
		return this.children;
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
		if (reset) {
			this.children = undefined;
		} else {
			void this.parent?.triggerChange(false);
		}

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

		if (e.changed(RepositoryChange.Index) || e.changed(RepositoryChange.Heads)) {
			void this.triggerChange(true);
			if (this.root) {
				void this.parent?.triggerChange(true);
			}
		}
	}
}

export class HistoryViewNode extends ViewNode<HistoryView> {
	private children: HistoryRepositoryNode[] | undefined;

	constructor(view: HistoryView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children != null) {
			for (const child of this.children) {
				child.dispose();
			}
			this.children = undefined;
		}

		const repositories = await Container.git.getOrderedRepositories();
		if (repositories.length === 0) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const root = repositories.length === 1;
		this.children = repositories.map(
			r => new HistoryRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, root),
		);

		if (root) {
			const [child] = this.children;

			const branch = await child.repo.getBranch();
			const status = branch?.getTrackingStatus();
			this.view.titleContext =
				branch != null ? `${branch.name}${status ? ` ${GlyphChars.Dot} ${status}` : ''}` : undefined;

			return child.getChildren();
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('History', TreeItemCollapsibleState.Expanded);
		return item;
	}
}
export class HistoryView extends ViewBase<HistoryViewNode, HistoryViewConfig> {
	protected readonly configKey = 'history';

	constructor() {
		super('gitlens.views.history', 'History');
	}

	getRoot() {
		return new HistoryViewNode(this);
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
			!configuration.changed(e, 'defaultGravatarsStyle')
		) {
			return false;
		}

		return true;
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.initializing(e)) {
			this.initialize(undefined, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root !== undefined) {
			void this.refresh(true);
		}
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

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', this.configKey, 'files', 'layout', layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
