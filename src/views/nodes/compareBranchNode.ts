import type { Disposable, TreeCheckboxChangeEvent } from 'vscode';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { ViewShowBranchComparison } from '../../config';
import type { StoredBranchComparison, StoredBranchComparisons } from '../../constants';
import { GlyphChars } from '../../constants';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import { createRevisionRange, shortenRevision } from '../../git/models/reference';
import { CommandQuickPickItem } from '../../quickpicks/items/common';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { getSettledValue } from '../../system/promise';
import { pluralize } from '../../system/string';
import type { ViewsWithBranches } from '../viewBase';
import type { WorktreesView } from '../worktreesView';
import {
	getComparisonCheckedFiles,
	getComparisonStoragePrefix,
	resetComparisonCheckedFiles,
	restoreComparisonCheckedFiles,
} from './compareResultsNode';
import type { CommitsQueryResults } from './resultsCommitsNode';
import { ResultsCommitsNode } from './resultsCommitsNode';
import type { FilesQueryResults } from './resultsFilesNode';
import { ResultsFilesNode } from './resultsFilesNode';
import type { ViewNode } from './viewNode';
import { ContextValues, getViewNodeId, SubscribeableViewNode } from './viewNode';

export class CompareBranchNode extends SubscribeableViewNode<ViewsWithBranches | WorktreesView> {
	private _children: ViewNode[] | undefined;
	private _compareWith: StoredBranchComparison | undefined;

	constructor(
		uri: GitUri,
		view: ViewsWithBranches | WorktreesView,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		private showComparison: ViewShowBranchComparison,
		// Specifies that the node is shown as a root
		public readonly root: boolean = false,
	) {
		super(uri, view, parent);

		this.updateContext({ branch: branch, root: root, storedComparisonId: this.getStorageId() });
		this._uniqueId = getViewNodeId('compare-branch', this.context);
		this.loadCompareWith();
	}

	protected override etag(): number {
		return 0;
	}

	get ahead(): { readonly ref1: string; readonly ref2: string } {
		return {
			ref1: this._compareWith?.ref || 'HEAD',
			ref2: this.branch.ref,
		};
	}

	get behind(): { readonly ref1: string; readonly ref2: string } {
		return {
			ref1: this.branch.ref,
			ref2: this._compareWith?.ref || 'HEAD',
		};
	}

	get repoPath(): string {
		return this.branch.repoPath;
	}

	protected override subscribe(): Disposable | Promise<Disposable | undefined> | undefined {
		return this.view.onDidChangeNodesCheckedState(this.onNodesCheckedStateChanged, this);
	}

	private onNodesCheckedStateChanged(e: TreeCheckboxChangeEvent<ViewNode>) {
		const prefix = getComparisonStoragePrefix(this.getStorageId());
		if (e.items.some(([n]) => n.id?.startsWith(prefix))) {
			void this.storeCompareWith(false);
		}
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._compareWith == null) return [];

		if (this._children == null) {
			const ahead = this.ahead;
			const behind = this.behind;

			const aheadBehindCounts = await this.view.container.git.getAheadBehindCommitCount(this.branch.repoPath, [
				createRevisionRange(behind.ref1, behind.ref2, '...'),
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
							ref1: this.compareWithWorkingTree ? '' : mergeBase ?? behind.ref1,
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
						query: this.getCommitsQuery(
							createRevisionRange(ahead.ref1, this.compareWithWorkingTree ? '' : ahead.ref2, '..'),
						),
						comparison: ahead,
						direction: 'ahead',
						files: {
							ref1: mergeBase ?? ahead.ref1,
							ref2: this.compareWithWorkingTree ? '' : ahead.ref2,
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
					this._compareWith.ref || 'HEAD',
					this.compareWithWorkingTree ? '' : this.branch.ref,
					this.getFilesQuery.bind(this),
					undefined,
					{ expand: false },
				),
			];
		}
		return this._children;
	}

	getTreeItem(): TreeItem {
		let state: TreeItemCollapsibleState;
		let label;
		let tooltip;
		if (this._compareWith == null) {
			label = `Compare ${
				this.compareWithWorkingTree ? 'Working Tree' : this.branch.name
			} with <branch, tag, or ref>`;
			state = TreeItemCollapsibleState.None;
			tooltip = `Click to compare ${
				this.compareWithWorkingTree ? 'Working Tree' : this.branch.name
			} with a branch, tag, or ref`;
		} else {
			label = `Compare ${this.compareWithWorkingTree ? 'Working Tree' : this.branch.name} with ${shortenRevision(
				this._compareWith.ref,
				{
					strings: { working: 'Working Tree' },
				},
			)}`;
			state = TreeItemCollapsibleState.Collapsed;
		}

		const item = new TreeItem(label, state);
		item.id = this.id;
		item.contextValue = `${ContextValues.CompareBranch}${this.branch.current ? '+current' : ''}+${
			this.comparisonType
		}${this._compareWith == null ? '' : '+comparing'}${this.root ? '+root' : ''}`;

		if (this._compareWith == null) {
			item.command = {
				title: `Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${
					GlyphChars.Ellipsis
				}`,
				command: 'gitlens.views.editNode',
				arguments: [this],
			};
		}

		item.iconPath = new ThemeIcon('git-compare');
		item.tooltip = tooltip;

		return item;
	}

