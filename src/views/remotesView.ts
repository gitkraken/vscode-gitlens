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
import { configuration, RemotesViewConfig, ViewBranchesLayout, ViewFilesLayout } from '../configuration';
import { Container } from '../container';
import {
	GitBranch,
	GitBranchReference,
	GitReference,
	Repository,
	RepositoryChange,
	RepositoryChangeEvent,
} from '../git/git';
import { GitUri } from '../git/gitUri';
import {
	BranchesNode,
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

export class RemotesRepositoryNode extends SubscribeableViewNode<RemotesView> {
	private child: RemotesNode | undefined;

	constructor(
		uri: GitUri,
		view: RemotesView,
		parent: ViewNode,
		public readonly repo: Repository,
		private readonly root: boolean,
	) {
		super(uri, view, parent);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new RemotesNode(this.uri, this.view, this, this.repo);

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

		if (e.changed(RepositoryChange.Remotes)) {
			void this.triggerChange(true);
			if (this.root) {
				void this.parent?.triggerChange(true);
			}
		}
	}
}

export class RemotesViewNode extends ViewNode<RemotesView> {
	private children: RemotesRepositoryNode[] | undefined;

	constructor(view: RemotesView) {
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
		if (repositories.length === 0) return [new MessageNode(this.view, this, 'No remotes could be found.')];

		const root = repositories.length === 1;
		this.children = repositories.map(
			r => new RemotesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, root),
		);

		if (root) {
			const [child] = this.children;

			const remotes = await child.repo.getRemotes();
			this.view.description = remotes.length === 0 ? undefined : `(${remotes.length})`;

			return child.getChildren();
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Remotes', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class RemotesView extends ViewBase<RemotesViewNode, RemotesViewConfig> {
	protected readonly configKey = 'remotes';

	constructor() {
		super('gitlens.views.remotes', 'Remotes');
	}

	getRoot() {
		return new RemotesViewNode(this);
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
		if (!branch.remote) return undefined;

		const repoNodeId = RepositoryNode.getId(branch.repoPath);

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
