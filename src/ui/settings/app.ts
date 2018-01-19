'use strict';
import { DOM } from './../shared/dom';
import { initializeColorPalette } from '../shared/colors';
import { IConfig } from './../config';

const config: IConfig = (window as any).gitlens.config;
const changes: { [key: string]: any } = Object.create(null);

export class App {

    private readonly _commandRelay: HTMLAnchorElement;

    constructor() {
        console.log('SettingsApp.ctor');

        this._commandRelay = DOM.getElementById<HTMLAnchorElement>('commandRelay');

        initializeColorPalette();
        this.initializeState();

        const onChecked = this.onChecked.bind(this);
        DOM.listenAll('input[type="checkbox"],input[type="radio"]', 'change', function(this: HTMLInputElement) { onChecked(this); });

        const onSelected = this.onSelected.bind(this);
        DOM.listenAll('select', 'change', function(this: HTMLInputElement) { onSelected(this); });
    }

    private onChecked(element: HTMLInputElement) {
        console.log(`SettingsApp.onChange: name=${element.name}, checked=${element.checked}, value=${element.value}`);

        let value;
        if (element.checked) {
            value = element.value === 'on' ? true : element.value;
        }
        else {
            value = false;
        }
        changes[element.name] = value;

        this.updateState(element.name, !!value);
        this.applyChanges();
    }

    private onSelected(element: HTMLSelectElement) {
        const value = element.options[element.selectedIndex].value;

        console.log(`SettingsApp.onSelected: name=${element.name}, value=${value}`);

        changes[element.name] = value;

        this.updateState(element.name, value);
        this.applyChanges();
    }

    private applyChanges() {
        const args = JSON.stringify(changes);
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
            const name = el.name;

            const checked = getSettingValue<boolean>(name);
            el.checked = checked;

            this.updateState(name, checked);
        }

        for (const el of document.querySelectorAll<HTMLSelectElement>('select')) {
            const name = el.name;

            const value = getSettingValue<string>(name);

            el.querySelector<HTMLOptionElement>(`option[value='${value}']`)!.selected = true;

            this.updateState(name, value);
        }
    }

    private updateState(setting: string, value: string | boolean) {
        this.updateEnablement(setting, value);
        this.updateVisibility(setting, value);
    }

    private updateEnablement(setting: string, value: string | boolean) {
        for (const el of document.querySelectorAll<HTMLElement>(`[data-enablement~="${setting}"]`)) {
            const enabled = evaluateExpression(el.dataset.enablement!, setting, value);
            if (enabled) {
                el.removeAttribute('disabled');
            }
            else {
                el.setAttribute('disabled', '');
            }

            const input = el.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
            if (input == null) continue;

            input.disabled = !enabled;
        }
    }

    private updateVisibility(setting: string, value: string | boolean) {
        for (const el of document.querySelectorAll<HTMLElement>(`[data-visibility~="${setting}"]`)) {
            const visible = evaluateExpression(el.dataset.visibility!, setting, value);
            if (visible) {
                el.removeAttribute('hidden');
            }
            else {
                el.setAttribute('hidden', '');
            }
        }
    }
}

function evaluateExpression(expression: string, setting: string, settingValue: string | boolean): boolean {
    let state = false;
    for (const expr of expression.trim().split('&&')) {
        const [lhs, rhs] = parseExpression(expr);

        const value = lhs !== setting
            ? getSettingValue<string | boolean>(lhs)
            : settingValue;
        state = rhs !== undefined ? rhs === '' + value : !!value;

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

function parseExpression(expression: string): [string, string | boolean | undefined] {
    const [lhs, rhs] = expression.trim().split('=');
    return [lhs.trim(), rhs !== undefined ? rhs.trim() : rhs];
}