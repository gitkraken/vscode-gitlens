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
	RepositoryNode,
	SubscribeableViewNode,
	unknownGitUri,
	ViewNode,
} from './nodes';
import { debug, gate } from '../system';
import { ViewBase } from './viewBase';

export class BranchesRepositoryNode extends SubscribeableViewNode<BranchesView> {
	protected splatted = true;
	private child: BranchesNode | undefined;

	constructor(
		uri: GitUri,
		view: BranchesView,
		parent: ViewNode,
		public readonly repo: Repository,
		splatted: boolean,
	) {
		super(uri, view, parent);

		this.splatted = splatted;
	}

	get id(): string {
		return RepositoryNode.getId(this.repo.path);
	}

	async getChildren(): Promise<ViewNode[]> {
		void this.ensureSubscription();

		if (this.child == null) {
			this.child = new BranchesNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	getTreeItem(): TreeItem {
		this.splatted = false;
		void this.ensureSubscription();

		const item = new TreeItem(
			this.repo.formattedName ?? this.uri.repoPath ?? '',
			TreeItemCollapsibleState.Expanded,
		);
		item.contextValue = ContextValues.RepositoryFolder;

		return item;
	}

	async getSplattedChild() {
		if (this.child == null) {
			await this.getChildren();
		}

		return this.child;
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

		if (
			e.changed(RepositoryChange.Config) ||
			e.changed(RepositoryChange.Heads) ||
			e.changed(RepositoryChange.Remotes)
		) {
			void this.triggerChange(true);
			// if (this.root) {
			// 	void this.parent?.triggerChange(true);
			// }
		}
	}
}

export class BranchesViewNode extends ViewNode<BranchesView> {
	protected splatted = true;
	private children: BranchesRepositoryNode[] | undefined;

	constructor(view: BranchesView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = await Container.git.getOrderedRepositories();
			if (repositories.length === 0) return [new MessageNode(this.view, this, 'No branches could be found.')];

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new BranchesRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const branches = await child.repo.getBranches({ filter: b => !b.remote });
			this.view.title = `Branches (${branches.length})`;

			return child.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Branches', TreeItemCollapsibleState.Expanded);
		return item;
	}

	async getSplattedChild() {
		if (this.children == null) {
			await this.getChildren();
		}

		return this.children?.length === 1 ? this.children[0] : undefined;
	}

	@gate()
	@debug()
	refresh(reset: boolean = false) {
		if (reset && this.children != null) {
			for (const child of this.children) {
				child.dispose();
			}
			this.children = undefined;
		}
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

	findBranch(branch: GitBranchReference, token?: CancellationToken) {
		if (branch.remote) return undefined;

		const repoNodeId = RepositoryNode.getId(branch.repoPath);

		return this.findNode((n: any) => n.branch?.ref === branch.ref, {
			allowPaging: true,
			maxDepth: 4,
			canTraverse: n => {
				if (n instanceof BranchesViewNode) return true;

				if (n instanceof BranchesRepositoryNode || n instanceof BranchOrTagFolderNode) {
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
		const branches = await Container.git.getCommitBranches(commit.repoPath, commit.ref);
		if (branches.length === 0) return undefined;

		return this.findNode((n: any) => n.commit?.ref === commit.ref, {
			allowPaging: true,
			maxDepth: 5,
			canTraverse: async n => {
				if (n instanceof BranchesViewNode) return true;

				if (n instanceof BranchesRepositoryNode || n instanceof BranchOrTagFolderNode) {
					return n.id.startsWith(repoNodeId);
				}

				if (n instanceof BranchNode && branches.includes(n.branch.name)) {
					await n.showMore({ until: commit.ref });
					return true;
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
				title: `Revealing ${GitReference.toString(branch, { icon: false })} in the side bar...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findBranch(branch, token);
				if (node == null) return undefined;

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
				title: `Revealing ${GitReference.toString(commit, { icon: false })} in the side bar...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findCommit(commit, token);
				if (node == null) return undefined;

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
