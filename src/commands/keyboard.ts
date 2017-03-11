'use strict';
import { commands, Disposable, ExtensionContext, QuickPickItem } from 'vscode';
import { CommandContext, setCommandContext } from '../commands';
import { CommandQuickPickItem, OpenFileCommandQuickPickItem } from '../quickPicks/quickPicks';
import { Logger } from '../logger';

export declare type Keys = 'left' | 'right' | ',' | '.';
export const keys: Keys[] = [
    'left',
    'right',
    ',',
    '.'
];

let scopeCount = 0;
let counters = {
    left: 0,
    right: 0,
    ',': 0,
    '.': 0
};

let _instance: Keyboard;

export class Keyboard extends Disposable {

    static get instance(): Keyboard {
        return _instance;
    }

    private _disposable: Disposable;

    constructor(private context: ExtensionContext) {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        for (const key of keys) {
            subscriptions.push(commands.registerCommand(`gitlens.key.${key}`, () => this.execute(key), this));
        }

        this._disposable = Disposable.from(...subscriptions);

        _instance = this;
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    async execute(key: Keys): Promise<{}> {
        let command = this.context.globalState.get(`gitlens:key:${key}`) as CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        if (typeof command === 'function') {
            command = await command();
        }
        if (!command || !(command instanceof CommandQuickPickItem)) return undefined;

        Logger.log('Keyboard.execute', key);

        if (command instanceof OpenFileCommandQuickPickItem) {
            // Have to open this pinned right now, because vscode doesn't have a way to open a unpinned, but unfocused editor
            return await command.execute(true);
        }

        return await command.execute();
    }

    async enterScope(...keyCommands: [Keys, QuickPickItem | (() => Promise<QuickPickItem>)][]) {
        Logger.log('Keyboard.enterScope', scopeCount);
        scopeCount++;
        // await setCommandContext(CommandContext.Key, ++scopeCount);
        if (keyCommands && Array.isArray(keyCommands) && keyCommands.length) {
            for (const [key, command] of keyCommands) {
                await setCommandContext(`${CommandContext.Key}:${key}`, ++counters[key]);
                await this.setKeyCommand(key as Keys, command);
            }
        }
    }

    async exitScope(clear: boolean = true) {
        Logger.log('Keyboard.exitScope', scopeCount);
        if (scopeCount) {
            scopeCount--;
            // await setCommandContext(CommandContext.Key, --scopeCount);
        }
        if (clear && !scopeCount) {
            for (const key of keys) {
                if (counters[key]) {
                    await setCommandContext(`${CommandContext.Key}:${key}`, --counters[key]);
                }
                await this.clearKeyCommand(key);
            }
        }
    }

    async clearKeyCommand(key: Keys) {
        Logger.log('Keyboard.clearKeyCommand', key);
        if (counters[key]) {
            await setCommandContext(`${CommandContext.Key}:${key}`, --counters[key]);
        }
        await this.context.globalState.update(`gitlens:key:${key}`, undefined);
    }

    async setKeyCommand(key: Keys, command: QuickPickItem | (() => Promise<QuickPickItem>)) {
        Logger.log('Keyboard.setKeyCommand', key);
        await setCommandContext(`${CommandContext.Key}:${key}`, ++counters[key]);
        await this.context.globalState.update(`gitlens:key:${key}`, command);
    }
}