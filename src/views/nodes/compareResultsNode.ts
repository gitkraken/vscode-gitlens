'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { NamedRef } from '../../constants';
import { Container } from '../../container';
import { GitRevision } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { debug, gate, log, Strings } from '../../system';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { FilesQueryResults, ResultsFilesNode } from './resultsFilesNode';
import { ContextValues, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';
import { SearchAndCompareView } from '../searchAndCompareView';

let instanceId = 0;

export class CompareResultsNode extends ViewNode<SearchAndCompareView> {
	static key = ':compare-results';
	static getId(repoPath: string, ref1: string, ref2: string, instanceId: number): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${ref1}|${ref2}):${instanceId}`;
	}

	static getPinnableId(repoPath: string, ref1: string, ref2: string) {
		return Strings.sha1(`${repoPath}|${ref1}|${ref2}`);
	}

	private _children: ViewNode[] | undefined;
	private _instanceId: number;

	constructor(
		view: SearchAndCompareView,
		parent: ViewNode,
		public readonly repoPath: string,
		private _ref: NamedRef,
		private _compareWith: NamedRef,
		private _pinned: number = 0,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);
		this._instanceId = instanceId++;
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

	get id(): string {
		return CompareResultsNode.getId(this.repoPath, this._ref.ref, this._compareWith.ref, this._instanceId);
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

	async getChildren(): Promise<ViewNode[]> {
		if (this._children == null) {
			const ahead = this.ahead;
			const behind = this.behind;

			const aheadBehindCounts = await Container.git.getAheadBehindCommitCount(this.repoPath, [
				GitRevision.createRange(behind.ref1 || 'HEAD', behind.ref2, '...'),
			]);

			this._children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'Behind',
					{
						query: this.getCommitsQuery(GitRevision.createRange(behind.ref1, behind.ref2, '..')),
						comparison: behind,
						direction: 'behind',
						files: {
							ref1: behind.ref1,
							ref2: behind.ref2,
							query: this.getBehindFilesQuery.bind(this),
						},
					},
					{
						id: 'behind',
						description: Strings.pluralize('commit', aheadBehindCounts?.behind ?? 0),
						expand: false,
					},
				),
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'Ahead',
					{
						query: this.getCommitsQuery(GitRevision.createRange(ahead.ref1, ahead.ref2, '..')),
						comparison: ahead,
						direction: 'ahead',
						files: {
							ref1: ahead.ref1,
							ref2: ahead.ref2,
							query: this.getAheadFilesQuery.bind(this),
						},
					},
					{
						id: 'ahead',
						description: Strings.pluralize('commit', aheadBehindCounts?.ahead ?? 0),
						expand: false,
					},
				),
				new ResultsFilesNode(
					this.view,
					this,
					this.uri.repoPath!,
					this._compareWith.ref,
					this._ref.ref,
					this.getFilesQuery.bind(this),
					undefined,
					{
						expand: false,
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
			TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = `${ContextValues.CompareResults}${this._pinned ? '+pinned' : ''}`;
		item.description = description;
		if (this._pinned) {
			item.iconPath = new ThemeIcon('pinned');
		}

		return item;
	}

	@gate()
	@debug()
	async getDiffRefs(): Promise<[string, string]> {
		return Promise.resolve([this._compareWith.ref, this._ref.ref]);
	}

	@log()
	async pin() {
		if (this.pinned) return;

		this._pinned = Date.now();
		await this.updatePinned();

		setImmediate(() => this.view.reveal(this, { focus: true, select: true }));
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
		if (this.pinned) {
			await this.view.updatePinned(currentId);
			await this.updatePinned();
		}

		this._children = undefined;
		this.view.triggerNodeChange(this.parent);
		setImmediate(() => this.view.reveal(this, { expand: true, focus: true, select: true }));
	}

	@log()
	async unpin() {
		if (!this.pinned) return;

		this._pinned = 0;
		await this.view.updatePinned(this.getPinnableId());

		setImmediate(() => this.view.reveal(this, { focus: true, select: true }));
	}

	private getPinnableId() {
		return CompareResultsNode.getPinnableId(this.repoPath, this._ref.ref, this._compareWith.ref);
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

	private async getFilesQuery(): Promise<FilesQueryResults> {
		let comparison;
		if (this._compareWith.ref === '') {
			comparison = this._ref.ref;
		} else if (this._ref.ref === '') {
			comparison = this._compareWith.ref;
		} else {
			comparison = `${this._compareWith.ref}..${this._ref.ref}`;
		}

		const files = await Container.git.getDiffStatus(this.uri.repoPath!, comparison);

		return {
			label: `${Strings.pluralize('file', files?.length ?? 0, { zero: 'No' })} changed`,
			files: files,
		};
	}

	private updatePinned() {
		return this.view.updatePinned(this.getPinnableId(), {
			type: 'comparison',
			timestamp: this._pinned,
			path: this.repoPath,
			ref1: this._ref,
			ref2: this._compareWith,
		});
	}
}
