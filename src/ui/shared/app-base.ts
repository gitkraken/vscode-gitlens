'use strict';
import { DOM } from './../shared/dom';
import { initializeColorPalette } from '../shared/colors';
import { IConfig } from './../config';

const gitlens: { config: IConfig, scope: 'user' | 'workspace', scopes: ['user' | 'workspace', string][], uri: string } = (window as any).gitlens;

export abstract class App {

    private readonly _commandRelay: HTMLAnchorElement;
    private readonly _changes: { [key: string]: any } = Object.create(null);
    private readonly _scopes: HTMLSelectElement | null = null;

    constructor(private _appName: string) {
        this.log(`${this._appName}.ctor`);

        this._commandRelay = DOM.getElementById<HTMLAnchorElement>('commandRelay');

        // Add scopes if available
        const scopes = DOM.getElementById<HTMLSelectElement>('scopes');
        if (scopes && gitlens.scopes.length > 1) {
            for (const [scope, text] of gitlens.scopes) {
                const option = document.createElement('option');
                option.value = scope;
                option.innerHTML = text;
                if (gitlens.scope === scope) {
                    option.selected = true;
                }
                scopes.appendChild(option);
            }

            scopes.parentElement!.classList.remove('hidden');
            this._scopes = scopes;
        }

        initializeColorPalette();
        this.initialize();
        this.bind();

        setTimeout(() => {
            document.body.classList.remove('preload');
        }, 500);
    }

    protected initialize() {
        this.log(`${this._appName}.initializeState`);

        for (const el of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"].setting')) {
            const checked = el.dataset.type === 'array'
                ? (getSettingValue<string[]>(el.name) || []).includes(el.value)
                : getSettingValue<boolean>(el.name) || false;
            el.checked = checked;
        }

        for (const el of document.querySelectorAll<HTMLInputElement>('input[type="text"].setting')) {
            el.value = getSettingValue<string>(el.name) || '';
        }

        for (const el of document.querySelectorAll<HTMLSelectElement>('select.setting')) {
            const value = getSettingValue<string>(el.name);
            const option = el.querySelector<HTMLOptionElement>(`option[value='${value}']`);
            if (option != null) {
                option.selected = true;
            }
        }

        const state = flatten(gitlens.config);
        this.setVisibility(state);
        this.setEnablement(state);
    }

    protected bind() {
        const onInputChecked = this.onInputChecked.bind(this);
        DOM.listenAll('input[type="checkbox"].setting', 'change', function(this: HTMLInputElement) { return onInputChecked(this, ...arguments); });

        const onInputBlurred = this.onInputBlurred.bind(this);
        DOM.listenAll('input[type="text"].setting', 'blur', function(this: HTMLInputElement) { return onInputBlurred(this, ...arguments); });

        const onInputFocused = this.onInputFocused.bind(this);
        DOM.listenAll('input[type="text"].setting', 'focus', function(this: HTMLInputElement) { return onInputFocused(this, ...arguments); });

        const onInputSelected = this.onInputSelected.bind(this);
        DOM.listenAll('select.setting', 'change', function(this: HTMLInputElement) { return onInputSelected(this, ...arguments); });

        const onTokenMouseDown = this.onTokenMouseDown.bind(this);
        DOM.listenAll('[data-token]', 'mousedown', function(this: HTMLElement) { return onTokenMouseDown(this, ...arguments); });

        const onPopupMouseDown = this.onPopupMouseDown.bind(this);
        DOM.listenAll('.popup', 'mousedown', function(this: HTMLElement) { return onPopupMouseDown(this, ...arguments); });
    }

    protected log(message: string) {
        console.log(message);
    }

    private onInputBlurred(element: HTMLInputElement) {
        this.log(`${this._appName}.onInputBlurred: name=${element.name}, value=${element.value}`);

        const popup = document.getElementById(`${element.name}.popup`);
        if (popup != null) {
            popup.classList.add('hidden');
        }

        let value: string | null | undefined = element.value;
        if (value === '') {
            value = element.dataset.defaultValue;
            if (value === undefined) {
                value = null;
            }
        }

        this._changes[element.name] = value;

        // this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
        this.applyChanges();
    }

    private onInputChecked(element: HTMLInputElement) {
        this.log(`${this._appName}.onInputChecked: name=${element.name}, checked=${element.checked}, value=${element.value}`);

        if (element.dataset.type === 'array') {
            const setting = getSettingValue(element.name) || [];
            if (Array.isArray(setting)) {
                if (element.checked) {
                    if (!setting.includes(element.value)) {
                        setting.push(element.value);
                    }
                }
                else {
                    const i = setting.indexOf(element.value);
                    if (i !== -1) {
                        setting.splice(i, 1);
                    }
                }
                this._changes[element.name] = setting;
            }
        }
        else {
            if (element.checked) {
                this._changes[element.name] = element.value === 'on' ? true : element.value;
            }
            else {
                this._changes[element.name] = false;
            }
        }

        this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
        this.applyChanges();
    }

    private onInputFocused(element: HTMLInputElement) {
        this.log(`${this._appName}.onInputFocused: name=${element.name}, value=${element.value}`);

        const popup = document.getElementById(`${element.name}.popup`);
        if (popup != null) {
            popup.classList.remove('hidden');
        }
    }

