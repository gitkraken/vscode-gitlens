'use strict';
import * as paths from 'path';
import * as fs from 'fs';
import {
    commands,
    ConfigurationChangeEvent,
    ConfigurationTarget,
    Disposable,
    Uri,
    ViewColumn,
    WebviewPanel,
    WebviewPanelOnDidChangeViewStateEvent,
    window,
    workspace
} from 'vscode';
import { Config, configuration } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';
import {
    DidChangeConfigurationNotificationType,
    DidRequestJumpToNotificationType,
    IpcMessage,
    IpcNotificationParamsOf,
    IpcNotificationType,
    onIpcCommand,
    ReadyCommandType,
    UpdateConfigurationCommandType
} from './protocol';
import { Commands } from '../commands';

let ipcSequence = 0;

const emptyCommands: Disposable[] = [
    {
        dispose: function() {
            /* noop */
        }
    }
];

const anchorRegex = /.*?#(.*)/;

export abstract class WebviewBase<TBootstrap> implements Disposable {
    private _disposable: Disposable | undefined;
    private _disposablePanel: Disposable | undefined;
    private _panel: WebviewPanel | undefined;

    private _pendingJumpToAnchor: string | undefined;

    constructor(showCommand: Commands, showAndJumpCommands?: Commands[]) {
        this._disposable = Disposable.from(
            configuration.onDidChange(this.onConfigurationChanged, this),
            commands.registerCommand(showCommand, this.show, this)
        );

        if (showAndJumpCommands !== undefined) {
            this._disposable = Disposable.from(
                this._disposable,
                ...showAndJumpCommands.map(c => {
                    // The show and jump commands are structured to have a # separating the base command from the anchor
                    let anchor: string | undefined;
                    const match = anchorRegex.exec(c);
                    if (match != null) {
                        [, anchor] = match;
                    }

                    return commands.registerCommand(c, () => this.show(anchor), this);
                })
            );
        }
    }

    abstract get filename(): string;
    abstract get id(): string;
    abstract get title(): string;

    abstract getBootstrap(): TBootstrap;
    registerCommands(): Disposable[] {
        return emptyCommands;
    }

    dispose() {
        this._disposable && this._disposable.dispose();
        this._disposablePanel && this._disposablePanel.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        this.notifyDidChangeConfiguration();
    }

    private onPanelDisposed() {
        this._disposablePanel && this._disposablePanel.dispose();
        this._panel = undefined;
    }

    private onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent) {
        Logger.log(
            `Webview(${this.id}).onViewStateChanged`,
            `active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}`
        );

        // Anytime the webview becomes active, make sure it has the most up-to-date config
        if (e.webviewPanel.active) {
            this.notifyDidChangeConfiguration();
        }
    }

    protected onMessageReceived(e: IpcMessage) {
        // virtual
    }

    private onMessageReceivedCore(e: IpcMessage) {
        if (e == null) return;

        Logger.log(`Webview(${this.id}).onMessageReceived: method=${e.method}, data=${JSON.stringify(e)}`);

        switch (e.method) {
            case ReadyCommandType.method:
                onIpcCommand(ReadyCommandType, e, params => {
                    if (this._pendingJumpToAnchor !== undefined) {
                        this.notify(DidRequestJumpToNotificationType, { anchor: this._pendingJumpToAnchor });
                        this._pendingJumpToAnchor = undefined;
                    }
                });

                break;

            case UpdateConfigurationCommandType.method:
                onIpcCommand(UpdateConfigurationCommandType, e, async params => {
                    const target =
                        params.scope === 'workspace' ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;

                    for (const key in params.changes) {
                        const inspect = await configuration.inspect(key)!;

                        const value = params.changes[key];
                        await configuration.update(key, value === inspect.defaultValue ? undefined : value, target);
                    }

                    for (const key of params.removes) {
                        await configuration.update(key, undefined, target);
                    }
                });

                break;
            default:
                this.onMessageReceived(e);

                break;
        }
    }

    get visible() {
        return this._panel === undefined ? false : this._panel.visible;
    }

    hide() {
        if (this._panel === undefined) return;

        this._panel.dispose();
    }

    async show(jumpToAnchor?: string): Promise<void> {
        const html = await this.getHtml();

        if (this._panel === undefined) {
            this._panel = window.createWebviewPanel(
                this.id,
                this.title,
                { viewColumn: ViewColumn.Active, preserveFocus: false },
                {
                    retainContextWhenHidden: true,
                    enableFindWidget: true,
                    enableCommandUris: true,
                    enableScripts: true
                }
            );

            this._panel.iconPath = Uri.file(Container.context.asAbsolutePath('images/gitlens-icon.png'));
            this._disposablePanel = Disposable.from(
                this._panel,
                this._panel.onDidDispose(this.onPanelDisposed, this),
                this._panel.onDidChangeViewState(this.onViewStateChanged, this),
                this._panel.webview.onDidReceiveMessage(this.onMessageReceivedCore, this),
                ...this.registerCommands()
            );

            this._panel.webview.html = html;
        }
        else {
            // Reset the html to get the webview to reload
            this._panel.webview.html = '';
            this._panel.webview.html = html;
            this._panel.reveal(ViewColumn.Active, false);
        }

        this._pendingJumpToAnchor = jumpToAnchor;
    }

    private _html: string | undefined;
    private async getHtml(): Promise<string> {
        const filename = Container.context.asAbsolutePath(paths.join('dist/webviews/', this.filename));

        let content;
        // When we are debugging avoid any caching so that we can change the html and have it update without reloading
        if (Logger.isDebugging) {
            content = await new Promise<string>((resolve, reject) => {
                fs.readFile(filename, 'utf8', (err, data) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(data);
                    }
                });
            });
        }
        else {
            if (this._html !== undefined) return this._html;

            const doc = await workspace.openTextDocument(filename);
            content = doc.getText();
        }

        this._html = content.replace(
            /{{root}}/g,
            Uri.file(Container.context.asAbsolutePath('.'))
                .with({ scheme: 'vscode-resource' })
                .toString()
        );

        if (this._html.includes("'{{bootstrap}}'")) {
            this._html = this._html.replace("'{{bootstrap}}'", JSON.stringify(this.getBootstrap()));
        }

        return this._html;
    }

    protected notify<NT extends IpcNotificationType>(type: NT, params: IpcNotificationParamsOf<NT>): Thenable<boolean> {
        return this.postMessage({ id: this.nextIpcId(), method: type.method, params: params });
    }

    private nextIpcId() {
        if (ipcSequence === Number.MAX_SAFE_INTEGER) {
            ipcSequence = 1;
        }
        else {
            ipcSequence++;
        }

        return `host:${ipcSequence}`;
    }

    private notifyDidChangeConfiguration() {
        // Make sure to get the raw config, not from the container which has the modes mixed in
        return this.notify(DidChangeConfigurationNotificationType, { config: configuration.get<Config>() });
    }

    private postMessage(message: IpcMessage) {
        if (this._panel === undefined) return Promise.resolve(false);

        return this._panel.webview.postMessage(message);
    }
}
