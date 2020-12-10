'use strict';
import { Command, Disposable, Event, TreeItem, TreeItemCollapsibleState, TreeViewVisibilityChangeEvent } from 'vscode';
import {
	GitFile,
	GitReference,
	GitRevisionReference,
	Repository,
	RepositoryChange,
	RepositoryChangeEvent,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Logger } from '../../logger';
import { debug, Functions, gate, log, logName } from '../../system';
import { TreeViewNodeCollapsibleStateChangeEvent, View } from '../viewBase';

export enum ContextValues {
	ActiveFileHistory = 'gitlens:history:active:file',
	ActiveLineHistory = 'gitlens:history:active:line',
	Branch = 'gitlens:branch',
	Branches = 'gitlens:branches',
	BranchStatusAheadOfUpstream = 'gitlens:status-branch:upstream:ahead',
	BranchStatusBehindUpstream = 'gitlens:status-branch:upstream:behind',
	BranchStatusFiles = 'gitlens:status-branch:files',
	Commit = 'gitlens:commit',
	Commits = 'gitlens:commits',
	Compare = 'gitlens:compare',
	CompareBranch = 'gitlens:compare:branch',
	ComparePicker = 'gitlens:compare:picker',
	ComparePickerWithRef = 'gitlens:compare:picker:ref',
	CompareResults = 'gitlens:compare:results',
	CompareResultsCommits = 'gitlens:compare:results:commits',
	Contributor = 'gitlens:contributor',
	Contributors = 'gitlens:contributors',
	DateMarker = 'gitlens:date-marker',
	File = 'gitlens:file',
	FileHistory = 'gitlens:history:file',
	Folder = 'gitlens:folder',
	LineHistory = 'gitlens:history:line',
	Message = 'gitlens:message',
	Pager = 'gitlens:pager',
	PullRequest = 'gitlens:pullrequest',
	Reflog = 'gitlens:reflog',
	ReflogRecord = 'gitlens:reflog-record',
	Remote = 'gitlens:remote',
	Remotes = 'gitlens:remotes',
	Repositories = 'gitlens:repositories',
	Repository = 'gitlens:repository',
	RepositoryFolder = 'gitlens:repo-folder',
	ResultsFile = 'gitlens:file:results',
	ResultsFiles = 'gitlens:results:files',
	SearchAndCompare = 'gitlens:searchAndCompare',
	SearchResults = 'gitlens:search:results',
	SearchResultsCommits = 'gitlens:search:results:commits',
	Stash = 'gitlens:stash',
	Stashes = 'gitlens:stashes',
	StatusFileCommits = 'gitlens:status:file:commits',
	StatusFiles = 'gitlens:status:files',
	StatusAheadOfUpstream = 'gitlens:status:upstream:ahead',
	StatusBehindUpstream = 'gitlens:status:upstream:behind',
	StatusNoUpstream = 'gitlens:status:upstream:none',
	StatusSameAsUpstream = 'gitlens:status:upstream:same',
	Tag = 'gitlens:tag',
	Tags = 'gitlens:tags',
}

export const unknownGitUri = new GitUri();

export interface ViewNode {
	readonly id?: string;
}

@logName<ViewNode>((c, name) => `${name}${c.id != null ? `(${c.id})` : ''}`)
export abstract class ViewNode<TView extends View = View> {
	static is(node: any): node is ViewNode {
		return node instanceof ViewNode;
	}

	protected splatted = false;

	constructor(uri: GitUri, public readonly view: TView, protected readonly parent?: ViewNode) {
		this._uri = uri;
	}

	toClipboard?(): string;

	toString() {
		return `${Logger.toLoggableName(this)}${this.id != null ? `(${this.id})` : ''}`;
	}

	protected _uri: GitUri;
	get uri() {
		return this._uri;
	}

	abstract getChildren(): ViewNode[] | Promise<ViewNode[]>;

	getParent(): ViewNode | undefined {
		// If this node's parent has been splatted (e.g. not shown itself, but its children are), then return its grandparent
		return this.parent?.splatted ? this.parent?.getParent() : this.parent;
	}

	abstract getTreeItem(): TreeItem | Promise<TreeItem>;

	getCommand(): Command | undefined {
		return undefined;
	}

	refresh?(reset?: boolean): boolean | void | Promise<void> | Promise<boolean>;

