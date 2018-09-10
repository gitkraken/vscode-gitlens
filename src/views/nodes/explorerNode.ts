'use strict';
import { Command, Disposable, Event, TreeItem, TreeViewVisibilityChangeEvent } from 'vscode';
import { GitUri } from '../../git/gitService';
import { Explorer } from '../explorer';

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
    Folder = 'gitlens:folder',
    Message = 'gitlens:message',
    Pager = 'gitlens:pager',
    Remote = 'gitlens:remote',
    Remotes = 'gitlens:remotes',
    Repositories = 'gitlens:repositories',
    Repository = 'gitlens:repository',
    Results = 'gitlens:results',
    ResultsCommits = 'gitlens:results:commits',
    ResultsFiles = 'gitlens:results:files',
    SearchResults = 'gitlens:results:search',
    Stash = 'gitlens:stash',
    StashFile = 'gitlens:file:stash',
    Stashes = 'gitlens:stashes',
    StatusFile = 'gitlens:file:status',
    StatusFiles = 'gitlens:status:files',
    StatusFileCommits = 'gitlens:status:file-commits',
    StatusUpstream = 'gitlens:status:upstream',
    Tag = 'gitlens:tag',
    Tags = 'gitlens:tags'
}

export interface NamedRef {
    label?: string;
    ref: string;
}

export const unknownGitUri = new GitUri();

export abstract class ExplorerNode {
    constructor(uri: GitUri) {
        this._uri = uri;
    }

    protected _uri: GitUri;
    get uri() {
        return this._uri;
    }

    abstract getChildren(): ExplorerNode[] | Promise<ExplorerNode[]>;
    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    refresh(): void | Promise<void> {}
}

export abstract class ExplorerRefNode extends ExplorerNode {
    abstract get ref(): string;

    get repoPath(): string {
        return this.uri.repoPath!;
    }
}

export interface PageableExplorerNode {
    readonly supportsPaging: boolean;
    maxCount: number | undefined;
}

export function isPageable(
    node: ExplorerNode
): node is ExplorerNode & { supportsPaging: boolean; maxCount: number | undefined } {
    return !!(node as any).supportsPaging;
}

export function supportsAutoRefresh(
    explorer: Explorer
): explorer is Explorer & { autoRefresh: boolean; onDidChangeAutoRefresh: Event<void> } {
    return (explorer as any).onDidChangeAutoRefresh !== undefined;
}

export abstract class SubscribeableExplorerNode<TExplorer extends Explorer> extends ExplorerNode {
    protected _disposable: Disposable;
    protected _subscription: Disposable | undefined;

    constructor(
        uri: GitUri,
        public readonly explorer: TExplorer
    ) {
        super(uri);

        const disposables = [this.explorer.onDidChangeVisibility(this.onVisibilityChanged, this)];

        if (supportsAutoRefresh(this.explorer)) {
            disposables.push(this.explorer.onDidChangeAutoRefresh(this.onAutoRefreshChanged, this));
        }

        this._disposable = Disposable.from(...disposables);
    }

    dispose() {
        this.unsubscribe();

        if (this._disposable !== undefined) {
            this._disposable.dispose();
        }
    }

    protected abstract async subscribe(): Promise<Disposable | undefined>;
    protected unsubscribe(): void {
        if (this._subscription !== undefined) {
            this._subscription.dispose();
            this._subscription = undefined;
        }
    }

    protected onAutoRefreshChanged() {
        this.onVisibilityChanged({ visible: this.explorer.visible });
    }

    protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
        void this.ensureSubscription();

        if (e.visible) {
            void this.explorer.refreshNode(this);
        }
    }

    async ensureSubscription() {
        // We only need to subscribe if we are visible and if auto-refresh enabled (when supported)
        if (!this.explorer.visible || (supportsAutoRefresh(this.explorer) && !this.explorer.autoRefresh)) {
            this.unsubscribe();

            return;
        }

        // If we already have a subscription, just kick out
        if (this._subscription !== undefined) return;

        this._subscription = await this.subscribe();
    }
}
