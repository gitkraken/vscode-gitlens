'use strict';
import { commands, Disposable, ExtensionContext, QuickPickItem } from 'vscode';
import { BuiltInCommands } from '../constants';
import { CommandQuickPickItem, OpenFileCommandQuickPickItem } from '../quickPicks/quickPicks';
//import { Logger } from '../logger';

declare type Keys = 'left' | 'right';
const keys: Keys[] = [
    'left',
    'right'
];

let scopeCount = 0;

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

    execute(key: Keys): any {
        const command = this.context.globalState.get(`gitlens:key:${key}`) as CommandQuickPickItem;
        if (!command || !(command instanceof CommandQuickPickItem)) return undefined;

        if (command instanceof OpenFileCommandQuickPickItem) {
            // Have to open this pinned right now, because vscode doesn't have a way to open a unpinned, but unfocused editor
            return command.execute(true);
        }

        return command.execute();
    }

    async enterScope(...keyCommands: [Keys, QuickPickItem][]) {
        await commands.executeCommand(BuiltInCommands.SetContext, 'gitlens:key', ++scopeCount);
        if (keyCommands && Array.isArray(keyCommands) && keyCommands.length) {
            for (const [key, command] of keyCommands) {
                await this.setKeyCommand(key as Keys, command);
            }
        }
    }

    async exitScope(clear: boolean = true) {
        await commands.executeCommand(BuiltInCommands.SetContext, 'gitlens:key', --scopeCount);
        if (clear && !scopeCount) {
            for (const key of keys) {
                await this.clearKeyCommand(key);
            }
        }
    }

    async clearKeyCommand(key: Keys) {
        await this.context.globalState.update(`gitlens:key:${key}`, undefined);
    }

    async setKeyCommand(key: Keys, command: QuickPickItem) {
        await this.context.globalState.update(`gitlens:key:${key}`, command);
    }
}