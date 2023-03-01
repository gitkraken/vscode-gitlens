import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../config';
import { GitUri } from '../../git/gitUri';
import type { GitDiffShortStat } from '../../git/models/diff';
import type { GitFile } from '../../git/models/file';
import { makeHierarchical } from '../../system/array';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { map } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import { cancellable, PromiseCancelledError } from '../../system/promise';
import { pluralize, sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { ResultsFileNode } from './resultsFileNode';
import { ContextValues, ViewNode } from './viewNode';

export enum FilesQueryFilter {
	Left = 0,
	Right = 1,
}

export interface FilesQueryResults {
	label: string;
	files: GitFile[] | undefined;
	stats?: (GitDiffShortStat & { approximated?: boolean }) | undefined;

	filtered?: Map<FilesQueryFilter, GitFile[]>;
}

export class ResultsFilesNode extends ViewNode<ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override parent: ViewNode,
		public readonly repoPath: string,
		public readonly ref1: string,
		public readonly ref2: string,
		private readonly _filesQuery: () => Promise<FilesQueryResults>,
		private readonly direction: 'ahead' | 'behind' | undefined,
		private readonly _options: {
			expand?: boolean;
		} = {},
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._options = { expand: true, ..._options };
	}

	override get id(): string {
		return `${this.parent.id}:results:files`;
	}

	get filter(): FilesQueryFilter | undefined {
		return this.view.nodeState.getState<FilesQueryFilter>(this.id, 'filter');
	}
	set filter(value: FilesQueryFilter | undefined) {
		if (this.filter === value) return;

		this.view.nodeState.storeState(this.id, 'filter', value);
		this._filterResults = undefined;

		void this.triggerChange(false);
	}

	get filterable(): boolean {
		return this.filter != null || (this.ref1 !== this.ref2 && this.direction === undefined);
	}

	private getFilterContextValue(): string {
		switch (this.filter) {
			case FilesQueryFilter.Left:
				return '+filtered~left';
			case FilesQueryFilter.Right:
				return '+filtered~right';
			default:
				return '';
		}
	}

	async getChildren(): Promise<ViewNode[]> {
		const results = await this.getFilesQueryResults();
		const files = (this.filter != null ? results.filtered?.get(this.filter) : undefined) ?? results.files;
		if (files == null) return [];

		let children: FileNode[] = [
			...map(
				files,
				s => new ResultsFileNode(this.view, this, this.repoPath, s, this.ref1, this.ref2, this.direction),
			),
		];

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => a.priority - b.priority || sortCompare(a.label!, b.label!));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let label;
		let description;
		let icon;
		let files: GitFile[] | undefined;
		let state;
		let tooltip;

		const filter = this.filter;
		try {
			const results = await cancellable(this.getFilesQueryResults(), 100);
			label = results.label;
			if (filter == null && results.stats != null) {
				description = `${pluralize('addition', results.stats.additions)} (+), ${pluralize(
					'deletion',
					results.stats.deletions,
				)} (-)${results.stats.approximated ? ' *approximated' : ''}`;
				tooltip = `${label}, ${description}`;
			}

			if (filter != null) {
				description = 'Filtered';
				tooltip = `${label} &mdash; ${description}`;
				files = results.filtered?.get(filter);
				if (files == null) {
					label = 'files changed';
					icon = new ThemeIcon('ellipsis');
					// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
					// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
					state = TreeItemCollapsibleState.Collapsed;

					void this._filterResults?.then(() => queueMicrotask(() => this.triggerChange(false)));
				}
			} else {
				files = results.files;
			}

			if (state === undefined) {
				state =
					files == null || files.length === 0
						? TreeItemCollapsibleState.None
						: this._options.expand
						? TreeItemCollapsibleState.Expanded
						: TreeItemCollapsibleState.Collapsed;
			}
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) {
				void ex.promise.then(() => queueMicrotask(() => this.triggerChange(false)));
			}

			label = 'files changed';
			icon = new ThemeIcon('ellipsis');
			// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
			// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
			state = TreeItemCollapsibleState.Collapsed;
		}

		const item = new TreeItem(
			`${filter != null && files != null ? `Showing ${files.length} of ` : ''}${label}`,
			state,
		);
		item.description = description;
		item.id = this.id;
		item.iconPath = icon;
		item.contextValue = `${ContextValues.ResultsFiles}${
			this.filterable ? '+filterable' : ''
		}${this.getFilterContextValue()}`;
		item.tooltip = tooltip;

		return item;
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		if (!reset) return;

		this.view.nodeState.deleteState(this.id, 'filter');

		this._filterResults = undefined;
		this._filesQueryResults = this._filesQuery();
	}

	private _filesQueryResults: Promise<FilesQueryResults> | undefined;
	private _filterResults: Promise<void> | undefined;

	async getFilesQueryResults() {
		if (this._filesQueryResults === undefined) {
			this._filesQueryResults = this._filesQuery();
		}

		const results = await this._filesQueryResults;
		if (
			results.files == null ||
			!this.filterable ||
			this.filter == null ||
			results.filtered?.get(this.filter) != null
		) {
			return results;
		}

		if (this._filterResults === undefined) {
			this._filterResults = this.filterResults(this.filter, results);
		}

		await this._filterResults;

		return results;
	}

	private async filterResults(filter: FilesQueryFilter, results: FilesQueryResults) {
		let filterTo: Set<string> | undefined;

		const ref = this.filter === FilesQueryFilter.Left ? this.ref2 : this.ref1;

		const mergeBase = await this.view.container.git.getMergeBase(
			this.repoPath,
			this.ref1 || 'HEAD',
			this.ref2 || 'HEAD',
		);
		if (mergeBase != null) {
			const files = await this.view.container.git.getDiffStatus(this.uri.repoPath!, `${mergeBase}..${ref}`);
			if (files != null) {
				filterTo = new Set<string>(files.map(f => f.path));
			}
		} else {
			const commit = await this.view.container.git.getCommit(this.uri.repoPath!, ref || 'HEAD');
			if (commit?.files != null) {
				filterTo = new Set<string>(commit.files.map(f => f.path));
			}
		}

		if (results.filtered == null) {
			results.filtered = new Map();
		}
		results.filtered.set(filter, filterTo == null ? [] : results.files!.filter(f => filterTo!.has(f.path)));
	}
}
