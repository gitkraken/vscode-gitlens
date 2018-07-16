'use strict';
import {
    commands,
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    TextEditor,
    TreeDataProvider,
    TreeItem,
    TreeView,
    window
} from 'vscode';
import { configuration, GitExplorerView, IExplorersConfig, IHistoryExplorerConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Functions } from '../system';
import { RefreshNodeCommandArgs } from '../views/explorerCommands';
import { GitExplorer } from '../views/gitExplorer';
import { ExplorerNode, MessageNode, RefreshReason } from './nodes';

export * from './nodes';

export class HistoryExplorer extends Disposable implements TreeDataProvider<ExplorerNode> {
    private _disposable: Disposable | undefined;
    private _root?: ExplorerNode;
    private _tree: TreeView<ExplorerNode> | undefined;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        super(() => this.dispose());

        Container.explorerCommands;
        commands.registerCommand('gitlens.historyExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.historyExplorer.refreshNode', this.refreshNode, this);
        commands.registerCommand('gitlens.historyExplorer.close', () => this.dock(false), this);
        commands.registerCommand('gitlens.historyExplorer.dock', this.dock, this);

        commands.registerCommand(
            'gitlens.historyExplorer.setRenameFollowingOn',
            () => GitExplorer.setRenameFollowing(true),
            this
        );
        commands.registerCommand(
            'gitlens.historyExplorer.setRenameFollowingOff',
            () => GitExplorer.setRenameFollowing(false),
            this
        );

        Container.context.subscriptions.push(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
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
            setCommandContext(CommandContext.HistoryExplorer, this.config.enabled ? this.config.location : false);
        }

        if (initializing || configuration.changed(e, configuration.name('historyExplorer')('enabled').value)) {
            if (this.config.enabled) {
                this.undock(!initializing, !configuration.changed(e, configuration.name('mode').value));
            }
            else {
                this.dock(!initializing, !configuration.changed(e, configuration.name('mode').value));
            }
        }

        if (initializing) {
            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        if (initializing || configuration.changed(e, configuration.name('historyExplorer')('location').value)) {
            if (this._disposable) {
                this._disposable.dispose();
                this._onDidChangeTreeData = new EventEmitter<ExplorerNode>();
            }

            this._tree = window.createTreeView(`gitlens.historyExplorer:${this.config.location}`, {
                treeDataProvider: this
            });
            this._disposable = this._tree;
        }

        if (!initializing && this._root === undefined) {
            this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    private async onActiveEditorChanged(editor: TextEditor | undefined) {
        const root = await this.getRootNode(editor);
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

    async dock(switchView: boolean = true, updateConfig: boolean = true) {
        if (switchView) {
            await Container.gitExplorer.switchTo(GitExplorerView.History);
        }

        await setCommandContext(CommandContext.HistoryExplorer, false);
        if (updateConfig) {
            await configuration.updateEffective(configuration.name('historyExplorer')('enabled').value, false);
        }
    }

    getQualifiedCommand(command: string) {
        return `gitlens.historyExplorer.${command}`;
    }

    async refresh(reason?: RefreshReason, root?: ExplorerNode) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`HistoryExplorer.refresh`, `reason='${reason}'`);

        if (this._root === undefined || root === undefined) {
            this.clearRoot();
            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        this._onDidChangeTreeData.fire();
    }

    refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`HistoryExplorer.refreshNode(${(node as { id?: string }).id || ''})`);

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

    async undock(switchView: boolean = true, updateConfig: boolean = true) {
        if (switchView) {
            await Container.gitExplorer.switchTo(GitExplorerView.Repository);
        }

        await setCommandContext(CommandContext.HistoryExplorer, this.config.location);
        if (updateConfig) {
            await configuration.updateEffective(configuration.name('historyExplorer')('enabled').value, true);
        }
    }

    private clearRoot() {
        if (this._root === undefined) return;

        this._root.dispose();
        this._root = undefined;
    }

    private async getRootNode(editor: TextEditor | undefined): Promise<ExplorerNode | undefined> {
        return GitExplorer.getHistoryNode(this, editor, this._root);
    }

    private setRoot(root: ExplorerNode | undefined): boolean {
        if (this._root === root) return false;

        if (this._root !== undefined) {
            this._root.dispose();
        }

        this._root = root;
        return true;
    }
}
