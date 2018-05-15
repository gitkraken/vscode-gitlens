'use strict';
import { DOM } from './../shared/dom';
import { App } from '../shared/app-base';
import { SettingsBootstrap } from '../ipc';

const bootstrap: SettingsBootstrap = (window as any).bootstrap;

export class SettingsApp extends App<SettingsBootstrap> {

    private _scopes: HTMLSelectElement | null = null;

    constructor() {
        super('SettingsApp', bootstrap);
    }

    protected onInitialize() {
        // Add scopes if available
        const scopes = DOM.getElementById<HTMLSelectElement>('scopes');
        if (scopes && this.bootstrap.scopes.length > 1) {
            for (const [scope, text] of this.bootstrap.scopes) {
                const option = document.createElement('option');
                option.value = scope;
                option.innerHTML = text;
                if (this.bootstrap.scope === scope) {
                    option.selected = true;
                }
                scopes.appendChild(option);
            }

            scopes.parentElement!.classList.remove('hidden');
            this._scopes = scopes;
        }
    }

    protected onBind() {
        const onSectionHeaderClicked = this.onSectionHeaderClicked.bind(this);
        DOM.listenAll('.section__header', 'click', function(this: HTMLInputElement) { return onSectionHeaderClicked(this, ...arguments); });
    }

    protected getSettingsScope(): 'user' | 'workspace' {
        return this._scopes != null
            ? this._scopes.options[this._scopes.selectedIndex].value as 'user' | 'workspace'
            : 'user';
    }

    protected onInputSelected(element: HTMLSelectElement) {
        if (element === this._scopes) return;

        return super.onInputSelected(element);
    }

    private onSectionHeaderClicked(element: HTMLElement, e: MouseEvent) {
        if ((e.target as HTMLElement).matches('i.icon__info') ||
            (e.target as HTMLElement).matches('a.link__learn-more')) return;

        element.classList.toggle('collapsed');
    }
}
