'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { NamedRef } from '../../constants';
import { Container } from '../../container';
import { GitRevision } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { debug, gate, log, Strings } from '../../system';
import { CompareView } from '../compareView';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { FilesQueryResults } from './resultsFilesNode';
import { ContextValues, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';
import { TreeViewNodeCollapsibleStateChangeEvent } from '../viewBase';

let instanceId = 0;

export class CompareResultsNode extends ViewNode<CompareView> implements Disposable {
	static key = ':compare-results';
	static getId(repoPath: string, ref1: string, ref2: string, instanceId: number): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${ref1}|${ref2}):${instanceId}`;
	}

	private _children: ViewNode[] | undefined;
	private _disposable: Disposable;
	private _instanceId: number;

	constructor(
		view: CompareView,
		public readonly repoPath: string,
		private _ref: NamedRef,
		private _compareWith: NamedRef,
		private _pinned: boolean = false,
	) {
		super(GitUri.fromRepoPath(repoPath), view);
		this._instanceId = instanceId++;

		this._disposable = this.view.onDidChangeNodeCollapsibleState(this.onCollapsibleStateChanged, this);
	}

	dispose() {
		this._disposable.dispose();
	}

	private _collapsibleState: TreeItemCollapsibleState | undefined;
	private onCollapsibleStateChanged(e: TreeViewNodeCollapsibleStateChangeEvent<ViewNode>) {
		if (e.element !== this) return;

		this._collapsibleState = e.state;
	}

	get id(): string {
		return CompareResultsNode.getId(this.repoPath, this._ref.ref, this._compareWith.ref, this._instanceId);
	}

	get pinned(): boolean {
		return this._pinned;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const aheadBehind = await Container.git.getAheadBehindCommitCount(this.repoPath, [
				GitRevision.createRange(this._ref.ref || 'HEAD', this._compareWith.ref || 'HEAD', '...'),
			]);

			this._children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'Behind',
					this.getCommitsQuery(
						GitRevision.createRange(this._ref.ref, this._compareWith?.ref ?? 'HEAD', '..'),
					),
					{
						id: 'behind',
						description: Strings.pluralize('commit', aheadBehind?.behind ?? 0),
						expand: false,
						includeRepoName: true,
						files: {
							ref1: this._ref.ref,
							ref2: this._compareWith.ref || 'HEAD',
							query: this.getBehindFilesQuery.bind(this),
						},
					},
				),
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'Ahead',
					this.getCommitsQuery(
						GitRevision.createRange(this._compareWith?.ref ?? 'HEAD', this._ref.ref, '..'),
					),
					{
						id: 'ahead',
						description: Strings.pluralize('commit', aheadBehind?.ahead ?? 0),
						expand: false,
						includeRepoName: true,
						files: {
							ref1: this._compareWith.ref || 'HEAD',
							ref2: this._ref.ref,
							query: this.getAheadFilesQuery.bind(this),
						},
					},
				),
			];
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let description;
		if ((await Container.git.getRepositoryCount()) > 1) {
			const repo = await Container.git.getRepository(this.uri.repoPath!);
			description = repo?.formattedName ?? this.uri.repoPath;
		}

		const item = new TreeItem(
			`Comparing ${
				this._ref.label ?? GitRevision.shorten(this._ref.ref, { strings: { working: 'Working Tree' } })
			} to ${
				this._compareWith.label ??
				GitRevision.shorten(this._compareWith.ref, { strings: { working: 'Working Tree' } })
			}`,
			this._collapsibleState ?? TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = `${ContextValues.CompareResults}${this._pinned ? '+pinned' : ''}`;
		item.description = description;
		if (this._pinned) {
			item.iconPath = {
				dark: Container.context.asAbsolutePath('images/dark/icon-pin-small.svg'),
				light: Container.context.asAbsolutePath('images/light/icon-pin-small.svg'),
			};
		}

		return item;
	}

	canDismiss(): boolean {
		return !this._pinned;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	@gate()
	@debug()
	async getDiffRefs(): Promise<[string, string]> {
		// if (this.comparisonNotation === '..') {
		// 	return [
		// 		(await Container.git.getMergeBase(this.repoPath, this._compareWith.ref, this._ref.ref)) ??
		// 			this._compareWith.ref,
		// 		this._ref.ref,
		// 	];
		// }

		return [this._compareWith.ref, this._ref.ref];
	}

	@log()
	async pin() {
		if (this._pinned) return;

		await this.view.updatePinnedComparison(this.getPinnableId(), {
			path: this.repoPath,
			ref1: this._ref,
			ref2: this._compareWith,
			notation: undefined,
		});

		this._pinned = true;
		void this.triggerChange();
	}

	@gate()
	@debug()
	refresh(reset: boolean = false) {
		if (!reset) return;

		this._children = undefined;
	}

	@log()
	async swap() {
		// Save the current id so we can update it later
		const currentId = this.getPinnableId();

		const ref1 = this._ref;
		this._ref = this._compareWith;
		this._compareWith = ref1;

		// If we were pinned, remove the existing pin and save a new one
		if (this._pinned) {
			await this.view.updatePinnedComparison(currentId);
			await this.view.updatePinnedComparison(this.getPinnableId(), {
				path: this.repoPath,
				ref1: this._ref,
				ref2: this._compareWith,
				notation: undefined,
			});
		}

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	@log()
	async unpin() {
		if (!this._pinned) return;

		await this.view.updatePinnedComparison(this.getPinnableId());

		this._pinned = false;
		void this.triggerChange();
	}

	private async getAheadFilesQuery(): Promise<FilesQueryResults> {
		let files = await Container.git.getDiffStatus(
			this.repoPath,
			GitRevision.createRange(this._compareWith?.ref || 'HEAD', this._ref.ref || 'HEAD', '...'),
		);

		if (this._ref.ref === '') {
			const workingFiles = await Container.git.getDiffStatus(this.repoPath, 'HEAD');
			if (workingFiles != null) {
				if (files != null) {
					for (const wf of workingFiles) {
						const index = files.findIndex(f => f.fileName === wf.fileName);
						if (index !== -1) {
							files.splice(index, 1, wf);
						} else {
							files.push(wf);
						}
					}
				} else {
					files = workingFiles;
				}
			}
		}

		return {
			label: `${Strings.pluralize('file', files?.length ?? 0, { zero: 'No' })} changed`,
			files: files,
		};
	}

	private async getBehindFilesQuery(): Promise<FilesQueryResults> {
		let files = await Container.git.getDiffStatus(
			this.repoPath,
			GitRevision.createRange(this._ref.ref || 'HEAD', this._compareWith.ref || 'HEAD', '...'),
		);

		if (this._compareWith.ref === '') {
			const workingFiles = await Container.git.getDiffStatus(this.repoPath, 'HEAD');
			if (workingFiles != null) {
				if (files != null) {
					for (const wf of workingFiles) {
						const index = files.findIndex(f => f.fileName === wf.fileName);
						if (index !== -1) {
							files.splice(index, 1, wf);
						} else {
							files.push(wf);
						}
					}
				} else {
					files = workingFiles;
				}
			}
		}

		return {
			label: `${Strings.pluralize('file', files?.length ?? 0, { zero: 'No' })} changed`,
			files: files,
		};
	}

	private getCommitsQuery(range: string): (limit: number | undefined) => Promise<CommitsQueryResults> {
		const repoPath = this.repoPath;
		return async (limit: number | undefined) => {
			const log = await Container.git.getLog(repoPath, {
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

	private getPinnableId() {
		return Strings.sha1(`${this.repoPath}|${this._ref.ref}|${this._compareWith.ref}`);
	}
}
