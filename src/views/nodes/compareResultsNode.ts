import { md5 } from '@env/crypto';
import type { TreeCheckboxChangeEvent } from 'vscode';
import { Disposable, ThemeIcon, TreeItem, TreeItemCheckboxState, TreeItemCollapsibleState, window } from 'vscode';
import type { StoredNamedRef } from '../../constants.storage';
import type { FilesComparison } from '../../git/actions/commit';
import { GitUri } from '../../git/gitUri';
import { createRevisionRange, shortenRevision } from '../../git/models/revision.utils';
import type { GitUser } from '../../git/models/user';
import type { CommitsQueryResults, FilesQueryResults } from '../../git/queryResults';
import { getAheadBehindFilesQuery, getCommitsQuery, getFilesQuery } from '../../git/queryResults';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import { pluralize } from '../../system/string';
import type { SearchAndCompareView } from '../searchAndCompareView';
import type { View } from '../viewBase';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ResultsCommitsNode } from './resultsCommitsNode';
import { ResultsFilesNode } from './resultsFilesNode';

let instanceId = 0;

type State = {
	filterCommits: GitUser[] | undefined;
};

export class CompareResultsNode extends SubscribeableViewNode<
	'compare-results',
	SearchAndCompareView,
	ViewNode,
	State
> {
	private _instanceId: number;

	constructor(
		view: SearchAndCompareView,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private _ref: StoredNamedRef,
		private _compareWith: StoredNamedRef,
		private _storedAt: number = 0,
	) {
		super('compare-results', GitUri.fromRepoPath(repoPath), view, parent);

		this._instanceId = instanceId++;
		this.updateContext({
			comparisonId: `${_ref.ref}+${_compareWith.ref}+${this._instanceId}`,
			storedComparisonId: this.getStorageId(),
		});
		this._uniqueId = getViewNodeId(this.type, this.context);

		// If this is a new comparison, save it
		if (this._storedAt === 0) {
			this._storedAt = Date.now();
			void this.store(true).catch();
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

	protected override subscribe(): Disposable | Promise<Disposable | undefined> | undefined {
		return Disposable.from(
			weakEvent(this.view.onDidChangeNodesCheckedState, this.onNodesCheckedStateChanged, this),
			weakEvent(
				this.view.container.integrations.onDidChangeConnectionState,
				this.onIntegrationConnectionStateChanged,
				this,
			),
		);
	}

	private onIntegrationConnectionStateChanged() {
		this.view.triggerNodeChange(this.parent);
	}

	private onNodesCheckedStateChanged(e: TreeCheckboxChangeEvent<ViewNode>) {
		const prefix = getComparisonStoragePrefix(this.getStorageId());
		if (e.items.some(([n]) => n.id?.startsWith(prefix))) {
			void this.store(true).catch();
		}
	}

	dismiss() {
		void this.remove(true);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const ahead = {
				...this.ahead,
				range: createRevisionRange(this.ahead.ref1, this.ahead.ref2, '..'),
			};
			const behind = { ...this.behind, range: createRevisionRange(this.behind.ref1, this.behind.ref2, '..') };

			const counts = await this.view.container.git.getLeftRightCommitCount(
				this.repoPath,
				createRevisionRange(behind.ref1 || 'HEAD', behind.ref2, '...'),
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
							ref1: behind.ref1 === '' ? '' : mergeBase ?? behind.ref1,
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
						query: this.getCommitsQuery(ahead.range),
						comparison: ahead,
						direction: 'ahead',
						files: {
							ref1: mergeBase ?? ahead.ref1,
							ref2: ahead.ref2,
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
						this._compareWith.ref,
						this._ref.ref,
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
		item.contextValue = `${ContextValues.CompareResults}${this._ref.ref === '' ? '+working' : ''}${
			this.filterByAuthors?.length ? '+filtered' : ''
		}`;
		item.description = description;
		item.iconPath = new ThemeIcon('compare-changes');

		return item;
	}

	@gate()
	@debug()
	async getDiffRefs(): Promise<[string, string]> {
		return Promise.resolve<[string, string]>([this._compareWith.ref, this._ref.ref]);
	}

	async getFilesComparison(): Promise<FilesComparison | undefined> {
		const children = await this.getChildren();
		const node = children.find(c => c.is('results-files'));
		return node?.getFilesComparison();
	}

	@log()
	clearReviewed() {
		resetComparisonCheckedFiles(this.view, this.getStorageId());
		void this.store().catch();
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

		this.children = undefined;
		this.view.triggerNodeChange(this.parent);
		queueMicrotask(() => this.view.reveal(this, { expand: true, focus: true, select: true }));
	}

	private async getAheadFilesQuery(): Promise<FilesQueryResults> {
		return getAheadBehindFilesQuery(
			this.view.container,
			this.repoPath,
			createRevisionRange(this._compareWith?.ref || 'HEAD', this._ref.ref || 'HEAD', '...'),
			this._ref.ref === '',
		);
	}

	private async getBehindFilesQuery(): Promise<FilesQueryResults> {
		return getAheadBehindFilesQuery(
			this.view.container,
			this.repoPath,
			createRevisionRange(this._ref.ref || 'HEAD', this._compareWith.ref || 'HEAD', '...'),
			false,
		);
	}

	private getCommitsQuery(range: string): (limit: number | undefined) => Promise<CommitsQueryResults> {
		return getCommitsQuery(this.view.container, this.repoPath, range, this.filterByAuthors);
	}

	private getFilesQuery(): Promise<FilesQueryResults> {
		return getFilesQuery(this.view.container, this.repoPath, this._ref.ref, this._compareWith.ref);
	}

	private getStorageId() {
		return md5(`${this.repoPath}|${this._ref.ref}|${this._compareWith.ref}`, 'base64');
	}

	private remove(silent: boolean = false) {
		resetComparisonCheckedFiles(this.view, this.getStorageId());
		return this.view.updateStorage(this.getStorageId(), undefined, silent);
	}

	private async replace(id: string, silent: boolean = false) {
		resetComparisonCheckedFiles(this.view, id);
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
