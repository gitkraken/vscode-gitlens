'use strict';
import { commands, ConfigurationChangeEvent, Event, EventEmitter } from 'vscode';
import { configuration, ExplorerFilesLayout, ExplorersConfig, RepositoriesExplorerConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { ExplorerBase, RefreshReason } from './explorer';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { RepositoriesNode } from './nodes';
import { ExplorerNode } from './nodes/explorerNode';

export class RepositoriesExplorer extends ExplorerBase<RepositoriesNode> {
    constructor() {
        super('gitlens.repositoriesExplorer');
    }

    private _onDidChangeAutoRefresh = new EventEmitter<void>();
    public get onDidChangeAutoRefresh(): Event<void> {
        return this._onDidChangeAutoRefresh.event;
    }

    getRoot() {
        return new RepositoriesNode(this);
    }

    protected registerCommands() {
        Container.explorerCommands;

        commands.registerCommand(this.getQualifiedCommand('fetchAll'), () => this.fetchAll(), this);
        commands.registerCommand(this.getQualifiedCommand('pullAll'), () => this.pullAll(), this);

        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(), this);
        commands.registerCommand(
            this.getQualifiedCommand('refreshNode'),
            (node: ExplorerNode, args?: RefreshNodeCommandArgs) => this.refreshNode(node, args),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToAuto'),
            () => this.setFilesLayout(ExplorerFilesLayout.Auto),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToList'),
            () => this.setFilesLayout(ExplorerFilesLayout.List),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setFilesLayoutToTree'),
            () => this.setFilesLayout(ExplorerFilesLayout.Tree),
            this
        );

        commands.registerCommand(
            this.getQualifiedCommand('setAutoRefreshToOn'),
            () => this.setAutoRefresh(Container.config.repositoriesExplorer.autoRefresh, true),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setAutoRefreshToOff'),
            () => this.setAutoRefresh(Container.config.repositoriesExplorer.autoRefresh, false),
            this
        );
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (
            !initializing &&
            !configuration.changed(e, configuration.name('repositoriesExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
        ) {
            return;
        }

        if (
            initializing ||
            configuration.changed(e, configuration.name('repositoriesExplorer')('enabled').value) ||
            configuration.changed(e, configuration.name('repositoriesExplorer')('location').value)
        ) {
            setCommandContext(CommandContext.RepositoriesExplorer, this.config.enabled ? this.config.location : false);
        }

        if (configuration.changed(e, configuration.name('repositoriesExplorer')('autoRefresh').value)) {
            void this.setAutoRefresh(Container.config.repositoriesExplorer.autoRefresh);
        }

        if (initializing || configuration.changed(e, configuration.name('repositoriesExplorer')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!initializing && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    get autoRefresh() {
        return (
            this.config.autoRefresh &&
            Container.context.workspaceState.get<boolean>(WorkspaceState.RepositoriesExplorerAutoRefresh, true)
        );
    }

    get config(): ExplorersConfig & RepositoriesExplorerConfig {
        return { ...Container.config.explorers, ...Container.config.repositoriesExplorer };
    }

    private fetchAll() {
        if (this._root === undefined) return;

        return this._root.fetchAll();
    }

    private pullAll() {
        if (this._root === undefined) return;

        return this._root.pullAll();
    }

    private async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
        if (enabled) {
            if (workspaceEnabled === undefined) {
                workspaceEnabled = Container.context.workspaceState.get<boolean>(
                    WorkspaceState.RepositoriesExplorerAutoRefresh,
                    true
                );
            }
            else {
                await Container.context.workspaceState.update(
                    WorkspaceState.RepositoriesExplorerAutoRefresh,
                    workspaceEnabled
                );
            }
        }

        setCommandContext(CommandContext.RepositoriesExplorerAutoRefresh, enabled && workspaceEnabled);

        this._onDidChangeAutoRefresh.fire();
    }

    private setFilesLayout(layout: ExplorerFilesLayout) {
        return configuration.updateEffective(
            configuration.name('repositoriesExplorer')('files')('layout').value,
            layout
        );
    }
}
