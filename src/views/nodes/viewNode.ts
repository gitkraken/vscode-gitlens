'use strict';
import { Command, Disposable, Event, TreeItem, TreeItemCollapsibleState, TreeViewVisibilityChangeEvent } from 'vscode';
import { GitUri } from '../../git/gitService';
import { debug, gate, logName } from '../../system';
import { RefreshReason, TreeViewNodeStateChangeEvent, View } from '../viewBase';

export enum ResourceType {
    ActiveFileHistory = 'gitlens:history:active:file',
    ActiveLineHistory = 'gitlens:history:active:line',
    Branch = 'gitlens:branch',
    BranchWithTracking = 'gitlens:branch:tracking',
    Branches = 'gitlens:branches',
    BranchesWithRemotes = 'gitlens:branches:remotes',
    CurrentBranch = 'gitlens:branch:current',
    CurrentBranchWithTracking = 'gitlens:branch:current:tracking',
    RemoteBranch = 'gitlens:branch:remote',
    Commit = 'gitlens:commit',
    CommitOnCurrentBranch = 'gitlens:commit:current',
    CommitFile = 'gitlens:file:commit',
    Commits = 'gitlens:commits',
    ComparisonResults = 'gitlens:results:comparison',
    FileHistory = 'gitlens:history:file',
    FileStaged = 'gitlens:file:staged',
    FileStagedAndUnstaged = 'gitlens:file:staged:unstaged',
    FileUnstaged = 'gitlens:file:unstaged',
    Folder = 'gitlens:folder',
    LineHistory = 'gitlens:history:line',
    Message = 'gitlens:message',
    Pager = 'gitlens:pager',
    Remote = 'gitlens:remote',
    Remotes = 'gitlens:remotes',
    Repositories = 'gitlens:repositories',
    Repository = 'gitlens:repository',
    Results = 'gitlens:results',
    ResultsCommits = 'gitlens:results:commits',
    ResultsFile = 'gitlens:file:results',
    ResultsFiles = 'gitlens:results:files',
    SearchResults = 'gitlens:results:search',
    Search = 'gitlens:search',
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

export interface NamedRef {
    label?: string;
    ref: string;
}

export const unknownGitUri = new GitUri();

export interface ViewNode {
    readonly id?: string;
}

@logName<ViewNode>((c, name) => `${name}${c.id ? `(${c.id})` : ''}`)
export abstract class ViewNode<TView extends View = View> {
    constructor(
        uri: GitUri,
        public readonly view: TView,
        protected readonly _parent?: ViewNode
    ) {
        this._uri = uri;
    }

    toString() {
        return `${this.constructor.name}${this.id != null ? `(${this.id})` : ''}`;
    }

    protected _uri: GitUri;
    get uri() {
        return this._uri;
    }

    abstract getChildren(): ViewNode[] | Promise<ViewNode[]>;

    getParent(): ViewNode | undefined {
        return this._parent;
    }

    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    @gate()
    @debug()
    refresh(reason?: RefreshReason): void | boolean | Promise<void> | Promise<boolean> {}

    @gate()
    @debug()
    triggerChange(): Promise<void> {
        return this.view.refreshNode(this);
    }
}

export abstract class ViewRefNode<TView extends View = View> extends ViewNode<TView> {
    abstract get ref(): string;

    get repoPath(): string {
        return this.uri.repoPath!;
    }
}

export interface PageableViewNode {
    readonly supportsPaging: boolean;
    maxCount: number | undefined;
}

export function isPageable(
    node: ViewNode
): node is ViewNode & { supportsPaging: boolean; maxCount: number | undefined } {
    return Boolean((node as any).supportsPaging);
}

export function supportsAutoRefresh(
    view: View
): view is View & { autoRefresh: boolean; onDidChangeAutoRefresh: Event<void> } {
    return (view as any).onDidChangeAutoRefresh !== undefined;
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

    protected abstract async subscribe(): Promise<Disposable | undefined>;

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

    protected onParentStateChanged(state: TreeItemCollapsibleState) {}
    protected onStateChanged(state: TreeItemCollapsibleState) {}

    protected _state: TreeItemCollapsibleState | undefined;
    protected onNodeStateChanged(e: TreeViewNodeStateChangeEvent<ViewNode>) {
        if (e.element === this) {
            this._state = e.state;
            this.onStateChanged(e.state);
        }
        else if (e.element === this._parent) {
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

        this._subscription = this.subscribe();
        await this._subscription;
    }
}

export function canDismissNode(view: View): view is View & { dismissNode(node: ViewNode): void } {
    return typeof (view as any).dismissNode === 'function';
}
