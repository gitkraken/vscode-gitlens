'use strict';
import { commands, ConfigurationChangeEvent, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { configuration, ContributorsViewConfig, ViewFilesLayout } from '../configuration';
import { Container } from '../container';
import { Repository, RepositoryChange, RepositoryChangeEvent } from '../git/git';
import { GitUri } from '../git/gitUri';
import { ContextValues, ContributorsNode, MessageNode, SubscribeableViewNode, unknownGitUri, ViewNode } from './nodes';
import { debug, gate } from '../system';
import { ViewBase } from './viewBase';

export class ContributorsRepositoryNode extends SubscribeableViewNode<ContributorsView> {
	private child: ContributorsNode | undefined;

	constructor(
		uri: GitUri,
		view: ContributorsView,
		parent: ViewNode,
		public readonly repo: Repository,
		private readonly root: boolean,
	) {
		super(uri, view, parent);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new ContributorsNode(this.uri, this.view, this, this.repo);

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

export class ContributorsViewNode extends ViewNode<ContributorsView> {
	private children: ContributorsRepositoryNode[] | undefined;

	constructor(view: ContributorsView) {
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
		if (repositories.length === 0) return [new MessageNode(this.view, this, 'No contributors could be found.')];

		const root = repositories.length === 1;
		this.children = repositories.map(
			r => new ContributorsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, root),
		);

		if (root) {
			const [child] = this.children;

			const contributors = await child.repo.getContributors();
			this.view.description = contributors.length === 0 ? undefined : `(${contributors.length})`;

			return child.getChildren();
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class ContributorsView extends ViewBase<ContributorsViewNode, ContributorsViewConfig> {
	protected readonly configKey = 'contributors';

	constructor() {
		super('gitlens.views.contributors', 'Contributors');
	}

	getRoot() {
		return new ContributorsViewNode(this);
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

		if (!configuration.initializing(e) && this._root != null) {
			void this.refresh(true);
		}
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', this.configKey, 'files', 'layout', layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
