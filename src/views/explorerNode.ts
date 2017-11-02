'use strict';
import { Command, Disposable, ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../constants';
import { GitUri } from '../gitService';
import { RefreshNodeCommandArgs } from './gitExplorer';

export declare type ResourceType =
    'gitlens:branches' |
    'gitlens:branch-history' |
    'gitlens:commit' |
    'gitlens:commit-file' |
    'gitlens:file-history' |
    'gitlens:folder' |
    'gitlens:history' |
    'gitlens:message' |
    'gitlens:pager' |
    'gitlens:remote' |
    'gitlens:remotes' |
    'gitlens:repositories' |
    'gitlens:repository' |
    'gitlens:stash' |
    'gitlens:stash-file' |
    'gitlens:stashes' |
    'gitlens:status' |
    'gitlens:status-file' |
    'gitlens:status-files' |
    'gitlens:status-file-commits' |
    'gitlens:status-upstream';

// let id = 0;

export abstract class ExplorerNode extends Disposable {

    abstract readonly resourceType: ResourceType;

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

    readonly resourceType: ResourceType = 'gitlens:message';

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
        item.contextValue = this.resourceType;
        return item;
    }
}

export class PagerNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:pager';
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
        item.contextValue = this.resourceType;
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