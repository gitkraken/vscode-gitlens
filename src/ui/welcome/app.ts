'use strict';
import { DOM } from './../shared/dom';
import { App } from '../shared/app-base';

export class WelcomeApp extends App {

    constructor() {
        super('WelcomeApp');
    }

    protected bind() {
        super.bind();

        const onClicked = this.onClicked.bind(this);
        DOM.listenAll('button[data-href]', 'click', function(this: HTMLButtonElement) { onClicked(this); });
    }

    private onClicked(element: HTMLButtonElement) {
        this.executeCommand(element.dataset.href);
    }
}
