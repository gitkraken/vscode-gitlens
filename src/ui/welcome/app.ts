'use strict';
import { DOM } from './../shared/dom';
import { initializeColorPalette } from '../shared/colors';

export class App {

    private readonly _commandRelay: HTMLAnchorElement;

    constructor() {
        console.log('WelcomeApp.ctor');

        this._commandRelay = DOM.getElementById<HTMLAnchorElement>('commandRelay');

        initializeColorPalette();

        const onClicked = this.onClicked.bind(this);
        DOM.listenAll('button[data-href]', 'click', function(this: HTMLButtonElement) { onClicked(this); });
    }

    private onClicked(element: HTMLButtonElement) {
        this.executeCommand(element.dataset.href);
    }

    private executeCommand(command: string | undefined) {
        if (command === undefined) return;

        console.log(`WelcomeApp.executeCommand: command=${command}`);

        this._commandRelay.setAttribute('href', command);
        this._commandRelay.click();
    }
}
