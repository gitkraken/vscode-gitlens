import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { SearchAndCompareViewConfig } from '../config';
import { ViewFilesLayout } from '../config';
import { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { unknownGitUri } from '../git/gitUri';
import type { GitLog } from '../git/models/log';
import { isRevisionRange, shortenRevision, splitRevisionRange } from '../git/models/reference';
import type { SearchQuery } from '../git/search';
import { getSearchQuery } from '../git/search';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import type { StoredNamedRef, StoredPinnedItem, StoredPinnedItems } from '../storage';
import { filterMap } from '../system/array';
import { executeCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { gate } from '../system/decorators/gate';
import { debug, log } from '../system/decorators/log';
import { updateRecordValue } from '../system/object';
import { isPromise } from '../system/promise';
import { ComparePickerNode } from './nodes/comparePickerNode';
import { CompareResultsNode } from './nodes/compareResultsNode';
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

			// Get pinned searches & comparisons
			const pinned = this.view.getPinned();
			if (pinned.length !== 0) {
				this._children.push(...pinned);
			}
		}

		return this._children;
	}

	getChildren(): ViewNode[] {
		if (this.children.length === 0) return [];

		this.view.message = undefined;

		return this.children.sort((a, b) => (a.pinned ? -1 : 1) - (b.pinned ? -1 : 1) || b.order - a.order);
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('SearchAndCompare', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.SearchAndCompare;
		return item;
	}

	addOrReplace(results: CompareResultsNode | SearchResultsNode, replace: boolean) {
		if (this.children.includes(results)) return;

		if (replace) {
			this.clear();
		}

		this.children.push(results);

		this.view.triggerNodeChange();
	}

	@log()
	clear(silent: boolean = false) {
		if (this.children.length === 0) return;

		this.removeComparePicker(true);
		const index = this._children!.findIndex(c => !c.pinned);
		if (index !== -1) {
			this._children!.splice(index, this._children!.length);
		}

		if (!silent) {
			this.view.triggerNodeChange();
		}
	}

	@log<SearchAndCompareViewNode['dismiss']>({ args: { 0: n => n.toString() } })
	dismiss(node: ComparePickerNode | CompareResultsNode | SearchResultsNode) {
		if (node === this.comparePicker) {
			this.removeComparePicker();

			return;
		}

		if (this.children.length === 0) return;

		const index = this.children.indexOf(node);
		if (index === -1) return;

		this.children.splice(index, 1);

		this.view.triggerNodeChange();
	}

	@gate()
	@debug()
	override async refresh() {
		if (this.children.length === 0) return;

		const promises: Promise<any>[] = [
			...filterMap(this.children, c => {
				const result = c.refresh === undefined ? false : c.refresh();
				return isPromise<boolean | void>(result) ? result : undefined;
			}),
		];
		await Promise.all(promises);
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
		this.children.splice(0, 0, this.comparePicker);
		void setContext(ContextKeys.ViewsCanCompare, true);

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
		void setContext(ContextKeys.ViewsCanCompare, false);
		if (this.comparePicker != null) {
			const index = this.children.indexOf(this.comparePicker);
			if (index !== -1) {
				this.children.splice(index, 1);
				if (!silent) {
					void this.triggerChange();
				}
			}
			this.comparePicker = undefined;
		}
	}
}

export class SearchAndCompareView extends ViewBase<SearchAndCompareViewNode, SearchAndCompareViewConfig> {
	protected readonly configKey = 'searchAndCompare';

	constructor(container: Container) {
		super(container, 'gitlens.views.searchAndCompare', 'Search & Compare', 'searchAndCompareView');

		void setContext(ContextKeys.ViewsSearchAndCompareKeepResults, this.keepResults);
	}

	protected getRoot() {
		return new SearchAndCompareViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerViewCommand(this.getQualifiedCommand('clear'), () => this.clear(), this),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToAuto'),
				() => this.setFilesLayout(ViewFilesLayout.Auto),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout(ViewFilesLayout.List),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout(ViewFilesLayout.Tree),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this),
			registerViewCommand(
				this.getQualifiedCommand('setKeepResultsToOff'),
				() => this.setKeepResults(false),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),

			registerViewCommand(this.getQualifiedCommand('pin'), this.pin, this),
			registerViewCommand(this.getQualifiedCommand('unpin'), this.unpin, this),
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

	get keepResults(): boolean {
		return this.container.storage.getWorkspace('views:searchAndCompare:keepResults', true);
	}

