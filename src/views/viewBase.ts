import type {
	CancellationToken,
	ConfigurationChangeEvent,
	Disposable,
	Event,
	ThemeIcon,
	TreeCheckboxChangeEvent,
	TreeDataProvider,
	TreeItem,
	TreeView,
	TreeViewExpansionEvent,
	TreeViewSelectionChangeEvent,
	TreeViewVisibilityChangeEvent,
	ViewBadge,
} from 'vscode';
import { EventEmitter, MarkdownString, TreeItemCollapsibleState, window } from 'vscode';
import type {
	BranchesViewConfig,
	CommitsViewConfig,
	ContributorsViewConfig,
	DraftsViewConfig,
	FileHistoryViewConfig,
	LaunchpadViewConfig,
	LineHistoryViewConfig,
	PullRequestViewConfig,
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
import type { TreeViewCommandSuffixesByViewType } from '../constants.commands';
import type { TrackedUsageFeatures } from '../constants.telemetry';
import type { TreeViewIds, TreeViewTypes, WebviewViewTypes } from '../constants.views';
import type { Container } from '../container';
import type { Repository } from '../git/models/repository';
import { groupRepositories } from '../git/utils/-webview/repository.utils';
import { sortRepositories, sortRepositoriesGrouped } from '../git/utils/-webview/sorting';
import { executeCoreCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import type { StorageChangeEvent } from '../system/-webview/storage';
import { getViewFocusCommand } from '../system/-webview/vscode/views';
import { areEqual } from '../system/array';
import { debug, log } from '../system/decorators/log';
import { once } from '../system/event';
import { debounce } from '../system/function/debounce';
import { first } from '../system/iterable';
import type { Lazy } from '../system/lazy';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { cancellable, defer, isPromise } from '../system/promise';
import type { BranchesView } from './branchesView';
import type { CommitsView } from './commitsView';
import type { ContributorsView } from './contributorsView';
import type { DraftsView } from './draftsView';
import type { FileHistoryView } from './fileHistoryView';
import type { LaunchpadView } from './launchpadView';
import type { LineHistoryView } from './lineHistoryView';
import type { PageableViewNode, ViewNode } from './nodes/abstract/viewNode';
import { isPageableViewNode } from './nodes/abstract/viewNode';
import { GroupedHeaderNode } from './nodes/common';
import type { PullRequestView } from './pullRequestView';
import type { RemotesView } from './remotesView';
import type { RepositoriesView } from './repositoriesView';
import type { SearchAndCompareView } from './searchAndCompareView';
import type { StashesView } from './stashesView';
import type { TagsView } from './tagsView';
import type { WorkspacesView } from './workspacesView';
import type { WorktreesView } from './worktreesView';

const treeViewTypesSupportsRepositoryFilter: TreeViewTypes[] = [
	'branches',
	'commits',
	'contributors',
	'remotes',
	'stashes',
	'tags',
	'worktrees',
];
const treeViewTypesSupportsWorktreeCollapsing: TreeViewTypes[] = [
	'branches',
	'contributors',
	'remotes',
	'stashes',
	'tags',
	'worktrees',
];

export type View =
	| BranchesView
	| CommitsView
	| ContributorsView
	| DraftsView
	| FileHistoryView
	| LaunchpadView
	| LineHistoryView
	| PullRequestView
	| RemotesView
	| RepositoriesView
	| SearchAndCompareView
	| StashesView
	| TagsView
	| WorkspacesView
	| WorktreesView;

// prettier-ignore
export type TreeViewByType = {
	[T in TreeViewTypes]: T extends 'branches'
		? BranchesView
		: T extends 'commits'
		? CommitsView
		: T extends 'contributors'
		? ContributorsView
		: T extends 'drafts'
		? DraftsView
		: T extends 'fileHistory'
		? FileHistoryView
		: T extends 'launchpad'
		? LaunchpadView
		: T extends 'lineHistory'
		? LineHistoryView
		: T extends 'pullRequest'
		? PullRequestView
		: T extends 'remotes'
		? RemotesView
		: T extends 'repositories'
		? RepositoriesView
		: T extends 'searchAndCompare'
		? SearchAndCompareView
		: T extends 'stashes'
		? StashesView
		: T extends 'tags'
		? TagsView
		: T extends 'workspaces'
		? WorkspacesView
		: T extends 'worktrees'
		? WorktreesView
		: View;
};

// prettier-ignore
export type WebviewViewByType = {
	[T in WebviewViewTypes]: T extends 'commitDetails'
		? CommitsView
		: T extends 'graph'
		? CommitsView
		: T extends 'graphDetails'
		? CommitsView
		: T extends 'home'
		? CommitsView
		: T extends 'patchDetails'
		? CommitsView
		: T extends 'timeline'
		? CommitsView
		: View;
};

export type ViewsWithBranches = BranchesView | CommitsView | RemotesView | RepositoriesView | WorkspacesView;
export type ViewsWithBranchesNode = BranchesView | RepositoriesView | WorkspacesView;
export type ViewsWithCommits = Exclude<View, LineHistoryView | StashesView>;
export type ViewsWithContributors = ViewsWithCommits;
export type ViewsWithContributorsNode = ViewsWithCommits;
export type ViewsWithRemotes = RemotesView | RepositoriesView | WorkspacesView;
export type ViewsWithRemotesNode = RemotesView | RepositoriesView | WorkspacesView;
export type ViewsWithRepositories = RepositoriesView | WorkspacesView;
export type ViewsWithRepositoriesNode = RepositoriesView | WorkspacesView;
export type ViewsWithRepositoryFolders = Exclude<
	View,
	DraftsView | FileHistoryView | LaunchpadView | LineHistoryView | PullRequestView | RepositoriesView | WorkspacesView
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

export interface GroupedViewContext {
	onDidChangeTreeData: EventEmitter<ViewNode | undefined>;
	tree: Lazy<TreeView<ViewNode>>;
	cancellation?: CancellationToken;
}

export abstract class ViewBase<
	Type extends TreeViewTypes,
	RootNode extends ViewNode,
	ViewConfig extends
		| BranchesViewConfig
		| CommitsViewConfig
		| ContributorsViewConfig
		| DraftsViewConfig
		| FileHistoryViewConfig
		| LaunchpadViewConfig
		| LineHistoryViewConfig
		| PullRequestViewConfig
		| RemotesViewConfig
		| RepositoriesViewConfig
		| SearchAndCompareViewConfig
		| StashesViewConfig
		| TagsViewConfig
		| WorktreesViewConfig,
>
	implements TreeDataProvider<ViewNode>, Disposable
{
	is<T extends keyof TreeViewByType>(type: T): this is TreeViewByType[T] {
		return this.type === (type as unknown as Type);
	}

	isAny<T extends (keyof TreeViewByType)[]>(...types: T): this is TreeViewByType[T[number]] {
		return types.includes(this.type as unknown as T[number]);
	}

	private _cancellation: CancellationToken | undefined;
	get cancellation(): CancellationToken | undefined {
		return this._cancellation;
	}

	private _disposed: boolean = false;
	get disposed(): boolean {
		return this._disposed;
	}

	get id(): TreeViewIds<Type> {
		return `gitlens.views.${this.type}`;
	}

	private _onDidChangeRepositoryFilter = new EventEmitter<void>();
	get onDidChangeRepositoryFilter(): Event<void> {
		return this._onDidChangeRepositoryFilter.event;
	}

	private _onDidChangeSelection = new EventEmitter<TreeViewSelectionChangeEvent<ViewNode>>();
	get onDidChangeSelection(): Event<TreeViewSelectionChangeEvent<ViewNode>> {
		return this._onDidChangeSelection.event;
	}

	private _onDidChangeNodesCheckedState = new EventEmitter<TreeCheckboxChangeEvent<ViewNode>>();
	get onDidChangeNodesCheckedState(): Event<TreeCheckboxChangeEvent<ViewNode>> {
		return this._onDidChangeNodesCheckedState.event;
	}

	private _onDidChangeNodeCollapsibleState = new EventEmitter<TreeViewNodeCollapsibleStateChangeEvent<ViewNode>>();
	get onDidChangeNodeCollapsibleState(): Event<TreeViewNodeCollapsibleStateChangeEvent<ViewNode>> {
		return this._onDidChangeNodeCollapsibleState.event;
	}

	protected readonly _onDidChangeTreeData: EventEmitter<ViewNode | undefined>;
	get onDidChangeTreeData(): Event<ViewNode | undefined> {
		return this._onDidChangeTreeData.event;
	}

	private _onDidChangeVisibility = new EventEmitter<TreeViewVisibilityChangeEvent>();
	get onDidChangeVisibility(): Event<TreeViewVisibilityChangeEvent> {
		return this._onDidChangeVisibility.event;
	}

	protected disposables: Disposable[] = [];
	protected root: RootNode | undefined;
	protected tree: TreeView<ViewNode> | undefined;

	private initialized = defer<void>();
	private readonly _lastKnownLimits = new Map<string, number | undefined>();

	constructor(
		public readonly container: Container,
		public readonly type: Type,
		public readonly name: string,
		private readonly trackingFeature: TrackedUsageFeatures,
		grouped?: GroupedViewContext,
	) {
		this._grouped = grouped;
		if (grouped != null) {
			this._onDidChangeTreeData = grouped.onDidChangeTreeData;
			this._cancellation = grouped.cancellation;
		} else {
			this._onDidChangeTreeData = new EventEmitter<ViewNode | undefined>();
			this.disposables.push(this._onDidChangeTreeData);
		}

		this.description = this.getViewDescription();

		this.disposables.push(
			this._onDidChangeNodesCheckedState,
			this._onDidChangeNodeCollapsibleState,
			this._onDidChangeSelection,
			this._onDidChangeVisibility,
			once(container.onReady)(this.onReady, this),
		);

		if (this.container.debugging || configuration.get('debug')) {
			function addDebuggingInfo(item: TreeItem, node: ViewNode, parent: ViewNode | undefined) {
				item.tooltip ??= new MarkdownString(
					item.label != null && typeof item.label !== 'string' ? item.label.label : (item.label ?? ''),
				);

				if (typeof item.tooltip === 'string') {
					item.tooltip = `${item.tooltip}\n\n---\ncontext: ${
						item.contextValue
					}\nnode: ${node.toString()}\nparent: ${parent?.toString()}\nid: ${node.id}`;
				} else {
					item.tooltip.appendMarkdown(
						`\n\n---\n\ncontext: \`${
							item.contextValue
						}\`\\\nnode: \`${node.toString()}\` \\\nparent: \`${parent?.toString()}\` \\\nid: \`${node.id}\``,
					);
				}
			}

			const originalGetTreeItem = this.getTreeItem;
			this.getTreeItem = async function (this: ViewBase<Type, RootNode, ViewConfig>, node: ViewNode) {
				const item = await originalGetTreeItem.call(this, node);

				if (node.resolveTreeItem == null) {
					addDebuggingInfo(item, node, node.getParent());
				}

				return item;
			};

			const originalResolveTreeItem = this.resolveTreeItem;
			this.resolveTreeItem = async function (
				this: ViewBase<Type, RootNode, ViewConfig>,
				item: TreeItem,
				node: ViewNode,
				token: CancellationToken,
			) {
				item = await originalResolveTreeItem.call(this, item, node, token);

				addDebuggingInfo(item, node, node.getParent());

				return item;
			};
		}

		this.disposables.push(...this.registerCommands());
	}

	dispose(): void {
		this._disposed = true;
		this.root?.dispose();
		this.disposables.forEach(d => void d.dispose());
	}

	private onReady() {
		this.initialize({
			canSelectMany: this.canSelectMany,
			showCollapseAll: this.grouped ? false : this.showCollapseAll,
		});
		queueMicrotask(() => this.onConfigurationChanged());
	}

	get canReveal(): boolean {
		return true;
	}

	get canSelectMany(): boolean {
		return false;
	}

	private readonly _grouped: GroupedViewContext | undefined;
	get grouped(): boolean {
		return this._grouped != null;
	}

	private _groupedLabel: string | undefined;
	get groupedLabel(): string | undefined {
		return this.grouped ? this._groupedLabel : undefined;
	}
	set groupedLabel(value: string | undefined) {
		this._groupedLabel = value;
	}

	protected get groupedIcon(): ThemeIcon | undefined {
		return undefined;
	}

	private _nodeState: ViewNodeState | undefined;
	get nodeState(): ViewNodeState {
		if (this._nodeState == null) {
			this._nodeState = new ViewNodeState();
			this.disposables.push(this._nodeState);
		}

		return this._nodeState;
	}

	get repositoryFilter(): string[] | undefined {
		return this.container.storage.getWorkspace(`views:${this.type}:repositoryFilter`);
	}
	set repositoryFilter(value: string[] | undefined) {
		if (areEqual(value, this.repositoryFilter)) return;

		for (const type of treeViewTypesSupportsRepositoryFilter) {
			void this.container.storage.storeWorkspace(
				`views:${type}:repositoryFilter`,
				value?.length ? value : undefined,
			);
		}
	}

	protected get showCollapseAll(): boolean {
		return true;
	}

	get supportsRepositoryFilter(): boolean {
		return this.isAny(...treeViewTypesSupportsRepositoryFilter);
	}

	get supportsWorktreeCollapsing(): boolean {
		if (
			!this.isAny(...treeViewTypesSupportsWorktreeCollapsing) ||
			!configuration.get('views.collapseWorktreesWhenPossible')
		) {
			return false;
		}
		if (this.is('contributors') && !configuration.get('views.contributors.showAllBranches')) return false;

		return true;
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent): boolean {
		if (!configuration.changed(e, 'views')) return false;

		if (configuration.changed(e, `views.${this.configKey}` as const)) return true;
		if (
			configuration.changed(
				e,
				viewsCommonConfigKeys.map(k => `views.${k}` as const),
			)
		) {
			return true;
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
		if (this.tree != null && !this.grouped) {
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

	getQualifiedCommand(
		command: TreeViewCommandSuffixesByViewType<Type>,
	): `gitlens.views.${Type}.${TreeViewCommandSuffixesByViewType<Type>}` {
		return `gitlens.views.${this.type}.${command}` as const;
	}

	async getFilteredRepositories(): Promise<Repository[]> {
		let repos = this.container.git.openRepositories;

		const filter = this.repositoryFilter;
		if (filter?.length && repos.length > 1) {
			const filtered = repos.filter(r => filter.includes(r.id));
			repos = filtered.length ? filtered : repos;
		}

		if (repos.length > 1) {
			const grouped = await groupRepositories(repos);
			if (this.supportsWorktreeCollapsing) {
				repos = sortRepositories([...grouped.keys()]);
			} else {
				repos = sortRepositoriesGrouped(grouped);
			}
		}

		return repos;
	}

	isRepositoryFilterActive(): boolean {
		return this.repositoryFilter?.length
			? this.container.git.openRepositories.some(r => this.repositoryFilter!.includes(r.id))
			: false;
	}

	protected abstract getRoot(): RootNode;
	protected abstract registerCommands(): Disposable[];
	protected onConfigurationChanged(e?: ConfigurationChangeEvent): void {
		if (e != null && this.root != null) {
			void this.refresh(true);
		}
	}

	protected initialize(options?: { canSelectMany?: boolean; showCollapseAll?: boolean }): void {
		if (this._grouped != null) {
			this.tree = this._grouped.tree.value;
		} else {
			this.tree = window.createTreeView<ViewNode>(this.id, { ...options, treeDataProvider: this });
			this.disposables.push(this.tree);
		}
		this._defaultSelection = [];

		this.disposables.push(
			configuration.onDidChange(e => {
				if (!this.filterConfigurationChanged(e)) return;

				this._config = undefined;
				this.onConfigurationChanged(e);
			}, this),
			this.tree.onDidChangeSelection(debounce(this.onSelectionChanged, 250), this),
			this.tree.onDidChangeVisibility(debounce(this.onVisibilityChanged, 250), this),
			this.tree.onDidChangeCheckboxState(this.onCheckboxStateChanged, this),
			this.tree.onDidCollapseElement(this.onElementCollapsed, this),
			this.tree.onDidExpandElement(this.onElementExpanded, this),
			this.container.storage.onDidChange(this.onStorageChanged, this),
		);

		if (this._title != null) {
			this.tree.title = this._title;
		} else {
			this._title = this.tree.title;
		}
		if (this._description != null && !this.grouped) {
			this.tree.description = this._description;
		}
		if (this._message != null) {
			this.tree.message = this._message;
		}
	}

	protected ensureRoot(force: boolean = false): RootNode {
		if (this.root == null || force) {
			this.root?.dispose();
			this.root = this.getRoot();
		}

		return this.root;
	}

	/** Tracks whether the view has been initialized and should avoid a duplicate refresh */
	private _skipNextVisibilityChange: boolean = false;

	private _loadingPromise: Promise<any> | undefined;

	private trackAsLoading<T>(promise: T | Promise<T>): T | Promise<T> {
		if (!isPromise(promise)) return promise;

		const chainedPromise = this._loadingPromise != null ? this._loadingPromise.finally(() => promise) : promise;
		const last = chainedPromise
			.catch(() => {})
			.finally(() => {
				if (this._loadingPromise === last) {
					this._loadingPromise = undefined;
				}
			});
		this._loadingPromise = last;

		return promise;
	}

	private addHeaderNode(node: ViewNode, promise: ViewNode[] | Promise<ViewNode[]>): ViewNode[] | Promise<ViewNode[]> {
		if (node !== this.root) return promise;

		const { openRepositories: repos } = this.container.git;

		// If we are not grouped and we are either not filterable or there aren't multiple repos open, then just return the promise
		if (!this.grouped && (!this.isAny(...treeViewTypesSupportsRepositoryFilter) || repos.length <= 1)) {
			return promise;
		}

		const ensureGroupedHeaderNode = (children: ViewNode[]): ViewNode[] => {
			if (!children.length) return children;

			const index = children.findIndex(n => n instanceof GroupedHeaderNode);
			if (index === 0) {
				this._defaultSelection = this.grouped ? [children[0]] : [];
				return children.length === 1 ? [] : children;
			}

			let header: ViewNode | undefined;
			if (index === -1) {
				header = new GroupedHeaderNode(this as unknown as View, node);
			} else if (index > 0) {
				header = children.splice(index, 1)[0];
			}
			if (header != null) {
				this._defaultSelection = this.grouped ? [header] : [];
				children.unshift(header);
			}

			return children;
		};

		if (!this.grouped && this.supportsWorktreeCollapsing) {
			return groupRepositories(repos).then(grouped => {
				if (grouped.size <= 1) return promise;

				return isPromise(promise)
					? promise.then(c => ensureGroupedHeaderNode(c))
					: ensureGroupedHeaderNode(promise);
			});
		}

		return isPromise(promise) ? promise.then(c => ensureGroupedHeaderNode(c)) : ensureGroupedHeaderNode(promise);
	}

	getChildren(node?: ViewNode): ViewNode[] | Promise<ViewNode[]> {
		if (node != null) {
			node.splatted ??= true;
			return this.trackAsLoading(this.addHeaderNode(node, node.getChildren()));
		}

		// If we are already visible, then skip the next visibility change event otherwise we end up refreshing twice
		this._skipNextVisibilityChange = this.tree?.visible ?? false;

		const root = this.ensureRoot();
		root.splatted ??= true;
		const children = this.trackAsLoading(this.addHeaderNode(root, root.getChildren()));

		if (this.initialized.pending) {
			queueMicrotask(async () => {
				await children;
				setTimeout(() => this.initialized.fulfill(), 1);
			});
		}

		return children;
	}

	getParent(node: ViewNode): ViewNode | undefined {
		return node.getParent();
	}

	getTreeItem(node: ViewNode): TreeItem | Promise<TreeItem> {
		// If this node gets requested, ensure the splatted flag is cleared
		node.splatted = false;
		return this.trackAsLoading(node.getTreeItem());
	}

	getViewDescription(count?: number): string | undefined {
		return (
			(this.grouped
				? `${this.name.toLocaleLowerCase()}${count != null ? ` (${count})` : ''}`
				: count != null
					? `(${count})`
					: '') || undefined
		);
	}

	resolveTreeItem(item: TreeItem, node: ViewNode, token: CancellationToken): TreeItem | Promise<TreeItem> {
		return node.resolveTreeItem?.(item, token) ?? item;
	}

	protected onElementCollapsed(e: TreeViewExpansionEvent<ViewNode>): void {
		this._expandedNodes.delete(e.element);
		this._onDidChangeNodeCollapsibleState.fire({ ...e, state: TreeItemCollapsibleState.Collapsed });
	}

	protected onElementExpanded(e: TreeViewExpansionEvent<ViewNode>): void {
		this._expandedNodes.add(e.element);
		this._onDidChangeNodeCollapsibleState.fire({ ...e, state: TreeItemCollapsibleState.Expanded });
	}

	protected onCheckboxStateChanged(e: TreeCheckboxChangeEvent<ViewNode>): void {
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

	protected onSelectionChanged(e: TreeViewSelectionChangeEvent<ViewNode>): void {
		this._onDidChangeSelection.fire(e);
		this.notifySelections();
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.workspace && e.keys.includes(`views:${this.type}:repositoryFilter`)) {
			this._onDidChangeRepositoryFilter.fire();
		}
	}

	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent): void {
		if (e.visible) {
			void this.container.usage.track(`${this.trackingFeature}:shown`).catch();
		}

		const skip = this._skipNextVisibilityChange;
		this._skipNextVisibilityChange = false;

		if (!skip || !e.visible) {
			this._onDidChangeVisibility.fire(e);
		}

		if (e.visible) {
			this.notifySelections();
		}
	}

	private notifySelections() {
		const node = this.selection?.[0];
		if (node == null) return;

		if (
			node.is('commit') ||
			node.is('stash') ||
			node.is('file-commit') ||
			node.is('commit-file') ||
			node.is('stash-file')
		) {
			this.container.events.fire(
				'commit:selected',
				{
					commit: node.commit,
					interaction: 'passive',
					preserveFocus: true,
					preserveVisibility: true,
				},
				{ source: this.id },
			);
		}

		if (node.is('file-commit') || node.is('commit-file') || node.is('stash-file')) {
			this.container.events.fire(
				'file:selected',
				{
					uri: node.uri,
					preserveFocus: true,
					preserveVisibility: true,
				},
				{ source: this.id },
			);
		}
	}

	get activeSelection(): ViewNode | undefined {
		if (this.tree == null || this.root == null) return undefined;

		// TODO@eamodio: https://github.com/microsoft/vscode/issues/157406
		return this.tree.selection[0];
	}

	private _defaultSelection: readonly ViewNode[] = [];
	get selection(): readonly ViewNode[] {
		if (this.tree == null || this.root == null) return [];

		return this.tree.selection.length === 0 ? this._defaultSelection : this.tree.selection;
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
		options?: {
			allowPaging?: boolean;
			canTraverse?: (node: ViewNode) => boolean | Promise<boolean>;
			maxDepth?: number;
			token?: CancellationToken;
		},
	): Promise<ViewNode | undefined> {
		const scope = getLogScope();

		async function find(this: ViewBase<Type, RootNode, ViewConfig>) {
			try {
				const node = await this.findNodeCoreBFS(
					predicate,
					this.ensureRoot(),
					options?.allowPaging ?? false,
					options?.canTraverse,
					options?.maxDepth ?? 2,
					options?.token,
				);

				return node;
			} catch (ex) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		if (!this.initialized.pending) return find.call(this);

		// If we have no root (e.g. never been initialized) force it so the tree will load properly
		void this.show({ preserveFocus: true });
		// Since we have to show the view, give the view time to load and let the callstack unwind before we try to find the node
		return this.initialized.promise.then(() => find.call(this));
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

			// If the node is splatted don't count it against the depth
			if (node.splatted) {
				depth--;
			}

			children = await node.getChildren();
			if (!children.length) continue;

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

						pagedChildren = await cancellable(Promise.resolve(node.getChildren()), 60000, token, {
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

	private _expandedNodes = new WeakSet<ViewNode>();
	isNodeExpanded(node: ViewNode): boolean {
		return this._expandedNodes.has(node);
	}

	@debug()
	async refresh(reset: boolean = false): Promise<void> {
		// If we are resetting, make sure to clear any saved node state
		if (reset) {
			this.nodeState.reset();
		}

		await this.root?.refresh?.(reset);

		this.triggerNodeChange();
	}

	@debug<ViewBase<Type, RootNode, ViewConfig>['refreshNode']>({ args: { 0: n => n.toString() } })
	async refreshNode(node: ViewNode, reset: boolean = false, force: boolean = false): Promise<void> {
		const result = await node.refresh?.(reset);
		if (!force && result?.cancel === true) return;

		this.triggerNodeChange(node);
	}

	@log<ViewBase<Type, RootNode, ViewConfig>['reveal']>({ args: { 0: n => n.toString() } })
	async reveal(node: ViewNode, options?: RevealOptions): Promise<void> {
		if (this.initialized.pending) {
			await this.initialized.promise;
		}

		return this.revealCore(node, undefined, options);
	}

	async revealDeep(node: ViewNode, options?: RevealOptions): Promise<void>;
	async revealDeep(node: ViewNode, parents: ViewNode[], options?: RevealOptions): Promise<void>;
	@log<ViewBase<Type, RootNode, ViewConfig>['revealDeep']>({
		args: {
			0: n => n.toString(),
			1: false,
		},
	})
	async revealDeep(
		node: ViewNode,
		parents: ViewNode[] | RevealOptions | undefined,
		options?: RevealOptions,
	): Promise<void> {
		if (this.initialized.pending) {
			await this.initialized.promise;
		}

		if (!Array.isArray(parents)) {
			options = parents;
			parents = [];

			let parent: ViewNode | undefined = node;
			while (parent != null) {
				parent = parent.getParent();
				if (parent == null) break;

				parents.unshift(parent);
			}
		}

		let root: ViewNode = this.ensureRoot();
		for (const node of parents) {
			await this.revealCore(node, root, { expand: true, focus: false, select: false });
			root = node;
		}

		return this.revealCore(node, root, options);
	}

	private async revealCore(node: ViewNode, root: ViewNode | undefined, options?: RevealOptions): Promise<void> {
		if (this.tree == null) return;

		const scope = getLogScope();

		try {
			while (this._loadingPromise != null) {
				await this._loadingPromise;
			}

			await this.tree?.reveal(node, options);
		} catch (ex) {
			if (!node.id || root == null) {
				Logger.error(ex, scope);
				debugger;
			}
		}
	}

	@log()
	async show(options?: { preserveFocus?: boolean }): Promise<void> {
		const scope = getLogScope();

		try {
			const command = getViewFocusCommand(this.grouped ? 'gitlens.views.scm.grouped' : this.id);
			// If we haven't been initialized, the focus command will show the view, but won't focus it, so wait until it's initialized and then focus again
			if (!options?.preserveFocus && this.initialized.pending) {
				void executeCoreCommand(command, options);
				await this.initialized.promise;
			}

			void (await executeCoreCommand(command, options));
		} catch (ex) {
			Logger.error(ex, scope);
		}
	}

	// @debug({ args: { 0: (n: ViewNode) => n.toString() }, singleLine: true })
	getNodeLastKnownLimit(node: PageableViewNode): number | undefined {
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
	): Promise<void> {
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
	resetNodeLastKnownLimit(node: PageableViewNode): void {
		this._lastKnownLimits.delete(node.id);
	}

	private _pendingNodeChanges = new Set<ViewNode | undefined>();
	private _processingNodeChanges = false;

	@debug<ViewBase<Type, RootNode, ViewConfig>['triggerNodeChange']>({ args: { 0: n => n?.toString() } })
	triggerNodeChange(node?: ViewNode): void {
		// Since the root node won't actually refresh, force everything
		const target = node != null && node !== this.root ? node : undefined;

		// Clear all queued changes if this is a full-refresh (`undefined`)
		if (target == null) {
			this._pendingNodeChanges.clear();
			this._pendingNodeChanges.add(undefined);
		}
		// Don't queue if a full-refresh or this node is already queued
		else if (this._pendingNodeChanges.has(undefined) || this._pendingNodeChanges.has(target)) {
			return;
		} else {
			this._pendingNodeChanges.add(target);
		}

		// Only start processing if not already processing
		if (!this._processingNodeChanges) {
			this._processingNodeChanges = true;
			queueMicrotask(() => this.processNextNodeChange());
		}
	}

	private async processNextNodeChange(): Promise<void> {
		while (this._pendingNodeChanges.size > 0) {
			const target = first(this._pendingNodeChanges.values());

			// Wait until all loading is complete (avoids Element with id '...' already exists errors)
			while (this._loadingPromise != null) {
				await this._loadingPromise;
			}

			// Clear all pending changes if this was a full-refresh
			if (target == null) {
				this._pendingNodeChanges.clear();
			} else {
				this._pendingNodeChanges.delete(target);
			}

			this._onDidChangeTreeData.fire(target);
		}

		this._processingNodeChanges = false;
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

	// NOTE: @eamodio uncomment to track node leaks
	// private _nodeTracking = new Map<string, string | undefined>();
	// private registry = new FinalizationRegistry<string>(uuid => {
	// 	const id = this._nodeTracking.get(uuid);

	// 	Logger.log(`@@@ ${this.type} Finalizing [${uuid}]:${id}`);

	// 	this._nodeTracking.delete(uuid);

	// 	if (id != null) {
	// 		const c = count(this._nodeTracking.values(), v => v === id);
	// 		Logger.log(`@@@ ${this.type} [${padLeft(String(c), 3)}] ${id}`);
	// 	}
	// });

	// registerNode(node: ViewNode) {
	// 	const uuid = node.uuid;

	// 	Logger.log(`@@@ ${this.type}.registerNode [${uuid}]:${node.id}`);

	// 	this._nodeTracking.set(uuid, node.id);
	// 	this.registry.register(node, uuid);
	// }

	// unregisterNode(node: ViewNode) {
	// 	const uuid = node.uuid;

	// 	Logger.log(`@@@ ${this.type}.unregisterNode [${uuid}]:${node.id}`);

	// 	this._nodeTracking.delete(uuid);
	// 	this.registry.unregister(node);
	// }

	// private _timer = setInterval(() => {
	// 	const counts = new Map<string | undefined, number>();
	// 	for (const value of this._nodeTracking.values()) {
	// 		const count = counts.get(value) ?? 0;
	// 		counts.set(value, count + 1);
	// 	}

	// 	let total = 0;
	// 	for (const [id, count] of counts) {
	// 		if (count > 1) {
	// 			Logger.log(`@@@ ${this.type} [${padLeft(String(count), 3)}] ${id}`);
	// 		}
	// 		total += count;
	// 	}

	// 	Logger.log(`@@@ ${this.type} total=${total}`);
	// }, 10000);
}

export class ViewNodeState implements Disposable {
	private _store: Map<string, Map<string, unknown>> | undefined;
	private _stickyStore: Map<string, Map<string, unknown>> | undefined;

	dispose(): void {
		this.reset();

		this._stickyStore?.clear();
		this._stickyStore = undefined;
	}

	reset(): void {
		this._store?.clear();
		this._store = undefined;
	}

	delete(prefix: string, key: string): void {
		for (const store of [this._store, this._stickyStore]) {
			if (store == null) continue;

			for (const [id, map] of store) {
				if (id.startsWith(prefix)) {
					map.delete(key);
					if (map.size === 0) {
						store.delete(id);
					}
				}
			}
		}
	}

	deleteState(id: string, key?: string): void {
		if (key == null) {
			this._store?.delete(id);
			this._stickyStore?.delete(id);
		} else {
			for (const store of [this._store, this._stickyStore]) {
				if (store == null) continue;

				const map = store.get(id);
				if (map == null) continue;

				map.delete(key);
				if (map.size === 0) {
					store.delete(id);
				}
			}
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

export function disposeChildren(oldChildren: ViewNode[] | undefined, newChildren?: ViewNode[]): void {
	if (!oldChildren?.length) return;

	const children = newChildren?.length ? oldChildren.filter(c => !newChildren.includes(c)) : [...oldChildren];
	if (!children.length) return;

	if (children.length > 1000) {
		// Defer the disposals to avoid impacting the treeview's rendering
		setTimeout(() => {
			for (const child of children) {
				child.dispose();
			}
		}, 500);
	} else {
		for (const child of children) {
			child.dispose();
		}
	}
}

export interface RevealOptions {
	expand?: boolean | number;
	focus?: boolean;
	select?: boolean;
}
