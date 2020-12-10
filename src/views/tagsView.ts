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
import { configuration, TagsViewConfig, ViewBranchesLayout, ViewFilesLayout } from '../configuration';
import { Container } from '../container';
import { GitReference, GitTagReference, RepositoryChange, RepositoryChangeEvent } from '../git/git';
import { GitUri } from '../git/gitUri';
import { RepositoryFolderNode, RepositoryNode, TagsNode, unknownGitUri, ViewNode } from './nodes';
import { debug, gate } from '../system';
import { ViewBase } from './viewBase';
import { BranchOrTagFolderNode } from './nodes/branchOrTagFolderNode';

export class TagsRepositoryNode extends RepositoryFolderNode<TagsView, TagsNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new TagsNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	protected changed(e: RepositoryChangeEvent) {
		return (
			e.changed(RepositoryChange.Config) ||
			e.changed(RepositoryChange.Tags) ||
			e.changed(RepositoryChange.Unknown)
		);
	}
}

export class TagsViewNode extends ViewNode<TagsView> {
	protected splatted = true;
	private children: TagsRepositoryNode[] | undefined;

	constructor(view: TagsView) {
		super(unknownGitUri, view);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = await Container.git.getOrderedRepositories();
			if (repositories.length === 0) {
				this.view.message = 'No tags could be found.';

				return [];
			}

			this.view.message = undefined;

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new TagsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const tags = await child.repo.getTags();
			this.view.title = `Tags (${tags.length})`;

			return child.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Tags', TreeItemCollapsibleState.Expanded);
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

export class TagsView extends ViewBase<TagsViewNode, TagsViewConfig> {
	protected readonly configKey = 'tags';

	constructor() {
		super('gitlens.views.tags', 'Tags');
	}

	getRoot() {
		return new TagsViewNode(this);
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
			!configuration.changed(e, 'sortTagsBy')
		) {
			return false;
		}

		return true;
	}

	findTag(tag: GitTagReference, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(tag.repoPath);

		return this.findNode((n: any) => n.tag?.ref === tag.ref, {
			allowPaging: true,
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof TagsViewNode) return true;

				if (n instanceof TagsRepositoryNode || n instanceof BranchOrTagFolderNode) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			},
			token: token,
		});
	}

	@gate(() => '')
	revealTag(
		tag: GitTagReference,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing ${GitReference.toString(tag, { icon: false })} in the side bar...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findTag(tag, token);
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
