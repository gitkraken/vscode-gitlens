'use strict';
import { commands, ConfigurationChangeEvent, Event, EventEmitter } from 'vscode';
import { configuration, ExplorerFilesLayout, IExplorersConfig, IGitExplorerConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { ExplorerBase, RefreshReason } from './explorer';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { RepositoriesNode } from './nodes';
import { ExplorerNode } from './nodes/explorerNode';

export class GitExplorer extends ExplorerBase<RepositoriesNode> {
    constructor() {
        super('gitlens.gitExplorer');
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
            () => this.setAutoRefresh(Container.config.gitExplorer.autoRefresh, true),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setAutoRefreshToOff'),
            () => this.setAutoRefresh(Container.config.gitExplorer.autoRefresh, false),
            this
        );
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (
            !initializing &&
            !configuration.changed(e, configuration.name('gitExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value)
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

        if (configuration.changed(e, configuration.name('gitExplorer')('autoRefresh').value)) {
            void this.setAutoRefresh(Container.config.gitExplorer.autoRefresh);
        }

        if (initializing || configuration.changed(e, configuration.name('gitExplorer')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!initializing && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
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

    private async setAutoRefresh(enabled: boolean, workspaceEnabled?: boolean) {
        if (enabled) {
            if (workspaceEnabled === undefined) {
                workspaceEnabled = Container.context.workspaceState.get<boolean>(
                    WorkspaceState.GitExplorerAutoRefresh,
                    true
                );
            }
            else {
                await Container.context.workspaceState.update(WorkspaceState.GitExplorerAutoRefresh, workspaceEnabled);
            }
        }

        setCommandContext(CommandContext.GitExplorerAutoRefresh, enabled && workspaceEnabled);

        this._onDidChangeAutoRefresh.fire();
    }

    private setFilesLayout(layout: ExplorerFilesLayout) {
        return configuration.updateEffective(configuration.name('gitExplorer')('files')('layout').value, layout);
    }
}
