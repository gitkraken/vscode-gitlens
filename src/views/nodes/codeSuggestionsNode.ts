import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { PullRequest } from '../../git/models/pullRequest';
import type { ViewsWithCommits } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { MessageNode } from './common';
import { DraftNode } from './draftNode';

export class CodeSuggestionsNode extends CacheableChildrenViewNode<'drafts-code-suggestions', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override parent: ViewNode,
		public readonly repoPath: string,
		private readonly pullRequest: PullRequest,
	) {
		super('drafts-code-suggestions', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const drafts = await this.getSuggestedChanges();

			let children: ViewNode[] | undefined;
			if (drafts?.length) {
				drafts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
				children = drafts.map(d => new DraftNode(this.uri, this.view, this, d));
			}

			if (!children?.length) {
				children = [new MessageNode(this.view, this, 'No code suggestions')];
			}

			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Code Suggestions', TreeItemCollapsibleState.Collapsed);
		item.contextValue = ContextValues.CodeSuggestions;
		return item;
	}

	private async getSuggestedChanges() {
		const repo = this.view.container.git.getRepository(this.repoPath);
		if (repo == null) return [];

		const drafts = await this.view.container.drafts.getCodeSuggestions(this.pullRequest, repo);
		return drafts;
	}
}
