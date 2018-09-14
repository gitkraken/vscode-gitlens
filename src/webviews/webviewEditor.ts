'use strict';
import * as fs from 'fs';
import {
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
import { Message, SettingsChangedMessage } from '../ui/ipc';

export abstract class WebviewEditor<TBootstrap> implements Disposable {
    private _disposable: Disposable | undefined;
    private _disposablePanel: Disposable | undefined;
    private _panel: WebviewPanel | undefined;

    constructor() {
        this._disposable = Disposable.from(
            configuration.onDidChange(this.onConfigurationChanged, this),
            ...this.registerCommands()
        );
    }

    abstract get filename(): string;
    abstract get id(): string;
    abstract get title(): string;

    abstract getBootstrap(): TBootstrap;
    abstract registerCommands(): Disposable[];

    dispose() {
        this._disposable && this._disposable.dispose();
        this._disposablePanel && this._disposablePanel.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        this.postUpdatedConfiguration();
    }

    private onPanelDisposed() {
        this._disposablePanel && this._disposablePanel.dispose();
        this._panel = undefined;
    }

    private _invalidateOnVisible: 'all' | 'config' | undefined;

    private onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent) {
        Logger.log('WebviewEditor.onViewStateChanged', e.webviewPanel.visible);
        // HACK: Because messages aren't sent to the webview when hidden, we need make sure it is up-to-date
        if (this._invalidateOnVisible && e.webviewPanel.visible) {
            const invalidates = this._invalidateOnVisible;
            this._invalidateOnVisible = undefined;

            switch (invalidates) {
                case 'config':
                    this.postUpdatedConfiguration();
                    break;

                default:
                    void this.show();
                    break;
            }
        }
    }

    protected async onMessageReceived(e: Message) {
        if (e == null) return;

        Logger.log(`WebviewEditor.onMessageReceived: type=${e.type}, data=${JSON.stringify(e)}`);

        switch (e.type) {
            case 'saveSettings':
                const target = e.scope === 'workspace' ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;

                for (const key in e.changes) {
                    const inspect = await configuration.inspect(key)!;

                    const value = e.changes[key];
                    await configuration.update(key, value === inspect.defaultValue ? undefined : value, target);
                }

                for (const key of e.removes) {
                    await configuration.update(key, undefined, target);
                }
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

    async show(): Promise<void> {
        let html = (await this.getHtml()).replace(
            /{{root}}/g,
            Uri.file(Container.context.asAbsolutePath('.'))
                .with({ scheme: 'vscode-resource' })
                .toString(true)
        );
        if (html.includes("'{{bootstrap}}'")) {
            html = html.replace("'{{bootstrap}}'", JSON.stringify(this.getBootstrap()));
        }

        if (this._panel === undefined) {
            this._panel = window.createWebviewPanel(
                this.id,
                this.title,
                ViewColumn.Active, // { viewColumn: ViewColumn.Active, preserveFocus: false }
                {
                    retainContextWhenHidden: true,
                    enableFindWidget: true,
                    enableCommandUris: true,
                    enableScripts: true
                }
            );

            this._disposablePanel = Disposable.from(
                this._panel,
                this._panel.onDidDispose(this.onPanelDisposed, this),
                this._panel.onDidChangeViewState(this.onViewStateChanged, this),
                this._panel.webview.onDidReceiveMessage(this.onMessageReceived, this)
            );

            this._panel.webview.html = html;
        }
        else {
            this._panel.webview.html = html;
            this._panel.reveal(ViewColumn.Active); // , false);
        }
    }

    private async getHtml(): Promise<string> {
        if (Logger.isDebugging) {
            return new Promise<string>((resolve, reject) => {
                fs.readFile(Container.context.asAbsolutePath(this.filename), 'utf8', (err, data) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(data);
                    }
                });
            });
        }

        const doc = await workspace.openTextDocument(Container.context.asAbsolutePath(this.filename));
        return doc.getText();
    }

    private postMessage(message: Message, invalidates: 'all' | 'config' = 'all') {
        if (this._panel === undefined) return false;

        const result = this._panel!.webview.postMessage(message);
        if (!result && this._invalidateOnVisible !== 'all') {
            this._invalidateOnVisible = invalidates;
        }
        return result;
    }

    private postUpdatedConfiguration() {
        // Make sure to get the raw config, not from the container which has the modes mixed in
        return this.postMessage(
            {
                type: 'settingsChanged',
                config: configuration.get<Config>()
            } as SettingsChangedMessage,
            'config'
        );
    }
}