	clear() {
		this.root?.clear();
	}

	dismissNode(node: ViewNode) {
		if (
			this.root == null ||
			(!(node instanceof ComparePickerNode) &&
				!(node instanceof CompareResultsNode) &&
				!(node instanceof SearchResultsNode)) ||
			!node.canDismiss
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

		const labels = { label: `Results ${typeof label === 'string' ? label : label.label}`, queryLabel: label };
		if (updateNode != null) {
			await updateNode.edit({ pattern: search, labels: labels, log: results });

			return;
		}

		await this.addResults(new SearchResultsNode(this, this.root!, repoPath, search, labels, results), reveal);
	}

	getPinned() {
		let savedPins = this.container.storage.getWorkspace('views:searchAndCompare:pinned');
		if (savedPins == null) {
			// Migrate any deprecated pinned items
			const deprecatedPins = this.container.storage.getWorkspace('pinned:comparisons');
			if (deprecatedPins == null) return [];

			savedPins = Object.create(null) as StoredPinnedItems;
			for (const p of Object.values(deprecatedPins)) {
				savedPins[CompareResultsNode.getPinnableId(p.path, p.ref1.ref, p.ref2.ref)] = {
					type: 'comparison',
					timestamp: Date.now(),
					path: p.path,
					ref1: p.ref1,
					ref2: p.ref2,
				};
			}

			void this.container.storage.storeWorkspace('views:searchAndCompare:pinned', savedPins);
			void this.container.storage.deleteWorkspace('pinned:comparisons');
		}

		const migratedPins = Object.create(null) as StoredPinnedItems;
		let migrated = false;

		const root = this.ensureRoot();
		const pins = Object.entries(savedPins)
			.sort(([, a], [, b]) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
			.map(([k, p]) => {
				if (p.type === 'comparison') {
					// Migrated any old keys (sha1) to new keys (md5)
					const key = CompareResultsNode.getPinnableId(p.path, p.ref1.ref, p.ref2.ref);
					if (k !== key) {
						migrated = true;
						migratedPins[key] = p;
					} else {
						migratedPins[k] = p;
					}

					return new CompareResultsNode(
						this,
						root,
						p.path,
						{ label: p.ref1.label, ref: p.ref1.ref ?? (p.ref1 as any).name ?? (p.ref1 as any).sha },
						{ label: p.ref2.label, ref: p.ref2.ref ?? (p.ref2 as any).name ?? (p.ref2 as any).sha },
						p.timestamp,
					);
				}

				// Migrated any old keys (sha1) to new keys (md5)
				const key = SearchResultsNode.getPinnableId(p.path, p.search);
				if (k !== key) {
					migrated = true;
					migratedPins[key] = p;
				} else {
					migratedPins[k] = p;
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

		if (migrated) {
			void this.container.storage.storeWorkspace('views:searchAndCompare:pinned', migratedPins);
		}
		return pins;
	}

	async updatePinned(id: string, pin?: StoredPinnedItem) {
		let pinned = this.container.storage.getWorkspace('views:searchAndCompare:pinned');
		pinned = updateRecordValue(pinned, id, pin);
		await this.container.storage.storeWorkspace('views:searchAndCompare:pinned', pinned);

		this.triggerNodeChange(this.ensureRoot());
	}

	@gate(() => '')
	async revealRepository(
		repoPath: string,
		options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
	) {
		const node = await this.findNode(RepositoryFolderNode.getId(repoPath), {
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
		root.addOrReplace(results, !this.keepResults);

		queueMicrotask(() => this.reveal(results, options));
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setKeepResults(enabled: boolean) {
		void this.container.storage.storeWorkspace('views:searchAndCompare:keepResults', enabled);
		void setContext(ContextKeys.ViewsSearchAndCompareKeepResults, enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private pin(node: CompareResultsNode | SearchResultsNode) {
		if (!(node instanceof CompareResultsNode) && !(node instanceof SearchResultsNode)) return undefined;

		return node.pin();
	}

	private setFilesFilter(node: ResultsFilesNode, filter: FilesQueryFilter | undefined) {
		if (!(node instanceof ResultsFilesNode)) return;

		node.filter = filter;
	}

	private swapComparison(node: CompareResultsNode) {
		if (!(node instanceof CompareResultsNode)) return undefined;

		return node.swap();
	}

	private unpin(node: CompareResultsNode | SearchResultsNode) {
		if (!(node instanceof CompareResultsNode) && !(node instanceof SearchResultsNode)) return undefined;

		return node.unpin();
	}
}
