'use strict';
import { commands, ConfigurationChangeEvent, Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Avatars } from '../avatars';
import { configuration, ContributorsViewConfig, ViewFilesLayout } from '../configuration';
import { Container } from '../container';
import { RepositoryChange, RepositoryChangeEvent } from '../git/git';
import { GitUri } from '../git/gitUri';
import { ContributorsNode, RepositoryFolderNode, unknownGitUri, ViewNode } from './nodes';
import { debug, gate } from '../system';
import { ViewBase } from './viewBase';

export class ContributorsRepositoryNode extends RepositoryFolderNode<ContributorsView, ContributorsNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new ContributorsNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	@debug()
	protected subscribe() {
		return Disposable.from(
			super.subscribe(),
			Avatars.onDidFetch(e => this.child?.updateAvatar(e.email)),
		);
	}

	protected changed(e: RepositoryChangeEvent) {
		return (
			e.changed(RepositoryChange.Config) ||
			e.changed(RepositoryChange.Heads) ||
			e.changed(RepositoryChange.Remotes) ||
			e.changed(RepositoryChange.Unknown)
		);
	}
}

export class ContributorsViewNode extends ViewNode<ContributorsView> {
	protected splatted = true;
	private children: ContributorsRepositoryNode[] | undefined;

	constructor(view: ContributorsView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = await Container.git.getOrderedRepositories();
			if (repositories.length === 0) {
				this.view.message = 'No contributors could be found.';

				return [];
			}

			this.view.message = undefined;

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new ContributorsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const contributors = await child.repo.getContributors();
			this.view.title = `Contributors (${contributors.length})`;

			return child.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Expanded);
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

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', this.configKey, 'files', 'layout', layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
