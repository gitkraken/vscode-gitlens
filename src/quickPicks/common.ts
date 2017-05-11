'use strict';
import { CancellationTokenSource, commands, Disposable, QuickPickItem, QuickPickOptions, Uri, window, workspace } from 'vscode';
import { Commands, Keyboard, KeyboardScope, KeyMapping, openEditor } from '../commands';
import { IAdvancedConfig } from '../configuration';
import { ExtensionKey } from '../constants';
import { GitCommit, GitLogCommit, GitStashCommit } from '../gitService';
// import { Logger } from '../logger';
import * as moment from 'moment';

export function getQuickPickIgnoreFocusOut() {
    const cfg = workspace.getConfiguration(ExtensionKey).get<IAdvancedConfig>('advanced')!;
    return !cfg.quickPick.closeOnFocusOut;
}

export function showQuickPickProgress(message: string, mapping?: KeyMapping, delay: boolean = false): CancellationTokenSource {
    const cancellation = new CancellationTokenSource();

    if (delay) {
        let disposable: Disposable;
        const timer = setTimeout(() => {
            disposable && disposable.dispose();
            _showQuickPickProgress(message, cancellation, mapping);
        }, 250);
        disposable = cancellation.token.onCancellationRequested(() => clearTimeout(timer));
    }
    else {
        _showQuickPickProgress(message, cancellation, mapping);
    }

    return cancellation;
}

async function _showQuickPickProgress(message: string, cancellation: CancellationTokenSource, mapping?: KeyMapping) {
        // Logger.log(`showQuickPickProgress`, `show`, message);

        const scope: KeyboardScope | undefined = mapping && await Keyboard.instance.beginScope(mapping);

        try {
            await window.showQuickPick(_getInfiniteCancellablePromise(cancellation), {
                placeHolder: message,
                ignoreFocusOut: getQuickPickIgnoreFocusOut()
            } as QuickPickOptions, cancellation.token);
        }
        catch (ex) {
            // Not sure why this throws
        }
        finally {
            // Logger.log(`showQuickPickProgress`, `cancel`, message);

            cancellation.cancel();
            scope && scope.dispose();
        }
}

function _getInfiniteCancellablePromise(cancellation: CancellationTokenSource) {
    return new Promise<QuickPickItem[]>((resolve, reject) => {
        const disposable = cancellation.token.onCancellationRequested(() => {
            disposable.dispose();
            resolve([]);
        });
    });
}

export class CommandQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail?: string | undefined;

    constructor(item: QuickPickItem, protected command: Commands | undefined, protected args?: any[]) {
        Object.assign(this, item);
    }

    execute(): Thenable<{} | undefined> {
        if (this.command === undefined) return Promise.resolve(undefined);

        return commands.executeCommand(this.command, ...(this.args || []));
    }
}

export class KeyCommandQuickPickItem extends CommandQuickPickItem {

    constructor(command: Commands, args?: any[]) {
        super({ label: '', description: '' } as QuickPickItem, command, args);
    }
}

export class OpenFileCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public uri: Uri, item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    async execute(pinned: boolean = false): Promise<{} | undefined> {
        return this.open(pinned);
    }

    async open(pinned: boolean = false): Promise<{} | undefined> {
        return openEditor(this.uri, pinned);
    }
}

export class OpenFilesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public uris: Uri[], item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    async execute(): Promise<{} | undefined> {
        for (const uri of this.uris) {
            await openEditor(uri, true);
        }
        return undefined;
    }
}

export class CommitQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(public commit: GitCommit) {
        let message = commit.message;
        const index = message.indexOf('\n');
        if (index !== -1) {
            message = `${message.substring(0, index)}\u00a0$(ellipsis)`;
        }

        if (commit instanceof GitStashCommit) {
            this.label = `${commit.stashName}\u00a0\u2022\u00a0${message}`;
            this.description = '';
            this.detail = `\u00a0 ${moment(commit.date).fromNow()}\u00a0\u00a0\u2022\u00a0 ${commit.getDiffStatus()}`;
        }
        else {
            this.label = message;
            this.description = `\u00a0$(git-commit)\u00a0 ${commit.shortSha}`;
            this.detail = `\u00a0 ${commit.author}, ${moment(commit.date).fromNow()}${(commit.type === 'branch') ? `\u00a0\u00a0\u2022\u00a0 ${(commit as GitLogCommit).getDiffStatus()}` : ''}`;
        }
    }
}