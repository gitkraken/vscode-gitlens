'use strict';
import { Command, Disposable, Event, TreeItem, TreeItemCollapsibleState, TreeViewVisibilityChangeEvent } from 'vscode';
import { GitUri } from '../../git/gitService';
import { Logger } from '../../logger';
import { debug, Functions, gate, logName } from '../../system';
import { TreeViewNodeStateChangeEvent, View } from '../viewBase';

export enum ResourceType {
    ActiveFileHistory = 'gitlens:history:active:file',
    ActiveLineHistory = 'gitlens:history:active:line',
    Branch = 'gitlens:branch',
    Branches = 'gitlens:branches',
    BranchStatusAheadOfUpstream = 'gitlens:branch-status:upstream:ahead',
    BranchStatusBehindUpstream = 'gitlens:branch-status:upstream:behind',
    Commit = 'gitlens:commit',
    CommitFile = 'gitlens:file:commit',
    Commits = 'gitlens:commits',
    Compare = 'gitlens:compare',
    ComparePicker = 'gitlens:compare:picker',
    ComparePickerWithRef = 'gitlens:compare:picker:ref',
    CompareResults = 'gitlens:compare:results',
    Contributor = 'gitlens:contributor',
    Contributors = 'gitlens:contributors',
    File = 'gitlens:file',
    FileHistory = 'gitlens:history:file',
    Folder = 'gitlens:folder',
    LineHistory = 'gitlens:history:line',
    Message = 'gitlens:message',
    Pager = 'gitlens:pager',
    Reflog = 'gitlens:reflog',
    ReflogRecord = 'gitlens:reflog-record',
    Remote = 'gitlens:remote',
    Remotes = 'gitlens:remotes',
    Repositories = 'gitlens:repositories',
    Repository = 'gitlens:repository',
    ResultsCommits = 'gitlens:results:commits',
    ResultsFile = 'gitlens:file:results',
    ResultsFiles = 'gitlens:results:files',
    Search = 'gitlens:search',
    SearchResults = 'gitlens:search:results',
    Stash = 'gitlens:stash',
    StashFile = 'gitlens:file:stash',
    Stashes = 'gitlens:stashes',
    StatusFileCommits = 'gitlens:status:file:commits',
    StatusFiles = 'gitlens:status:files',
    StatusAheadOfUpstream = 'gitlens:status:upstream:ahead',
    StatusBehindUpstream = 'gitlens:status:upstream:behind',
    Tag = 'gitlens:tag',
    Tags = 'gitlens:tags'
}

export const unknownGitUri = new GitUri();

export interface ViewNode {
    readonly id?: string;
}

const counters: { [key: string]: number } = {
    instanceId: 0
};
export function getNextId(key?: string) {
    if (key === undefined) {
        key = 'instanceId';
    }

    let counter = counters[key] || 0;
    if (counter === Number.MAX_SAFE_INTEGER) {
        counter = 0;
    }
    counter++;

    counters[key] = counter;
    return counter;
}

@logName<ViewNode>((c, name) => `${name}(${c.id || c._instanceId})`)
export abstract class ViewNode<TView extends View = View> {
    protected readonly _instanceId: number;

    constructor(uri: GitUri, public readonly view: TView, protected readonly parent?: ViewNode) {
        this._instanceId = 0; //getNextId();
        this._uri = uri;

        if (Logger.isDebugging) {
            const fn = this.getTreeItem;
            this.getTreeItem = async function(this: ViewNode<TView>) {
                const item = await fn.apply(this);

                item.tooltip = `${item.tooltip || item.label}\n\nDBG: ${this.toString()}`;
                return item;
            };
        }
    }

    toString() {
        return `${Logger.toLoggableName(this)}${this.id != null ? `(${this.id})` : ''}`;
    }

    protected _uri: GitUri;
    get uri() {
        return this._uri;
    }

    abstract getChildren(): ViewNode[] | Promise<ViewNode[]>;

    getParent(): ViewNode | undefined {
        return this.parent;
    }

    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    @gate()
    @debug()
    refresh(reset: boolean = false): void | boolean | Promise<void> | Promise<boolean> {
        // virtual
    }

