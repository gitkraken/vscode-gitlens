'use strict';
import { commands } from 'vscode';
import { Container } from '../container';
import { WelcomeBootstrap } from '../ui/ipc';
import { WebviewEditor } from './webviewEditor';

export class WelcomeEditor extends WebviewEditor<WelcomeBootstrap> {
    constructor() {
        super();
    }

    get filename(): string {
        return 'welcome.html';
    }

    get id(): string {
        return 'gitlens.welcome';
    }

    get title(): string {
        return 'Welcome to GitLens';
    }

    getBootstrap(): WelcomeBootstrap {
        return {
            config: Container.config
        };
    }

    registerCommands() {
        return [
            commands.registerCommand('gitlens.showWelcomePage', this.show, this)
        ];
    }
}
