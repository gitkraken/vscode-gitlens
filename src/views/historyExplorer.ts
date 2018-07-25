'use strict';
import * as path from 'path';
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
    Uri,
    window
} from 'vscode';
import { UriComparer } from '../comparers';
import { configuration, IExplorersConfig, IHistoryExplorerConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Functions } from '../system';
import { RefreshNodeCommandArgs } from '../views/explorerCommands';
import { ExplorerNode, HistoryNode, MessageNode, RefreshReason } from './nodes';

export * from './nodes';

export class HistoryExplorer implements TreeDataProvider<ExplorerNode>, Disposable {
    private _disposable: Disposable | undefined;
    private _root?: ExplorerNode;
    private _tree: TreeView<ExplorerNode> | undefined;

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        Container.explorerCommands;
        commands.registerCommand('gitlens.historyExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.historyExplorer.refreshNode', this.refreshNode, this);

        commands.registerCommand(
            'gitlens.historyExplorer.setRenameFollowingOn',
            () => this.setRenameFollowing(true),
            this
        );
        commands.registerCommand(
            'gitlens.historyExplorer.setRenameFollowingOff',
            () => this.setRenameFollowing(false),
            this
        );

        Container.context.subscriptions.push(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
            window.onDidChangeVisibleTextEditors(Functions.debounce(this.onVisibleEditorsChanged, 500), this),
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        void this.onConfigurationChanged(configuration.initializingChangeEvent);
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

        if (!initializing && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    private async onActiveEditorChanged(editor: TextEditor | undefined) {
        const root = await this.getRootNode(editor);
        if (!this.setRoot(root)) return;

        void this.refresh(RefreshReason.ActiveEditorChanged, root);
    }

    private onVisibleEditorsChanged(editors: TextEditor[]) {
        if (this._root === undefined) return;

        // If we have no visible editors, or no trackable visible editors reset the view
        if (editors.length === 0 || !editors.some(e => e.document && Container.git.isTrackable(e.document.uri))) {
            this.clearRoot();

            void this.refresh(RefreshReason.VisibleEditorsChanged);
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

    private clearRoot() {
        if (this._root === undefined) return;

        this._root.dispose();
        this._root = undefined;
    }

    private async getRootNode(editor: TextEditor | undefined): Promise<ExplorerNode | undefined> {
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

        let gitUri = await GitUri.fromUri(editor.document.uri);

        const repo = await Container.git.getRepository(gitUri);
        if (repo === undefined) return undefined;

        let uri;
        if (gitUri.sha !== undefined) {
            // If we have a sha, normalize the history to the working file (so we get a full history all the time)
            const [fileName, repoPath] = await Container.git.findWorkingFileName(
                gitUri.fsPath,
                gitUri.repoPath,
                gitUri.sha
            );

            if (fileName !== undefined) {
                uri = Uri.file(repoPath !== undefined ? path.join(repoPath, fileName) : fileName);
            }
        }

        if (UriComparer.equals(uri || gitUri, this._root && this._root.uri)) return this._root;

        if (uri !== undefined) {
            gitUri = await GitUri.fromUri(uri);
        }
        return new HistoryNode(gitUri, repo, this);
    }

    private setRenameFollowing(enabled: boolean) {
        return configuration.updateEffective(
            configuration.name('advanced')('fileHistoryFollowsRenames').value,
            enabled
        );
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
