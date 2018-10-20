'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, FileHistoryViewConfig, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { FileHistoryTrackerNode, ViewNode } from './nodes';
import { RefreshReason, ViewBase } from './viewBase';
import { RefreshNodeCommandArgs } from './viewCommands';

export class FileHistoryView extends ViewBase<FileHistoryTrackerNode> {
    constructor() {
        super('gitlens.views.fileHistory');
    }

    getRoot() {
        return new FileHistoryTrackerNode(this);
    }

    protected registerCommands() {
        Container.viewCommands;
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(), this);
        commands.registerCommand(
            this.getQualifiedCommand('refreshNode'),
            (node: ViewNode, args?: RefreshNodeCommandArgs) => this.refreshNode(node, args),
            this
        );

        commands.registerCommand(
            this.getQualifiedCommand('setEditorFollowingOn'),
            () => this.setEditorFollowing(true),
            this
        );
        commands.registerCommand(
            this.getQualifiedCommand('setEditorFollowingOff'),
            () => this.setEditorFollowing(false),
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
            !configuration.changed(e, configuration.name('views')('fileHistory').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        ) {
            return;
        }

        if (
            initializing ||
            configuration.changed(e, configuration.name('views')('fileHistory')('enabled').value) ||
            configuration.changed(e, configuration.name('views')('fileHistory')('location').value)
        ) {
            setCommandContext(CommandContext.ViewsFileHistory, this.config.enabled ? this.config.location : false);
            setCommandContext(CommandContext.ViewsFileHistoryEditorFollowing, true);
        }

        if (initializing || configuration.changed(e, configuration.name('views')('fileHistory')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!initializing && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    get config(): ViewsConfig & FileHistoryViewConfig {
        return { ...Container.config.views, ...Container.config.views.fileHistory };
    }

    private setEditorFollowing(enabled: boolean) {
        setCommandContext(CommandContext.ViewsFileHistoryEditorFollowing, enabled);
        if (this._root !== undefined) {
            this._root.setEditorFollowing(enabled);
        }
    }

    private setRenameFollowing(enabled: boolean) {
        return configuration.updateEffective(
            configuration.name('advanced')('fileHistoryFollowsRenames').value,
            enabled
        );
    }
}
