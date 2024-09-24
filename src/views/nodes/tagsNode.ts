import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { Repository } from '../../git/models/repository';
import { makeHierarchical } from '../../system/array';
import { debug } from '../../system/decorators/log';
import type { ViewsWithTagsNode } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode';
import { MessageNode } from './common';
import { TagNode } from './tagNode';

export class TagsNode extends CacheableChildrenViewNode<'tags', ViewsWithTagsNode> {
	constructor(
		uri: GitUri,
		view: ViewsWithTagsNode,
		protected override readonly parent: ViewNode,
		public readonly repo: Repository,
	) {
		super('tags', uri, view, parent);

		this.updateContext({ repository: repo });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.repo.path;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const tags = await this.repo.git.getTags({ sort: true });
			if (tags.values.length === 0) return [new MessageNode(this.view, this, 'No tags could be found.')];

			// TODO@eamodio handle paging
			const tagNodes = tags.values.map(
				t => new TagNode(GitUri.fromRepoPath(this.uri.repoPath!, t.ref), this.view, this, t),
			);
			if (this.view.config.branches.layout === 'list') return tagNodes;

			const hierarchy = makeHierarchical(
				tagNodes,
				n => n.tag.name.split('/'),
				(...paths) => paths.join('/'),
				this.view.config.files.compact,
			);

			const root = new BranchOrTagFolderNode(this.view, this, 'tag', hierarchy, this.repo.path, '', undefined);
			this.children = root.getChildren();
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Tags', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Tags;
		item.iconPath = new ThemeIcon('tag');
		return item;
	}

	@debug()
	override refresh() {
		super.refresh(true);
	}
}
