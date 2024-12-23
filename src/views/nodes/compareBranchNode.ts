import type { Disposable, TreeCheckboxChangeEvent } from 'vscode';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { ViewShowBranchComparison } from '../../config';
import { GlyphChars } from '../../constants';
import type { StoredBranchComparison, StoredBranchComparisons, StoredNamedRef } from '../../constants.storage';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import { createRevisionRange, shortenRevision } from '../../git/models/revision.utils';
import type { GitUser } from '../../git/models/user';
import type { CommitsQueryResults, FilesQueryResults } from '../../git/queryResults';
import { getCommitsQuery, getFilesQuery } from '../../git/queryResults';
import { CommandQuickPickItem } from '../../quickpicks/items/common';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { debug, log } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import { getSettledValue } from '../../system/promise';
import { pluralize } from '../../system/string';
import type { ViewsWithBranches } from '../viewBase';
import type { WorktreesView } from '../worktreesView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import {
	getComparisonCheckedFiles,
	getComparisonStoragePrefix,
	resetComparisonCheckedFiles,
	restoreComparisonCheckedFiles,
} from './compareResultsNode';
import { ResultsCommitsNode } from './resultsCommitsNode';
import { ResultsFilesNode } from './resultsFilesNode';

type State = {
	filterCommits: GitUser[] | undefined;
};

export class CompareBranchNode extends SubscribeableViewNode<
	'compare-branch',
	ViewsWithBranches | WorktreesView,
	ViewNode,
	State
