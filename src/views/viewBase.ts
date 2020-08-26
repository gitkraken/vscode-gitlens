'use strict';
import {
	CancellationToken,
	commands,
	ConfigurationChangeEvent,
	ConfigurationTarget,
	Disposable,
	Event,
	EventEmitter,
	MessageItem,
	TreeDataProvider,
	TreeItem,
	TreeItemCollapsibleState,
	TreeView,
	TreeViewExpansionEvent,
	TreeViewVisibilityChangeEvent,
	window,
} from 'vscode';
import { BranchesView } from './branchesView';
import { CommitsView } from './commitsView';
import { CompareView } from './compareView';
import {
	BranchesViewConfig,
	CommitsViewConfig,
	CompareViewConfig,
	configuration,
	ContributorsViewConfig,
	FileHistoryViewConfig,
	LineHistoryViewConfig,
	RemotesViewConfig,
	RepositoriesViewConfig,
	SearchViewConfig,
	StashesViewConfig,
	TagsViewConfig,
	ViewsCommonConfig,
	viewsCommonConfigKeys,
	viewsConfigKeys,
	ViewsConfigKeys,
} from '../configuration';
import { Container } from '../container';
import { ContributorsView } from './contributorsView';
import { FileHistoryView } from './fileHistoryView';
import { LineHistoryView } from './lineHistoryView';
import { Logger } from '../logger';
import { PageableViewNode, ViewNode } from './nodes';
import { RemotesView } from './remotesView';
import { RepositoriesView } from './repositoriesView';
import { SearchView } from './searchView';
import { StashesView } from './stashesView';
import { debug, Functions, log, Promises, Strings } from '../system';
import { TagsView } from './tagsView';
import { GlyphChars } from '../constants';

export type View =
	| BranchesView
	| CompareView
	| ContributorsView
	| FileHistoryView
	| CommitsView
	| LineHistoryView
	| RemotesView
	| RepositoriesView
	| SearchView
	| StashesView
	| TagsView;
export type ViewsWithFiles =
	| BranchesView
	| CompareView
	| ContributorsView
	| CommitsView
	| RemotesView
	| RepositoriesView
	| SearchView
	| StashesView
	| TagsView;

export interface TreeViewNodeStateChangeEvent<T> extends TreeViewExpansionEvent<T> {
	state: TreeItemCollapsibleState;
}

export abstract class ViewBase<
	RootNode extends ViewNode<View>,
	ViewConfig extends
		| BranchesViewConfig
		| CompareViewConfig
		| ContributorsViewConfig
		| FileHistoryViewConfig
		| CommitsViewConfig
		| LineHistoryViewConfig
		| RemotesViewConfig
		| RepositoriesViewConfig
		| SearchViewConfig
		| StashesViewConfig
		| TagsViewConfig
