'use strict';
import { Functions } from '../system';
import { commands, ConfigurationChangeEvent, ConfigurationTarget, Disposable, Event, EventEmitter, TextDocumentShowOptions, TextEditor, TreeDataProvider, TreeItem, Uri, window, workspace } from 'vscode';
import { UriComparer } from '../comparers';
import { configuration, ExplorerFilesLayout, GitExplorerView, IExplorersConfig, IGitExplorerConfig } from '../configuration';
import { CommandContext, GlyphChars, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { ExplorerNode, HistoryNode, MessageNode, RefreshReason, RepositoriesNode, RepositoryNode } from './explorerNodes';
import { GitUri } from '../gitService';
import { Logger } from '../logger';

export * from './explorerNodes';

export interface OpenFileRevisionCommandArgs {
    uri?: Uri;
    showOptions?: TextDocumentShowOptions;
}

export class GitExplorer extends Disposable implements TreeDataProvider<ExplorerNode> {

    private _disposable: Disposable | undefined;
    private _root?: ExplorerNode;
    private _view: GitExplorerView | undefined;

    private _onDidChangeAutoRefresh = new EventEmitter<void>();
    public get onDidChangeAutoRefresh(): Event<void> {
        return this._onDidChangeAutoRefresh.event;
    }

    private _onDidChangeTreeData = new EventEmitter<ExplorerNode>();
    public get onDidChangeTreeData(): Event<ExplorerNode> {
        return this._onDidChangeTreeData.event;
    }

    constructor() {
        super(() => this.dispose());

        Container.explorerCommands;
        commands.registerCommand('gitlens.gitExplorer.refresh', this.refresh, this);
        commands.registerCommand('gitlens.gitExplorer.refreshNode', this.refreshNode, this);
        commands.registerCommand('gitlens.gitExplorer.setFilesLayoutToAuto', () => this.setFilesLayout(ExplorerFilesLayout.Auto), this);
        commands.registerCommand('gitlens.gitExplorer.setFilesLayoutToList', () => this.setFilesLayout(ExplorerFilesLayout.List), this);
        commands.registerCommand('gitlens.gitExplorer.setFilesLayoutToTree', () => this.setFilesLayout(ExplorerFilesLayout.Tree), this);

        commands.registerCommand('gitlens.gitExplorer.setAutoRefreshToOn', () => this.setAutoRefresh(Container.config.gitExplorer.autoRefresh, true), this);
        commands.registerCommand('gitlens.gitExplorer.setAutoRefreshToOff', () => this.setAutoRefresh(Container.config.gitExplorer.autoRefresh, false), this);
        commands.registerCommand('gitlens.gitExplorer.setRenameFollowingOn', () => this.setRenameFollowing(true), this);
        commands.registerCommand('gitlens.gitExplorer.setRenameFollowingOff', () => this.setRenameFollowing(false), this);
        commands.registerCommand('gitlens.gitExplorer.switchToHistoryView', () => this.switchTo(GitExplorerView.History), this);
        commands.registerCommand('gitlens.gitExplorer.switchToRepositoryView', () => this.switchTo(GitExplorerView.Repository), this);

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

    private async onActiveEditorChanged(editor: TextEditor | undefined) {
        if (this._view !== GitExplorerView.History) return;

        const root = await this.getRootNode(editor);
        if (!this.setRoot(root)) return;

        this.refresh(RefreshReason.ActiveEditorChanged, root);
    }

    private async onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (!initializing &&
            !configuration.changed(e, configuration.name('gitExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)) return;

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('enabled').value)) {
            setCommandContext(CommandContext.GitExplorer, this.config.enabled);
        }

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('autoRefresh').value)) {
            this.setAutoRefresh(Container.config.gitExplorer.autoRefresh);
        }

        let view = this._view;

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('view').value)) {
            view = this.config.view;
            if (view === GitExplorerView.Auto) {
                view = Container.context.workspaceState.get<GitExplorerView>(WorkspaceState.GitExplorerView, GitExplorerView.Repository);
            }

            if (initializing) {
                this._view = view;
                setCommandContext(CommandContext.GitExplorerView, this._view);

                this.setRoot(await this.getRootNode(window.activeTextEditor));

                this._disposable = window.registerTreeDataProvider('gitlens.gitExplorer', this);

                return;
            }
        }

        this.reset(view!, configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value));
    }

    private onRepositoriesChanged() {
        if (this._view !== GitExplorerView.Repository) return;

        this.clearRoot();

        Logger.log(`GitExplorer[view=${this._view}].onRepositoriesChanged`);

        this.refresh(RefreshReason.RepoChanged);
    }

    private onVisibleEditorsChanged(editors: TextEditor[]) {
        if (this._root === undefined || this._view !== GitExplorerView.History) return;

        // If we have no visible editors, or no trackable visible editors reset the view
        if (editors.length === 0 || !editors.some(e => e.document && Container.git.isTrackable(e.document.uri))) {
            this.clearRoot();

            this.refresh(RefreshReason.VisibleEditorsChanged);
        }
    }

    get autoRefresh() {
        return this.config.autoRefresh &&
            Container.context.workspaceState.get<boolean>(WorkspaceState.GitExplorerAutoRefresh, true);
    }

    get config(): IExplorersConfig & IGitExplorerConfig {
        return { ...Container.config.explorers, ...Container.config.gitExplorer };
    }

    get folderResourceUri(): Uri | undefined {
        // Return the uri of any workspace folder -- we just need a folder so that we can use the uri has an icon resourceUri
        if (workspace.workspaceFolders === undefined || workspace.workspaceFolders.length === 0) return undefined;

        return workspace.workspaceFolders[0].uri;
    }

    private _loading: Promise<void> | undefined;

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (this._loading !== undefined) {
            await this._loading;
            this._loading = undefined;
        }

        if (this._root === undefined) {
            if (this._view === GitExplorerView.History) return [new MessageNode(`No active file ${GlyphChars.Dash} no history to show`)];
            return [new MessageNode('No repositories found')];
        }

        if (node === undefined) return this._root.getChildren();
        return node.getChildren();
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    private async getRootNode(editor?: TextEditor): Promise<ExplorerNode | undefined> {
        switch (this._view) {
            case GitExplorerView.History: {
                const promise = this.getHistoryNode(editor || window.activeTextEditor);
                this._loading = promise.then(_ => Functions.wait(0));
                return promise;
            }
            default: {
                const promise = Container.git.getRepositories();
                this._loading = promise.then(_ => Functions.wait(0));

                const repositories = [...await promise];
                if (repositories.length === 0) return undefined; // new MessageNode('No repositories found');

                if (repositories.length === 1) {
                    const repo = repositories[0];
                    return new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this, true);
                }

                return new RepositoriesNode(repositories, this);
            }
        }
    }

    private async getHistoryNode(editor: TextEditor | undefined): Promise<ExplorerNode | undefined> {
        // If we have no active editor, or no visible editors, or no trackable visible editors reset the view
        if (editor === undefined || window.visibleTextEditors.length === 0 || !window.visibleTextEditors.some(e => e.document && Container.git.isTrackable(e.document.uri))) return undefined;
        // If we do have a visible trackable editor, don't change from the last state (avoids issues when focus switches to the problems/output/debug console panes)
        if (editor.document === undefined || !Container.git.isTrackable(editor.document.uri)) return this._root;

        const uri = await GitUri.fromUri(editor.document.uri);

        const repo = await Container.git.getRepository(uri);
        if (repo === undefined) return undefined;

        if (UriComparer.equals(uri, this._root && this._root.uri)) return this._root;

        return new HistoryNode(uri, repo, this);
    }

    getQualifiedCommand(command: string) {
        return `gitlens.gitExplorer.${command}`;
    }

    async refresh(reason?: RefreshReason, root?: ExplorerNode) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`GitExplorer[view=${this._view}].refresh`, `reason='${reason}'`);

        if (this._root === undefined || (root === undefined && this._view === GitExplorerView.History)) {
            this.clearRoot();
            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        this._onDidChangeTreeData.fire();
    }

    refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`GitExplorer[view=${this._view}].refreshNode(${(node as any).id})`);

        if (args !== undefined && node.supportsPaging) {
            node.maxCount = args.maxCount;
        }

        // Since the root node won't actually refresh, force everything
        this._onDidChangeTreeData.fire(node === this._root ? undefined : node);
    }

    async reset(view: GitExplorerView, force: boolean = false) {
        this.setView(view);

        if (force && this._root !== undefined) {
            this.clearRoot();
        }

        const requiresRefresh = this.setRoot(await this.getRootNode(window.activeTextEditor));

        if (requiresRefresh || force) {
            this.refresh(RefreshReason.ViewChanged);
        }
    }

    private clearRoot() {
        if (this._root === undefined) return;

        this._root.dispose();
        this._root = undefined;
    }

    private async setFilesLayout(layout: ExplorerFilesLayout) {
        return configuration.update(configuration.name('gitExplorer')('files')('layout').value, layout, ConfigurationTarget.Global);
    }

    private setRoot(root: ExplorerNode | undefined): boolean {
        if (this._root === root) return false;

        if (this._root !== undefined) {
            this._root.dispose();
        }

        this._root = root;
        return true;
    }

    setView(view: GitExplorerView) {
        if (this._view === view) return;

        if (Container.config.gitExplorer.view === GitExplorerView.Auto) {
            Container.context.workspaceState.update(WorkspaceState.GitExplorerView, view);
        }

        this._view = view;
        setCommandContext(CommandContext.GitExplorerView, this._view);

        if (view !== GitExplorerView.Repository) {
            Container.git.stopWatchingFileSystem();
        }
    }

    async switchTo(view: GitExplorerView) {
        if (this._view === view) return;

        this.reset(view, true);
    }

    private _autoRefreshDisposable: Disposable | undefined;

    async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
        if (this._autoRefreshDisposable !== undefined) {
            this._autoRefreshDisposable.dispose();
            this._autoRefreshDisposable = undefined;
        }

        let toggled = false;
        if (enabled) {
            if (workspaceEnabled === undefined) {
                workspaceEnabled = Container.context.workspaceState.get<boolean>(WorkspaceState.GitExplorerAutoRefresh, true);
            }
            else {
                toggled = workspaceEnabled;
                await Container.context.workspaceState.update(WorkspaceState.GitExplorerAutoRefresh, workspaceEnabled);

                this._onDidChangeAutoRefresh.fire();
            }

            if (workspaceEnabled) {
                this._autoRefreshDisposable = Container.git.onDidChangeRepositories(this.onRepositoriesChanged, this);
                Container.context.subscriptions.push(this._autoRefreshDisposable);
            }
        }

        setCommandContext(CommandContext.GitExplorerAutoRefresh, enabled && workspaceEnabled);

        if (toggled) {
            this.refresh(RefreshReason.AutoRefreshChanged);
        }
    }

    setRenameFollowing(enabled: boolean) {
        configuration.updateEffective(configuration.name('advanced')('fileHistoryFollowsRenames').value, enabled);
    }
}