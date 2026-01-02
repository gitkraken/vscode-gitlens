import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri.js';
import type { Repository } from '../../git/models/repository.js';
import { makeHierarchical } from '../../system/array.js';
import type { ViewsWithTagsNode } from '../viewBase.js';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { BranchOrTagFolderNode } from './branchOrTagFolderNode.js';
import { MessageNode } from './common.js';
import { TagNode } from './tagNode.js';

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
			const tags = await this.repo.git.tags.getTags({ sort: true });
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
				this.view.config.branches.compact,
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
}
