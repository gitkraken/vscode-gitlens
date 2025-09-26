import type { Disposable, TreeView } from 'vscode';
import { CancellationTokenSource, EventEmitter, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GroupableTreeViewTypes } from '../constants.views';
import type { Container } from '../container';
import { setContext } from '../system/-webview/context';
import { once } from '../system/function';
import { first } from '../system/iterable';
import { lazy } from '../system/lazy';
import type { Deferred } from '../system/promise';
import { defer, isPromise } from '../system/promise';
import { BranchesView } from './branchesView';
import { CommitsView } from './commitsView';
import { ContributorsView } from './contributorsView';
import { FileHistoryView } from './fileHistoryView';
import { LaunchpadView } from './launchpadView';
import type { ViewNode } from './nodes/abstract/viewNode';
import { RemotesView } from './remotesView';
import { RepositoriesView } from './repositoriesView';
import { SearchAndCompareView } from './searchAndCompareView';
import { StashesView } from './stashesView';
import { TagsView } from './tagsView';
import type { GroupedViewContext, TreeViewByType } from './viewBase';
import type { Views } from './views';
import { WorktreesView } from './worktreesView';

const emptyArray: ViewNode[] = [];
const emptyTreeItem: TreeItem = new TreeItem('', TreeItemCollapsibleState.None);

/** Whether to reuse or destroy the tree when switching views (until we can figure out which is better) */
const destroyTree = false;

export class ScmGroupedView implements Disposable {
	private _cancellationSource: CancellationTokenSource | undefined;
	private _cleared: Deferred<void> | undefined;
	private _clearLoadingTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _disposable: Disposable;
	private _lastSelectedByView = new Map<
		GroupableTreeViewTypes,
		{ node: ViewNode; parents: ViewNode[] | undefined; expanded: boolean }
	>();
	private _loaded: Deferred<void> | undefined;
	private _onDidChangeTreeData: EventEmitter<ViewNode | undefined> | undefined;
	private _tree: TreeView<ViewNode> | undefined;
	private _view: TreeViewByType[GroupableTreeViewTypes] | undefined;

	constructor(
		private readonly container: Container,
		private views: Views,
	) {
		this._disposable = once(container.onReady)(this.onReady, this);
	}

	dispose(): void {
		this._tree?.dispose();
		this._view?.dispose();
		this._disposable.dispose();
	}

	private onReady() {
		// Since we don't want the view to open on every load, prevent revealing it
		this._view = this.setView(this.views.lastSelectedScmGroupedView!, { focus: false, preventReveal: true });
	}

	get view(): TreeViewByType[GroupableTreeViewTypes] | undefined {
		return this._view;
	}

	async clearView<T extends GroupableTreeViewTypes>(type: T): Promise<void> {
		if (this._view == null || this._view.type === type) return;

		// Save current selection before switching views
		const node: ViewNode | undefined = this._view.selection?.[0];
		if (node != null) {
			const parents: ViewNode[] = [];

			let parent: ViewNode | undefined = node;
			while (true) {
				parent = parent.getParent();
				if (parent == null) break;

				parents.unshift(parent);
			}

			this._lastSelectedByView.set(this._view.type, {
				node: node,
				parents: parents,
				expanded: this._view.isNodeExpanded(node),
			});
		}

		void setContext('gitlens:views:scm:grouped:loading', true);
		clearTimeout(this._clearLoadingTimer);

		if (this._cancellationSource != null) {
			this._cancellationSource.cancel();
			this._cancellationSource = undefined;
		}

		// Tear down the current view
		this._view?.dispose();
		this._view = undefined;

		this.resetTree();

		if (!destroyTree) {
			// Force a "refresh" of the tree to blank it out
			this._cleared?.cancel();
			if (this._tree?.visible) {
				this._cleared = defer<void>();
				this._onDidChangeTreeData?.fire(undefined);
				await this._cleared.promise.catch(() => {}).finally(() => (this._cleared = undefined));
			}
			this._cleared = undefined;
		}
	}

	private resetTree() {
		if (this._tree == null) return;

		this._tree.badge = undefined;
		this._tree.message = undefined;
		// Don't clear the title or description as each view will manage it themselves

		if (destroyTree) {
			this._tree.dispose();
			this._tree = undefined;
		}
	}

