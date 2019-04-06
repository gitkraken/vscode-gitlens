'use strict';
import { commands, workspace } from 'vscode';
import { Commands } from '../commands';
import { Config, configuration } from '../configuration';
import { SettingsBootstrap } from './protocol';
import { WebviewBase } from './webviewBase';

export class SettingsWebview extends WebviewBase<SettingsBootstrap> {
    constructor() {
        super();
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
        return {
            // Make sure to get the raw config, not from the container which has the modes mixed in
            config: configuration.get<Config>(),
            scope: 'user',
            scopes: this.getAvailableScopes()
        };
    }

    registerCommands() {
        return [commands.registerCommand(Commands.ShowSettingsPage, this.show, this)];
    }

    private getAvailableScopes(): ['user' | 'workspace', string][] {
        const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
        if (workspace.workspaceFolders !== undefined && workspace.workspaceFolders.length) {
            scopes.push(['workspace', 'Workspace']);
        }
        return scopes;
    }
}
