'use strict';
import {
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    TreeDataProvider,
    TreeItem,
    TreeView
} from 'vscode';
// import { configuration } from '../configuration';
// import { Container } from '../container';
import { Logger } from '../logger';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { ExplorerNode, RefreshReason } from './nodes';

export abstract class ExplorerBase implements TreeDataProvider<ExplorerNode>, Disposable {
    protected _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    protected _disposable: Disposable | undefined;
    protected _roots: ExplorerNode[] = [];
    protected _tree: TreeView<ExplorerNode> | undefined;

    constructor() {
        this.registerCommands();
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    abstract get id(): string;

    protected abstract registerCommands(): void;
    protected abstract onConfigurationChanged(e: ConfigurationChangeEvent): void;

    abstract getChildren(node?: ExplorerNode): Promise<ExplorerNode[]>;
    getParent(element: ExplorerNode): ExplorerNode | undefined {
        return undefined;
    }
    abstract getTreeItem(node: ExplorerNode): Promise<TreeItem>;

    protected getQualifiedCommand(command: string) {
        return `gitlens.${this.id}.${command}`;
    }

    refresh(reason?: RefreshReason) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`Explorer(${this.id}).refresh`, `reason='${reason}'`);
        this._onDidChangeTreeData.fire();
    }

    refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`Explorer(${this.id}).refreshNode(${(node as { id?: string }).id || ''})`);

        if (args !== undefined && node.supportsPaging) {
            node.maxCount = args.maxCount;
        }
        node.refresh();

        // Since a root node won't actually refresh, force everything
        this.updateNode(node);
    }

    refreshNodes() {
        Logger.log(`Explorer(${this.id}).refreshNodes`);

        this._roots.forEach(n => n.refresh());
        this._onDidChangeTreeData.fire();
    }

    async show() {
        if (this._tree === undefined || this._roots === undefined || this._roots.length === 0) return;

        try {
            await this._tree.reveal(this._roots[0], { select: false });
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    updateNode(node: ExplorerNode | undefined) {
        Logger.log(`Explorer(${this.id}).updateNode`);
        if (node !== undefined) {
            node = this._roots.includes(node) ? undefined : node;
        }
        this._onDidChangeTreeData.fire(node);
    }
}
