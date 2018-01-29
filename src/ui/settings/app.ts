'use strict';
import { DOM } from './../shared/dom';
import { initializeColorPalette } from '../shared/colors';
import { IConfig } from './../config';

const config: IConfig = (window as any).gitlens.config;

export class App {

    private readonly _commandRelay: HTMLAnchorElement;
    private readonly _changes: { [key: string]: any } = Object.create(null);

    constructor() {
        console.log('SettingsApp.ctor');

        this._commandRelay = DOM.getElementById<HTMLAnchorElement>('commandRelay');

        initializeColorPalette();
        this.initializeState();

        const onInputChecked = this.onInputChecked.bind(this);
        DOM.listenAll('input[type="checkbox"],input[type="radio"]', 'change', function(this: HTMLInputElement) { onInputChecked(this); });

        const onInputSelected = this.onInputSelected.bind(this);
        DOM.listenAll('select', 'change', function(this: HTMLInputElement) { onInputSelected(this); });

        const onSectionHeaderClicked = this.onSectionHeaderClicked.bind(this);
        DOM.listenAll('.section__header', 'click', function(this: HTMLInputElement) { onSectionHeaderClicked(this); });
    }

    private onInputChecked(element: HTMLInputElement) {
        console.log(`SettingsApp.onChange: name=${element.name}, checked=${element.checked}, value=${element.value}`);

        if (element.dataset.type === 'array') {
            const setting = getSettingValue(element.name);
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

    private onInputSelected(element: HTMLSelectElement) {
        const value = element.options[element.selectedIndex].value;

        console.log(`SettingsApp.onSelected: name=${element.name}, value=${value}`);

        this._changes[element.name] = ensureIfBoolean(value);

        this.applyChanges();
    }

    private onSectionHeaderClicked(element: HTMLElement) {
        element.classList.toggle('collapsed');
    }

    private applyChanges() {
        const args = JSON.stringify(this._changes);
        console.log(`SettingsApp.applyChanges: changes=${args}`);

        const command = 'command:gitlens.saveSettings?' + encodeURI(args);
        setTimeout(() => this.executeCommand(command), 0);
    }

    private executeCommand(command: string | undefined) {
        if (command === undefined) return;

        console.log(`SettingsApp.executeCommand: command=${command}`);

        this._commandRelay.setAttribute('href', command);
        this._commandRelay.click();
    }

    private initializeState() {
        console.log('SettingsApp.initializeState');

        for (const el of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
            const checked = el.dataset.type === 'array'
                ? getSettingValue<string[]>(el.name).includes(el.value)
                : getSettingValue<boolean>(el.name);
            el.checked = checked;
        }

        for (const el of document.querySelectorAll<HTMLSelectElement>('select')) {
            const value = getSettingValue<string>(el.name);
            el.querySelector<HTMLOptionElement>(`option[value='${value}']`)!.selected = true;
        }

        const state = flatten(config);
        this.setVisibility(state);
        this.setEnablement(state);
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
    for (const expr of expression.trim().split('&&')) {
        const [lhs, op, rhs] = parseStateExpression(expr);

        switch (op) {
            case '=':
                let value = changes[lhs];
                if (value === undefined) {
                    value = getSettingValue<string | boolean>(lhs);
                }
                state = rhs !== undefined ? rhs === '' + value : !!value;
                break;

            case '+':
                if (rhs !== undefined) {
                    const setting = getSettingValue<string[]>(lhs);
                    state = setting.includes(rhs.toString());
                }
                break;
        }

        if (!state) break;
    }
    return state;
}

function get<T>(o: { [key: string ]: any}, path: string): T {
    return path.split('.').reduce((o = {}, key) => o[key], o) as T;
}

function getSettingValue<T>(path: string): T {
    return get<T>(config, path);
}

function parseAdditionalSettingsExpression(expression: string): [string, string | boolean][] {
    const settingsExpression = expression.trim().split(',');
    return settingsExpression.map<[string, string | boolean]>(s => {
        const [setting, value] = s.split('=');
        return [setting, ensureIfBoolean(value)];
    });
}

function parseStateExpression(expression: string): [string, string, string | boolean | undefined] {
    const [lhs, op, rhs] = expression.trim().split(/([=\+])/);
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