    @gate()
    @debug()
    triggerChange(reset: boolean = false): Promise<void> {
        return this.view.refreshNode(this, reset);
    }
}

export abstract class ViewRefNode<TView extends View = View> extends ViewNode<TView> {
    abstract get ref(): string;

    get repoPath(): string {
        return this.uri.repoPath!;
    }

    toString() {
        return `${super.toString()}: ${this.ref}`;
    }
}

export abstract class ViewRefFileNode<TView extends View = View> extends ViewRefNode<TView> {
    abstract get fileName(): string;

    toString() {
        return `${super.toString()}:${this.fileName}`;
    }
}

export interface PageableViewNode {
    readonly supportsPaging: boolean;
    maxCount: number | undefined;
}

export function isPageable(node: ViewNode): node is ViewNode & PageableViewNode {
    return Functions.is<ViewNode & PageableViewNode>(node, 'supportsPaging', true);
}

interface AutoRefreshableView {
    autoRefresh: boolean;
    onDidChangeAutoRefresh: Event<void>;
}
export function supportsAutoRefresh(view: View): view is View & AutoRefreshableView {
    return Functions.is<View & AutoRefreshableView>(view, 'onDidChangeAutoRefresh');
}

export abstract class SubscribeableViewNode<TView extends View = View> extends ViewNode<TView> {
    protected _disposable: Disposable;
    protected _subscription: Promise<Disposable | undefined> | undefined;

    constructor(uri: GitUri, view: TView, parent?: ViewNode) {
        super(uri, view, parent);

        const disposables = [
            this.view.onDidChangeVisibility(this.onVisibilityChanged, this),
            this.view.onDidChangeNodeState(this.onNodeStateChanged, this)
        ];

        if (supportsAutoRefresh(this.view)) {
            disposables.push(this.view.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this));
        }

        this._disposable = Disposable.from(...disposables);
    }

    @debug()
    dispose() {
        void this.unsubscribe();

        if (this._disposable !== undefined) {
            this._disposable.dispose();
        }
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

    protected abstract subscribe(): Disposable | undefined | Promise<Disposable | undefined>;

    @debug()
    protected async unsubscribe(): Promise<void> {
        if (this._subscription !== undefined) {
            const subscriptionPromise = this._subscription;
            this._subscription = undefined;

            const subscription = await subscriptionPromise;
            if (subscription !== undefined) {
                subscription.dispose();
            }
        }
    }

    @debug()
    protected onAutoRefreshChanged() {
        this.onVisibilityChanged({ visible: this.view.visible });
    }

    protected onParentStateChanged(state: TreeItemCollapsibleState) {
        // virtual
    }
    protected onStateChanged(state: TreeItemCollapsibleState) {
        // virtual
    }

    protected _state: TreeItemCollapsibleState | undefined;
    protected onNodeStateChanged(e: TreeViewNodeStateChangeEvent<ViewNode>) {
        if (e.element === this) {
            this._state = e.state;
            this.onStateChanged(e.state);
        }
        else if (e.element === this.parent) {
            this.onParentStateChanged(e.state);
        }
    }

    @debug()
    protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
        void this.ensureSubscription();

        if (e.visible) {
            void this.triggerChange();
        }
    }

    @debug()
    async ensureSubscription() {
        // We only need to subscribe if we are visible and if auto-refresh enabled (when supported)
        if (!this.canSubscribe || !this.view.visible || (supportsAutoRefresh(this.view) && !this.view.autoRefresh)) {
            await this.unsubscribe();

            return;
        }

        // If we already have a subscription, just kick out
        if (this._subscription !== undefined) return;

        this._subscription = Promise.resolve(this.subscribe());
        await this._subscription;
    }
}

export function nodeSupportsConditionalDismissal(node: ViewNode): node is ViewNode & { canDismiss(): boolean } {
    return typeof (node as ViewNode & { canDismiss(): boolean }).canDismiss === 'function';
}

export function viewSupportsNodeDismissal(view: View): view is View & { dismissNode(node: ViewNode): void } {
    return typeof (view as View & { dismissNode(node: ViewNode): void }).dismissNode === 'function';
}
