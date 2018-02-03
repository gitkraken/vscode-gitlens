'use strict';
import { DOM } from './../shared/dom';
import { App } from '../shared/app-base';

export class SettingsApp extends App {

    constructor() {
        super('SettingsApp');
    }

    protected bind() {
        super.bind();

        const onSectionHeaderClicked = this.onSectionHeaderClicked.bind(this);
        DOM.listenAll('.section__header', 'click', function(this: HTMLInputElement) { onSectionHeaderClicked(this); });
    }

    private onSectionHeaderClicked(element: HTMLElement) {
        element.classList.toggle('collapsed');
    }
}
