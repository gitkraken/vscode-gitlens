'use strict';
import { Command, Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ISavedComputedRef, ISavedNamedRef } from '../ui/config';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { GitService, GitUri } from '../gitService';
import { GitExplorer } from './gitExplorer';
import { HistoryExplorer } from './historyExplorer';
import { ResultsExplorer } from './resultsExplorer';

export interface NamedRef extends ISavedNamedRef { }

export class ComputedRef implements NamedRef {

    private _label: string | undefined;
    private readonly _ref: Promise<string>;

    constructor(
        public readonly repoPath: string,
        public readonly op: 'merge-base',
        public readonly ref1: string,
        public readonly ref2?: string,
        label?: string
    ) {
        this._ref = this.computeRef();
        this._label = label;
    }

    get label(): string | Promise<string | undefined> | undefined {
        if (this._label !== undefined) return this._label;

        return this.getLabel();
    }

    get ref(): Promise<string> {
        return this._ref;
    }

    private async getLabel() {
        await this._ref;
        return this._label;
    }

    private async computeRef(): Promise<string> {
        switch (this.op) {
            case 'merge-base':
                let ref2 = this.ref2;
                if (ref2 === undefined) {
                    const branch = await Container.git.getBranch(this.repoPath);
                    if (branch !== undefined) {
                        ref2 = branch.name;
                    }
                }

                if (ref2 !== undefined) {
                    const ancestor = await Container.git.getMergeBase(this.repoPath!, this.ref1, ref2);
                    if (ancestor !== undefined) {
                        if (this._label === undefined) {
                            this._label = `ancestry with ${this.ref1} (${GitService.shortenSha(ancestor)})`;
                        }
                        return ancestor;
                    }
                }

                break;
        }

        return this.ref1;
    }

    toJSON() {
        return {
            op: this.op,
            ref1: this.ref1,
            ref2: this.ref2
            // repoPath: this.repoPath
        };
    }

    static fromSaved(ref: ISavedNamedRef | ISavedComputedRef, repoPath: string): NamedRef | ComputedRef {
        if ('op' in ref) return new ComputedRef(repoPath, ref.op, ref.ref1, ref.ref2);

        return ref;
    }
}

export class MergeBaseNamedRef extends ComputedRef {

    constructor(
        repoPath: string,
        ref1: string,
        ref2?: string,
        label?: string
    ) {
        super(repoPath, 'merge-base', ref1, ref2, label);
    }
}

export enum RefreshReason {
    ActiveEditorChanged = 'active-editor-changed',
    AutoRefreshChanged = 'auto-refresh-changed',
    Command = 'command',
    ConfigurationChanged = 'configuration',
    NodeCommand = 'node-command',
    RepoChanged = 'repo-changed',
    ViewChanged = 'view-changed',
    VisibleEditorsChanged = 'visible-editors-changed'
}

export enum ResourceType {
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
    History = 'gitlens:history',
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
    Status = 'gitlens:status',
    StatusFile = 'gitlens:file:status',
    StatusFiles = 'gitlens:status:files',
    StatusFileCommits = 'gitlens:status:file-commits',
    StatusUpstream = 'gitlens:status:upstream',
    Tag = 'gitlens:tag',
    Tags = 'gitlens:tags'
}

export type Explorer = GitExplorer | HistoryExplorer | ResultsExplorer;

// let id = 0;

export abstract class ExplorerNode extends Disposable {

    readonly supportsPaging: boolean = false;
    maxCount: number | undefined;

    protected children: ExplorerNode[] | undefined;
    protected disposable: Disposable | undefined;
    // protected readonly id: number;

    constructor(
        public readonly uri: GitUri
    ) {
        super(() => this.dispose());
        // this.id = id++;
    }

    dispose() {
        if (this.disposable !== undefined) {
            this.disposable.dispose();
            this.disposable = undefined;
        }

        this.resetChildren();
    }

    abstract getChildren(): ExplorerNode[] | Promise<ExplorerNode[]>;
    abstract getTreeItem(): TreeItem | Promise<TreeItem>;

    getCommand(): Command | undefined {
        return undefined;
    }

    refresh(): void { }

    resetChildren(): void {
        if (this.children !== undefined) {
            this.children.forEach(c => c.dispose());
            this.children = undefined;
        }
    }
}

export abstract class ExplorerRefNode extends ExplorerNode {
    abstract get ref(): string;
    get repoPath(): string {
        return this.uri.repoPath!;
    }
}

export class MessageNode extends ExplorerNode {

    constructor(
        private readonly message: string,
        private readonly tooltip?: string
    ) {
        super(new GitUri());
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Message;
        item.tooltip = this.tooltip;
        return item;
    }
}

export class PagerNode extends ExplorerNode {

    args: RefreshNodeCommandArgs = {};

    constructor(
        private readonly message: string,
        private readonly node: ExplorerNode,
        protected readonly explorer: Explorer
    ) {
        super(new GitUri());
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Pager;
        item.command = this.getCommand();
        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-unfold.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-unfold.svg')
        };
        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Refresh',
            command: this.explorer.getQualifiedCommand('refreshNode'),
            arguments: [this.node, this.args]
        } as Command;
    }
}

export class ShowAllNode extends PagerNode {

    args: RefreshNodeCommandArgs = { maxCount: 0 };

    constructor(
        message: string,
        node: ExplorerNode,
        explorer: Explorer
    ) {
        super(`${message} ${GlyphChars.Space}${GlyphChars.Dash}${GlyphChars.Space} this may take a while`, node, explorer);
    }
}