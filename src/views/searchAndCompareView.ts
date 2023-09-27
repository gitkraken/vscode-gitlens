import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { SearchAndCompareViewConfig, ViewFilesLayout } from '../config';
import type { StoredNamedRef, StoredSearchAndCompareItem } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import type { GitLog } from '../git/models/log';
import { isRevisionRange, shortenRevision, splitRevisionRange } from '../git/models/reference';
import type { SearchQuery } from '../git/search';
import { getSearchQuery } from '../git/search';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { filterMap } from '../system/array';
import { executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import { gate } from '../system/decorators/gate';
import { debug, log } from '../system/decorators/log';
import { updateRecordValue } from '../system/object';
import { isPromise } from '../system/promise';
import { ComparePickerNode } from './nodes/comparePickerNode';
import { CompareResultsNode, restoreComparisonCheckedFiles } from './nodes/compareResultsNode';
import { FilesQueryFilter, ResultsFilesNode } from './nodes/resultsFilesNode';
import { SearchResultsNode } from './nodes/searchResultsNode';
import { ContextValues, RepositoryFolderNode, ViewNode } from './nodes/viewNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class SearchAndCompareViewNode extends ViewNode<SearchAndCompareView> {
	protected override splatted = true;
	private comparePicker: ComparePickerNode | undefined;

	constructor(view: SearchAndCompareView) {
		super(unknownGitUri, view);
	}

	private _children: (ComparePickerNode | CompareResultsNode | SearchResultsNode)[] | undefined;
	private get children(): (ComparePickerNode | CompareResultsNode | SearchResultsNode)[] {
		if (this._children == null) {
			this._children = [];

			// Get stored searches & comparisons
			const stored = this.view.getStoredNodes();
			if (stored.length !== 0) {
				this._children.push(...stored);
			}
		}

		return this._children;
	}

	getChildren(): ViewNode[] {
		const children = this.children;
		if (children.length === 0) return [];

		return children.sort((a, b) => b.order - a.order);
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('SearchAndCompare', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.SearchAndCompare;
		return item;
	}

	addOrReplace(results: CompareResultsNode | SearchResultsNode) {
		const children = this.children;
		if (children.includes(results)) return;

		children.push(results);

		this.view.triggerNodeChange();
	}

	@log()
	async clear() {
		if (this.children.length === 0) return;

		this.removeComparePicker(true);
		this._children!.length = 0;

		await this.view.clearStorage();

		this.view.triggerNodeChange();
	}

	@log<SearchAndCompareViewNode['dismiss']>({ args: { 0: n => n.toString() } })
	dismiss(node: ComparePickerNode | CompareResultsNode | SearchResultsNode) {
		if (node === this.comparePicker) {
			this.removeComparePicker();

			return;
		}

		if (node instanceof CompareResultsNode || node instanceof SearchResultsNode) {
			node.dismiss();
		}

		const children = this.children;
		if (children.length === 0) return;

		const index = children.indexOf(node);
		if (index === -1) return;

		children.splice(index, 1);

		this.view.triggerNodeChange();
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false) {
		const children = this.children;
		if (children.length === 0) return;

		const promises: Promise<any>[] = [
			...filterMap(children, c => {
				const result = c.refresh?.(reset);
				return isPromise<boolean | void>(result) ? result : undefined;
			}),
		];
		await Promise.allSettled(promises);
	}

	async compareWithSelected(repoPath?: string, ref?: string | StoredNamedRef) {
		const selectedRef = this.comparePicker?.selectedRef;
		if (selectedRef == null) return;

		if (repoPath == null) {
			repoPath = selectedRef.repoPath;
		} else if (repoPath !== selectedRef.repoPath) {
			// If we don't have a matching repoPath, then start over
			void this.selectForCompare(repoPath, ref);

			return;
		}

		if (ref == null) {
			const pick = await showReferencePicker(
				repoPath,
				`Compare ${this.getRefName(selectedRef.ref)} with`,
				'Choose a reference to compare with',
				{
					allowEnteringRefs: true,
					picked: typeof selectedRef.ref === 'string' ? selectedRef.ref : selectedRef.ref.ref,
					// checkmarks: true,
					include: ReferencesQuickPickIncludes.BranchesAndTags | ReferencesQuickPickIncludes.HEAD,
					sort: { branches: { current: true } },
				},
			);
			if (pick == null) {
				if (this.comparePicker != null) {
					await this.view.show();
					await this.view.reveal(this.comparePicker, { focus: true, select: true });
				}

				return;
			}

			ref = pick.ref;
		}

		this.removeComparePicker();
		await this.view.compare(repoPath, selectedRef.ref, ref);
	}

	async selectForCompare(repoPath?: string, ref?: string | StoredNamedRef, options?: { prompt?: boolean }) {
		if (repoPath == null) {
			repoPath = (await getRepositoryOrShowPicker('Compare'))?.path;
		}
		if (repoPath == null) return;

		this.removeComparePicker(true);

		let prompt = options?.prompt ?? false;
		let ref2;
		if (ref == null) {
			const pick = await showReferencePicker(repoPath, 'Compare', 'Choose a reference to compare', {
				allowEnteringRefs: { ranges: true },
				// checkmarks: false,
				include:
					ReferencesQuickPickIncludes.BranchesAndTags |
					ReferencesQuickPickIncludes.HEAD |
					ReferencesQuickPickIncludes.WorkingTree,
				sort: { branches: { current: true }, tags: {} },
			});
			if (pick == null) {
				await this.triggerChange();

				return;
			}

			ref = pick.ref;

			if (isRevisionRange(ref)) {
				const range = splitRevisionRange(ref);
				if (range != null) {
					ref = range.ref1 || 'HEAD';
					ref2 = range.ref2 || 'HEAD';
				}
			}

			prompt = true;
		}

		this.comparePicker = new ComparePickerNode(this.view, this, {
			label: this.getRefName(ref),
			repoPath: repoPath,
			ref: ref,
		});
		this.children.unshift(this.comparePicker);
		void setContext('gitlens:views:canCompare', true);

		await this.triggerChange();

		await this.view.reveal(this.comparePicker, { focus: false, select: true });

		if (prompt) {
			await this.compareWithSelected(repoPath, ref2);
		}
	}

	private getRefName(ref: string | StoredNamedRef): string {
		return typeof ref === 'string'
			? shortenRevision(ref, { strings: { working: 'Working Tree' } })!
			: ref.label ?? shortenRevision(ref.ref)!;
	}

	private removeComparePicker(silent: boolean = false) {
		void setContext('gitlens:views:canCompare', false);
		if (this.comparePicker != null) {
			const children = this.children;
			const index = children.indexOf(this.comparePicker);
			if (index !== -1) {
				children.splice(index, 1);
				if (!silent) {
					void this.triggerChange();
				}
			}
			this.comparePicker = undefined;
		}
	}
}

export class SearchAndCompareView extends ViewBase<
	'searchAndCompare',
	SearchAndCompareViewNode,
	SearchAndCompareViewConfig
> {
	protected readonly configKey = 'searchAndCompare';

	constructor(container: Container) {
		super(container, 'searchAndCompare', 'Search & Compare', 'searchAndCompareView');
	}

	protected getRoot() {
		return new SearchAndCompareViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(this.getQualifiedCommand('clear'), () => void this.clear(), this),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToAuto'),
				() => this.setFilesLayout('auto'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout('list'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout('tree'),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),

			registerViewCommand(this.getQualifiedCommand('swapComparison'), this.swapComparison, this),
			registerViewCommand(this.getQualifiedCommand('selectForCompare'), () => this.selectForCompare()),
			registerViewCommand(this.getQualifiedCommand('compareWithSelected'), this.compareWithSelected, this),

			registerViewCommand(
				this.getQualifiedCommand('setFilesFilterOnLeft'),
				n => this.setFilesFilter(n, FilesQueryFilter.Left),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesFilterOnRight'),
				n => this.setFilesFilter(n, FilesQueryFilter.Right),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesFilterOff'),
				n => this.setFilesFilter(n, undefined),
				this,
			),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateLocale') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat')
		) {
			return false;
		}

		return true;
	}

	clear() {
		return this.root?.clear();
	}

	dismissNode(node: ViewNode) {
		if (
			this.root == null ||
			(!(node instanceof ComparePickerNode) &&
				!(node instanceof CompareResultsNode) &&
				!(node instanceof SearchResultsNode))
		) {
			return;
		}

		this.root.dismiss(node);
	}

	compare(repoPath: string, ref1: string | StoredNamedRef, ref2: string | StoredNamedRef) {
		return this.addResults(
			new CompareResultsNode(
				this,
				this.ensureRoot(),
				repoPath,
				typeof ref1 === 'string' ? { ref: ref1 } : ref1,
				typeof ref2 === 'string' ? { ref: ref2 } : ref2,
			),
		);
	}

	compareWithSelected(repoPath?: string, ref?: string | StoredNamedRef) {
		void this.ensureRoot().compareWithSelected(repoPath, ref);
	}

	selectForCompare(repoPath?: string, ref?: string | StoredNamedRef, options?: { prompt?: boolean }) {
		void this.ensureRoot().selectForCompare(repoPath, ref, options);
	}

	async search(
		repoPath: string,
		search: SearchQuery,
		{
			label,
			reveal,
		}: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			reveal?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			};
		},
		results?: Promise<GitLog | undefined> | GitLog,
		updateNode?: SearchResultsNode,
	) {
		if (!this.visible) {
			await this.show();
		}

		const labels = {
			label: `Search results ${typeof label === 'string' ? label : label.label}`,
			queryLabel: label,
		};
		if (updateNode != null) {
			await updateNode.edit({ pattern: search, labels: labels, log: results });

			return;
		}

		await this.addResults(new SearchResultsNode(this, this.root!, repoPath, search, labels, results), reveal);
	}

	getStoredNodes() {
		const stored = this.container.storage.getWorkspace('views:searchAndCompare:pinned');
		if (stored == null) return [];

		const root = this.ensureRoot();
		const nodes = Object.entries(stored)
			.sort(([, a], [, b]) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
			.map(([, p]) => {
				if (p.type === 'comparison') {
					restoreComparisonCheckedFiles(this, p.checkedFiles);

					return new CompareResultsNode(
						this,
						root,
						p.path,
						{ label: p.ref1.label, ref: p.ref1.ref ?? (p.ref1 as any).name ?? (p.ref1 as any).sha },
						{ label: p.ref2.label, ref: p.ref2.ref ?? (p.ref2 as any).name ?? (p.ref2 as any).sha },
						p.timestamp,
					);
				}

				return new SearchResultsNode(
					this,
					root,
					p.path,
					getSearchQuery(p.search),
					p.labels,
					undefined,
					p.timestamp,
				);
			});

		return nodes;
	}

	clearStorage() {
		return this.container.storage.deleteWorkspace('views:searchAndCompare:pinned');
	}

	async updateStorage(id: string, item?: StoredSearchAndCompareItem, silent: boolean = false) {
		let stored = this.container.storage.getWorkspace('views:searchAndCompare:pinned');
		stored = updateRecordValue(stored, id, item);
		await this.container.storage.storeWorkspace('views:searchAndCompare:pinned', stored);

		if (!silent) {
			this.triggerNodeChange(this.ensureRoot());
		}
	}

	@gate(() => '')
	async revealRepository(
		repoPath: string,
		options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
	) {
		const node = await this.findNode(n => n instanceof RepositoryFolderNode && n.repoPath === repoPath, {
			maxDepth: 1,
			canTraverse: n => n instanceof SearchAndCompareViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	private async addResults(
		results: CompareResultsNode | SearchResultsNode,
		options: {
			expand?: boolean | number;
			focus?: boolean;
			select?: boolean;
		} = { expand: true, focus: true, select: true },
	) {
		if (!this.visible) {
			await this.show();
		}

		const root = this.ensureRoot();
		root.addOrReplace(results);

		queueMicrotask(() => this.reveal(results, options));
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private setFilesFilter(node: ResultsFilesNode, filter: FilesQueryFilter | undefined) {
		if (!(node instanceof ResultsFilesNode)) return;

		node.filter = filter;
	}

	private swapComparison(node: CompareResultsNode) {
		if (!(node instanceof CompareResultsNode)) return undefined;

		return node.swap();
	}
}
