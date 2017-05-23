'use strict';
import { CancellationTokenSource, commands, Disposable, QuickPickItem, QuickPickOptions, TextDocumentShowOptions, TextEditor, Uri, window, workspace } from 'vscode';
import { Commands, Keyboard, KeyboardScope, KeyMapping, Keys, openEditor } from '../commands';
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

export interface QuickPickItem extends QuickPickItem {
    onDidSelect?(): void;
    onDidPressKey?(key: Keys): Promise<{} | undefined>;
}

export class CommandQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail?: string | undefined;
    protected command: Commands | undefined;
    protected args: any[] | undefined;

    constructor(item: QuickPickItem, args?: [Commands, any[]]);
    constructor(item: QuickPickItem, command?: Commands, args?: any[]);
    constructor(item: QuickPickItem, commandOrArgs?: Commands | [Commands, any[]], args?: any[]) {
        if (commandOrArgs === undefined) {
            this.command = undefined;
            this.args = args;
        }
        else if (typeof commandOrArgs === 'string') {
            this.command = commandOrArgs;
            this.args = args;
        }
        else {
            this.command = commandOrArgs[0];
            this.args = commandOrArgs.slice(1);
        }
        Object.assign(this, item);
    }

    execute(): Promise<{} | undefined> {
        if (this.command === undefined) return Promise.resolve(undefined);

        return commands.executeCommand(this.command, ...(this.args || [])) as Promise<{} | undefined>;
    }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        return this.execute();
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

    async execute(options?: TextDocumentShowOptions): Promise<TextEditor | undefined> {
        return openEditor(this.uri, options);
    }

    // onDidSelect(): Promise<{} | undefined> {
    //     return this.execute({
    //         preserveFocus: true,
    //         preview: true
    //     });
    // }

    onDidPressKey(key: Keys): Promise<{} | undefined> {
        return this.execute({
            preserveFocus: true,
            preview: false
        });
    }
}

export class OpenFilesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(public uris: Uri[], item: QuickPickItem) {
        super(item, undefined, undefined);
    }

    async execute(options: TextDocumentShowOptions = { preserveFocus: false, preview: false }): Promise<{} | undefined> {
        for (const uri of this.uris) {
            await openEditor(uri, options);
        }
        return undefined;
    }

    async onDidPressKey(key: Keys): Promise<{} | undefined> {
        return this.execute({
            preserveFocus: true,
            preview: false
        });
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
            this.label = message;
            this.description = '';
            this.detail = `\u00a0 ${commit.stashName}\u00a0\u00a0\u2022\u00a0 ${moment(commit.date).fromNow()}\u00a0\u00a0\u2022\u00a0 ${commit.getDiffStatus()}`;
        }
        else {
            this.label = message;
            this.description = `\u00a0$(git-commit)\u00a0 ${commit.shortSha}`;
            this.detail = `\u00a0 ${commit.author}, ${moment(commit.date).fromNow()}${(commit.type === 'branch') ? `\u00a0\u00a0\u2022\u00a0 ${(commit as GitLogCommit).getDiffStatus()}` : ''}`;
        }
    }
}