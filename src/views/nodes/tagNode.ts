import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { GlyphChars } from '../../constants';
import { emojify } from '../../emojis';
import type { GitUri } from '../../git/gitUri';
import type { GitLog } from '../../git/models/log';
import type { GitTagReference } from '../../git/models/reference';
import { shortenRevision } from '../../git/models/revision.utils';
import type { GitTag } from '../../git/models/tag';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import { pad } from '../../system/string';
import type { ViewsWithTags } from '../viewBase';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ViewRefNode } from './abstract/viewRefNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { insertDateMarkers } from './helpers';

export class TagNode extends ViewRefNode<'tag', ViewsWithTags, GitTagReference> implements PageableViewNode {
	limit: number | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithTags,
		public override parent: ViewNode,
		public readonly tag: GitTag,
	) {
		super('tag', uri, view, parent);

		this.updateContext({ tag: tag });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.tag.name;
	}

	get label(): string {
		return this.view.config.branches.layout === 'tree' ? this.tag.getBasename() : this.tag.name;
	}

	get ref(): GitTagReference {
		return this.tag;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await this.view.container.git.getBranchesAndTagsTipsLookup(
			this.uri.repoPath,
			this.tag.name,
		);
		const children = [
			...insertDateMarkers(
				map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, undefined, getBranchAndTagTips),
				),
				this,
			),
		];

		if (log.hasMore) {
			children.push(
				new LoadMoreNode(this.view, this, children[children.length - 1], {
					getCount: () => this.view.container.git.getCommitCount(this.tag.repoPath, this.tag.name),
				}),
			);
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.Tag;
		item.description = emojify(this.tag.message);
		item.tooltip = `${this.tag.name}${pad(GlyphChars.Dash, 2, 2)}${shortenRevision(this.tag.sha, {
			force: true,
		})}${
			this.tag.date != null
				? `\n${this.tag.formatDateFromNow()} (${this.tag.formatDate(
						this.view.container.TagDateFormatting.dateFormat,
				  )})`
				: ''
		}\n\n${emojify(this.tag.message)}${
			this.tag.commitDate != null && this.tag.date !== this.tag.commitDate
				? `\n${this.tag.formatCommitDateFromNow()} (${this.tag.formatCommitDate(
						this.view.container.TagDateFormatting.dateFormat,
				  )})`
				: ''
		}`;

		return item;
	}

	@gate()
	@debug()
	override refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log == null) {
			this._log = await this.view.container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.tag.name,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }) {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (!log?.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		void this.triggerChange(false);
	}
}