> {
	constructor(
		uri: GitUri,
		view: ViewsWithBranches | WorktreesView,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		private showComparison: ViewShowBranchComparison,
		// Specifies that the node is shown as a root
		public readonly root: boolean = false,
	) {
		super('compare-branch', uri, view, parent);

		this.updateContext({ branch: branch, root: root, storedComparisonId: this.getStorageId() });
		this._uniqueId = getViewNodeId(this.type, this.context);
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

	get compareRef(): StoredNamedRef {
		return { label: this.branch.name, ref: this.branch.sha! };
	}

	private _compareWith: StoredBranchComparison | undefined;
	get compareWith(): StoredBranchComparison | undefined {
		return this._compareWith;
	}

	get compareWithRef(): StoredNamedRef | undefined {
		return this._compareWith != null ? { label: this._compareWith.label, ref: this._compareWith.ref } : undefined;
	}

	private _isFiltered: boolean | undefined;
	private get filterByAuthors(): GitUser[] | undefined {
		const authors = this.getState('filterCommits');

		const isFiltered = Boolean(authors?.length);
		if (this._isFiltered != null && this._isFiltered !== isFiltered) {
			this.updateContext({ comparisonFiltered: isFiltered });
		}
		this._isFiltered = isFiltered;

		return authors;
	}

	get repoPath(): string {
		return this.branch.repoPath;
	}

	protected override subscribe(): Disposable | Promise<Disposable | undefined> | undefined {
		return weakEvent(this.view.onDidChangeNodesCheckedState, this.onNodesCheckedStateChanged, this);
	}

	private onNodesCheckedStateChanged(e: TreeCheckboxChangeEvent<ViewNode>) {
		const prefix = getComparisonStoragePrefix(this.getStorageId());
		if (e.items.some(([n]) => n.id?.startsWith(prefix))) {
			void this.storeCompareWith(false).catch();
		}
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._compareWith == null) return [];

		if (this.children == null) {
			const ahead = {
				...this.ahead,
				range: createRevisionRange(this.ahead.ref1, this.compareWithWorkingTree ? '' : this.ahead.ref2, '..'),
			};
			const behind = { ...this.behind, range: createRevisionRange(this.behind.ref1, this.behind.ref2, '..') };

			const counts = await this.view.container.git.getLeftRightCommitCount(
				this.branch.repoPath,
				createRevisionRange(behind.ref1, behind.ref2, '...'),
				{ authors: this.filterByAuthors },
			);
			const mergeBase =
				(await this.view.container.git.getMergeBase(this.repoPath, behind.ref1, behind.ref2, {
					forkPoint: true,
				})) ?? (await this.view.container.git.getMergeBase(this.repoPath, behind.ref1, behind.ref2));

			const children: ViewNode[] = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.repoPath,
					'Behind',
					{
						query: this.getCommitsQuery(behind.range),
						comparison: behind,
						direction: 'behind',
						files: {
							ref1: this.compareWithWorkingTree ? '' : mergeBase ?? behind.ref1,
							ref2: behind.ref2,
							query: this.getBehindFilesQuery.bind(this),
						},
					},
					{
						description: pluralize('commit', counts?.right ?? 0),
						expand: false,
					},
				),
				new ResultsCommitsNode(
					this.view,
					this,
					this.repoPath,
					'Ahead',
					{
						query: this.getCommitsQuery(ahead.ref1),
						comparison: ahead,
						direction: 'ahead',
						files: {
							ref1: mergeBase ?? ahead.ref1,
							ref2: this.compareWithWorkingTree ? '' : ahead.ref2,
							query: this.getAheadFilesQuery.bind(this),
						},
					},
					{
						description: pluralize('commit', counts?.left ?? 0),
						expand: false,
					},
				),
			];

			// Can't support showing files when commits are filtered
			if (!this.filterByAuthors?.length) {
				children.push(
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
				);
			}

			this.children = children;
		}
		return this.children;
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
			label = `Compare ${this.compareWithWorkingTree ? 'Working Tree' : this.branch.name} with ${
				this._compareWith.label ??
				shortenRevision(this._compareWith.ref, {
					strings: { working: 'Working Tree' },
				})
			}`;
			state = TreeItemCollapsibleState.Collapsed;
		}

		const item = new TreeItem(label, state);
		item.id = this.id;
		item.contextValue = `${ContextValues.CompareBranch}${this.branch.current ? '+current' : ''}+${
			this.comparisonType
		}${this._compareWith == null ? '' : '+comparing'}${this.root ? '+root' : ''}${
			this.filterByAuthors?.length ? '+filtered' : ''
		}`;

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

		this.children = undefined;
		this.view.triggerNodeChange(this);
	}

	@log()
	clearReviewed() {
		void this.storeCompareWith(true).catch();
		void this.triggerChange();
	}

	@log()
	async edit() {
		const pick = await showReferencePicker(
			this.branch.repoPath,
			`Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with`,
			'Choose a reference (branch, tag, etc) to compare with',
			{
				allowRevisions: true,
				picked: this.branch.ref,
				sort: { branches: { current: true }, tags: {} },
			},
		);
		if (pick == null || pick instanceof CommandQuickPickItem) return;

		await this.updateCompareWith({
			ref: pick.ref,
			notation: undefined,
			type: this.comparisonType,
		});

		this.children = undefined;
		this.view.triggerNodeChange(this);
	}

	@debug()
	override refresh(reset?: boolean) {
		super.refresh(reset);
		this.loadCompareWith();
	}

	@log()
	async setComparisonType(comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (this._compareWith != null) {
			await this.updateCompareWith({ ...this._compareWith, type: comparisonType, checkedFiles: undefined });
		} else {
			this.showComparison = comparisonType;
		}

		this.children = undefined;
		this.view.triggerNodeChange(this);
	}

	@log()
	async setDefaultCompareWith(compareWith: StoredBranchComparison) {
		if (this._compareWith != null) return;

		await this.updateCompareWith(compareWith);
	}

	private get comparisonType() {
		return this._compareWith?.type ?? this.showComparison;
	}

	private get compareWithWorkingTree() {
		return this.comparisonType === 'working';
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
						files: files.length,
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
		return getCommitsQuery(this.view.container, this.repoPath, range, this.filterByAuthors);
	}

	private getFilesQuery(): Promise<FilesQueryResults> {
		let ref1 = this.branch.ref;
		let ref2 = this._compareWith?.ref;

		if (!ref2) {
			ref2 = ref1;
			ref1 = '';
		} else if (this.compareWithWorkingTree) {
			ref1 = '';
		}

		return getFilesQuery(this.view.container, this.repoPath, ref1, ref2);
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
