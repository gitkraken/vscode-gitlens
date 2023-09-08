import type { Disposable, TreeCheckboxChangeEvent } from 'vscode';
import { ThemeIcon, TreeItem, TreeItemCheckboxState, TreeItemCollapsibleState, window } from 'vscode';
import { md5 } from '@env/crypto';
import type { StoredNamedRef } from '../../constants';
import { GitUri } from '../../git/gitUri';
import { createRevisionRange, shortenRevision } from '../../git/models/reference';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { getSettledValue } from '../../system/promise';
import { pluralize } from '../../system/string';
import type { SearchAndCompareView } from '../searchAndCompareView';
import type { View } from '../viewBase';
import type { CommitsQueryResults } from './resultsCommitsNode';
import { ResultsCommitsNode } from './resultsCommitsNode';
import type { FilesQueryResults } from './resultsFilesNode';
import { ResultsFilesNode } from './resultsFilesNode';
import type { ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, SubscribeableViewNode } from './viewNode';

let instanceId = 0;

export class CompareResultsNode extends SubscribeableViewNode<SearchAndCompareView> {
	private _instanceId: number;

	constructor(
		view: SearchAndCompareView,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private _ref: StoredNamedRef,
		private _compareWith: StoredNamedRef,
		private _storedAt: number = 0,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._instanceId = instanceId++;
		this.updateContext({
			comparisonId: `${_ref.ref}+${_compareWith.ref}+${this._instanceId}`,
			storedComparisonId: this.getStorageId(),
		});
		this._uniqueId = getViewNodeId('comparison-results', this.context);

		// If this is a new comparison, save it
		if (this._storedAt === 0) {
			this._storedAt = Date.now();
			void this.store(true);
		}
	}

	override get id(): string {
		return this._uniqueId;
	}

	protected override etag(): number {
		return this._storedAt;
	}

	get order(): number {
		return this._storedAt;
	}

	get ahead(): { readonly ref1: string; readonly ref2: string } {
		return {
			ref1: this._compareWith.ref || 'HEAD',
			ref2: this._ref.ref,
		};
	}

	get behind(): { readonly ref1: string; readonly ref2: string } {
		return {
			ref1: this._ref.ref,
			ref2: this._compareWith.ref || 'HEAD',
		};
	}

	get compareRef(): StoredNamedRef {
		return this._ref;
	}

	get compareWithRef(): StoredNamedRef {
		return this._compareWith;
	}

	protected override subscribe(): Disposable | Promise<Disposable | undefined> | undefined {
		return this.view.onDidChangeNodesCheckedState(this.onNodesCheckedStateChanged, this);
	}

	private onNodesCheckedStateChanged(e: TreeCheckboxChangeEvent<ViewNode>) {
		const prefix = getComparisonStoragePrefix(this.getStorageId());
		if (e.items.some(([n]) => n.id?.startsWith(prefix))) {
			void this.store(true);
		}
	}

	dismiss() {
		void this.remove(true);
	}

	private _children: ViewNode[] | undefined;

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const ahead = this.ahead;
			const behind = this.behind;

			const aheadBehindCounts = await this.view.container.git.getAheadBehindCommitCount(this.repoPath, [
				createRevisionRange(behind.ref1 || 'HEAD', behind.ref2, '...'),
			]);
			const mergeBase =
				(await this.view.container.git.getMergeBase(this.repoPath, behind.ref1, behind.ref2, {
					forkPoint: true,
				})) ?? (await this.view.container.git.getMergeBase(this.repoPath, behind.ref1, behind.ref2));

