'use strict';
import { darken, lighten, opacity } from '../shared/colors';
import { Bootstrap, Message, SaveSettingsMessage } from './../ipc';
import { DOM } from './../shared/dom';

interface VsCodeApi {
    postMessage(msg: {}): void;
    setState(state: {}): void;
    getState(): {};
}

declare function acquireVsCodeApi(): VsCodeApi;

export abstract class App<TBootstrap extends Bootstrap> {
    private readonly _api: VsCodeApi;
    private _changes: { [key: string]: any } = Object.create(null);
    private _updating: boolean = false;

    constructor(
        protected readonly appName: string,
        protected readonly bootstrap: TBootstrap
    ) {
        this.log(`${this.appName}.ctor`);

        this._api = acquireVsCodeApi();

        this.initializeColorPalette();
        this.initialize();
        this.bind();

        setTimeout(() => {
            document.body.classList.remove('preload');
        }, 500);
    }

    protected applyChanges() {
        this.postMessage({
            type: 'saveSettings',
            changes: { ...this._changes },
            removes: Object.keys(this._changes).filter(k => this._changes[k] === undefined),
            scope: this.getSettingsScope()
        } as SaveSettingsMessage);

        this._changes = Object.create(null);
    }

    protected getSettingsScope(): 'user' | 'workspace' {
        return 'user';
    }

    protected log(message: string) {
        console.log(message);
    }

    protected onBind() {}
    protected onInitialize() {}

