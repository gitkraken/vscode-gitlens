'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchComparison, BranchComparisons, GlyphChars, WorkspaceState } from '../../constants';
import { ViewShowBranchComparison } from '../../config';
import { Container } from '../../container';
import { GitBranch, GitRevision } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { HistoryView } from '../historyView';
import { CommandQuickPickItem, ReferencePicker } from '../../quickpicks';
import { RepositoriesView } from '../repositoriesView';
import { RepositoryNode } from './repositoryNode';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { FilesQueryResults, ResultsFilesNode } from './resultsFilesNode';
import { debug, gate, log, Strings } from '../../system';
import { ContextValues, ViewNode } from './viewNode';

export class CompareBranchNode extends ViewNode<HistoryView | RepositoriesView> {
	static key = ':compare-branch';
	static getId(repoPath: string, name: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${name})`;
	}

	private _children: ViewNode[] | undefined;
	private _compareWith: BranchComparison | undefined;

	constructor(
		uri: GitUri,
		view: HistoryView | RepositoriesView,
		parent: ViewNode,
		public readonly branch: GitBranch,
	) {
		super(uri, view, parent);

		const comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
		const compareWith = comparisons?.[branch.id];
		if (compareWith !== undefined && typeof compareWith === 'string') {
			this._compareWith = {
				ref: compareWith,
				notation: Container.config.advanced.useSymmetricDifferenceNotation ? '...' : '..',
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
		if (this._compareWith === undefined) return [];

		if (this._children === undefined) {
			let ref1 = this._compareWith.ref || 'HEAD';
			if (this.comparisonNotation === '..') {
				ref1 = (await Container.git.getMergeBase(this.branch.repoPath, ref1, this.branch.ref)) ?? ref1;
			}

			this._children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'commits',
					this.getCommitsQuery.bind(this),
					{
						expand: false,
						includeDescription: false,
					},
				),
				new ResultsFilesNode(
					this.view,
					this,
					this.uri.repoPath!,
					ref1,
					this.compareWithWorkingTree ? '' : this.branch.ref,
					this.getFilesQuery.bind(this),
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
			label = `${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''}`;
			description = `${GlyphChars.ArrowLeftRightLong}${GlyphChars.Space} ${GitRevision.shorten(
				this._compareWith.ref,
				{
					strings: {
						working: 'Working Tree',
					},
				},
			)}`;
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
		item.contextValue = `${ContextValues.CompareBranch}${this._compareWith === undefined ? '' : '+comparing'}+${
			this.comparisonNotation === '..' ? 'twodot' : 'threedot'
		}+${this.comparisonType}`;
		item.description = description;
		if (this.compareWithWorkingTree) {
			item.iconPath = {
				dark: Container.context.asAbsolutePath('images/dark/icon-compare-ref-working.svg'),
				light: Container.context.asAbsolutePath('images/light/icon-compare-ref-working.svg'),
			};
		} else {
			item.iconPath = new ThemeIcon('git-compare');
		}
		item.id = this.id;
		item.tooltip = `Click to compare ${this.branch.name}${this.compareWithWorkingTree ? ' (working)' : ''} with${
			GlyphChars.Ellipsis
		}`;

		return item;
	}

	@log()
	async setComparisonNotation(comparisonNotation: '...' | '..') {
		if (this._compareWith !== undefined) {
			await this.updateCompareWith({ ...this._compareWith, notation: comparisonNotation });
		}

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	@log()
	async setComparisonType(comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (this._compareWith !== undefined) {
			await this.updateCompareWith({ ...this._compareWith, type: comparisonType });
		}

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	private get comparisonNotation(): '..' | '...' {
		return this._compareWith?.notation ?? (Container.config.advanced.useSymmetricDifferenceNotation ? '...' : '..');
	}

	private get diffComparisonNotation(): '..' | '...' {
		// In git diff the range syntax doesn't mean the same thing as with git log -- since git diff is about comparing endpoints not ranges
		// see https://git-scm.com/docs/git-diff#Documentation/git-diff.txt-emgitdiffemltoptionsgtltcommitgtltcommitgt--ltpathgt82308203
		// So inverting the range syntax should be about equivalent for the behavior we want
		return this.comparisonNotation === '...' ? '..' : '...';
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
			{ allowEnteringRefs: true, picked: this.branch.ref /*checkmarks: true*/ },
		);
		if (pick === undefined || pick instanceof CommandQuickPickItem) return;

		await this.updateCompareWith({
			ref: pick.ref,
			notation: this.comparisonNotation,
			type: this.comparisonType,
		});

		this._children = undefined;
		this.view.triggerNodeChange(this);
	}

	private async getCommitsQuery(limit: number | undefined): Promise<CommitsQueryResults> {
		const log = await Container.git.getLog(this.uri.repoPath!, {
			limit: limit,
			ref: GitRevision.createRange(
				this._compareWith?.ref ?? 'HEAD',
				this.compareWithWorkingTree ? '' : this.branch.ref,
				this.comparisonNotation,
			),
		});

		const count = log?.count ?? 0;
		const results: Mutable<Partial<CommitsQueryResults>> = {
			label: Strings.pluralize('commit', count, {
				number: log?.hasMore ?? false ? `${count}+` : undefined,
				zero: 'No',
			}),
			log: log,
			hasMore: log?.hasMore ?? true,
		};
		if (results.hasMore) {
			results.more = async (limit: number | undefined) => {
				results.log = (await results.log?.more?.(limit)) ?? results.log;

				const count = results.log?.count ?? 0;
				results.label = Strings.pluralize('commit', count, {
					number: results.log?.hasMore ?? false ? `${count}+` : undefined,
					zero: 'No',
				});
				results.hasMore = results.log?.hasMore ?? true;
			};
		}

		return results as CommitsQueryResults;
	}

	@gate()
	@debug()
	refresh() {
		this._children = undefined;
	}

	private async getFilesQuery(): Promise<FilesQueryResults> {
		const diff = await Container.git.getDiffStatus(
			this.uri.repoPath!,
			GitRevision.createRange(
				this._compareWith?.ref ?? 'HEAD',
				this.compareWithWorkingTree ? '' : this.branch.ref,
				this.diffComparisonNotation,
			),
		);

		return {
			label: `${Strings.pluralize('file', diff !== undefined ? diff.length : 0, { zero: 'No' })} changed`,
			diff: diff,
		};
	}

	private async updateCompareWith(compareWith: BranchComparison | undefined) {
		this._compareWith = compareWith;

		let comparisons = Container.context.workspaceState.get<BranchComparisons>(WorkspaceState.BranchComparisons);
		if (comparisons === undefined) {
			comparisons = Object.create(null) as BranchComparisons;
		}

		if (compareWith) {
			comparisons[this.branch.id] = { ...compareWith };
		} else {
			const { [this.branch.id]: _, ...rest } = comparisons;
			comparisons = rest;
		}
		await Container.context.workspaceState.update(WorkspaceState.BranchComparisons, comparisons);
	}
}
