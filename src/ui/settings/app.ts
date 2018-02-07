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
        DOM.listenAll('.section__header', 'click', function(this: HTMLInputElement) { return onSectionHeaderClicked(this, ...arguments); });
    }

    private onSectionHeaderClicked(element: HTMLElement, e: MouseEvent) {
        if ((e.target as HTMLElement).matches('i.icon__info') ||
            (e.target as HTMLElement).matches('a.link__learn-more')) return;

        element.classList.toggle('collapsed');
    }
}
