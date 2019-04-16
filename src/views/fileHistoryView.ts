'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, FileHistoryViewConfig, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { FileHistoryTrackerNode } from './nodes';
import { ViewBase } from './viewBase';

export class FileHistoryView extends ViewBase<FileHistoryTrackerNode> {
    constructor() {
        super('gitlens.views.fileHistory', 'File History');
    }

    getRoot() {
        return new FileHistoryTrackerNode(this);
    }

    protected get location(): string {
        return this.config.location;
    }

    protected registerCommands() {
        void Container.viewCommands;
        commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
        commands.registerCommand(this.getQualifiedCommand('changeBase'), () => this.changeBase(), this);
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
            !configuration.changed(e, configuration.name('views')('fileHistory').value) &&
            !configuration.changed(e, configuration.name('views').value) &&
            !configuration.changed(e, configuration.name('defaultGravatarsStyle').value) &&
            !configuration.changed(e, configuration.name('advanced')('fileHistoryFollowsRenames').value)
        ) {
            return;
        }

        if (configuration.changed(e, configuration.name('views')('fileHistory')('enabled').value)) {
            setCommandContext(CommandContext.ViewsFileHistoryEditorFollowing, true);
        }

        if (configuration.changed(e, configuration.name('views')('fileHistory')('location').value)) {
            this.initialize(this.config.location);
        }

        if (!configuration.initializing(e) && this._root !== undefined) {
            void this.refresh(true);
        }
    }

    get config(): ViewsConfig & FileHistoryViewConfig {
        return { ...Container.config.views, ...Container.config.views.fileHistory };
    }

    async showHistoryForUri(uri: GitUri, baseRef?: string) {
        const root = this.ensureRoot();

        this.setEditorFollowing(false);
        await root.showHistoryForUri(uri, baseRef);
        return this.show();
    }

    private changeBase() {
        if (this._root !== undefined) {
            void this._root.changeBase();
        }
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