    private onInputSelected(element: HTMLSelectElement) {
        if (element === this._scopes) return;

        const value = element.options[element.selectedIndex].value;

        this.log(`${this._appName}.onInputSelected: name=${element.name}, value=${value}`);

        this._changes[element.name] = ensureIfBoolean(value);

        this.applyChanges();
    }

    private onPopupMouseDown(element: HTMLElement, e: MouseEvent) {
        // e.stopPropagation();
        // e.stopImmediatePropagation();
        e.preventDefault();
    }

    private onTokenMouseDown(element: HTMLElement, e: MouseEvent) {
        this.log(`${this._appName}.onTokenClicked: id=${element.id}`);

        const setting = element.closest('.settings-group__setting');
        if (setting == null) return;

        const input = setting.querySelector<HTMLInputElement>('input[type="text"]');
        if (input == null) return;

        input.value += `\${${element.dataset.token}}`;

        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
    }

    private applyChanges() {
        const args = JSON.stringify({
            changes: this._changes,
            scope: this.getScope(),
            uri: gitlens.uri
        });
        this.log(`${this._appName}.applyChanges: args=${args}`);

        const command = 'command:gitlens.saveSettings?' + encodeURI(args);
        setTimeout(() => this.executeCommand(command), 0);
    }

    protected executeCommand(command: string | undefined) {
        if (command === undefined) return;

        this.log(`${this._appName}.executeCommand: command=${command}`);

        this._commandRelay.setAttribute('href', command);
        this._commandRelay.click();
    }

    private getScope(): 'user' | 'workspace' {
        return this._scopes != null
            ? this._scopes.options[this._scopes.selectedIndex].value as 'user' | 'workspace'
            : 'user';
    }

    private setAdditionalSettings(expression: string | undefined) {
        if (!expression) return;

        const addSettings = parseAdditionalSettingsExpression(expression);
        for (const [s, v] of addSettings) {
            this._changes[s] = v;
        }
    }

    private setEnablement(state: { [key: string]: string | boolean }) {
        for (const el of document.querySelectorAll<HTMLElement>('[data-enablement]')) {
            // Since everything starts disabled, kick out if it still is
            if (!evaluateStateExpression(el.dataset.enablement!, state)) continue;

            el.removeAttribute('disabled');

            if (el.matches('input,select')) {
                (el as HTMLInputElement | HTMLSelectElement).disabled = false;
            }
            else {
                const input = el.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
                if (input == null) continue;

                input.disabled = false;
            }
        }
    }

    private setVisibility(state: { [key: string]: string | boolean }) {
        for (const el of document.querySelectorAll<HTMLElement>('[data-visibility]')) {
            // Since everything starts hidden, kick out if it still is
            if (!evaluateStateExpression(el.dataset.visibility!, state)) continue;

            el.classList.remove('hidden');
        }
    }
}

function ensureIfBoolean(value: string | boolean): string | boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}

function evaluateStateExpression(expression: string, changes: { [key: string]: string | boolean }): boolean {
    let state = false;
    for (const expr of expression.trim().split('&')) {
        const [lhs, op, rhs] = parseStateExpression(expr);

        switch (op) {
            case '=': { // Equals
                let value = changes[lhs];
                if (value === undefined) {
                    value = getSettingValue<string | boolean>(lhs) || false;
                }
                state = rhs !== undefined ? rhs === '' + value : !!value;
                break;
            }
            case '!': { // Not equals
                let value = changes[lhs];
                if (value === undefined) {
                    value = getSettingValue<string | boolean>(lhs) || false;
                }
                state = rhs !== undefined ? rhs !== '' + value : !value;
                break;
            }
            case '+': { // Contains
                if (rhs !== undefined) {
                    const setting = getSettingValue<string[]>(lhs);
                    state = setting !== undefined ? setting.includes(rhs.toString()) : false;
                }
                break;
            }
        }

        if (!state) break;
    }
    return state;
}

function get<T>(o: { [key: string ]: any}, path: string): T | undefined {
    return path.split('.').reduce((o = {}, key) => o[key], o) as T;
}

function getSettingValue<T>(path: string): T | undefined {
    return get<T>(gitlens.config, path);
}

function parseAdditionalSettingsExpression(expression: string): [string, string | boolean][] {
    const settingsExpression = expression.trim().split(',');
    return settingsExpression.map<[string, string | boolean]>(s => {
        const [setting, value] = s.split('=');
        return [setting, ensureIfBoolean(value)];
    });
}

function parseStateExpression(expression: string): [string, string, string | boolean | undefined] {
    const [lhs, op, rhs] = expression.trim().split(/([=\+\!])/);
    return [lhs.trim(), op !== undefined ? op.trim() : '=', rhs !== undefined ? rhs.trim() : rhs];
}

function flatten(o: { [key: string]: any }, path?: string): { [key: string]: any } {
    const results: { [key: string]: any } = {};

    for (const key in o) {
        const value = o[key];
        if (Array.isArray(value)) continue;

        if (typeof value === 'object') {
            Object.assign(results, flatten(value, path === undefined ? key : `${path}.${key}`));
        }
        else {
            results[path === undefined ? key : `${path}.${key}`] = value;
        }
    }

    return results;
}