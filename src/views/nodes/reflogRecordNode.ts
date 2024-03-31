import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { GlyphChars } from '../../constants';
import { GitUri } from '../../git/gitUri';
import type { GitLog } from '../../git/models/log';
import type { GitReflogRecord } from '../../git/models/reflog';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import type { ViewsWithCommits } from '../viewBase';
import type { PageableViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';

export class ReflogRecordNode extends ViewNode<'reflog-record', ViewsWithCommits> implements PageableViewNode {
	limit: number | undefined;

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly record: GitReflogRecord,
	) {
		super('reflog-record', GitUri.fromRepoPath(record.repoPath), view, parent);

		this.updateContext({ reflog: record });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (log === undefined) return [new MessageNode(this.view, this, 'No commits could be found.')];

		const children: (CommitNode | LoadMoreNode)[] = [
			...map(log.commits.values(), c => new CommitNode(this.view, this, c)),
		];

		if (log.hasMore) {
			children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
		}
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.record.command}${this.record.commandArgs ? ` ${this.record.commandArgs}` : ''}`,
			TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.description = `${
			this.record.HEAD.length === 0
				? ''
				: `${this.record.HEAD} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} `
		}${this.record.formattedDate}`;
		item.contextValue = ContextValues.ReflogRecord;
		item.tooltip = `${this.record.HEAD.length === 0 ? '' : `${this.record.HEAD}\n`}${this.record.command}${
			this.record.commandArgs ? ` ${this.record.commandArgs}` : ''
		}${
			this.record.details ? ` (${this.record.details})` : ''
		}\n${this.record.formatDateFromNow()} (${this.record.formatDate()})\n${this.record.previousShortSha} ${
			GlyphChars.Space
		}${GlyphChars.ArrowRight}${GlyphChars.Space} ${this.record.shortSha}`;

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
		if (this._log === undefined) {
			const range = `${this.record.previousSha}..${this.record.sha}`;
			this._log = await this.view.container.git.getLog(this.uri.repoPath!, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: range,
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