	@log()
	async clear() {
		this._compareWith = undefined;
		await this.updateCompareWith(undefined);

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	@log()
	async edit() {
		await this.compareWith();
	}

	@gate()
	@debug()
	override refresh() {
		this._children = undefined;
		this.loadCompareWith();
	}

	@log()
	async setComparisonType(comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (this._compareWith != null) {
			await this.updateCompareWith({ ...this._compareWith, type: comparisonType, checkedFiles: undefined });
		} else {
			this.showComparison = comparisonType;
		}

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	private get comparisonType() {
		return this._compareWith?.type ?? this.showComparison;
	}

	private get compareWithWorkingTree() {
		return this.comparisonType === 'working';
	}

	private async compareWith() {
		const pick = await showReferencePicker(
			this.branch.repoPath,
			`Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with`,
			'Choose a reference to compare with',
			{
				allowEnteringRefs: true,
				picked: this.branch.ref,
				// checkmarks: true,
				sort: { branches: { current: true }, tags: {} },
			},
		);
		if (pick == null || pick instanceof CommandQuickPickItem) return;

		await this.updateCompareWith({
			ref: pick.ref,
			notation: undefined,
			type: this.comparisonType,
		});

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	private async getAheadFilesQuery(): Promise<FilesQueryResults> {
		const comparison = createRevisionRange(this._compareWith?.ref || 'HEAD', this.branch.ref || 'HEAD', '...');

		const [filesResult, workingFilesResult, statsResult, workingStatsResult] = await Promise.allSettled([
			this.view.container.git.getDiffStatus(this.repoPath, comparison),
			this.compareWithWorkingTree ? this.view.container.git.getDiffStatus(this.repoPath, 'HEAD') : undefined,
			this.view.container.git.getChangedFilesCount(this.repoPath, comparison),
			this.compareWithWorkingTree
				? this.view.container.git.getChangedFilesCount(this.repoPath, 'HEAD')
				: undefined,
		]);

		let files = getSettledValue(filesResult) ?? [];
		let stats: FilesQueryResults['stats'] = getSettledValue(statsResult);

		if (this.compareWithWorkingTree) {
			const workingFiles = getSettledValue(workingFilesResult);
			if (workingFiles != null) {
				if (files.length === 0) {
					files = workingFiles;
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

	private async getBehindFilesQuery(): Promise<FilesQueryResults> {
		const comparison = createRevisionRange(this.branch.ref, this._compareWith?.ref || 'HEAD', '...');

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
		if (!this._compareWith?.ref) {
			comparison = this.branch.ref;
		} else if (this.compareWithWorkingTree) {
			comparison = this._compareWith.ref;
		} else {
			comparison = `${this._compareWith.ref}..${this.branch.ref}`;
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
		return `${this.branch.id}${this.branch.current ? '+current' : ''}`;
	}

	private loadCompareWith() {
		const comparisons = this.view.container.storage.getWorkspace('branch:comparisons');

		const storageId = this.getStorageId();
		const compareWith = comparisons?.[storageId];
		if (compareWith != null && typeof compareWith === 'string') {
			this._compareWith = {
				ref: compareWith,
				notation: undefined,
				type: this.showComparison,
			};
		} else {
			this._compareWith = compareWith;
			if (compareWith != null) {
				restoreComparisonCheckedFiles(this.view, compareWith.checkedFiles);
			}
		}
	}

	private async storeCompareWith(resetCheckedFiles: boolean) {
		const storageId = this.getStorageId();
		if (resetCheckedFiles) {
			resetComparisonCheckedFiles(this.view, storageId);
		}

		let comparisons = this.view.container.storage.getWorkspace('branch:comparisons');
		if (comparisons == null) {
			if (this._compareWith == null) return;

			comparisons = Object.create(null) as StoredBranchComparisons;
		}

		if (this._compareWith != null) {
			const checkedFiles = getComparisonCheckedFiles(this.view, storageId);
			this._compareWith.checkedFiles = checkedFiles;

			comparisons[storageId] = { ...this._compareWith };
		} else {
			if (comparisons[storageId] == null) return;

			const { [storageId]: _, ...rest } = comparisons;
			comparisons = rest;
		}
		await this.view.container.storage.storeWorkspace('branch:comparisons', comparisons);
	}

	private async updateCompareWith(compareWith: StoredBranchComparison | undefined) {
		this._compareWith = compareWith;
		await this.storeCompareWith(true);
	}
}
