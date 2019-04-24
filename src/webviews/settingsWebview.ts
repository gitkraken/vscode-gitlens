'use strict';
import { commands, ConfigurationTarget, workspace } from 'vscode';
import { Commands } from '../commands';
import { Config, configuration, ViewLocation } from '../configuration';
import { SettingsBootstrap } from './protocol';
import { WebviewBase } from './webviewBase';

export class SettingsWebview extends WebviewBase<SettingsBootstrap> {
    constructor() {
        super(Commands.ShowSettingsPage, [
            Commands.ShowSettingsPageAndJumpToCompareView,
            Commands.ShowSettingsPageAndJumpToFileHistoryView,
            Commands.ShowSettingsPageAndJumpToLineHistoryView,
            Commands.ShowSettingsPageAndJumpToRepositoriesView,
            Commands.ShowSettingsPageAndJumpToSearchCommitsView
        ]);
    }

    get filename(): string {
        return 'settings.html';
    }

    get id(): string {
        return 'gitlens.settings';
    }

    get title(): string {
        return 'GitLens Settings';
    }

    getBootstrap(): SettingsBootstrap {
        const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
        if (workspace.workspaceFolders !== undefined && workspace.workspaceFolders.length) {
            scopes.push(['workspace', 'Workspace']);
        }

        return {
            // Make sure to get the raw config, not from the container which has the modes mixed in
            config: configuration.get<Config>(),
            scope: 'user',
            scopes: scopes
        };
    }

    registerCommands() {
        return [commands.registerCommand(`${this.id}.applyViewLayoutPreset`, this.applyViewLayoutPreset, this)];
    }

    private applyViewLayoutPreset(preset: 'contextual' | 'default' | 'scm') {
        let repositories;
        let histories;
        let compareAndSearch;
        switch (preset) {
            case 'contextual':
                repositories = ViewLocation.SourceControl;
                histories = ViewLocation.Explorer;
                compareAndSearch = ViewLocation.GitLens;
                break;
            case 'default':
                repositories = ViewLocation.GitLens;
                histories = ViewLocation.GitLens;
                compareAndSearch = ViewLocation.GitLens;
                break;
            case 'scm':
                repositories = ViewLocation.SourceControl;
                histories = ViewLocation.SourceControl;
                compareAndSearch = ViewLocation.SourceControl;
                break;
            default:
                return;
        }

        configuration.update(
            configuration.name('views')('repositories')('location').value,
            repositories,
            ConfigurationTarget.Global
        );
        configuration.update(
            configuration.name('views')('fileHistory')('location').value,
            histories,
            ConfigurationTarget.Global
        );
        configuration.update(
            configuration.name('views')('lineHistory')('location').value,
            histories,
            ConfigurationTarget.Global
        );
        configuration.update(
            configuration.name('views')('compare')('location').value,
            compareAndSearch,
            ConfigurationTarget.Global
        );
        configuration.update(
            configuration.name('views')('search')('location').value,
            compareAndSearch,
            ConfigurationTarget.Global
        );
    }
}
