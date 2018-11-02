'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, LineHistoryViewConfig, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { LineHistoryTrackerNode, ViewNode } from './nodes';
import { RefreshReason, ViewBase } from './viewBase';
import { RefreshNodeCommandArgs } from './viewCommands';

export class LineHistoryView extends ViewBase<LineHistoryTrackerNode> {
    constructor() {
        super('gitlens.views.lineHistory');
    }

    getRoot() {
        return new LineHistoryTrackerNode(this);
    }

    protected get location(): string {
        return this.config.location;
    }

    protected registerCommands() {
        void Container.viewCommands;
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
        if (
            !configuration.changed(e, configuration.name('views')('lineHistory').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        ) {
            return;
        }

        if (configuration.changed(e, configuration.name('views')('lineHistory')('enabled').value)) {
            setCommandContext(CommandContext.ViewsLineHistoryEditorFollowing, true);
        }

        if (configuration.changed(e, configuration.name('views')('lineHistory')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!configuration.initializing(e) && this._root !== undefined) {
            void this.refresh(RefreshReason.ConfigurationChanged);
        }
    }

    get config(): ViewsConfig & LineHistoryViewConfig {
        return { ...Container.config.views, ...Container.config.views.lineHistory };
    }

    private setEditorFollowing(enabled: boolean) {
        setCommandContext(CommandContext.ViewsLineHistoryEditorFollowing, enabled);
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