> implements TreeDataProvider<ViewNode>, Disposable {
	protected _onDidChangeTreeData = new EventEmitter<ViewNode | undefined>();
	get onDidChangeTreeData(): Event<ViewNode | undefined> {
		return this._onDidChangeTreeData.event;
	}

	private _onDidChangeVisibility = new EventEmitter<TreeViewVisibilityChangeEvent>();
	get onDidChangeVisibility(): Event<TreeViewVisibilityChangeEvent> {
		return this._onDidChangeVisibility.event;
	}

	private _onDidChangeNodeState = new EventEmitter<TreeViewNodeStateChangeEvent<ViewNode>>();
	get onDidChangeNodeState(): Event<TreeViewNodeStateChangeEvent<ViewNode>> {
		return this._onDidChangeNodeState.event;
	}

	protected _disposable: Disposable | undefined;
	private readonly _lastKnownLimits = new Map<string, number | undefined>();
	protected _root: RootNode | undefined;
	protected _tree: TreeView<ViewNode> | undefined;

	constructor(public readonly id: string, public readonly name: string) {
		if (Logger.isDebugging) {
			const fn = this.getTreeItem;
			this.getTreeItem = async function (this: ViewBase<RootNode, ViewConfig>, node: ViewNode) {
				const item = await fn.apply(this, [node]);

				const parent = node.getParent();
				if (parent != null) {
					item.tooltip = `${
						item.tooltip ?? item.label
					}\n\nDBG:\nnode: ${node.toString()}\nparent: ${parent.toString()}\ncontext: ${item.contextValue}`;
				} else {
					item.tooltip = `${item.tooltip ?? item.label}\n\nDBG:\nnode: ${node.toString()}\ncontext: ${
						item.contextValue
					}`;
				}
				return item;
			};
		}

		this.registerCommands();

		Container.context.subscriptions.push(
			configuration.onDidChange(e => {
				if (!this.filterConfigurationChanged(e)) return;

				this._config = undefined;
				this.onConfigurationChanged(e);
			}, this),
		);
		setImmediate(() => this.onConfigurationChanged(configuration.initializingChangeEvent));
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'views')) return false;

		if (configuration.changed(e, 'views', this.configKey)) return true;
		for (const key of viewsCommonConfigKeys) {
			if (configuration.changed(e, 'views', key)) return true;
		}

		return false;
	}

	dispose() {
		this._disposable?.dispose();
	}

	private _title: string | undefined;
	get title(): string | undefined {
		return this._title;
	}
	set title(value: string | undefined) {
		this._title = value;
		this.updateTitle();
	}

	private _titleDescription: string | undefined;
	get titleDescription(): string | undefined {
		return this._titleDescription;
	}
	set titleDescription(value: string | undefined) {
		this._titleDescription = value;
		this.updateTitle();
	}

	private _updateTitleDebounced: (() => void) | undefined = undefined;
	private updateTitle() {
		if (this._tree == null) return;

		if (this._updateTitleDebounced === undefined) {
			this._updateTitleDebounced = Functions.debounce(this.updateTitleCore.bind(this), 100);
		}

		this._updateTitleDebounced();
	}

	private updateTitleCore() {
		if (this._tree == null) return;
		if (this._tree.visible) {
			this._tree.title = `${this.title}${
				this.titleDescription ? ` ${GlyphChars.Dot} ${this.titleDescription}` : ''
			}`;
		} else {
			this._tree.title = this.title;
		}
	}

	getQualifiedCommand(command: string) {
		return `${this.id}.${command}`;
	}

	protected get location(): string | undefined {
		return undefined;
	}

	protected abstract getRoot(): RootNode;
	protected abstract registerCommands(): void;
	protected abstract onConfigurationChanged(e: ConfigurationChangeEvent): void;

	protected initialize(container?: string, options: { showCollapseAll?: boolean } = {}) {
		if (this._disposable != null) {
			this._disposable.dispose();
			this._onDidChangeTreeData = new EventEmitter<ViewNode>();
		}

		this._tree = window.createTreeView(`${this.id}${container ? `:${container}` : ''}`, {
			...options,
			treeDataProvider: this,
		});
		this._disposable = Disposable.from(
			this._tree,
			this._tree.onDidChangeVisibility(Functions.debounce(this.onVisibilityChanged, 250), this),
			this._tree.onDidCollapseElement(this.onElementCollapsed, this),
			this._tree.onDidExpandElement(this.onElementExpanded, this),
		);
		this._title = this._tree.title;
	}

	protected ensureRoot(force: boolean = false) {
		if (this._root == null || force) {
			this._root = this.getRoot();
		}

		return this._root;
	}

	getChildren(node?: ViewNode): ViewNode[] | Promise<ViewNode[]> {
		if (node != null) return node.getChildren();

		const root = this.ensureRoot();
		return root.getChildren();
	}

	getParent(node: ViewNode): ViewNode | undefined {
		return node.getParent();
	}

	getTreeItem(node: ViewNode): TreeItem | Promise<TreeItem> {
		return node.getTreeItem();
	}

	protected onElementCollapsed(e: TreeViewExpansionEvent<ViewNode>) {
		this._onDidChangeNodeState.fire({ ...e, state: TreeItemCollapsibleState.Collapsed });
	}

	protected onElementExpanded(e: TreeViewExpansionEvent<ViewNode>) {
		this._onDidChangeNodeState.fire({ ...e, state: TreeItemCollapsibleState.Expanded });
	}

	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		if (this.titleDescription) {
			this.updateTitleCore();
		}
		this._onDidChangeVisibility.fire(e);
	}

	get selection(): ViewNode[] {
		if (this._tree == null || this._root == null) return [];

		return this._tree.selection;
	}

	get visible(): boolean {
		return this._tree != null ? this._tree.visible : false;
	}

	async findNode(
		id: string,
		options?: {
			allowPaging?: boolean;
			canTraverse?: (node: ViewNode) => boolean | Promise<boolean>;
			maxDepth?: number;
			token?: CancellationToken;
		},
	): Promise<ViewNode | undefined>;
	async findNode(
		predicate: (node: ViewNode) => boolean,
		options?: {
			allowPaging?: boolean;
			canTraverse?: (node: ViewNode) => boolean | Promise<boolean>;
			maxDepth?: number;
			token?: CancellationToken;
		},
	): Promise<ViewNode | undefined>;
	@log({
		args: {
			0: (predicate: string | ((node: ViewNode) => boolean)) =>
				typeof predicate === 'string' ? predicate : 'function',
			1: (opts: {
				allowPaging?: boolean;
				canTraverse?: (node: ViewNode) => boolean | Promise<boolean>;
				maxDepth?: number;
				token?: CancellationToken;
			}) => `options=${JSON.stringify({ ...opts, canTraverse: undefined, token: undefined })}`,
		},
	})
	async findNode(
		predicate: string | ((node: ViewNode) => boolean),
		{
			allowPaging = false,
			canTraverse,
			maxDepth = 2,
			token,
		}: {
			allowPaging?: boolean;
			canTraverse?: (node: ViewNode) => boolean | Promise<boolean>;
			maxDepth?: number;
			token?: CancellationToken;
		} = {},
	): Promise<ViewNode | undefined> {
		const cc = Logger.getCorrelationContext();

		// If we have no root (e.g. never been initialized) force it so the tree will load properly
		if (this._root == null) {
			await this.show();
		}

		try {
			const node = await this.findNodeCoreBFS(
				typeof predicate === 'string' ? n => n.id === predicate : predicate,
				this.ensureRoot(),
				allowPaging,
				canTraverse,
				maxDepth,
				token,
			);

			return node;
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	private async findNodeCoreBFS(
		predicate: (node: ViewNode) => boolean,
		root: ViewNode,
		allowPaging: boolean,
		canTraverse: ((node: ViewNode) => boolean | Promise<boolean>) | undefined,
		maxDepth: number,
		token: CancellationToken | undefined,
	): Promise<ViewNode | undefined> {
		const queue: (ViewNode | undefined)[] = [root, undefined];

		const defaultPageSize = Container.config.advanced.maxListItems;

		let depth = 0;
		let node: ViewNode | undefined;
		let children: ViewNode[];
		let pagedChildren: ViewNode[];
		while (queue.length > 1) {
			if (token?.isCancellationRequested) return undefined;

			node = queue.shift();
			if (node == null) {
				depth++;

				queue.push(undefined);
				if (depth > maxDepth) break;

				continue;
			}

			if (predicate(node)) return node;
			if (canTraverse != null) {
				const traversable = canTraverse(node);
				if (Promises.is(traversable)) {
					if (!(await traversable)) continue;
				} else if (!traversable) {
					continue;
				}
			}

			children = await node.getChildren();
			if (children.length === 0) continue;

			if (PageableViewNode.is(node)) {
				let child = children.find(predicate);
				if (child != null) return child;

				if (allowPaging && node.hasMore) {
					while (true) {
						if (token?.isCancellationRequested) return undefined;

						await this.showMoreNodeChildren(node, defaultPageSize);

						pagedChildren = await Promises.cancellable(
							Promise.resolve(node.getChildren()),
							token ?? 60000,
							{
								onDidCancel: resolve => resolve([]),
							},
						);

						child = pagedChildren.find(predicate);
						if (child != null) return child;

						if (!node.hasMore) break;
					}
				}

				// Don't traverse into paged children
				continue;
			}

			queue.push(...children);
		}

		return undefined;
	}

	protected async ensureRevealNode(
		node: ViewNode,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		// Not sure why I need to reveal each parent, but without it the node won't be revealed
		const nodes: ViewNode[] = [];

		let parent: ViewNode | undefined = node;
		while (parent !== undefined) {
			nodes.push(parent);
			parent = parent.getParent();
		}
		nodes.pop();

		for (const n of nodes.reverse()) {
			try {
				await this.reveal(n, options);
			} catch {}
		}
	}

	@debug()
	async refresh(reset: boolean = false) {
		await this._root?.refresh?.(reset);

		this.triggerNodeChange();
	}

	@debug({
		args: { 0: (n: ViewNode) => n.toString() },
	})
	async refreshNode(node: ViewNode, reset: boolean = false) {
		if (node.refresh != null) {
			const cancel = await node.refresh(reset);
			if (cancel === true) return;
		}

		this.triggerNodeChange(node);
	}

	@log({
		args: { 0: (n: ViewNode) => n.toString() },
	})
	async reveal(
		node: ViewNode,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		if (this._tree == null) return;

		try {
			await this._tree.reveal(node, options);
		} catch (ex) {
			Logger.error(ex);
		}
	}

	@log()
	async show() {
		const location = this.location;

		try {
			void (await commands.executeCommand(`${this.id}${location ? `:${location}` : ''}.focus`));
		} catch (ex) {
			Logger.error(ex);

			const section = Strings.splitSingle(this.id, '.')[1];
			// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
			if (!configuration.get(section as any, 'enabled')) {
				const actions: MessageItem[] = [{ title: 'Enable' }, { title: 'Cancel', isCloseAffordance: true }];

				const result = await window.showErrorMessage(
					`Unable to show the ${this.name} view since it's currently disabled. Would you like to enable it?`,
					...actions,
				);

				if (result === actions[0]) {
					await configuration.update(section as any, 'enabled', true, ConfigurationTarget.Global);

					void (await commands.executeCommand(`${this.id}${location ? `:${location}` : ''}.focus`));
				}
			}
		}
	}

	// @debug({ args: { 0: (n: ViewNode) => n.toString() }, singleLine: true })
	getNodeLastKnownLimit(node: PageableViewNode) {
		return this._lastKnownLimits.get(node.id);
	}

	@debug({ args: { 0: (n: ViewNode) => n.toString() }, singleLine: true })
	resetNodeLastKnownLimit(node: PageableViewNode) {
		this._lastKnownLimits.delete(node.id);
	}

	@debug({
		args: {
			0: (n: ViewNode & PageableViewNode) => n.toString(),
			3: (n?: ViewNode) => (n == null ? '' : n.toString()),
		},
	})
	async showMoreNodeChildren(
		node: ViewNode & PageableViewNode,
		limit: number | { until: any } | undefined,
		previousNode?: ViewNode,
	) {
		if (previousNode != null) {
			void (await this.reveal(previousNode, { select: true }));
		}

		await node.showMore(limit);
		this._lastKnownLimits.set(node.id, node.limit);
	}

	@debug({
		args: { 0: (n: ViewNode) => (n != null ? n.toString() : '') },
	})
	triggerNodeChange(node?: ViewNode) {
		// Since the root node won't actually refresh, force everything
		this._onDidChangeTreeData.fire(node != null && node !== this._root ? node : undefined);
	}

	protected abstract readonly configKey: ViewsConfigKeys;

	private _config: (ViewConfig & ViewsCommonConfig) | undefined;
	get config(): ViewConfig & ViewsCommonConfig {
		if (this._config == null) {
			const cfg = { ...Container.config.views };
			for (const view of viewsConfigKeys) {
				delete cfg[view];
			}

			this._config = { ...(cfg as ViewsCommonConfig), ...(Container.config.views[this.configKey] as ViewConfig) };
		}

		return this._config;
	}
}
