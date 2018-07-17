'use strict';
import {
    commands,
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    TextEditor,
    TextEditorSelectionChangeEvent,
    TreeDataProvider,
    TreeItem,
    TreeView,
    window
} from 'vscode';
import { UriComparer } from '../comparers';
import { configuration, IExplorersConfig, IHistoryExplorerConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { Functions } from '../system';
import { RefreshNodeCommandArgs } from '../views/explorerCommands';
import { ExplorerNode, MessageNode, RefreshReason } from './nodes';
import { LineHistoryNode } from './nodes/lineHistoryNode';

export * from './nodes';

export class LineHistoryExplorer implements TreeDataProvider<ExplorerNode>, Disposable {
    readonly id = 'LineHistoryExplorer';
    private _disposable: Disposable | undefined;
    private _root?: LineHistoryNode;
    private _tree: TreeView<ExplorerNode> | undefined;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        Container.explorerCommands;
        commands.registerCommand('gitlens.lineHistoryExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.lineHistoryExplorer.refreshNode', this.refreshNode, this);
        // commands.registerCommand('gitlens.historyExplorer.close', () => this.dock(false), this);
        // commands.registerCommand('gitlens.historyExplorer.dock', this.dock, this);

        // commands.registerCommand(
        //     'gitlens.historyExplorer.setRenameFollowingOn',
        //     () => GitExplorer.setRenameFollowing(true),
        //     this
        // );
        // commands.registerCommand(
        //     'gitlens.historyExplorer.setRenameFollowingOff',
        //     () => GitExplorer.setRenameFollowing(false),
        //     this
        // );

        Container.context.subscriptions.push(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
            window.onDidChangeTextEditorSelection(Functions.debounce(this.onSelectionChanged, 500), this),
            window.onDidChangeVisibleTextEditors(Functions.debounce(this.onVisibleEditorsChanged, 500), this),
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    private async onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (
            !initializing &&
            !configuration.changed(e, configuration.name('historyExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        ) {
            return;
        }

        if (
            initializing ||
            configuration.changed(e, configuration.name('historyExplorer')('enabled').value) ||
            configuration.changed(e, configuration.name('historyExplorer')('location').value)
        ) {
            setCommandContext(CommandContext.LineHistoryExplorer, this.config.enabled ? this.config.location : false);
        }

        if (initializing) {
            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        if (initializing || configuration.changed(e, configuration.name('historyExplorer')('location').value)) {
            if (this._disposable) {
                this._disposable.dispose();
                this._onDidChangeTreeData = new EventEmitter<ExplorerNode>();
            }

            this._tree = window.createTreeView(`gitlens.lineHistoryExplorer:${this.config.location}`, {
                treeDataProvider: this
            });
            this._disposable = this._tree;
        }

        if (!initializing && this._root !== undefined) {
            this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    private async onActiveEditorChanged(editor: TextEditor | undefined) {
        const root = await this.getRootNode(editor);
        if (!this.setRoot(root)) return;

        this.refresh(RefreshReason.ActiveEditorChanged, root);
    }

    private async onSelectionChanged(e: TextEditorSelectionChangeEvent) {
        const root = await this.getRootNode(e.textEditor);
        if (!this.setRoot(root)) return;

        this.refresh(RefreshReason.ActiveEditorChanged, root);
    }

    private onVisibleEditorsChanged(editors: TextEditor[]) {
        if (this._root === undefined) return;

        // If we have no visible editors, or no trackable visible editors reset the view
        if (editors.length === 0 || !editors.some(e => e.document && Container.git.isTrackable(e.document.uri))) {
            this.clearRoot();

            this.refresh(RefreshReason.VisibleEditorsChanged);
        }
    }

    get config(): IExplorersConfig & IHistoryExplorerConfig {
        return { ...Container.config.explorers, ...Container.config.historyExplorer };
    }

    getParent(element: ExplorerNode): ExplorerNode | undefined {
        return undefined;
    }

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (this._root === undefined) return [new MessageNode(`No active file ${GlyphChars.Dash} no history to show`)];

        if (node === undefined) return this._root.getChildren();
        return node.getChildren();
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    getQualifiedCommand(command: string) {
        return `gitlens.lineHistoryExplorer.${command}`;
    }

    async refresh(reason?: RefreshReason, root?: ExplorerNode) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`LineHistoryExplorer.refresh`, `reason='${reason}'`);

        if (this._root === undefined || root === undefined) {
            this.clearRoot();
            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        this._onDidChangeTreeData.fire();
    }

    refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`LineHistoryExplorer.refreshNode(${(node as { id?: string }).id || ''})`);

        if (args !== undefined && node.supportsPaging) {
            node.maxCount = args.maxCount;
        }
        node.refresh();

        // Since a root node won't actually refresh, force everything
        this._onDidChangeTreeData.fire(this._root === node ? undefined : node);
    }

    async show() {
        if (this._root === undefined || this._tree === undefined) return;

        try {
            await this._tree.reveal(this._root, { select: false });
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    private clearRoot() {
        if (this._root === undefined) return;

        this._root.dispose();
        this._root = undefined;
    }

    private async getRootNode(editor: TextEditor | undefined): Promise<LineHistoryNode | undefined> {
        // If we have no active editor, or no visible editors, or no trackable visible editors reset the view
        if (
            editor == null ||
            window.visibleTextEditors.length === 0 ||
            !window.visibleTextEditors.some(e => e.document && Container.git.isTrackable(e.document.uri))
        ) {
            return undefined;
        }

        // If we do have a visible trackable editor, don't change from the last state (avoids issues when focus switches to the problems/output/debug console panes)
        if (editor.document === undefined || !Container.git.isTrackable(editor.document.uri)) return this._root;

        const gitUri = await GitUri.fromUri(editor.document.uri);

        const repo = await Container.git.getRepository(gitUri);
        if (repo === undefined) return undefined;

        if (
            this._root !== undefined &&
            UriComparer.equals(gitUri, this._root.uri) &&
            editor.selection.isEqual(this._root.range)
        ) {
            return this._root;
        }

        return new LineHistoryNode(gitUri, editor.selection, repo, this);
    }

    private setRoot(root: LineHistoryNode | undefined): boolean {
        if (this._root === root) return false;

        if (this._root !== undefined) {
            this._root.dispose();
        }

        this._root = root;
        return true;
    }
}
