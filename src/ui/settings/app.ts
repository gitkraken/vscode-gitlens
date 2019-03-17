'use strict';
/*global window document*/
import { SettingsBootstrap } from '../ipc';
import { App } from '../shared/app-base';
import { DOM } from '../shared/dom';

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
        const me = this;

        DOM.listenAll('.section__header', 'click', function(this: HTMLInputElement, e: Event) {
            return me.onSectionHeaderClicked(this, e as MouseEvent);
        });
        DOM.listenAll('[data-action]', 'click', function(this: HTMLAnchorElement, e: Event) {
            return me.onActionLinkClicked(this, e as MouseEvent);
        });
    }

    protected getSettingsScope(): 'user' | 'workspace' {
        return this._scopes != null
            ? (this._scopes.options[this._scopes.selectedIndex].value as 'user' | 'workspace')
            : 'user';
    }

    private onActionLinkClicked(element: HTMLElement, e: MouseEvent) {
        switch (element.dataset.action) {
            case 'collapse':
                for (const el of document.querySelectorAll('.section__header')) {
                    el.classList.add('collapsed');
                }

                document.querySelector('[data-action="collapse"]')!.classList.add('hidden');
                document.querySelector('[data-action="expand"]')!.classList.remove('hidden');
                break;

            case 'expand':
                for (const el of document.querySelectorAll('.section__header')) {
                    el.classList.remove('collapsed');
                }

                document.querySelector('[data-action="collapse"]')!.classList.remove('hidden');
                document.querySelector('[data-action="expand"]')!.classList.add('hidden');
                break;
        }

        e.preventDefault();
        e.stopPropagation();
    }

    protected onInputSelected(element: HTMLSelectElement) {
        if (element === this._scopes) return;

        super.onInputSelected(element);
    }

    private onSectionHeaderClicked(element: HTMLElement, e: MouseEvent) {
        if (
            (e.target as HTMLElement).matches('i.icon__info') ||
            (e.target as HTMLElement).matches('a.link__learn-more')
        ) {
            return;
        }

        element.classList.toggle('collapsed');
    }
}