			this._children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.repoPath,
					'Behind',
					{
						query: this.getCommitsQuery(createRevisionRange(behind.ref1, behind.ref2, '..')),
						comparison: behind,
						direction: 'behind',
						files: {
							ref1: behind.ref1 === '' ? '' : mergeBase ?? behind.ref1,
							ref2: behind.ref2,
							query: this.getBehindFilesQuery.bind(this),
						},
					},
					{
						description: pluralize('commit', aheadBehindCounts?.behind ?? 0),
						expand: false,
					},
				),
				new ResultsCommitsNode(
					this.view,
					this,
					this.repoPath,
					'Ahead',
					{
						query: this.getCommitsQuery(createRevisionRange(ahead.ref1, ahead.ref2, '..')),
						comparison: ahead,
						direction: 'ahead',
						files: {
							ref1: mergeBase ?? ahead.ref1,
							ref2: ahead.ref2,
							query: this.getAheadFilesQuery.bind(this),
						},
					},
					{
						description: pluralize('commit', aheadBehindCounts?.ahead ?? 0),
						expand: false,
					},
				),
				new ResultsFilesNode(
					this.view,
					this,
					this.repoPath,
					this._compareWith.ref,
					this._ref.ref,
					this.getFilesQuery.bind(this),
					undefined,
					{ expand: false },
				),
			];
		}
		return this._children;
	}

	getTreeItem(): TreeItem {
		let description;
		if (this.view.container.git.repositoryCount > 1) {
			const repo = this.repoPath ? this.view.container.git.getRepository(this.repoPath) : undefined;
			description = repo?.formattedName ?? this.repoPath;
		}

		const item = new TreeItem(
			`Comparing ${
				this._ref.label ?? shortenRevision(this._ref.ref, { strings: { working: 'Working Tree' } })
			} with ${
				this._compareWith.label ??
				shortenRevision(this._compareWith.ref, { strings: { working: 'Working Tree' } })
			}`,
			TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = `${ContextValues.CompareResults}${this._ref.ref === '' ? '+working' : ''}`;
		item.description = description;
		item.iconPath = new ThemeIcon('compare-changes');

		return item;
	}

	@gate()
	@debug()
	async getDiffRefs(): Promise<[string, string]> {
		return Promise.resolve<[string, string]>([this._compareWith.ref, this._ref.ref]);
	}

	@gate()
	@debug()
	override refresh(reset: boolean = false) {
		if (!reset) return;

		this._children = undefined;
	}

	@log()
	async swap() {
		if (this._ref.ref === '') {
			void window.showErrorMessage('Cannot swap comparisons with the working tree');
			return;
		}

		// Save the current id so we can update it later
		const currentId = this.getStorageId();

		const ref1 = this._ref;
		this._ref = this._compareWith;
		this._compareWith = ref1;

		// Remove the existing stored item and save a new one
		await this.replace(currentId, true);

		this._children = undefined;
		this.view.triggerNodeChange(this.parent);
		queueMicrotask(() => this.view.reveal(this, { expand: true, focus: true, select: true }));
	}

	private async getAheadFilesQuery(): Promise<FilesQueryResults> {
		return this.getAheadBehindFilesQuery(
			createRevisionRange(this._compareWith?.ref || 'HEAD', this._ref.ref || 'HEAD', '...'),
			this._ref.ref === '',
		);
	}

	private async getBehindFilesQuery(): Promise<FilesQueryResults> {
		return this.getAheadBehindFilesQuery(
			createRevisionRange(this._ref.ref || 'HEAD', this._compareWith.ref || 'HEAD', '...'),
			false,
		);
	}

	private async getAheadBehindFilesQuery(
		comparison: string,
		compareWithWorkingTree: boolean,
	): Promise<FilesQueryResults> {
		const [filesResult, workingFilesResult, statsResult, workingStatsResult] = await Promise.allSettled([
			this.view.container.git.getDiffStatus(this.repoPath, comparison),
			compareWithWorkingTree ? this.view.container.git.getDiffStatus(this.repoPath, 'HEAD') : undefined,
			this.view.container.git.getChangedFilesCount(this.repoPath, comparison),
			compareWithWorkingTree ? this.view.container.git.getChangedFilesCount(this.repoPath, 'HEAD') : undefined,
		]);

		let files = getSettledValue(filesResult) ?? [];
		let stats: FilesQueryResults['stats'] = getSettledValue(statsResult);

		if (compareWithWorkingTree) {
			const workingFiles = getSettledValue(workingFilesResult);
			if (workingFiles != null) {
				if (files.length === 0) {
					files = workingFiles ?? [];
				} else {
					for (const wf of workingFiles) {
						const index = files.findIndex(f => f.path === wf.path);
						if (index !== -1) {
							files.splice(index, 1, wf);
						} else {
							files.push(wf);
						}
					}
				}
			}

			const workingStats = getSettledValue(workingStatsResult);
			if (workingStats != null) {
				if (stats == null) {
					stats = workingStats;
				} else {
					stats = {
						additions: stats.additions + workingStats.additions,
						deletions: stats.deletions + workingStats.deletions,
						changedFiles: files.length,
						approximated: true,
					};
				}
			}
		}

		return {
			label: `${pluralize('file', files.length, { zero: 'No' })} changed`,
			files: files,
			stats: stats,
		};
	}

	private getCommitsQuery(range: string): (limit: number | undefined) => Promise<CommitsQueryResults> {
		const repoPath = this.repoPath;
		return async (limit: number | undefined) => {
			const log = await this.view.container.git.getLog(repoPath, {
				limit: limit,
				ref: range,
			});

			const results: Mutable<Partial<CommitsQueryResults>> = {
				log: log,
				hasMore: log?.hasMore ?? true,
			};
			if (results.hasMore) {
				results.more = async (limit: number | undefined) => {
					results.log = (await results.log?.more?.(limit)) ?? results.log;
					results.hasMore = results.log?.hasMore ?? true;
				};
			}

			return results as CommitsQueryResults;
		};
	}

	private async getFilesQuery(): Promise<FilesQueryResults> {
		let comparison;
		if (this._compareWith.ref === '') {
			debugger;
			throw new Error('Cannot get files for comparisons of a ref with working tree');
		} else if (this._ref.ref === '') {
			comparison = this._compareWith.ref;
		} else {
			comparison = `${this._compareWith.ref}..${this._ref.ref}`;
		}

		const [filesResult, statsResult] = await Promise.allSettled([
			this.view.container.git.getDiffStatus(this.repoPath, comparison),
			this.view.container.git.getChangedFilesCount(this.repoPath, comparison),
		]);

		const files = getSettledValue(filesResult) ?? [];
		return {
			label: `${pluralize('file', files.length, { zero: 'No' })} changed`,
			files: files,
			stats: getSettledValue(statsResult),
		};
	}

	private getStorageId() {
		return md5(`${this.repoPath}|${this._ref.ref}|${this._compareWith.ref}`, 'base64');
	}

	private remove(silent: boolean = false) {
		return this.view.updateStorage(this.getStorageId(), undefined, silent);
	}

	private async replace(id: string, silent: boolean = false) {
		await this.view.updateStorage(id, undefined, silent);
		return this.store(silent);
	}

	store(silent = false) {
		const storageId = this.getStorageId();
		const checkedFiles = getComparisonCheckedFiles(this.view, storageId);

		return this.view.updateStorage(
			storageId,
			{
				type: 'comparison',
				timestamp: this._storedAt,
				path: this.repoPath,
				ref1: { label: this._ref.label, ref: this._ref.ref },
				ref2: { label: this._compareWith.label, ref: this._compareWith.ref },
				checkedFiles: checkedFiles.length > 0 ? checkedFiles : undefined,
			},
			silent,
		);
	}
}

export function getComparisonStoragePrefix(storageId: string) {
	return `${storageId}|`;
}

export function getComparisonCheckedFiles(view: View, storageId: string) {
	const checkedFiles = [];

	const checked = view.nodeState.get<TreeItemCheckboxState>(getComparisonStoragePrefix(storageId), 'checked');
	for (const [key, value] of checked) {
		if (value === TreeItemCheckboxState.Checked) {
			checkedFiles.push(key);
		}
	}
	return checkedFiles;
}

export function resetComparisonCheckedFiles(view: View, storageId: string) {
	view.nodeState.delete(getComparisonStoragePrefix(storageId), 'checked');
}

export function restoreComparisonCheckedFiles(view: View, checkedFiles: string[] | undefined) {
	if (checkedFiles?.length) {
		for (const id of checkedFiles) {
			view.nodeState.storeState(id, 'checked', TreeItemCheckboxState.Checked, true);
		}
	}
}
