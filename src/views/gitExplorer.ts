'use strict';
import {
    commands,
    ConfigurationChangeEvent,
    Disposable,
    Event,
    EventEmitter,
    TextDocumentShowOptions,
    TextEditor,
    TreeDataProvider,
    TreeItem,
    TreeView,
    Uri,
    window
} from 'vscode';
import {
    configuration,
    ExplorerFilesLayout,
    GitExplorerView,
    IExplorersConfig,
    IGitExplorerConfig
} from '../configuration';
import { CommandContext, GlyphChars, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { Functions } from '../system';
import { RefreshNodeCommandArgs } from '../views/explorerCommands';
import { HistoryExplorer } from './historyExplorer';
import { ExplorerNode, MessageNode, RefreshReason, RepositoriesNode, RepositoryNode } from './nodes';

export * from './nodes';

export interface OpenFileRevisionCommandArgs {
    uri?: Uri;
    showOptions?: TextDocumentShowOptions;
}

export class GitExplorer extends Disposable implements TreeDataProvider<ExplorerNode> {
    private _disposable: Disposable | undefined;
    private _root?: ExplorerNode;
    private _tree: TreeView<ExplorerNode> | undefined;

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
        commands.registerCommand(
            'gitlens.gitExplorer.setFilesLayoutToAuto',
            () => this.setFilesLayout(ExplorerFilesLayout.Auto),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.setFilesLayoutToList',
            () => this.setFilesLayout(ExplorerFilesLayout.List),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.setFilesLayoutToTree',
            () => this.setFilesLayout(ExplorerFilesLayout.Tree),
            this
        );

        commands.registerCommand(
            'gitlens.gitExplorer.setAutoRefreshToOn',
            () => this.setAutoRefresh(Container.config.gitExplorer.autoRefresh, true),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.setAutoRefreshToOff',
            () => this.setAutoRefresh(Container.config.gitExplorer.autoRefresh, false),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.setRenameFollowingOn',
            () => HistoryExplorer.setRenameFollowing(true),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.setRenameFollowingOff',
            () => HistoryExplorer.setRenameFollowing(false),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.switchToHistoryView',
            () => this.switchTo(GitExplorerView.History),
            this
        );
        commands.registerCommand(
            'gitlens.gitExplorer.switchToRepositoryView',
            () => this.switchTo(GitExplorerView.Repository),
            this
        );

        commands.registerCommand('gitlens.gitExplorer.undockHistory', this.undockHistory, this);

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
            !configuration.changed(e, configuration.name('gitExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        ) {
            return;
        }

        if (
            initializing ||
            configuration.changed(e, configuration.name('gitExplorer')('enabled').value) ||
            configuration.changed(e, configuration.name('gitExplorer')('location').value)
        ) {
            setCommandContext(CommandContext.GitExplorer, this.config.enabled ? this.config.location : false);
        }

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('autoRefresh').value)) {
            void this.setAutoRefresh(Container.config.gitExplorer.autoRefresh);
        }

        // if (!initializing && configuration.changed(e, configuration.name('gitExplorer')('undockHistory').value)) {
        //     if (Container.config.historyExplorer.enabled) {
        //         this.undockHistory(!initializing);
        //     }
        //     // else {
        //     //     this.dockHistory(!initializing);
        //     // }
        // }

        let view = this.view;

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('view').value)) {
            view = this.config.view;
            if (view === GitExplorerView.Auto) {
                view = Container.context.workspaceState.get<GitExplorerView>(
                    WorkspaceState.GitExplorerView,
                    GitExplorerView.Repository
                );
            }
        }

        if (initializing) {
            this.view = view;
            setCommandContext(CommandContext.GitExplorerView, this.view);

            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('location').value)) {
            if (this._disposable) {
                this._disposable.dispose();
                this._onDidChangeTreeData = new EventEmitter<ExplorerNode>();
            }

            this._tree = window.createTreeView(`gitlens.gitExplorer:${this.config.location}`, {
                treeDataProvider: this
            });
            this._disposable = this._tree;

            return;
        }

        void this.reset(
            view!,
            configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        );
    }

    private async onActiveEditorChanged(editor: TextEditor | undefined) {
        if (this.view !== GitExplorerView.History) return;

        const root = await this.getRootNode(editor);
        if (!this.setRoot(root)) return;

        void this.refresh(RefreshReason.ActiveEditorChanged, root);
    }

    private onRepositoriesChanged() {
        if (this.view !== GitExplorerView.Repository) return;

        this.clearRoot();

        Logger.log(`GitExplorer[view=${this.view}].onRepositoriesChanged`);

        void this.refresh(RefreshReason.RepoChanged);
    }

    private onVisibleEditorsChanged(editors: TextEditor[]) {
        if (this._root === undefined || this.view !== GitExplorerView.History) return;

        // If we have no visible editors, or no trackable visible editors reset the view
        if (editors.length === 0 || !editors.some(e => e.document && Container.git.isTrackable(e.document.uri))) {
            this.clearRoot();

            void this.refresh(RefreshReason.VisibleEditorsChanged);
        }
    }

    get autoRefresh() {
        return (
            this.config.autoRefresh &&
            Container.context.workspaceState.get<boolean>(WorkspaceState.GitExplorerAutoRefresh, true)
        );
    }

    get config(): IExplorersConfig & IGitExplorerConfig {
        return { ...Container.config.explorers, ...Container.config.gitExplorer };
    }

    private _view: GitExplorerView | undefined;
    private get view(): GitExplorerView | undefined {
        return this._view;
    }
    private set view(value: GitExplorerView | undefined) {
        this._view = Container.config.historyExplorer.enabled ? GitExplorerView.Repository : value;
    }

    getParent(): ExplorerNode | undefined {
        return undefined;
    }

    private _loading: Promise<void> | undefined;

    async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
        if (this._loading !== undefined) {
            await this._loading;
            this._loading = undefined;
        }

        if (this._root === undefined) {
            return [
                new MessageNode(
                    this.view === GitExplorerView.History
                        ? `No active file ${GlyphChars.Dash} no history to show`
                        : 'No repositories found'
                )
            ];
        }

        if (node === undefined) return this._root.getChildren();
        return node.getChildren();
    }

    async getTreeItem(node: ExplorerNode): Promise<TreeItem> {
        return node.getTreeItem();
    }

    getQualifiedCommand(command: string) {
        return `gitlens.gitExplorer.${command}`;
    }

    async refresh(reason?: RefreshReason, root?: ExplorerNode) {
        if (reason === undefined) {
            reason = RefreshReason.Command;
        }

        Logger.log(`GitExplorer[view=${this.view}].refresh`, `reason='${reason}'`);

        if (this._root === undefined || (root === undefined && this.view === GitExplorerView.History)) {
            this.clearRoot();
            this.setRoot(await this.getRootNode(window.activeTextEditor));
        }

        if (this._root !== undefined) {
            this._root.refresh();
        }

        this._onDidChangeTreeData.fire();
    }

    refreshNode(node: ExplorerNode, args?: RefreshNodeCommandArgs) {
        Logger.log(`GitExplorer[view=${this.view}].refreshNode(${(node as { id?: string }).id || ''})`);

        if (args !== undefined && node.supportsPaging) {
            node.maxCount = args.maxCount;
        }

        node.refresh();

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
            return this.refresh(RefreshReason.ViewChanged);
        }
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
                workspaceEnabled = Container.context.workspaceState.get<boolean>(
                    WorkspaceState.GitExplorerAutoRefresh,
                    true
                );
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
            void this.refresh(RefreshReason.AutoRefreshChanged);
        }
    }

    setView(view: GitExplorerView) {
        if (this.view === view) return;

        if (Container.config.gitExplorer.view === GitExplorerView.Auto) {
            Container.context.workspaceState.update(WorkspaceState.GitExplorerView, view);
        }

        this.view = view;
        setCommandContext(CommandContext.GitExplorerView, this.view);

        if (view !== GitExplorerView.Repository) {
            Container.git.stopWatchingFileSystem();
        }
    }

    async show(view: GitExplorerView) {
        if (this._root === undefined || this._tree === undefined) return;

        await this.switchTo(view);
        const [child] = await this._root!.getChildren();

        try {
            await this._tree.reveal(child, { select: false });
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    async switchTo(view: GitExplorerView) {
        if (this.view === view) return false;

        await this.reset(view, true);
        return true;
    }

    // async dockHistory(switchView: boolean = true) {
    //     Container.historyExplorer.dock(switchView);
    // }

    private clearRoot() {
        if (this._root === undefined) return;

        this._root.dispose();
        this._root = undefined;
    }

    private async getRootNode(editor?: TextEditor): Promise<ExplorerNode | undefined> {
        switch (this.view) {
            case GitExplorerView.History: {
                const promise = this.getHistoryNode(editor || window.activeTextEditor);
                this._loading = promise.then(_ => Functions.wait(0));
                return promise;
            }
            default: {
                const promise = Container.git.getRepositories();
                this._loading = promise.then(_ => Functions.wait(0));

                const repositories = [...(await promise)];
                if (repositories.length === 0) return undefined;

                const openedRepos = repositories.filter(r => !r.closed);
                if (openedRepos.length === 0) return undefined;

                if (openedRepos.length === 1) {
                    const repo = openedRepos[0];
                    return new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this, true);
                }

                return new RepositoriesNode(openedRepos, this);
            }
        }
    }

    private getHistoryNode(editor: TextEditor | undefined): Promise<ExplorerNode | undefined> {
        return HistoryExplorer.getHistoryNode(this, editor, this._root);
    }

    private setFilesLayout(layout: ExplorerFilesLayout) {
        return configuration.updateEffective(configuration.name('gitExplorer')('files')('layout').value, layout);
    }

    private setRoot(root: ExplorerNode | undefined): boolean {
        if (this._root === root) return false;

        if (this._root !== undefined) {
            this._root.dispose();
        }

        this._root = root;
        return true;
    }

    private undockHistory(switchView: boolean = true) {
        return Container.historyExplorer.undock(switchView);
    }
}
