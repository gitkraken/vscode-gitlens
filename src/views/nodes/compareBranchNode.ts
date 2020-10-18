'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchesView } from '../branchesView';
import { CommitsView } from '../commitsView';
import { BranchComparison, BranchComparisons, GlyphChars, WorkspaceState } from '../../constants';
import { BranchSorting, TagSorting, ViewShowBranchComparison } from '../../configuration';
import { Container } from '../../container';
import { GitBranch, GitRevision } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { CommandQuickPickItem, ReferencePicker } from '../../quickpicks';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { FilesQueryResults } from './resultsFilesNode';
import { debug, gate, log, Strings } from '../../system';
import { ContextValues, ViewNode } from './viewNode';

export class CompareBranchNode extends ViewNode<BranchesView | CommitsView | RepositoriesView> {
	static key = ':compare-branch';
	static getId(repoPath: string, name: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})`;
	}

	private _children: ViewNode[] | undefined;
	private _compareWith: BranchComparison | undefined;

	constructor(
		uri: GitUri,
		view: BranchesView | CommitsView | RepositoriesView,
		parent: ViewNode,
		public readonly branch: GitBranch,
	) {
		super(uri, view, parent);

		const comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
		const compareWith = comparisons?.[branch.id];
		if (compareWith !== undefined && typeof compareWith === 'string') {
			this._compareWith = {
				ref: compareWith,
				notation: undefined,
				// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				type: this.view.config.showBranchComparison || ViewShowBranchComparison.Working,
			};
		} else {
			this._compareWith = compareWith;
		}
	}

	get id(): string {
		return CompareBranchNode.getId(this.branch.repoPath, this.branch.name);
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._compareWith == null) return [];

		if (this._children == null) {
			const aheadBehind = await Container.git.getAheadBehindCommitCount(this.branch.repoPath, [
				GitRevision.createRange(this.branch.ref, this._compareWith.ref || 'HEAD', '...'),
			]);

			this._children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'Behind',
					this.getCommitsQuery(
						GitRevision.createRange(this.branch.ref, this._compareWith.ref || 'HEAD', '..'),
					),
					{
						id: 'behind',
						description: Strings.pluralize('commit', aheadBehind?.behind ?? 0),
						expand: false,
						includeRepoName: true,
						files: {
							ref1: this.compareWithWorkingTree ? '' : this.branch.ref,
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
						GitRevision.createRange(
							this._compareWith.ref || 'HEAD',
							this.compareWithWorkingTree ? '' : this.branch.ref,
							'..',
						),
					),
					{
						id: 'ahead',
						description: Strings.pluralize('commit', aheadBehind?.ahead ?? 0),
						expand: false,
						includeRepoName: true,
						files: {
							ref1: this._compareWith.ref || 'HEAD',
							ref2: this.compareWithWorkingTree ? '' : this.branch.ref,
							query: this.getAheadFilesQuery.bind(this),
						},
					},
				),
			];
		}
		return this._children;
	}

	getTreeItem(): TreeItem {
		let state: TreeItemCollapsibleState;
		let label;
		let description;
		if (this._compareWith === undefined) {
			label = `Compare ${this.branch.name}${
				this.compareWithWorkingTree ? ' (working)' : ''
			} with <branch, tag, or ref>`;
			state = TreeItemCollapsibleState.None;
		} else {
			label = `Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''}`;
			description = `with ${GitRevision.shorten(this._compareWith.ref, {
				strings: { working: 'Working Tree' },
			})}`;
			state = TreeItemCollapsibleState.Collapsed;
		}

		const item = new TreeItem(label, state);
		item.command = {
			title: `Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${
				GlyphChars.Ellipsis
			}`,
			command: 'gitlens.views.executeNodeCallback',
			arguments: [() => this.compareWith()],
		};
		item.contextValue = `${ContextValues.CompareBranch}${this.branch.current ? '+current' : ''}+${
			this.comparisonType
		}${this._compareWith == null ? '' : '+comparing'}`;
		item.description = description;
		item.iconPath = new ThemeIcon('git-compare');
		item.id = this.id;
		item.tooltip = `Click to compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${
			GlyphChars.Ellipsis
		}`;

		return item;
	}

	@log()
	async clear() {
		if (this._compareWith == null) return;

		this._compareWith = undefined;
		await this.updateCompareWith(undefined);

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	@gate()
	@debug()
	refresh() {
		this._children = undefined;
	}

	@log()
	async setComparisonType(comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (this._compareWith !== undefined) {
			await this.updateCompareWith({ ...this._compareWith, type: comparisonType });
		}

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	private get comparisonType() {
		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		return this._compareWith?.type ?? (this.view.config.showBranchComparison || ViewShowBranchComparison.Working);
	}

	private get compareWithWorkingTree() {
		return this.comparisonType === ViewShowBranchComparison.Working;
	}

	private async compareWith() {
		const pick = await ReferencePicker.show(
			this.branch.repoPath,
			`Compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with`,
			'Choose a reference to compare with',
			{
				allowEnteringRefs: true,
				picked: this.branch.ref,
				// checkmarks: true,
				sort: {
					branches: { current: true, orderBy: BranchSorting.DateDesc },
					tags: { orderBy: TagSorting.DateDesc },
				},
			},
		);
		if (pick === undefined || pick instanceof CommandQuickPickItem) return;

		await this.updateCompareWith({
			ref: pick.ref,
			notation: undefined,
			type: this.comparisonType,
		});

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	private async getAheadFilesQuery(): Promise<FilesQueryResults> {
		let files = await Container.git.getDiffStatus(
			this.uri.repoPath!,
			// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
			GitRevision.createRange(this._compareWith?.ref || 'HEAD', this.branch.ref, '...'),
		);

		if (this.compareWithWorkingTree) {
			const workingFiles = await Container.git.getDiffStatus(this.uri.repoPath!, 'HEAD');
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
		const files = await Container.git.getDiffStatus(
			this.uri.repoPath!,
			this.compareWithWorkingTree
				? // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				  this._compareWith?.ref || 'HEAD'
				: // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
				  GitRevision.createRange(this.branch.ref, this._compareWith?.ref || 'HEAD', '...'),
		);

		return {
			label: `${Strings.pluralize('file', files?.length ?? 0, { zero: 'No' })} changed`,
			files: files,
		};
	}

	private getCommitsQuery(range: string): (limit: number | undefined) => Promise<CommitsQueryResults> {
		const repoPath = this.uri.repoPath!;
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

	private async updateCompareWith(compareWith: BranchComparison | undefined) {
		this._compareWith = compareWith;

		let comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
		if (comparisons === undefined) {
			comparisons = Object.create(null) as BranchComparisons;
		}

		const id = `${this.branch.id}${this.branch.current ? '+current' : ''}`;

		if (compareWith != null) {
			comparisons[id] = { ...compareWith };
		} else {
			const { [id]: _, ...rest } = comparisons;
			comparisons = rest;
		}
		await Container.context.workspaceState.update(WorkspaceState.BranchComparisons, comparisons);
	}
}
