'use strict';
import { Command, Disposable, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../constants';
import { GitUri } from '../gitService';
import { RefreshNodeCommandArgs } from './gitExplorer';

export enum ResourceType {
    Branches = 'gitlens:branches',
    BranchesWithRemotes = 'gitlens:branches:remotes',
    BranchHistory = 'gitlens:branch-history',
    BranchHistoryWithTracking = 'gitlens:branch-history:tracking',
    CurrentBranchHistory = 'gitlens:current-branch-history',
    CurrentBranchHistoryWithTracking = 'gitlens:current-branch-history:tracking',
    RemoteBranchHistory = 'gitlens:remote-branch-history',
    Commit = 'gitlens:commit',
    CommitOnCurrentBranch = 'gitlens:commit:current',
    CommitFile = 'gitlens:commit-file',
    FileHistory = 'gitlens:file-history',
    Folder = 'gitlens:folder',
    History = 'gitlens:history',
    Message = 'gitlens:message',
    Pager = 'gitlens:pager',
    Remote = 'gitlens:remote',
    Remotes = 'gitlens:remotes',
    Repositories = 'gitlens:repositories',
    Repository = 'gitlens:repository',
    Stash = 'gitlens:stash',
    StashFile = 'gitlens:stash-file',
    Stashes = 'gitlens:stashes',
    Status = 'gitlens:status',
    StatusFile = 'gitlens:status-file',
    StatusFiles = 'gitlens:status-files',
    StatusFileCommits = 'gitlens:status-file-commits',
    StatusUpstream = 'gitlens:status-upstream'
}

// let id = 0;

export abstract class ExplorerNode extends Disposable {

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

    resetChildren() {
        if (this.children !== undefined) {
            this.children.forEach(c => c.dispose());
            this.children = undefined;
        }
    }
}

export class MessageNode extends ExplorerNode {

    constructor(
        private readonly message: string
    ) {
        super(new GitUri());
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Message;
        return item;
    }
}

export class PagerNode extends ExplorerNode {

    args: RefreshNodeCommandArgs = {};

    constructor(
        private readonly message: string,
        private readonly node: ExplorerNode,
        protected readonly context: ExtensionContext
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
            dark: this.context.asAbsolutePath('images/dark/icon-unfold.svg'),
            light: this.context.asAbsolutePath('images/light/icon-unfold.svg')
        };
        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Refresh',
            command: 'gitlens.gitExplorer.refreshNode',
            arguments: [this.node, this.args]
        } as Command;
    }
}

export class ShowAllNode extends PagerNode {

    args: RefreshNodeCommandArgs = { maxCount: 0 };

    constructor(
        message: string,
        node: ExplorerNode,
        context: ExtensionContext
    ) {
        super(`${message} ${GlyphChars.Space}${GlyphChars.Dash}${GlyphChars.Space} this may take a while`, node, context);
    }
}