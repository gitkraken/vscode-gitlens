'use strict';
import { commands, Disposable } from 'vscode';
import { CommandContext, ExtensionKey, setCommandContext } from './constants';
import { Logger } from './logger';

export declare interface KeyCommand {
    onDidPressKey?(key: Keys): Promise<{} | undefined>;
}

const keyNoopCommand = Object.create(null) as KeyCommand;
export { keyNoopCommand as KeyNoopCommand };

export declare type Keys = 'left' | 'right' | ',' | '.' | 'escape';
export const keys: Keys[] = [
    'left',
    'right',
    ',',
    '.',
    'escape'
];

export declare interface KeyMapping {
    [id: string]: (KeyCommand | (() => Promise<KeyCommand>) | undefined);
}

const mappings: KeyMapping[] = [];

let _instance: Keyboard;

export class KeyboardScope extends Disposable {

    constructor(private mapping: KeyMapping) {
        super(() => this.dispose());

        for (const key in mapping) {
            mapping[key] = mapping[key] || keyNoopCommand;
        }
    }

    async dispose() {
        const index = mappings.indexOf(this.mapping);
        Logger.log('KeyboardScope.dispose', mappings.length, index);
        if (index === (mappings.length - 1)) {
            mappings.pop();
            await this.updateKeyCommandsContext(mappings[mappings.length - 1]);
        }
        else {
            mappings.splice(index, 1);
        }
    }

    async begin() {
        mappings.push(this.mapping);
        await this.updateKeyCommandsContext(this.mapping);
        return this;
    }

    async clearKeyCommand(key: Keys) {
        const mapping = mappings[mappings.length - 1];
        if (mapping !== this.mapping || !mapping[key]) return;

        Logger.log('KeyboardScope.clearKeyCommand', mappings.length, key);
        mapping[key] = undefined;
        await setCommandContext(`${CommandContext.Key}:${key}`, false);
    }

    async setKeyCommand(key: Keys, command: KeyCommand | (() => Promise<KeyCommand>)) {
        const mapping = mappings[mappings.length - 1];
        if (mapping !== this.mapping) return;

        Logger.log('KeyboardScope.setKeyCommand', mappings.length, key, !!mapping[key]);

        if (!mapping[key]) {
            mapping[key] = command;
            await setCommandContext(`${CommandContext.Key}:${key}`, true);
        }
        else {
            mapping[key] = command;
        }
    }

    private async updateKeyCommandsContext(mapping: KeyMapping) {
        const promises = [];
        for (const key of keys) {
            promises.push(setCommandContext(`${CommandContext.Key}:${key}`, !!(mapping && mapping[key])));
        }
        await Promise.all(promises);
    }
}

export class Keyboard extends Disposable {

    static get instance(): Keyboard {
        return _instance;
    }

    private _disposable: Disposable;

    constructor() {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        for (const key of keys) {
            subscriptions.push(commands.registerCommand(`${ExtensionKey}.key.${key}`, () => this.execute(key), this));
        }

        this._disposable = Disposable.from(...subscriptions);

        _instance = this;
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    async beginScope(mapping?: KeyMapping): Promise<KeyboardScope> {
        Logger.log('Keyboard.beginScope', mappings.length);
        return await new KeyboardScope(mapping ? Object.assign(Object.create(null), mapping) : Object.create(null)).begin();
    }

    async execute(key: Keys): Promise<{} | undefined> {
        if (!mappings.length) return undefined;

        try {
            const mapping = mappings[mappings.length - 1];

            let command = mapping[key] as KeyCommand | (() => Promise<KeyCommand>);
            if (typeof command === 'function') {
                command = await command();
            }
            if (!command || typeof command.onDidPressKey !== 'function') return undefined;

            Logger.log('Keyboard.execute', key);

            return await command.onDidPressKey(key);
        }
        catch (ex) {
            Logger.error(ex, 'Keyboard.execute');
            return undefined;
        }
    }
}