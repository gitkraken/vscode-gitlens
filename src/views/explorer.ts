'use strict';
import {
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    TreeDataProvider,
    TreeItem,
    TreeView,
    TreeViewVisibilityChangeEvent,
    window
} from 'vscode';
import { configuration } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { FileHistoryExplorer } from './fileHistoryExplorer';
import { LineHistoryExplorer } from './lineHistoryExplorer';
import { ExplorerNode } from './nodes';
import { isPageable } from './nodes/explorerNode';
import { RepositoriesExplorer } from './repositoriesExplorer';
import { ResultsExplorer } from './resultsExplorer';

export enum RefreshReason {
    Command = 'Command',
    ConfigurationChanged = 'ConfigurationChanged',
    VisibilityChanged = 'VisibilityChanged'
}

export type Explorer = RepositoriesExplorer | FileHistoryExplorer | LineHistoryExplorer | ResultsExplorer;

export abstract class ExplorerBase<TRoot extends ExplorerNode> implements TreeDataProvider<ExplorerNode>, Disposable {
    protected _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    private _onDidChangeVisibility = new EventEmitter<TreeViewVisibilityChangeEvent>();
    public get onDidChangeVisibility(): Event<TreeViewVisibilityChangeEvent> {
        return this._onDidChangeVisibility.event;
    }

    protected _disposable: Disposable | undefined;
    protected _root: TRoot | undefined;
    protected _tree: TreeView<ExplorerNode> | undefined;

    constructor(
        public readonly id: string
    ) {
        this.registerCommands();

        Container.context.subscriptions.push(configuration.onDidChange(this.onConfigurationChanged, this));
        setImmediate(() => this.onConfigurationChanged(configuration.initializingChangeEvent));
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    getQualifiedCommand(command: string) {
        return `${this.id}.${command}`;
    }

    protected abstract getRoot(): TRoot;
    protected abstract registerCommands(): void;
    protected abstract onConfigurationChanged(e: ConfigurationChangeEvent): void;

    protected initialize(container?: string) {
        if (this._disposable) {
            this._disposable.dispose();
            this._onDidChangeTreeData = new EventEmitter<ExplorerNode>();
        }

        this._tree = window.createTreeView(`${this.id}${container ? `:${container}` : ''}`, {
            treeDataProvider: this
        });
        this._disposable = Disposable.from(
            this._tree,
            this._tree.onDidChangeVisibility(this.onVisibilityChanged, this)
        );
    }

    getChildren(node?: ExplorerNode): ExplorerNode[] | Promise<ExplorerNode[]> {
        if (node !== undefined) return node.getChildren();

        if (this._root === undefined) {
            this._root = this.getRoot();
        }

        return this._root.getChildren();
    }

    getParent(node: ExplorerNode): ExplorerNode | undefined {
        return node.getParent();
    }

    getTreeItem(node: ExplorerNode): TreeItem | Promise<TreeItem> {
        return node.getTreeItem();
    }

    protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
        this._onDidChangeVisibility.fire(e);
    }

    get selection(): ExplorerNode[] {
        if (this._tree === undefined || this._root === undefined) return [];

        return this._tree.selection;
    }

    get visible(): boolean {
        return this._tree !== undefined ? this._tree.visible : false;
    }

    async refresh(reason?: RefreshReason) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`Explorer(${this.id}).refresh`, `reason='${reason}'`);

        if (this._root !== undefined) {
            await this._root.refresh(reason);
        }

        this.triggerNodeUpdate();
    }

    async refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`Explorer(${this.id}).refreshNode(${(node as { id?: string }).id || ''})`);

        if (args !== undefined) {
            if (isPageable(node)) {
                if (args.maxCount === undefined || args.maxCount === 0) {
                    node.maxCount = args.maxCount;
                }
                else {
                    node.maxCount = (node.maxCount || args.maxCount) + args.maxCount;
                }
            }
        }

        const cancel = await node.refresh();
        if (cancel === true) return;

        this.triggerNodeUpdate(node);
    }

    async reveal(
        node: ExplorerNode,
        options?: {
            select?: boolean | undefined;
            focus?: boolean | undefined;
        }
    ) {
        if (this._tree === undefined || this._root === undefined) return;

        try {
            await this._tree.reveal(node, options);
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    async show() {
        if (this._tree === undefined || this._root === undefined) return;

        // This sucks -- have to get the first child to reveal the tree
        const [child] = await this._root.getChildren();
        return this.reveal(child, { select: false, focus: true });
    }

    triggerNodeUpdate(node?: ExplorerNode) {
        // Since the root node won't actually refresh, force everything
        this._onDidChangeTreeData.fire(node !== undefined && node !== this._root ? node : undefined);
    }
}
