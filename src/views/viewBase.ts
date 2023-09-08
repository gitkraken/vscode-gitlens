import type {
	CancellationToken,
	ConfigurationChangeEvent,
	Event,
	TreeCheckboxChangeEvent,
	TreeDataProvider,
	TreeItem,
	TreeView,
	TreeViewExpansionEvent,
	TreeViewSelectionChangeEvent,
	TreeViewVisibilityChangeEvent,
	ViewBadge,
} from 'vscode';
import { Disposable, EventEmitter, MarkdownString, TreeItemCollapsibleState, window } from 'vscode';
import type {
	BranchesViewConfig,
	CommitsViewConfig,
	ContributorsViewConfig,
	FileHistoryViewConfig,
	LineHistoryViewConfig,
	RemotesViewConfig,
	RepositoriesViewConfig,
	SearchAndCompareViewConfig,
	StashesViewConfig,
	TagsViewConfig,
	ViewsCommonConfig,
	ViewsConfigKeys,
	WorktreesViewConfig,
} from '../config';
import { viewsCommonConfigKeys, viewsConfigKeys } from '../config';
import type { TreeViewCommandSuffixesByViewType, TreeViewTypes } from '../constants';
import type { Container } from '../container';
import { executeCoreCommand } from '../system/command';
import { configuration } from '../system/configuration';
import { debug, log } from '../system/decorators/log';
import { once } from '../system/event';
import { debounce } from '../system/function';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { cancellable, isPromise } from '../system/promise';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import type { BranchesView } from './branchesView';
import type { CommitsView } from './commitsView';
import type { ContributorsView } from './contributorsView';
import type { FileHistoryView } from './fileHistoryView';
import type { LineHistoryView } from './lineHistoryView';
import type { PageableViewNode, ViewNode } from './nodes/viewNode';
import { isPageableViewNode } from './nodes/viewNode';
import type { RemotesView } from './remotesView';
import type { RepositoriesView } from './repositoriesView';
import type { SearchAndCompareView } from './searchAndCompareView';
import type { StashesView } from './stashesView';
import type { TagsView } from './tagsView';
import type { WorkspacesView } from './workspacesView';
import type { WorktreesView } from './worktreesView';

export type View =
	| BranchesView
	| CommitsView
	| ContributorsView
	| FileHistoryView
	| LineHistoryView
	| RemotesView
	| RepositoriesView
	| SearchAndCompareView
	| StashesView
	| TagsView
	| WorkspacesView
	| WorktreesView;

export type ViewsWithBranches = BranchesView | CommitsView | RemotesView | RepositoriesView | WorkspacesView;
export type ViewsWithBranchesNode = BranchesView | RepositoriesView | WorkspacesView;
export type ViewsWithCommits = Exclude<View, LineHistoryView | StashesView>;
export type ViewsWithContributors = ContributorsView | RepositoriesView | WorkspacesView;
export type ViewsWithContributorsNode = ContributorsView | RepositoriesView | WorkspacesView;
export type ViewsWithRemotes = RemotesView | RepositoriesView | WorkspacesView;
export type ViewsWithRemotesNode = RemotesView | RepositoriesView | WorkspacesView;
export type ViewsWithRepositories = RepositoriesView | WorkspacesView;
export type ViewsWithRepositoriesNode = RepositoriesView | WorkspacesView;
export type ViewsWithRepositoryFolders = Exclude<
	View,
	FileHistoryView | LineHistoryView | RepositoriesView | WorkspacesView
>;
export type ViewsWithStashes = StashesView | ViewsWithCommits;
export type ViewsWithStashesNode = RepositoriesView | StashesView | WorkspacesView;
export type ViewsWithTags = RepositoriesView | TagsView | WorkspacesView;
export type ViewsWithTagsNode = RepositoriesView | TagsView | WorkspacesView;
export type ViewsWithWorkingTree = RepositoriesView | WorktreesView | WorkspacesView;
export type ViewsWithWorktrees = RepositoriesView | WorktreesView | WorkspacesView;
export type ViewsWithWorktreesNode = RepositoriesView | WorktreesView | WorkspacesView;

export interface TreeViewNodeCollapsibleStateChangeEvent<T> extends TreeViewExpansionEvent<T> {
	state: TreeItemCollapsibleState;
}