	@gate()
	@debug()
	triggerChange(reset: boolean = false, force: boolean = false): Promise<void> {
		// If this node has been splatted (e.g. not shown itself, but its children are), then delegate the change to its parent
		if (this.splatted && this.parent != null) {
			return this.parent.triggerChange(reset, force);
		}

		return this.view.refreshNode(this, reset, force);
	}

	getSplattedChild?(): Promise<ViewNode | undefined>;
}

export abstract class ViewRefNode<
	TView extends View = View,
	TReference extends GitReference = GitReference
> extends ViewNode<TView> {
	abstract get ref(): TReference;

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	toString() {
		return `${super.toString()}:${GitReference.toString(this.ref, false)}`;
	}
}

export abstract class ViewRefFileNode<TView extends View = View> extends ViewRefNode<TView, GitRevisionReference> {
	abstract get file(): GitFile;
	abstract get fileName(): string;

	toString() {
		return `${super.toString()}:${this.fileName}`;
	}
}

export function nodeSupportsClearing(node: ViewNode): node is ViewNode & { clear(): void | Promise<void> } {
	return typeof (node as ViewNode & { clear(): void | Promise<void> }).clear === 'function';
}

export interface PageableViewNode {
	readonly id: string;
	limit?: number;
	readonly hasMore: boolean;
	loadMore(limit?: number | { until?: any }): Promise<void>;
}

export namespace PageableViewNode {
	export function is(node: ViewNode): node is ViewNode & PageableViewNode {
		return Functions.is<ViewNode & PageableViewNode>(node, 'loadMore');
	}
}

export abstract class SubscribeableViewNode<TView extends View = View> extends ViewNode<TView> {
	protected disposable: Disposable;
	protected subscription: Promise<Disposable | undefined> | undefined;

	private _loaded: boolean = false;

	constructor(uri: GitUri, view: TView, parent?: ViewNode) {
		super(uri, view, parent);

		const disposables = [
			this.view.onDidChangeVisibility(this.onVisibilityChanged, this),
			this.view.onDidChangeNodeCollapsibleState(this.onNodeCollapsibleStateChanged, this),
		];

		if (viewSupportsAutoRefresh(this.view)) {
			disposables.push(this.view.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this));
		}

		const getTreeItem = this.getTreeItem;
		this.getTreeItem = function (this: SubscribeableViewNode<TView>) {
			this._loaded = true;
			void this.ensureSubscription();
			return getTreeItem.apply(this);
		};

		const getChildren = this.getChildren;
		this.getChildren = function (this: SubscribeableViewNode<TView>) {
			this._loaded = true;
			void this.ensureSubscription();
			return getChildren.apply(this);
		};

		this.disposable = Disposable.from(...disposables);
	}

	@debug()
	dispose() {
		void this.unsubscribe();

		this.disposable?.dispose();
	}

	@gate()
	@debug()
	async triggerChange(reset: boolean = false, force: boolean = false): Promise<void> {
		if (!this._loaded) return;

		await super.triggerChange(reset, force);
	}

	private _canSubscribe: boolean = true;
	protected get canSubscribe(): boolean {
		return this._canSubscribe;
	}
	protected set canSubscribe(value: boolean) {
		if (this._canSubscribe === value) return;

		this._canSubscribe = value;

		void this.ensureSubscription();
		if (value) {
			void this.triggerChange();
		}
	}

	protected get requiresResetOnVisible(): boolean {
		return false;
	}

	protected abstract subscribe(): Disposable | undefined | Promise<Disposable | undefined>;

	@debug()
	protected async unsubscribe(): Promise<void> {
		if (this.subscription != null) {
			const subscriptionPromise = this.subscription;
			this.subscription = undefined;

			(await subscriptionPromise)?.dispose();
		}
	}

	@debug()
	protected onAutoRefreshChanged() {
		this.onVisibilityChanged({ visible: this.view.visible });
	}

	protected onParentCollapsibleStateChanged?(state: TreeItemCollapsibleState): void;
	protected onCollapsibleStateChanged?(state: TreeItemCollapsibleState): void;

	protected collapsibleState: TreeItemCollapsibleState | undefined;
	protected onNodeCollapsibleStateChanged(e: TreeViewNodeCollapsibleStateChangeEvent<ViewNode>) {
		if (e.element === this) {
			this.collapsibleState = e.state;
			if (this.onCollapsibleStateChanged !== undefined) {
				this.onCollapsibleStateChanged(e.state);
			}
		} else if (e.element === this.parent) {
			if (this.onParentCollapsibleStateChanged !== undefined) {
				this.onParentCollapsibleStateChanged(e.state);
			}
		}
	}

	@debug()
	protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
		void this.ensureSubscription();

		if (e.visible) {
			void this.triggerChange(this.requiresResetOnVisible);
		}
	}

	@gate()
	@debug()
	async ensureSubscription() {
		// We only need to subscribe if we are visible and if auto-refresh enabled (when supported)
		if (
			!this.canSubscribe ||
			!this.view.visible ||
			(viewSupportsAutoRefresh(this.view) && !this.view.autoRefresh)
		) {
			await this.unsubscribe();

			return;
		}

		// If we already have a subscription, just kick out
		if (this.subscription != null) return;

		this.subscription = Promise.resolve(this.subscribe());
		await this.subscription;
	}
}

