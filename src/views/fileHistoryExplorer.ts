'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, IExplorersConfig, IFileHistoryExplorerConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { ExplorerBase, RefreshReason } from './explorer';
import { RefreshNodeCommandArgs } from './explorerCommands';
import { ActiveFileHistoryNode, ExplorerNode } from './nodes';

export class FileHistoryExplorer extends ExplorerBase<ActiveFileHistoryNode> {
    constructor() {
        super('gitlens.fileHistoryExplorer');
    }

    getRoot() {
        return new ActiveFileHistoryNode(this);
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
            this.getQualifiedCommand('setRenameFollowingOn'),
            () => this.setRenameFollowing(true),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setRenameFollowingOff'),
            () => this.setRenameFollowing(false),
            this
        );
    }

    protected onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (
            !initializing &&
            !configuration.changed(e, configuration.name('fileHistoryExplorer').value) &&
            !configuration.changed(e, configuration.name('explorers').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        ) {
            return;
        }

        if (
            initializing ||
            configuration.changed(e, configuration.name('fileHistoryExplorer')('enabled').value) ||
            configuration.changed(e, configuration.name('fileHistoryExplorer')('location').value)
        ) {
            setCommandContext(CommandContext.FileHistoryExplorer, this.config.enabled ? this.config.location : false);
        }

        if (initializing || configuration.changed(e, configuration.name('fileHistoryExplorer')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!initializing && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    get config(): IExplorersConfig & IFileHistoryExplorerConfig {
        return { ...Container.config.explorers, ...Container.config.fileHistoryExplorer };
    }

    private setRenameFollowing(enabled: boolean) {
        return configuration.updateEffective(
            configuration.name('advanced')('fileHistoryFollowsRenames').value,
            enabled
        );
    }
}
