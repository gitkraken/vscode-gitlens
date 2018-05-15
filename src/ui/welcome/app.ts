'use strict';
import { DOM } from './../shared/dom';
import { App } from '../shared/app-base';
import { WelcomeBootstrap } from '../ipc';

const bootstrap: WelcomeBootstrap = (window as any).bootstrap;

export class WelcomeApp extends App<WelcomeBootstrap> {

    private _commandRelay: HTMLAnchorElement | null | undefined;

    constructor() {
        super('WelcomeApp', bootstrap);
    }

    protected onInitialize() {
        this._commandRelay = DOM.getElementById<HTMLAnchorElement>('commandRelay');
    }

    protected onBind() {
        const onClicked = this.onClicked.bind(this);
        DOM.listenAll('button[data-href]', 'click', function(this: HTMLButtonElement) { onClicked(this); });
    }

    private onClicked(element: HTMLButtonElement) {
        this.executeCommand(element.dataset.href);
    }

    private executeCommand(command: string | undefined) {
        if (command === undefined || this._commandRelay == null) return;

        this.log(`${this.appName}.executeCommand: command=${command}`);

        this._commandRelay.setAttribute('href', command);
        this._commandRelay.click();
    }

}
