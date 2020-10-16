'use strict';
import { ThemeIcon, TreeItem } from 'vscode';
import { executeGitCommand } from '../../commands';
import { Container } from '../../container';
import { GitLog, SearchPattern } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { RepositoryNode } from './repositoryNode';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { SearchAndCompareView } from '../searchAndCompareView';
import { debug, gate, log, Strings } from '../../system';
import { ContextValues, PageableViewNode, ViewNode } from './viewNode';

let instanceId = 0;

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchResultsNode extends ViewNode<SearchAndCompareView> implements PageableViewNode {
	static key = ':search-results';
	static getId(repoPath: string, search: SearchPattern | undefined, instanceId: number): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${
			search == null ? '?' : SearchPattern.toKey(search)
		}):${instanceId}`;
	}

	static getPinnableId(repoPath: string, search: SearchPattern) {
		return Strings.sha1(`${repoPath}|${SearchPattern.toKey(search)}`);
	}

	static is(node: any): node is SearchResultsNode {
		return node instanceof SearchResultsNode;
	}

	private _instanceId: number;
	constructor(
		view: SearchAndCompareView,
		parent: ViewNode,
		public readonly repoPath: string,
		search: SearchPattern,
		private _labels: {
			label: string;
			queryLabel:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			resultsType?: { singular: string; plural: string };
		},
		private _searchQueryOrLog?:
			| ((limit: number | undefined) => Promise<CommitsQueryResults>)
			| Promise<GitLog | undefined>
			| GitLog
			| undefined,
		private _pinned: number = 0,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._search = search;
		this._instanceId = instanceId++;
		this._order = Date.now();
	}

	get id(): string {
		return SearchResultsNode.getId(this.repoPath, this.search, this._instanceId);
	}

	get canDismiss(): boolean {
		return !this.pinned;
	}

	private readonly _order: number = Date.now();
	get order(): number {
		return this._pinned || this._order;
	}

	get pinned(): boolean {
		return this._pinned !== 0;
	}

	private _search: SearchPattern;
	get search(): SearchPattern {
		return this._search;
	}

	private _resultsNode: ResultsCommitsNode | undefined;
	private ensureResults() {
		if (this._resultsNode == null) {
			let deferred;
			if (this._searchQueryOrLog == null) {
				deferred = true;
				this._searchQueryOrLog = this.getSearchQuery({
					label: this._labels.queryLabel,
				});
			} else if (typeof this._searchQueryOrLog !== 'function') {
				this._searchQueryOrLog = this.getSearchQuery(
					{
						label: this._labels.queryLabel,
					},
					this._searchQueryOrLog,
				);
			}

			this._resultsNode = new ResultsCommitsNode(
				this.view,
				this,
				this.repoPath,
				this._labels.label,
				{
					query: this._searchQueryOrLog,
					deferred: deferred,
				},
				{
					expand: !this.pinned,
				},
				true,
			);
		}

		return this._resultsNode;
	}

	async getChildren(): Promise<ViewNode[]> {
		return this.ensureResults().getChildren();
	}

	async getTreeItem(): Promise<TreeItem> {
		const item = await this.ensureResults().getTreeItem();
		item.contextValue = `${ContextValues.SearchResults}${this._pinned ? '+pinned' : ''}`;
		if ((await Container.git.getRepositoryCount()) > 1) {
			const repo = await Container.git.getRepository(this.repoPath);
			item.description = repo?.formattedName ?? this.repoPath;
		}
		if (this._pinned) {
			item.iconPath = new ThemeIcon('pinned');
		}

		// if (item.collapsibleState === TreeItemCollapsibleState.None) {
		// 	const args: SearchCommitsCommandArgs = {
		// 		search: this.search,
		// 		prefillOnly: true,
		// 		showResultsInSideBar: true,
		// 	};
		// 	item.command = {
		// 		title: 'Search Commits',
		// 		command: Commands.SearchCommitsInView,
		// 		arguments: [args],
		// 	};
		// }

		return item;
	}

	get hasMore() {
		return this.ensureResults().hasMore;
	}

	async loadMore(limit?: number) {
		return this.ensureResults().loadMore(limit);
	}

	async edit(search?: {
		pattern: SearchPattern;
		labels: {
			label: string;
			queryLabel:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			resultsType?: { singular: string; plural: string };
		};
		log: Promise<GitLog | undefined> | GitLog | undefined;
	}) {
		if (search == null) {
			void (await executeGitCommand({
				command: 'search',
				prefillOnly: true,
				state: {
					repo: this.repoPath,
					...this.search,
					showResultsInSideBar: this,
				},
			}));

			return;
		}

		this._search = search.pattern;
		this._labels = search.labels;
		this._searchQueryOrLog = search.log;
		this._resultsNode = undefined;

		void this.triggerChange(false);
	}

	@gate()
	@debug()
	refresh(reset: boolean = false) {
		this._resultsNode?.refresh(reset);
	}

	@log()
	async pin() {
		if (this.pinned) return;

		this._pinned = Date.now();
		await this.view.updatePinned(this.getPinnableId(), {
			type: 'search',
			timestamp: this._pinned,
			path: this.repoPath,
			labels: this._labels,
			search: this.search,
		});
		setImmediate(() => this.view.reveal(this, { focus: true, select: true }));
	}

	@log()
	async unpin() {
		if (!this.pinned) return;

		this._pinned = 0;
		await this.view.updatePinned(this.getPinnableId());
		setImmediate(() => this.view.reveal(this, { focus: true, select: true }));
	}

	private getPinnableId() {
		return SearchResultsNode.getPinnableId(this.repoPath, this.search);
	}

	private getSearchLabel(
		label:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  },
		log: GitLog | undefined,
	): string {
		if (typeof label === 'string') return label;

		const count = log?.count ?? 0;

		const resultsType =
			label.resultsType === undefined ? { singular: 'result', plural: 'results' } : label.resultsType;

		return `${Strings.pluralize(resultsType.singular, count, {
			number: log?.hasMore ?? false ? `${count}+` : undefined,
			plural: resultsType.plural,
			zero: 'No',
		})} ${label.label}`;
	}

	private getSearchQuery(
		options: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
		},
		log?: Promise<GitLog | undefined> | GitLog,
	): (limit: number | undefined) => Promise<SearchQueryResults> {
		let useCacheOnce = true;

		return async (limit: number | undefined) => {
			log = await (log ?? Container.git.getLogForSearch(this.repoPath, this.search));

			if (!useCacheOnce && log != null && log.query != null) {
				log = await log.query(limit);
			}
			useCacheOnce = false;

			const results: Mutable<SearchQueryResults> = {
				label: this.getSearchLabel(options.label, log),
				log: log,
				hasMore: log?.hasMore ?? false,
			};
			if (results.hasMore) {
				results.more = async (limit: number | undefined) => {
					results.log = (await results.log?.more?.(limit)) ?? results.log;

					results.label = this.getSearchLabel(options.label, results.log);
					results.hasMore = results.log?.hasMore ?? true;
				};
			}

			return results;
		};
	}
}