export abstract class RepositoryFolderNode<
	TView extends View = View,
	TChild extends ViewNode = ViewNode
> extends SubscribeableViewNode<TView> {
	static key = ':repository';
	static getId(repoPath: string): string {
		return `gitlens${this.key}(${repoPath})`;
	}

	protected splatted = true;
	protected child: TChild | undefined;

	constructor(uri: GitUri, view: TView, parent: ViewNode, public readonly repo: Repository, splatted: boolean) {
		super(uri, view, parent);

		this.splatted = splatted;
	}

	toClipboard(): string {
		return this.repo.path;
	}

	get id(): string {
		return RepositoryFolderNode.getId(this.repo.path);
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		this.splatted = false;

		const item = new TreeItem(
			this.repo.formattedName ?? this.uri.repoPath ?? '',
			TreeItemCollapsibleState.Expanded,
		);
		item.contextValue = `${ContextValues.RepositoryFolder}${this.repo.starred ? '+starred' : ''}`;
		item.tooltip = `${
			this.repo.formattedName ? `${this.repo.formattedName}\n${this.uri.repoPath}` : this.uri.repoPath ?? ''
		}`;

		return item;
	}

	async getSplattedChild() {
		if (this.child == null) {
			await this.getChildren();
		}

		return this.child;
	}

	@gate()
	@debug()
	async refresh(reset: boolean = false) {
		await this.child?.triggerChange(reset);

		await this.ensureSubscription();
	}

	@log()
	async star() {
		await this.repo.star();
		// void this.parent!.triggerChange();
	}

	@log()
	async unstar() {
		await this.repo.unstar();
		// void this.parent!.triggerChange();
	}

	@debug()
	protected subscribe() {
		return this.repo.onDidChange(this.onRepositoryChanged, this);
	}

	protected get requiresResetOnVisible(): boolean {
		return this._repoUpdatedAt !== this.repo.updatedAt;
	}

	private _repoUpdatedAt: number = this.repo.updatedAt;

	protected abstract changed(e: RepositoryChangeEvent): boolean;

	@debug({
		args: {
			0: (e: RepositoryChangeEvent) =>
				`{ repository: ${e.repository?.name ?? ''}, changes: ${e.changes.join()} }`,
		},
	})
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		this._repoUpdatedAt = this.repo.updatedAt;

		if (e.changed(RepositoryChange.Closed)) {
			this.dispose();
			void this.parent?.triggerChange(true);

			return;
		}

		if (e.changed(RepositoryChange.Starred)) {
			void this.parent?.triggerChange(true);

			return;
		}

		if (this.changed(e)) {
			void this.triggerChange(true);
		}
	}
}

interface AutoRefreshableView {
	autoRefresh: boolean;
	onDidChangeAutoRefresh: Event<void>;
}
export function viewSupportsAutoRefresh(view: View): view is View & AutoRefreshableView {
	return Functions.is<View & AutoRefreshableView>(view, 'onDidChangeAutoRefresh');
}

export function viewSupportsNodeDismissal(view: View): view is View & { dismissNode(node: ViewNode): void } {
	return typeof (view as View & { dismissNode(node: ViewNode): void }).dismissNode === 'function';
}
