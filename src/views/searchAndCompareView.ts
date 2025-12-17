import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { SearchAndCompareViewConfig, ViewFilesLayout } from '../config';
import type { SearchQuery } from '../constants.search';
import type { StoredNamedRef, StoredSearchAndCompareItem } from '../constants.storage';
import type { Container } from '../container';
import { unknownGitUri } from '../git/gitUri';
import type { GitLog } from '../git/models/log';
import { getSearchQuery } from '../git/search';
import { createReference } from '../git/utils/reference.utils';
import { showComparisonPicker } from '../quickpicks/comparisonPicker';
import { executeCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { filterMap } from '../system/array';
import { gate } from '../system/decorators/gate';
import { debug, log } from '../system/decorators/log';
import { updateRecordValue } from '../system/object';
import { isPromise } from '../system/promise';
import { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import { ContextValues, ViewNode } from './nodes/abstract/viewNode';
import { CompareResultsNode, restoreComparisonCheckedFiles } from './nodes/compareResultsNode';
import { SearchResultsNode } from './nodes/searchResultsNode';
import type { GroupedViewContext, RevealOptions } from './viewBase';
import { disposeChildren, ViewBase } from './viewBase';
import type { CopyNodeCommandArgs } from './viewCommands';
import { registerViewCommand } from './viewCommands';

export class SearchAndCompareViewNode extends ViewNode<'search-compare', SearchAndCompareView> {
	constructor(view: SearchAndCompareView) {
		super('search-compare', unknownGitUri, view);
	}

	override dispose(): void {
		super.dispose();
		disposeChildren(this._children);
	}

	private _children: (CompareResultsNode | SearchResultsNode)[] | undefined;
	private get children(): (CompareResultsNode | SearchResultsNode)[] {
		if (this._children == null) {
			const children = [];

			// Get stored searches & comparisons
			const stored = this.view.getStoredNodes();
			if (stored.length !== 0) {
				children.push(...stored);
			}

			disposeChildren(this._children, children);
			this._children = children;
		}

		return this._children;
	}
	private set children(value: (CompareResultsNode | SearchResultsNode)[] | undefined) {
		if (this.children === value) return;

		disposeChildren(this.children, value);
		this._children = value;
	}

	getChildren(): ViewNode[] {
		const children = this.children;
		if (children.length === 0) return [];

		return children.sort((a, b) => b.order - a.order);
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('SearchAndCompare', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.SearchAndCompare;
		return item;
	}

	addOrReplace(results: CompareResultsNode | SearchResultsNode): void {
		const children = [...this.children];
		if (children.includes(results)) return;

		const index = children.findIndex(c => c.id === results.id);
		if (index !== -1) {
			children.splice(index, 1);
		}

		children.push(results);
		this.children = children;

		this.view.triggerNodeChange();
	}

	@log()
	async clear(): Promise<void> {
		if (this.children.length === 0) return;

		this.children = [];

		await this.view.clearStorage();

		this.view.triggerNodeChange();
	}

	@log<SearchAndCompareViewNode['dismiss']>({ args: { 0: n => n.toString() } })
	dismiss(node: CompareResultsNode | SearchResultsNode): void {
		node.dismiss();

		const children = [...this.children];
		if (children.length === 0) return;

		const index = children.indexOf(node);
		if (index === -1) return;

		children.splice(index, 1);
		this.children = children;

		this.view.triggerNodeChange();
	}

	@gate()
	@debug()
	override async refresh(reset: boolean = false): Promise<void> {
		const children = this.children;
		if (children.length === 0) return;

		await Promise.allSettled(
			filterMap(children, c => {
				const result = c.refresh?.(reset);
				return isPromise<{ cancel: boolean } | void>(result) ? result : undefined;
			}),
		);
	}
}

export class SearchAndCompareView extends ViewBase<
	'searchAndCompare',
	SearchAndCompareViewNode,
	SearchAndCompareViewConfig
> {
	protected readonly configKey = 'searchAndCompare';

	constructor(container: Container, grouped?: GroupedViewContext) {
		super(container, 'searchAndCompare', 'Search & Compare', 'searchAndCompareView', grouped);
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	protected getRoot(): SearchAndCompareViewNode {
		return new SearchAndCompareViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(this.getQualifiedCommand('clear'), () => void this.clear(), this),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand<CopyNodeCommandArgs>('gitlens.views.copy', this.activeSelection, this.selection),
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
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent): boolean {
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

	clear(): Promise<void> | undefined {
		return this.root?.clear();
	}

	dismissNode(node: ViewNode): void {
		if (this.root == null || !node.isAny('compare-results', 'search-results')) {
			return;
		}

		this.root.dismiss(node);
	}

	@log()
	async compare(
		repoPath: string,
		ref1: string | StoredNamedRef,
		ref2: string | StoredNamedRef,
		options?: { reveal?: boolean },
	): Promise<CompareResultsNode> {
		if (!this.visible && options?.reveal !== false) {
			await this.show({ preserveFocus: false });
		}

		return this.addResultsNode(
			() =>
				new CompareResultsNode(
					this,
					this.ensureRoot(),
					repoPath,
					typeof ref1 === 'string' ? { ref: ref1 } : ref1,
					typeof ref2 === 'string' ? { ref: ref2 } : ref2,
				),
			options?.reveal === false ? false : undefined,
		);
	}

	@log()
	private async selectForCompare(repoPath?: string, ref1?: string | StoredNamedRef): Promise<void> {
		const result = await showComparisonPicker(this.container, repoPath, {
			head: ref1 != null ? createReference(typeof ref1 === 'string' ? ref1 : ref1.ref, repoPath!) : undefined,
			headIncludes: ['branches', 'tags', 'workingTree', 'HEAD'],
		});
		if (result == null) return;

		await this.compare(result.repoPath, result.head.ref, result.base.ref);
	}

	async search(
		repoPath: string,
		search: SearchQuery,
		{
			label,
			reveal,
		}: {
			label: string | { label: string; resultsType?: { singular: string; plural: string } };
			reveal?: RevealOptions;
		},
		results?: Promise<GitLog | undefined> | GitLog,
		updateNode?: SearchResultsNode,
	): Promise<void> {
		if (!this.visible) {
			await this.show({ preserveFocus: reveal?.focus !== true });
		}

		const labels = {
			label: `Search results ${typeof label === 'string' ? label : label.label}`,
			queryLabel: label,
		};
		if (updateNode != null) {
			await updateNode.edit({ pattern: search, labels: labels, log: results });

			return;
		}

		await this.addResultsNode(
			() => new SearchResultsNode(this, this.root!, repoPath, search, labels, results),
			reveal,
		);
	}

	getStoredNodes(): (CompareResultsNode | SearchResultsNode)[] {
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

	clearStorage(): Promise<void> {
		return this.container.storage.deleteWorkspace('views:searchAndCompare:pinned');
	}

	async updateStorage(id: string, item?: StoredSearchAndCompareItem, silent: boolean = false): Promise<void> {
		let stored = this.container.storage.getWorkspace('views:searchAndCompare:pinned');
		stored = updateRecordValue(stored, id, item);
		await this.container.storage.storeWorkspace('views:searchAndCompare:pinned', stored);

		if (!silent) {
			this.triggerNodeChange(this.ensureRoot());
		}
	}

	@gate(() => '')
	async revealRepository(repoPath: string, options?: RevealOptions): Promise<ViewNode | undefined> {
		const node = await this.findNode(n => n instanceof RepositoryFolderNode && n.repoPath === repoPath, {
			maxDepth: 1,
			canTraverse: n => n instanceof SearchAndCompareViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	private async addResultsNode<T extends CompareResultsNode | SearchResultsNode>(
		resultsNodeFn: () => T,
		reveal?: RevealOptions | false,
	): Promise<T> {
		reveal ??= { expand: true, focus: true, select: true };
		const root = this.ensureRoot();

		// Deferred creating the results node until the view is visible (otherwise we will hit a duplicate timing issue when storing the new node, but then loading it from storage during the view's initialization)
		const resultsNode = resultsNodeFn();
		root.addOrReplace(resultsNode);

		if (reveal !== false) {
			await new Promise<void>(resolve =>
				queueMicrotask(async () => {
					await this.reveal(resultsNode, reveal);
					resolve();
				}),
			);
		}

		return resultsNode;
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private swapComparison(node: CompareResultsNode) {
		if (!node.is('compare-results')) return undefined;

		return node.swap();
	}
}