    protected onInputBlurred(element: HTMLInputElement) {
        this.log(`${this.appName}.onInputBlurred: name=${element.name}, value=${element.value}`);

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

    protected onInputChecked(element: HTMLInputElement) {
        if (this._updating) return;

        this.log(
            `${this.appName}.onInputChecked: name=${element.name}, checked=${element.checked}, value=${element.value}`
        );

        switch (element.dataset.type) {
            case 'object': {
                const props = element.name.split('.');
                const settingName = props.splice(0, 1)[0];
                const setting = this.getSettingValue(settingName) || Object.create(null);

                if (element.checked) {
                    set(setting, props.join('.'), fromCheckboxValue(element.value));
                }
                else {
                    set(setting, props.join('.'), false);
                }

                this._changes[settingName] = setting;

                break;
            }
            case 'array': {
                const setting = this.getSettingValue(element.name) || [];
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

                break;
            }
            default: {
                if (element.checked) {
                    this._changes[element.name] = fromCheckboxValue(element.value);
                }
                else {
                    this._changes[element.name] = false;
                }

                break;
            }
        }

        this.setAdditionalSettings(element.checked ? element.dataset.addSettingsOn : element.dataset.addSettingsOff);
        this.applyChanges();
    }

    protected onInputFocused(element: HTMLInputElement) {
        this.log(`${this.appName}.onInputFocused: name=${element.name}, value=${element.value}`);

        const popup = document.getElementById(`${element.name}.popup`);
        if (popup != null) {
            popup.classList.remove('hidden');
        }
    }

    protected onInputSelected(element: HTMLSelectElement) {
        if (this._updating) return;

        const value = element.options[element.selectedIndex].value;

        this.log(`${this.appName}.onInputSelected: name=${element.name}, value=${value}`);

        this._changes[element.name] = ensureIfBoolean(value);

        this.applyChanges();
    }

    protected onJumpToLinkClicked(element: HTMLAnchorElement, e: MouseEvent) {
        const href = element.getAttribute('href');
        if (href == null) return;

        const el = document.getElementById(href.substr(1));
        if (el == null) return;

        let height = 83;

        const header = document.querySelector('.page-header--sticky');
        if (header != null) {
            height = header.clientHeight;
        }

        const top = el.getBoundingClientRect().top - document.body.getBoundingClientRect().top - height;
        window.scrollTo({
            top: top,
            behavior: 'smooth'
        });

        e.stopPropagation();
        e.preventDefault();
    }

    protected onMessageReceived(e: MessageEvent) {
        const msg = e.data as Message;
        switch (msg.type) {
            case 'settingsChanged':
                this.bootstrap.config = msg.config;

                this.setState();
                break;
        }
    }

    protected onPopupMouseDown(element: HTMLElement, e: MouseEvent) {
        // e.stopPropagation();
        // e.stopImmediatePropagation();
        e.preventDefault();
    }

    protected onTokenMouseDown(element: HTMLElement, e: MouseEvent) {
        if (this._updating) return;

        this.log(`${this.appName}.onTokenClicked: id=${element.id}`);

        const setting = element.closest('.settings-group__setting');
        if (setting == null) return;

        const input = setting.querySelector<HTMLInputElement>('input[type=text], input:not([type])');
        if (input == null) return;

        input.value += `\${${element.dataset.token}}`;

        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
    }

    protected postMessage(e: Message) {
        this._api.postMessage(e);
    }

    private bind() {
        this.onBind();

        window.addEventListener('message', this.onMessageReceived.bind(this));

        const me = this;

        DOM.listenAll('input[type=checkbox].setting', 'change', function(this: HTMLInputElement) {
            return me.onInputChecked(this);
        });
        DOM.listenAll('input[type=text].setting, input:not([type]).setting', 'blur', function(this: HTMLInputElement) {
            return me.onInputBlurred(this);
        });
        DOM.listenAll('input[type=text].setting, input:not([type]).setting', 'focus', function(this: HTMLInputElement) {
            return me.onInputFocused(this);
        });
        DOM.listenAll('select.setting', 'change', function(this: HTMLSelectElement) {
            return me.onInputSelected(this);
        });
        DOM.listenAll('[data-token]', 'mousedown', function(this: HTMLElement, e: Event) {
            return me.onTokenMouseDown(this, e as MouseEvent);
        });
        DOM.listenAll('.popup', 'mousedown', function(this: HTMLElement, e: Event) {
            return me.onPopupMouseDown(this, e as MouseEvent);
        });
        DOM.listenAll('a.jump-to[href^="#"]', 'click', function(this: HTMLAnchorElement, e: Event) {
            return me.onJumpToLinkClicked(this, e as MouseEvent);
        });
    }

    private evaluateStateExpression(expression: string, changes: { [key: string]: string | boolean }): boolean {
        let state = false;
        for (const expr of expression.trim().split('&')) {
            const [lhs, op, rhs] = parseStateExpression(expr);

            switch (op) {
                case '=': {
                    // Equals
                    let value = changes[lhs];
                    if (value === undefined) {
                        value = this.getSettingValue<string | boolean>(lhs) || false;
                    }
                    state = rhs !== undefined ? rhs === '' + value : Boolean(value);
                    break;
                }
                case '!': {
                    // Not equals
                    let value = changes[lhs];
                    if (value === undefined) {
                        value = this.getSettingValue<string | boolean>(lhs) || false;
                    }
                    state = rhs !== undefined ? rhs !== '' + value : !value;
                    break;
                }
                case '+': {
                    // Contains
                    if (rhs !== undefined) {
                        const setting = this.getSettingValue<string[]>(lhs);
                        state = setting !== undefined ? setting.includes(rhs.toString()) : false;
                    }
                    break;
                }
            }

            if (!state) break;
        }
        return state;
    }

    private getSettingValue<T>(path: string): T | undefined {
        return get<T>(this.bootstrap.config, path);
    }

    private initialize() {
        this.log(`${this.appName}.initialize`);

        this.onInitialize();

        this.setState();
    }

    private initializeColorPalette() {
        const onColorThemeChanged = () => {
            const body = document.body;
            const computedStyle = getComputedStyle(body);

            const bodyStyle = body.style;
            let color = computedStyle.getPropertyValue('--color').trim();
            bodyStyle.setProperty('--color--75', opacity(color, 75));
            bodyStyle.setProperty('--color--50', opacity(color, 50));

            color = computedStyle.getPropertyValue('--background-color').trim();
            bodyStyle.setProperty('--background-color--lighten-05', lighten(color, 5));
            bodyStyle.setProperty('--background-color--darken-05', darken(color, 5));
            bodyStyle.setProperty('--background-color--lighten-075', lighten(color, 7.5));
            bodyStyle.setProperty('--background-color--darken-075', darken(color, 7.5));
            bodyStyle.setProperty('--background-color--lighten-15', lighten(color, 15));
            bodyStyle.setProperty('--background-color--darken-15', darken(color, 15));
            bodyStyle.setProperty('--background-color--lighten-30', lighten(color, 30));
            bodyStyle.setProperty('--background-color--darken-30', darken(color, 30));

            color = computedStyle.getPropertyValue('--link-color').trim();
            bodyStyle.setProperty('--link-color--darken-20', darken(color, 20));

            bodyStyle.setProperty(
                '--focus-border-color',
                computedStyle.getPropertyValue('--vscode-focusBorder').trim()
            );

            color = computedStyle.getPropertyValue('--vscode-button-background').trim();
            bodyStyle.setProperty('--button-background-color', color);
            bodyStyle.setProperty('--button-background-color--darken-30', darken(color, 30));
            bodyStyle.setProperty(
                '--button-color',
                computedStyle.getPropertyValue('--vscode-button-foreground').trim()
            );
        };

        const observer = new MutationObserver(onColorThemeChanged);
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

        onColorThemeChanged();
        return observer;
    }

    private setState() {
        this._updating = true;

        try {
            for (const el of document.querySelectorAll<HTMLInputElement>('input[type=checkbox].setting')) {
                const checked =
                    el.dataset.type === 'array'
                        ? (this.getSettingValue<string[]>(el.name) || []).includes(el.value)
                        : this.getSettingValue<boolean>(el.name) || false;
                el.checked = checked;
            }

            for (const el of document.querySelectorAll<HTMLInputElement>(
                'input[type=text].setting, input:not([type]).setting'
            )) {
                el.value = this.getSettingValue<string>(el.name) || '';
            }

            for (const el of document.querySelectorAll<HTMLSelectElement>('select.setting')) {
                const value = this.getSettingValue<string>(el.name);
                const option = el.querySelector<HTMLOptionElement>(`option[value='${value}']`);
                if (option != null) {
                    option.selected = true;
                }
            }
        }
        finally {
            this._updating = false;
        }

        const state = flatten(this.bootstrap.config);
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
            const disabled = !this.evaluateStateExpression(el.dataset.enablement!, state);
            if (disabled) {
                el.setAttribute('disabled', '');
            }
            else {
                el.removeAttribute('disabled');
            }

            if (el.matches('input,select')) {
                (el as HTMLInputElement | HTMLSelectElement).disabled = disabled;
            }
            else {
                const input = el.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
                if (input == null) continue;

                input.disabled = disabled;
            }
        }
    }

    private setVisibility(state: { [key: string]: string | boolean }) {
        for (const el of document.querySelectorAll<HTMLElement>('[data-visibility]')) {
            el.classList.toggle('hidden', !this.evaluateStateExpression(el.dataset.visibility!, state));
        }
    }
}

function ensureIfBoolean(value: string | boolean): string | boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}

function get<T>(o: { [key: string]: any }, path: string): T | undefined {
    return path.split('.').reduce((o = {}, key) => (o == null ? undefined : o[key]), o) as T;
}

function set(o: { [key: string]: any }, path: string, value: any): { [key: string]: any } {
    const props = path.split('.');
    const length = props.length;
    const lastIndex = length - 1;

    let index = -1;
    let nested = o;

    while (nested != null && ++index < length) {
        const key = props[index];
        let newValue = value;

        if (index !== lastIndex) {
            const objValue = nested[key];
            newValue = typeof objValue === 'object' ? objValue : {};
        }

        nested[key] = newValue;
        nested = nested[key];
    }

    return o;
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

function fromCheckboxValue(elementValue: any) {
    switch (elementValue) {
        case 'on':
            return true;
        case 'null':
            return null;
        case 'undefined':
            return undefined;
        default:
            return elementValue;
    }
}
