import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitTagReference } from '@gitlens/git/models/reference.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { map } from '@gitlens/utils/iterable.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../constants.js';
import { emojify } from '../../emojis.js';
import type { GitUri } from '../../git/gitUri.js';
import { gate } from '../../system/decorators/gate.js';
import type { ViewsWithTags } from '../viewBase.js';
import type { PageableViewNode, ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { ViewRefNode } from './abstract/viewRefNode.js';
import { CommitNode } from './commitNode.js';
import { LoadMoreNode, MessageNode } from './common.js';
import { insertDateMarkers } from './utils/-webview/node.utils.js';

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
		return this.view.config.branches.layout === 'tree' ? this.tag.basename : this.tag.name;
	}

	get ref(): GitTagReference {
		return this.tag;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log == null) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const getBranchAndTagTips = await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.getBranchesAndTagsTipsLookup(this.tag.name);
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
				new LoadMoreNode(this.view, this, children.at(-1)!, {
					getCount: () =>
						this.view.container.git
							.getRepositoryService(this.tag.repoPath)
							.commits.getCommitCount(this.tag.name),
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
		item.tooltip = `${this.tag.name}${pad(GlyphChars.Dash, 2, 2)}${shortenRevision(this.tag.sha)}${
			this.tag.date != null
				? `\n${GitTag.formatDateFromNow(this.tag)} (${GitTag.formatDate(
						this.tag,
						this.view.container.TagDateFormatting.dateFormat,
					)})`
				: ''
		}\n\n${emojify(this.tag.message)}${
			this.tag.commitDate != null && this.tag.date !== this.tag.commitDate
				? `\n${GitTag.formatCommitDateFromNow(this.tag)} (${GitTag.formatCommitDate(
						this.tag,
						this.view.container.TagDateFormatting.dateFormat,
					)})`
				: ''
		}`;

		return item;
	}

	@trace()
	override refresh(reset?: boolean): void {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		this._log ??= await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.commits.getLog(this.tag.name, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
			});

		return this._log;
	}

	get hasMore(): boolean {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }): Promise<void> {
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