export abstract class ViewBase<
		Type extends TreeViewTypes,
		RootNode extends ViewNode,
		ViewConfig extends
			| BranchesViewConfig
			| ContributorsViewConfig
			| FileHistoryViewConfig
			| CommitsViewConfig
			| LineHistoryViewConfig
			| RemotesViewConfig
			| RepositoriesViewConfig
			| SearchAndCompareViewConfig
			| StashesViewConfig
			| TagsViewConfig
			| WorktreesViewConfig,
	>
	implements TreeDataProvider<ViewNode>, Disposable
{
	get id(): `gitlens.views.${Type}` {
		return `gitlens.views.${this.type}`;
	}

	protected _onDidChangeTreeData = new EventEmitter<ViewNode | undefined>();
	get onDidChangeTreeData(): Event<ViewNode | undefined> {
		return this._onDidChangeTreeData.event;
	}

	private _onDidChangeSelection = new EventEmitter<TreeViewSelectionChangeEvent<ViewNode>>();
	get onDidChangeSelection(): Event<TreeViewSelectionChangeEvent<ViewNode>> {
		return this._onDidChangeSelection.event;
	}

	private _onDidChangeVisibility = new EventEmitter<TreeViewVisibilityChangeEvent>();
	get onDidChangeVisibility(): Event<TreeViewVisibilityChangeEvent> {
		return this._onDidChangeVisibility.event;
	}

	private _onDidChangeNodeCollapsibleState = new EventEmitter<TreeViewNodeCollapsibleStateChangeEvent<ViewNode>>();
	get onDidChangeNodeCollapsibleState(): Event<TreeViewNodeCollapsibleStateChangeEvent<ViewNode>> {
		return this._onDidChangeNodeCollapsibleState.event;
	}

	private _onDidChangeNodesCheckedState = new EventEmitter<TreeCheckboxChangeEvent<ViewNode>>();
	get onDidChangeNodesCheckedState(): Event<TreeCheckboxChangeEvent<ViewNode>> {
		return this._onDidChangeNodesCheckedState.event;
	}

	protected disposables: Disposable[] = [];
	protected root: RootNode | undefined;
	protected tree: TreeView<ViewNode> | undefined;

	private readonly _lastKnownLimits = new Map<string, number | undefined>();

	constructor(
		public readonly container: Container,
		public readonly type: Type,
		public readonly name: string,
		private readonly trackingFeature: TrackedUsageFeatures,
	) {
		this.disposables.push(once(container.onReady)(this.onReady, this));

		if (this.container.debugging || configuration.get('debug')) {
			function addDebuggingInfo(item: TreeItem, node: ViewNode, parent: ViewNode | undefined) {
				if (item.tooltip == null) {
					item.tooltip = new MarkdownString(
						item.label != null && typeof item.label !== 'string' ? item.label.label : item.label ?? '',
					);
				}

				if (typeof item.tooltip === 'string') {
					item.tooltip = `${item.tooltip}\n\n---\ncontext: ${item.contextValue}\nnode: ${node.toString()}${
						parent != null ? `\nparent: ${parent.toString()}` : ''
					}`;
				} else {
					item.tooltip.appendMarkdown(
						`\n\n---\n\ncontext: \`${item.contextValue}\`\\\nnode: \`${node.toString()}\`${
							parent != null ? `\\\nparent: \`${parent.toString()}\`` : ''
						}`,
					);
				}
			}

			const getTreeItemFn = this.getTreeItem;
			this.getTreeItem = async function (this: ViewBase<Type, RootNode, ViewConfig>, node: ViewNode) {
				const item = await getTreeItemFn.apply(this, [node]);

				if (node.resolveTreeItem == null) {
					addDebuggingInfo(item, node, node.getParent());
				}

				return item;
			};

			const resolveTreeItemFn = this.resolveTreeItem;
			this.resolveTreeItem = async function (
				this: ViewBase<Type, RootNode, ViewConfig>,
				item: TreeItem,
				node: ViewNode,
			) {
				item = await resolveTreeItemFn.apply(this, [item, node]);

				addDebuggingInfo(item, node, node.getParent());

				return item;
			};
		}

		this.disposables.push(...this.registerCommands());
	}

	dispose() {
		this._nodeState?.dispose();
		this._nodeState = undefined;
		Disposable.from(...this.disposables).dispose();
	}

	private onReady() {
		this.initialize({ canSelectMany: this.canSelectMany, showCollapseAll: this.showCollapseAll });
		queueMicrotask(() => this.onConfigurationChanged());
	}

	get canReveal(): boolean {
		return true;
	}

	get canSelectMany(): boolean {
		return (
			this.container.prereleaseOrDebugging &&
			configuration.get('views.experimental.multiSelect.enabled', undefined, false)
		);
	}

	private _nodeState: ViewNodeState | undefined;
	get nodeState(): ViewNodeState {
		if (this._nodeState == null) {
			this._nodeState = new ViewNodeState();
		}

		return this._nodeState;
	}

	protected get showCollapseAll(): boolean {
		return true;
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'views')) return false;

		if (configuration.changed(e, `views.${this.configKey}` as const)) return true;
		for (const key of viewsCommonConfigKeys) {
			if (configuration.changed(e, `views.${key}` as const)) return true;
		}

		return false;
	}

	get badge(): ViewBadge | undefined {
		return this.tree?.badge;
	}
	set badge(value: ViewBadge | undefined) {
		if (this.tree != null) {
			this.tree.badge = value;
		}
	}

	private _title: string | undefined;
	get title(): string | undefined {
		return this._title;
	}
	set title(value: string | undefined) {
		this._title = value;
		if (this.tree != null) {
			this.tree.title = value;
		}
	}

	private _description: string | undefined;
	get description(): string | undefined {
		return this._description;
	}
	set description(value: string | undefined) {
		this._description = value;
		if (this.tree != null) {
			this.tree.description = value;
		}
	}

	private _message: string | undefined;
	get message(): string | undefined {
		return this._message;
	}
	set message(value: string | undefined) {
		this._message = value;
		if (this.tree != null) {
			this.tree.message = value;
		}
	}

	getQualifiedCommand(command: TreeViewCommandSuffixesByViewType<Type>) {
		return `gitlens.views.${this.type}.${command}` as const;
	}

	protected abstract getRoot(): RootNode;
	protected abstract registerCommands(): Disposable[];
	protected onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (e != null && this.root != null) {
			void this.refresh(true);
		}
	}

	protected initialize(options: { canSelectMany?: boolean; showCollapseAll?: boolean } = {}) {
		this.tree = window.createTreeView<ViewNode>(this.id, {
			...options,
			treeDataProvider: this,
		});
		this.disposables.push(
			configuration.onDidChange(e => {
				if (!this.filterConfigurationChanged(e)) return;

				this._config = undefined;
				this.onConfigurationChanged(e);
			}, this),
			this.tree,
			this.tree.onDidChangeSelection(debounce(this.onSelectionChanged, 250), this),
			this.tree.onDidChangeVisibility(debounce(this.onVisibilityChanged, 250), this),
			this.tree.onDidChangeCheckboxState(this.onCheckboxStateChanged, this),
			this.tree.onDidCollapseElement(this.onElementCollapsed, this),
			this.tree.onDidExpandElement(this.onElementExpanded, this),
		);

		if (this._title != null) {
			this.tree.title = this._title;
		} else {
			this._title = this.tree.title;
		}
		if (this._description != null) {
			this.tree.description = this._description;
		}
		if (this._message != null) {
			this.tree.message = this._message;
		}
	}

	protected ensureRoot(force: boolean = false) {
		if (this.root == null || force) {
			this.root = this.getRoot();
		}

		return this.root;
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

	resolveTreeItem(item: TreeItem, node: ViewNode): TreeItem | Promise<TreeItem> {
		return node.resolveTreeItem?.(item) ?? item;
	}

	protected onElementCollapsed(e: TreeViewExpansionEvent<ViewNode>) {
		this._onDidChangeNodeCollapsibleState.fire({ ...e, state: TreeItemCollapsibleState.Collapsed });
	}

	protected onElementExpanded(e: TreeViewExpansionEvent<ViewNode>) {
		this._onDidChangeNodeCollapsibleState.fire({ ...e, state: TreeItemCollapsibleState.Expanded });
	}

	protected onCheckboxStateChanged(e: TreeCheckboxChangeEvent<ViewNode>) {
		try {
			for (const [node, state] of e.items) {
				if (node.id == null) {
					debugger;
					throw new Error('Id is required for checkboxes');
				}

				node.storeState('checked', state, true);
			}
		} finally {
			this._onDidChangeNodesCheckedState.fire(e);
		}
	}

	protected onSelectionChanged(e: TreeViewSelectionChangeEvent<ViewNode>) {
		this._onDidChangeSelection.fire(e);
	}

	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		if (e.visible) {
			void this.container.usage.track(`${this.trackingFeature}:shown`);
		}

		this._onDidChangeVisibility.fire(e);
	}

	get activeSelection(): ViewNode | undefined {
		if (this.tree == null || this.root == null) return undefined;

		// TODO@eamodio: https://github.com/microsoft/vscode/issues/157406
		return this.tree.selection[0];
	}

	get selection(): readonly ViewNode[] {
		if (this.tree == null || this.root == null) return [];

		return this.tree.selection;
	}

	get visible(): boolean {
		return this.tree?.visible ?? false;
	}

	@log<ViewBase<Type, RootNode, ViewConfig>['findNode']>({
		args: {
			0: '<function>',
			1: opts => `options=${JSON.stringify({ ...opts, canTraverse: undefined, token: undefined })}`,
		},
	})
	async findNode(
		predicate: (node: ViewNode) => boolean,
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
		const scope = getLogScope();

		async function find(this: ViewBase<Type, RootNode, ViewConfig>) {
			try {
				const node = await this.findNodeCoreBFS(
					predicate,
					this.ensureRoot(),
					allowPaging,
					canTraverse,
					maxDepth,
					token,
				);

				return node;
			} catch (ex) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		if (this.root != null) return find.call(this);

		// If we have no root (e.g. never been initialized) force it so the tree will load properly
		await this.show({ preserveFocus: true });
		// Since we have to show the view, give the view time to load and let the callstack unwind before we try to find the node
		return new Promise<ViewNode | undefined>(resolve => setTimeout(() => resolve(find.call(this)), 100));
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

		const defaultPageSize = configuration.get('advanced.maxListItems');

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
				if (isPromise(traversable)) {
					if (!(await traversable)) continue;
				} else if (!traversable) {
					continue;
				}
			}

			children = await node.getChildren();
			if (children.length === 0) continue;

			while (node != null && !isPageableViewNode(node)) {
				node = await node.getSplattedChild?.();
			}

			if (node != null && isPageableViewNode(node)) {
				let child = children.find(predicate);
				if (child != null) return child;

				if (allowPaging && node.hasMore) {
					while (true) {
						if (token?.isCancellationRequested) return undefined;

						await this.loadMoreNodeChildren(node, defaultPageSize);

						pagedChildren = await cancellable(Promise.resolve(node.getChildren()), token ?? 60000, {
							onDidCancel: resolve => resolve([]),
						});

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
		while (parent != null) {
			nodes.push(parent);
			parent = parent.getParent();
		}

		if (nodes.length > 1) {
			nodes.pop();
		}

		for (const n of nodes.reverse()) {
			try {
				await this.reveal(n, options);
			} catch {}
		}
	}

	@debug()
	async refresh(reset: boolean = false) {
		// If we are resetting, make sure to clear any saved node state
		if (reset) {
			this.nodeState.reset();
		}

		await this.root?.refresh?.(reset);

		this.triggerNodeChange();
	}

	@debug<ViewBase<Type, RootNode, ViewConfig>['refreshNode']>({ args: { 0: n => n.toString() } })
	async refreshNode(node: ViewNode, reset: boolean = false, force: boolean = false) {
		const cancel = await node.refresh?.(reset);
		if (!force && cancel === true) return;

		this.triggerNodeChange(node);
	}

	@log<ViewBase<Type, RootNode, ViewConfig>['reveal']>({ args: { 0: n => n.toString() } })
	async reveal(
		node: ViewNode,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		if (this.tree == null) return;

		try {
			await this.tree.reveal(node, options);
		} catch (ex) {
			Logger.error(ex);
		}
	}

	@log()
	async show(options?: { preserveFocus?: boolean }) {
		const scope = getLogScope();

		try {
			void (await executeCoreCommand(`${this.id}.focus`, options));
		} catch (ex) {
			Logger.error(ex, scope);
		}
	}

	// @debug({ args: { 0: (n: ViewNode) => n.toString() }, singleLine: true })
	getNodeLastKnownLimit(node: PageableViewNode) {
		return this._lastKnownLimits.get(node.id);
	}

	@debug<ViewBase<Type, RootNode, ViewConfig>['loadMoreNodeChildren']>({
		args: { 0: n => n.toString(), 2: n => n?.toString() },
	})
	async loadMoreNodeChildren(
		node: ViewNode & PageableViewNode,
		limit: number | { until: string | undefined } | undefined,
		previousNode?: ViewNode,
		context?: Record<string, unknown>,
	) {
		if (previousNode != null) {
			await this.reveal(previousNode, { select: true });
		}

		await node.loadMore(limit, context);
		this._lastKnownLimits.set(node.id, node.limit);
	}

	@debug<ViewBase<Type, RootNode, ViewConfig>['resetNodeLastKnownLimit']>({
		args: { 0: n => n.toString() },
		singleLine: true,
	})
	resetNodeLastKnownLimit(node: PageableViewNode) {
		this._lastKnownLimits.delete(node.id);
	}

	@debug<ViewBase<Type, RootNode, ViewConfig>['triggerNodeChange']>({ args: { 0: n => n?.toString() } })
	triggerNodeChange(node?: ViewNode) {
		// Since the root node won't actually refresh, force everything
		this._onDidChangeTreeData.fire(node != null && node !== this.root ? node : undefined);
	}

	protected abstract readonly configKey: ViewsConfigKeys;

	private _config: (ViewConfig & ViewsCommonConfig) | undefined;
	get config(): ViewConfig & ViewsCommonConfig {
		if (this._config == null) {
			const cfg = { ...configuration.get('views') };
			for (const view of viewsConfigKeys) {
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete cfg[view];
			}

			this._config = {
				...(cfg as ViewsCommonConfig),
				...(configuration.get('views')[this.configKey] as ViewConfig),
			};
		}

		return this._config;
	}
}

export class ViewNodeState implements Disposable {
	private _store: Map<string, Map<string, unknown>> | undefined;
	private _stickyStore: Map<string, Map<string, unknown>> | undefined;

	dispose() {
		this.reset();

		this._stickyStore?.clear();
		this._stickyStore = undefined;
	}

	reset() {
		this._store?.clear();
		this._store = undefined;
	}

	delete(prefix: string, key: string): void {
		for (const store of [this._store, this._stickyStore]) {
			if (store == null) continue;

			for (const [id, map] of store) {
				if (id.startsWith(prefix)) {
					map.delete(key);
				}
			}
		}
	}

	deleteState(id: string, key?: string): void {
		if (key == null) {
			this._store?.delete(id);
			this._stickyStore?.delete(id);
		} else {
			this._store?.get(id)?.delete(key);
			this._stickyStore?.get(id)?.delete(key);
		}
	}

	get<T>(prefix: string, key: string): Map<string, T> {
		const maps = new Map<string, T>();

		for (const store of [this._store, this._stickyStore]) {
			if (store == null) continue;

			for (const [id, map] of store) {
				if (id.startsWith(prefix) && map.has(key)) {
					maps.set(id, map.get(key) as T);
				}
			}
		}

		return maps;
	}

	getState<T>(id: string, key: string): T | undefined {
		return (this._stickyStore?.get(id)?.get(key) ?? this._store?.get(id)?.get(key)) as T | undefined;
	}

	storeState<T>(id: string, key: string, value: T, sticky?: boolean): void {
		let store;
		if (sticky) {
			if (this._stickyStore == null) {
				this._stickyStore = new Map();
			}
			store = this._stickyStore;
		} else {
			if (this._store == null) {
				this._store = new Map();
			}
			store = this._store;
		}

		const state = store.get(id);
		if (state != null) {
			state.set(key, value);
		} else {
			store.set(id, new Map([[key, value]]));
		}
	}
}
