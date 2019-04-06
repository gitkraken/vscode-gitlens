'use strict';
import { commands } from 'vscode';
import { Commands } from '../commands';
import { Container } from '../container';
import { WelcomeBootstrap } from './protocol';
import { WebviewBase } from './webviewBase';

export class WelcomeWebview extends WebviewBase<WelcomeBootstrap> {
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
        return [commands.registerCommand(Commands.ShowWelcomePage, this.show, this)];
    }
}
