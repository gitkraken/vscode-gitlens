'use strict';
import { CancellationTokenSource, commands, QuickPickItem, QuickPickOptions, TextEditor, Uri, window, workspace } from 'vscode';
import { Commands, openEditor } from '../commands';
import { IAdvancedConfig } from '../configuration';
import { Logger } from '../logger';

export function getQuickPickIgnoreFocusOut() {
    return !workspace.getConfiguration('gitlens').get<IAdvancedConfig>('advanced').quickPick.closeOnFocusOut;
}

export function showQuickPickProgress(message: string): CancellationTokenSource {
    const cancellation = new CancellationTokenSource();
    _showQuickPickProgress(message, cancellation);
    return cancellation;
}

async function _showQuickPickProgress(message: string, cancellation: CancellationTokenSource) {
    Logger.log(`showQuickPickProgress`, `show`, message);
    await window.showQuickPick(_getInfiniteCancellablePromise(cancellation), {
        placeHolder: message,
        ignoreFocusOut: getQuickPickIgnoreFocusOut()
    } as QuickPickOptions, cancellation.token);
    Logger.log(`showQuickPickProgress`, `cancel`, message);
    cancellation.cancel();
}

function _getInfiniteCancellablePromise(cancellation: CancellationTokenSource) {
    return new Promise((resolve, reject) => {
        const disposable = cancellation.token.onCancellationRequested(() => {
            disposable.dispose();
            reject();
        });
    });
}

export class CommandQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(item: QuickPickItem, protected command: Commands, protected args?: any[]) {
        Object.assign(this, item);
    }

    execute(): Thenable<{}> {
        return commands.executeCommand(this.command, ...(this.args || []));
    }
}

export class KeyCommandQuickPickItem extends CommandQuickPickItem {

    constructor(protected command: Commands, protected args?: any[]) {
        super({ label: undefined, description: undefined }, command, args);
    }
}

export class KeyNoopCommandQuickPickItem extends CommandQuickPickItem {

    constructor() {
        super({ label: undefined, description: undefined }, undefined, undefined);
    }

    execute(): Thenable<{}> {
        return Promise.resolve(undefined);
    }
}

export class OpenFileCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public uri: Uri, item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    async execute(pinned: boolean = false): Promise<{}> {
        return this.open(pinned);
    }

    async open(pinned: boolean = false): Promise<TextEditor | undefined> {
        return openEditor(this.uri, pinned);
    }
}

export class OpenFilesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public uris: Uri[], item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    async execute(): Promise<{}> {
        for (const uri of this.uris) {
            await openEditor(uri, true);
        }
        return undefined;
    }
}