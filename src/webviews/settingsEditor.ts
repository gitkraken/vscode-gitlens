'use strict';
import { commands, workspace } from 'vscode';
import { Config, configuration } from '../configuration';
import { SettingsBootstrap } from '../ui/ipc';
import { WebviewEditor } from './webviewEditor';

export class SettingsEditor extends WebviewEditor<SettingsBootstrap> {
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

    getBootstrap() {
        return {
            // Make sure to get the raw config, not from the container which has the modes mixed in
            config: configuration.get<Config>(),
            scope: 'user',
            scopes: this.getAvailableScopes()
        } as SettingsBootstrap;
    }

    registerCommands() {
        return [commands.registerCommand('gitlens.showSettingsPage', this.show, this)];
    }

    private getAvailableScopes(): ['user' | 'workspace', string][] {
        const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
        if (workspace.workspaceFolders !== undefined && workspace.workspaceFolders.length) {
            scopes.push(['workspace', 'Workspace']);
        }
        return scopes;
    }
}