	setView<T extends GroupableTreeViewTypes>(
		type: T,
		options?: { focus?: boolean; preventReveal?: boolean },
	): TreeViewByType[T] {
		if (!this.views.scmGroupedViews?.has(type)) {
			type = this.views.scmGroupedViews?.size ? (first(this.views.scmGroupedViews) as T) : undefined!;
		}

		void setContext('gitlens:views:scm:grouped:loading', true);
		clearTimeout(this._clearLoadingTimer);

		const wasVisible = this._tree?.visible ?? false;
		this.resetTree();

		this._loaded?.cancel();
		this._loaded = defer<void>();
		void this._loaded.promise.then(
			async () => {
				this._loaded = undefined;

				const view = this._view;
				if (view != null) {
					if (!options?.preventReveal && !view.visible) {
						await view.show({ preserveFocus: !options?.focus });
					}

					let selection = this._lastSelectedByView.get(type);

					setTimeout(async () => {
						if (selection == null && view.selection?.length) {
							selection = { node: view.selection[0], parents: undefined, expanded: false };
						}
						if (selection == null) {
							if (options?.focus) {
								await view.show({ preserveFocus: false });
							}
							return;
						}

						const { node, parents, expanded } = selection;
						if (parents == null) {
							await view.revealDeep(node, {
								expand: expanded,
								focus: options?.focus ?? false,
								select: true,
							});
						} else {
							await view.revealDeep(node, parents, {
								expand: expanded,
								focus: options?.focus ?? false,
								select: true,
							});
						}
					}, 50);
				}

				this._clearLoadingTimer = setTimeout(
					() => void setContext('gitlens:views:scm:grouped:loading', false),
					500,
				);
			},
			() => {},
		);

		if (this._view?.type !== type) {
			this._view?.dispose();
			this._view = this.getView(type);

			if (!destroyTree) {
				this._view.triggerNodeChange();
			}
		}

		this.views.lastSelectedScmGroupedView = type;

		if (!options?.preventReveal && !wasVisible) {
			void this._view.show({ preserveFocus: !options?.focus });
		}

		return this._view as TreeViewByType[T];
	}

	private ensureGroupedContext(): GroupedViewContext {
		this._onDidChangeTreeData ??= new EventEmitter<ViewNode | undefined>();
		this._cancellationSource = new CancellationTokenSource();

		const onDidChangeTreeData = this._onDidChangeTreeData;
		const lazyTree = lazy(
			() =>
				(this._tree ??= window.createTreeView<ViewNode>('gitlens.views.scm.grouped', {
					canSelectMany: true,
					showCollapseAll: false,
					treeDataProvider: {
						get onDidChangeTreeData() {
							return onDidChangeTreeData.event;
						},
						getTreeItem: node => {
							if (this._view == null) {
								this._cleared?.fulfill();
								return emptyTreeItem;
							}

							const result = this._view.getTreeItem(node);
							if (!isPromise(result)) {
								this._loaded?.fulfill();
								return result;
							}

							const promise = new Promise<TreeItem>(resolve => {
								void result.then(resolve);
								this._cancellationSource?.token.onCancellationRequested(() => resolve(emptyTreeItem));
							});
							void promise.finally(() => this._loaded?.fulfill());
							return promise;
						},
						getChildren: node => {
							if (this._view == null) {
								this._cleared?.fulfill();
								return emptyArray;
							}

							const result = this._view.getChildren(node);
							if (!isPromise(result)) {
								this._loaded?.fulfill();
								return result;
							}

							const promise = new Promise<ViewNode[]>(resolve => {
								void result.then(resolve);
								this._cancellationSource?.token.onCancellationRequested(() => resolve(emptyArray));
							});
							void promise.finally(() => this._loaded?.fulfill());
							return promise;
						},
						getParent: node => this._view?.getParent(node),
						resolveTreeItem: (item, node, token) => this._view?.resolveTreeItem(item, node, token),
					},
				})),
		);

		return {
			onDidChangeTreeData: onDidChangeTreeData,
			tree: lazyTree,
			cancellation: this._cancellationSource.token,
		};
	}

	private getView(type: GroupableTreeViewTypes) {
		const grouped = this.ensureGroupedContext();

		switch (type) {
			case 'branches':
				return new BranchesView(this.container, grouped);
			case 'commits':
				return new CommitsView(this.container, grouped);
			case 'contributors':
				return new ContributorsView(this.container, grouped);
			case 'fileHistory':
				return new FileHistoryView(this.container, grouped);
			case 'launchpad':
				return new LaunchpadView(this.container, grouped);
			case 'remotes':
				return new RemotesView(this.container, grouped);
			case 'repositories':
				return new RepositoriesView(this.container, grouped);
			case 'searchAndCompare':
				return new SearchAndCompareView(this.container, grouped);
			case 'stashes':
				return new StashesView(this.container, grouped);
			case 'tags':
				return new TagsView(this.container, grouped);
			case 'worktrees':
				return new WorktreesView(this.container, grouped);
		}
	}
}
