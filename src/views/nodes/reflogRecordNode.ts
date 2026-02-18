import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { GlyphChars } from '../../constants.js';
import { GitUri } from '../../git/gitUri.js';
import type { GitLog } from '../../git/models/log.js';
import type { GitReflogRecord } from '../../git/models/reflog.js';
import { gate } from '../../system/decorators/gate.js';
import { trace } from '../../system/decorators/log.js';
import { map } from '../../system/iterable.js';
import type { ViewsWithCommits } from '../viewBase.js';
import type { PageableViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import { CommitNode } from './commitNode.js';
import { LoadMoreNode, MessageNode } from './common.js';

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
			children.push(new LoadMoreNode(this.view, this, children.at(-1)!));
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

	@trace()
	override refresh(reset?: boolean): void {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log === undefined) {
			const range = `${this.record.previousSha}..${this.record.sha}`;
			this._log = await this.view.container.git.getRepositoryService(this.uri.repoPath!).commits.getLog(range, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
			});
		}

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
