'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitLog, GitUri } from '../../git/gitService';
import { debug, gate, Iterables, Promises } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitNode } from './commitNode';
import { ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, ViewNode } from './viewNode';

export interface CommitsQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class ResultsCommitsNode extends ViewNode<ViewWithFiles> implements PageableViewNode {
	constructor(
		view: ViewWithFiles,
		parent: ViewNode,
		public readonly repoPath: string,
		private _label: string,
		private readonly _commitsQuery: (limit: number | undefined) => Promise<CommitsQueryResults>,
		private readonly _options: { expand?: boolean; includeDescription?: boolean } = {}
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._options = { expand: true, includeDescription: true, ..._options };
	}

	get id(): string {
		return `${this.parent!.id}:results:commits`;
	}

	get type(): ResourceType {
		return ResourceType.ResultsCommits;
	}

	async getChildren(): Promise<ViewNode[]> {
		const { log } = await this.getCommitsQueryResults();
		if (log === undefined) return [];

		const options = { expand: this._options.expand && log.count === 1 };

		const getBranchAndTagTips = await Container.git.getBranchesAndTagsTipsFn(this.uri.repoPath);
		const children = [
			...insertDateMarkers(
				Iterables.map(
					log.commits.values(),
					c => new CommitNode(this.view, this, c, undefined, getBranchAndTagTips, options)
				),
				this,
				undefined,
				{ show: log.count > 1 }
			)
		];

		if (log.hasMore) {
			children.push(new ShowMoreNode(this.view, this, 'Results', children[children.length - 1]));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let label;
		let log;
		let state;

		try {
			({ label, log } = await Promises.timeout(this.getCommitsQueryResults(), 100));
			state =
				log == null || log.count === 0
					? TreeItemCollapsibleState.None
					: this._options.expand || log.count === 1
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed;
		} catch (ex) {
			if (ex instanceof Promises.TimeoutError) {
				ex.promise.then(() => this.triggerChange(false));
			}

			// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
			// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
			state = TreeItemCollapsibleState.Collapsed;
		}

		let description;
		if (this._options.includeDescription && (await Container.git.getRepositoryCount()) > 1) {
			const repo = await Container.git.getRepository(this.repoPath);
			description = (repo && repo.formattedName) || this.repoPath;
		}

		const item = new TreeItem(label || this._label, state);
		item.contextValue = this.type;
		item.description = description;
		item.id = this.id;

		return item;
	}

	@gate()
	@debug()
	refresh(reset: boolean = false) {
		if (reset) {
			this._commitsQueryResults = undefined;
			void this.getCommitsQueryResults();
		}
	}

	private _commitsQueryResults: Promise<CommitsQueryResults> | undefined;
	private async getCommitsQueryResults() {
		if (this._commitsQueryResults === undefined) {
			this._commitsQueryResults = this._commitsQuery(this.limit ?? Container.config.advanced.maxSearchItems);
			const results = await this._commitsQueryResults;
			this._hasMore = results.hasMore;
		}

		return this._commitsQueryResults;
	}

	private _hasMore = true;
	get hasMore() {
		return this._hasMore;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async showMore(limit?: number) {
		const results = await this.getCommitsQueryResults();
		if (results === undefined || !results.hasMore) return;

		await results.more?.(limit ?? this.view.config.pageItemLimit);

		this.limit = results.log?.count;
		this.triggerChange(false);
	}
}
