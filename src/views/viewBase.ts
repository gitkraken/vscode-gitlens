'use strict';
import {
    commands,
    ConfigurationChangeEvent,
    ConfigurationTarget,
    Disposable,
    Event,
    EventEmitter,
    MessageItem,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    TreeView,
    TreeViewExpansionEvent,
    TreeViewVisibilityChangeEvent,
    window
} from 'vscode';
import { configuration } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';
import { debug, Functions, log, Strings } from '../system';
import { CompareView } from './compareView';
import { FileHistoryView } from './fileHistoryView';
import { LineHistoryView } from './lineHistoryView';
import { ViewNode } from './nodes';
import { isPageable } from './nodes/viewNode';
import { RepositoriesView } from './repositoriesView';
import { SearchView } from './searchView';
import { RefreshNodeCommandArgs } from './viewCommands';

export type View = RepositoriesView | FileHistoryView | LineHistoryView | CompareView | SearchView;
export type ViewWithFiles = RepositoriesView | CompareView | SearchView;

export interface TreeViewNodeStateChangeEvent<T> extends TreeViewExpansionEvent<T> {
    state: TreeItemCollapsibleState;
}

export abstract class ViewBase<TRoot extends ViewNode<View>> implements TreeDataProvider<ViewNode>, Disposable {
    protected _onDidChangeTreeData = new EventEmitter<ViewNode>();
    get onDidChangeTreeData(): Event<ViewNode> {
        return this._onDidChangeTreeData.event;
    }

    private _onDidChangeVisibility = new EventEmitter<TreeViewVisibilityChangeEvent>();
    get onDidChangeVisibility(): Event<TreeViewVisibilityChangeEvent> {
        return this._onDidChangeVisibility.event;
    }

    private _onDidChangeNodeState = new EventEmitter<TreeViewNodeStateChangeEvent<ViewNode>>();
    get onDidChangeNodeState(): Event<TreeViewNodeStateChangeEvent<ViewNode>> {
        return this._onDidChangeNodeState.event;
    }

    protected _disposable: Disposable | undefined;
    protected _root: TRoot | undefined;
    protected _tree: TreeView<ViewNode> | undefined;

    constructor(public readonly id: string, public readonly name: string) {
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

    protected abstract get location(): string;

    protected abstract getRoot(): TRoot;
    protected abstract registerCommands(): void;
    protected abstract onConfigurationChanged(e: ConfigurationChangeEvent): void;

    protected initialize(container?: string, options: { showCollapseAll?: boolean } = {}) {
        if (this._disposable) {
            this._disposable.dispose();
            this._onDidChangeTreeData = new EventEmitter<ViewNode>();
        }

        this._tree = window.createTreeView(`${this.id}${container ? `:${container}` : ''}`, {
            ...options,
            treeDataProvider: this
        });
        this._disposable = Disposable.from(
            this._tree,
            this._tree.onDidChangeVisibility(Functions.debounce(this.onVisibilityChanged, 250), this),
            this._tree.onDidCollapseElement(this.onElementCollapsed, this),
            this._tree.onDidExpandElement(this.onElementExpanded, this)
        );
    }

    protected ensureRoot() {
        if (this._root === undefined) {
            this._root = this.getRoot();
        }

        return this._root;
    }

    getChildren(node?: ViewNode): ViewNode[] | Promise<ViewNode[]> {
        if (node !== undefined) return node.getChildren();

        const root = this.ensureRoot();
        return root.getChildren();
    }

    getParent(node: ViewNode): ViewNode | undefined {
        return node.getParent();
    }

    getTreeItem(node: ViewNode): TreeItem | Promise<TreeItem> {
        return node.getTreeItem();
    }

    protected onElementCollapsed(e: TreeViewExpansionEvent<ViewNode>) {
        this._onDidChangeNodeState.fire({ ...e, state: TreeItemCollapsibleState.Collapsed });
    }

    protected onElementExpanded(e: TreeViewExpansionEvent<ViewNode>) {
        this._onDidChangeNodeState.fire({ ...e, state: TreeItemCollapsibleState.Expanded });
    }

    protected onVisibilityChanged(e: TreeViewVisibilityChangeEvent) {
        this._onDidChangeVisibility.fire(e);
    }

    get selection(): ViewNode[] {
        if (this._tree === undefined || this._root === undefined) return [];

        return this._tree.selection;
    }

    get visible(): boolean {
        return this._tree !== undefined ? this._tree.visible : false;
    }

    @debug()
    async refresh(reset: boolean = false) {
        if (this._root !== undefined) {
            await this._root.refresh(reset);
        }

        this.triggerNodeChange();
    }

    @debug({
        args: { 0: (n: ViewNode) => n.toString() }
    })
    async refreshNode(node: ViewNode, reset: boolean = false, args?: RefreshNodeCommandArgs) {
        if (args !== undefined) {
            if (isPageable(node)) {
                if (args.maxCount === undefined || args.maxCount === 0) {
                    node.maxCount = args.maxCount;
                }
                else {
                    node.maxCount = (node.maxCount || args.maxCount) + args.maxCount;
                }

                if (args.previousNode !== undefined) {
                    void (await this.reveal(args.previousNode, { select: true }));
                }
            }
        }

        const cancel = await node.refresh(reset);
        if (cancel === true) return;

        this.triggerNodeChange(node);
    }

    @log({
        args: { 0: (n: ViewNode) => n.toString() }
    })
    async reveal(
        node: ViewNode,
        options?: {
            select?: boolean;
            focus?: boolean;
            expand?: boolean | number;
        }
    ) {
        if (this._tree === undefined) return;

        try {
            await this._tree.reveal(node, options);
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    @log()
    async show() {
        const location = this.location;

        try {
            return await commands.executeCommand(`${this.id}${location ? `:${location}` : ''}.focus`);
        }
        catch (ex) {
            Logger.error(ex);

            const setting = `${Strings.splitSingle(this.id, '.')[1]}.enabled`;
            if (!configuration.get(setting)) {
                const actions: MessageItem[] = [{ title: 'Enable' }, { title: 'Cancel', isCloseAffordance: true }];

                const result = await window.showErrorMessage(
                    `Unable to show the ${this.name} view since it's currently disabled. Would you like to enable it?`,
                    ...actions
                );

                if (result === actions[0]) {
                    await configuration.update(setting, true, ConfigurationTarget.Global);

                    return commands.executeCommand(`${this.id}${location ? `:${location}` : ''}.focus`);
                }
            }

            return undefined;
        }
    }

    @debug({
        args: { 0: (n: ViewNode) => (n != null ? n.toString() : '') }
    })
    triggerNodeChange(node?: ViewNode) {
        // Since the root node won't actually refresh, force everything
        this._onDidChangeTreeData.fire(node !== undefined && node !== this._root ? node : undefined);
    }
}
