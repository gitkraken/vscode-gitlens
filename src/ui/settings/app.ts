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

        for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-readonly="${element.name}"]`)) {
            if (el.tagName === 'SELECT') {
                el.disabled = !value;
            }
            else {
                (el as HTMLInputElement).readOnly = !value;
            }
        }

        this.applyChanges();
    }

    private onSelected(element: HTMLSelectElement) {
        const value = element.options[element.selectedIndex].value;

        console.log(`SettingsApp.onSelected: name=${element.name}, value=${value}`);

        changes[element.name] = value;

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

        DOM.getElementById<HTMLInputElement>(`blame.line.enabled`).checked = config.blame.line.enabled;
        let element = DOM.getElementById<HTMLSelectElement>(`blame.line.annotationType`)!;
        element.querySelector<HTMLOptionElement>(`option[value='${config.blame.line.annotationType}']`)!.selected = true;
        if (config.blame.line.enabled) {
            element.disabled = false;
        }

        DOM.getElementById<HTMLInputElement>(`statusBar.enabled`).checked = config.statusBar.enabled;

        DOM.getElementById<HTMLInputElement>(`codeLens.enabled`).checked = config.codeLens.enabled;

        DOM.getElementById<HTMLInputElement>(`gitExplorer.enabled`).checked = config.gitExplorer.enabled;

        element = DOM.getElementById<HTMLSelectElement>(`gitExplorer.view`)!;
        element.querySelector<HTMLOptionElement>(`option[value='${config.gitExplorer.view}']`)!.selected = true;

        element = DOM.getElementById<HTMLSelectElement>(`keymap`)!;
        element.querySelector<HTMLOptionElement>(`option[value='${config.keymap}']`)!.selected = true;
    }
}
