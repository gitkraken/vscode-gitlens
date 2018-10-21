'use strict';
import { Command, Disposable, Event, TreeItem, TreeViewVisibilityChangeEvent } from 'vscode';
import { GitUri } from '../../git/gitService';
import { RefreshReason, View } from '../viewBase';

export enum ResourceType {
    ActiveFileHistory = 'gitlens:active:history-file',
    ActiveLineHistory = 'gitlens:active:history-line',
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
    FileHistory = 'gitlens:history-file',
    FileStaged = 'gitlens:file:staged',
    FileStagedAndUnstaged = 'gitlens:file:staged:unstaged',
    FileUnstaged = 'gitlens:file:unstaged',
    Folder = 'gitlens:folder',
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
    Stash = 'gitlens:stash',
    StashFile = 'gitlens:file:stash',
    Stashes = 'gitlens:stashes',
    StatusFileCommits = 'gitlens:status:file:commits',
    StatusFiles = 'gitlens:status:files',
    StatusUpstream = 'gitlens:status:upstream',
    Tag = 'gitlens:tag',
    Tags = 'gitlens:tags'
}

export interface NamedRef {
    label?: string;
    ref: string;
}

export const unknownGitUri = new GitUri();

export abstract class ViewNode {
    constructor(
        uri: GitUri,
        protected readonly _parent: ViewNode | undefined
    ) {
        this._uri = uri;
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

    refresh(reason?: RefreshReason): void | boolean | Promise<void> | Promise<boolean> {}
}

export abstract class ViewRefNode extends ViewNode {
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

export abstract class SubscribeableViewNode<TView extends View> extends ViewNode {
    protected _disposable: Disposable;
    protected _subscription: Promise<Disposable | undefined> | undefined;

    constructor(
        uri: GitUri,
        parent: ViewNode | undefined,
        public readonly view: TView
    ) {
        super(uri, parent);

        const disposables = [this.view.onDidChangeVisibility(this.onVisibilityChanged, this)];

        if (supportsAutoRefresh(this.view)) {
            disposables.push(this.view.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this));
        }

        this._disposable = Disposable.from(...disposables);
    }

    dispose() {
        this.unsubscribe();

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

    async triggerChange() {
        return this.view.refreshNode(this);
    }

    protected abstract async subscribe(): Promise<Disposable | undefined>;

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

    protected onAutoRefreshChanged() {
        this.onVisibilityChanged({ visible: this.view.visible });
    }

    protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
        void this.ensureSubscription();

        if (e.visible) {
            void this.triggerChange();
        }
    }

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
