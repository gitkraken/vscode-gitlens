'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { NamedRef } from '../../constants';
import { Container } from '../../container';
import { GitService, GitUri } from '../../git/gitService';
import { debug, gate, log, Mutable, Strings } from '../../system';
import { CompareView } from '../compareView';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { FilesQueryResults, ResultsFilesNode } from './resultsFilesNode';
import { ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';

let instanceId = 0;

export class CompareResultsNode extends SubscribeableViewNode<CompareView> {
	static key = ':compare-results';
	static getId(repoPath: string, ref1: string, ref2: string, instanceId: number): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${ref1}|${ref2}):${instanceId}`;
	}

	private _children: ViewNode[] | undefined;
	private _instanceId: number;

	constructor(
		view: CompareView,
		public readonly repoPath: string,
		private _ref: NamedRef,
		private _compareWith: NamedRef,
		private _pinned: boolean = false,
		private _comparisonNotation?: '...' | '..',
	) {
		super(GitUri.fromRepoPath(repoPath), view);
		this._instanceId = instanceId++;
	}

	get id(): string {
		return CompareResultsNode.getId(this.repoPath, this._ref.ref, this._compareWith.ref, this._instanceId);
	}

	get pinned(): boolean {
		return this._pinned;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._children === undefined) {
			const [ref1, ref2] = await this.getDiffRefs();

			this._children = [
				new ResultsCommitsNode(
					this.view,
					this,
					this.uri.repoPath!,
					'commits',
					this.getCommitsQuery.bind(this),
					{
						expand: false,
						includeDescription: true,
					},
				),
				new ResultsFilesNode(this.view, this, this.uri.repoPath!, ref1, ref2, this.getFilesQuery.bind(this)),
			];
		}
		return this._children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let description;
		if ((await Container.git.getRepositoryCount()) > 1) {
			const repo = await Container.git.getRepository(this.uri.repoPath!);
			description = (repo && repo.formattedName) || this.uri.repoPath;
		}

		const item = new TreeItem(
			`Comparing ${
				this._ref.label || GitService.shortenSha(this._ref.ref, { strings: { working: 'Working Tree' } })
			} to ${
				this._compareWith.label ||
				GitService.shortenSha(this._compareWith.ref, { strings: { working: 'Working Tree' } })
			}`,
			this._state || TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = `${ResourceType.CompareResults}+${
			this.comparisonNotation === '..' ? 'twodot' : 'threedot'
		}`;
		if (this._pinned) {
			item.contextValue += '+pinned';
		}

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

	@gate()
	@debug()
	async getDiffRefs(): Promise<[string, string]> {
		if (this.comparisonNotation === '..') {
			return [
				(await Container.git.getMergeBase(this.repoPath, this._compareWith.ref, this._ref.ref)) ||
					this._compareWith.ref,
				this._ref.ref,
			];
		}

		return [this._compareWith.ref, this._ref.ref];
	}

	@log()
	async pin() {
		if (this._pinned) return;

		await this.view.updatePinnedComparison(this.getPinnableId(), {
			path: this.repoPath,
			ref1: this._ref,
			ref2: this._compareWith,
			notation: this._comparisonNotation,
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
	async setComparisonNotation(comparisonNotation: '...' | '..') {
		this._comparisonNotation = comparisonNotation;

		if (this._pinned) {
			await this.view.updatePinnedComparison(this.getPinnableId(), {
				path: this.repoPath,
				ref1: this._ref,
				ref2: this._compareWith,
				notation: this._comparisonNotation,
			});
		}

		this._children = undefined;
		this.view.triggerNodeChange(this);
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
				notation: this._comparisonNotation,
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

	protected subscribe() {
		return undefined;
	}

	private get comparisonNotation() {
		return this._comparisonNotation || (Container.config.advanced.useSymmetricDifferenceNotation ? '...' : '..');
	}

	private get diffComparisonNotation() {
		// In git diff the range syntax doesn't mean the same thing as with git log -- since git diff is about comparing endpoints not ranges
		// see https://git-scm.com/docs/git-diff#Documentation/git-diff.txt-emgitdiffemltoptionsgtltcommitgtltcommitgt--ltpathgt82308203
		// So inverting the range syntax should be about equivalent for the behavior we want
		return this.comparisonNotation === '...' ? '..' : '...';
	}

	private async getCommitsQuery(limit: number | undefined): Promise<CommitsQueryResults> {
		const log = await Container.git.getLog(this.uri.repoPath!, {
			limit: limit,
			ref: `${this._compareWith.ref || 'HEAD'}${this.comparisonNotation}${this._ref.ref || 'HEAD'}`,
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

	private async getFilesQuery(): Promise<FilesQueryResults> {
		let comparison;
		if (this._compareWith.ref === '') {
			comparison = this._ref.ref;
		} else if (this._ref.ref === '') {
			comparison = this._compareWith.ref;
		} else {
			comparison = `${this._compareWith.ref}${this.diffComparisonNotation}${this._ref.ref}`;
		}

		const diff = await Container.git.getDiffStatus(this.uri.repoPath!, comparison);

		return {
			label: `${Strings.pluralize('file', diff !== undefined ? diff.length : 0, { zero: 'No' })} changed`,
			diff: diff,
		};
	}

	private getPinnableId() {
		return Strings.sha1(`${this.repoPath}|${this._ref.ref}|${this._compareWith.ref}`);
	}
}
