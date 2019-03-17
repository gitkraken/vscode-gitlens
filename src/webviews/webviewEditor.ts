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

    private onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent) {
        Logger.log(
            'WebviewEditor.onViewStateChanged',
            `active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}`
        );

        // Anytime the webview becomes active, make sure it has the most up-to-date config
        if (e.webviewPanel.active) {
            this.postUpdatedConfiguration();
        }
    }

    protected async onMessageReceived(e: Message) {
        if (e == null) return;

        Logger.log(`WebviewEditor.onMessageReceived: type=${e.type}, data=${JSON.stringify(e)}`);

        switch (e.type) {
            case 'saveSettings': {
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
    }

    get visible() {
        return this._panel === undefined ? false : this._panel.visible;
    }

    hide() {
        if (this._panel === undefined) return;

        this._panel.dispose();
    }

    async show(): Promise<void> {
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
                this._panel.webview.onDidReceiveMessage(this.onMessageReceived, this)
            );

            this._panel.webview.html = html;
        }
        else {
            // Reset the html to get the webview to reload
            this._panel.webview.html = '';
            this._panel.webview.html = html;
            this._panel.reveal(ViewColumn.Active, false);
        }
    }

    private _html: string | undefined;
    private async getHtml(): Promise<string> {
        let content;
        // When we are debugging avoid any caching so that we can change the html and have it update without reloading
        if (Logger.isDebugging) {
            content = await new Promise<string>((resolve, reject) => {
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
        else {
            if (this._html !== undefined) return this._html;

            const doc = await workspace.openTextDocument(Container.context.asAbsolutePath(this.filename));
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

    private postMessage(message: Message) {
        if (this._panel === undefined) return false;

        return this._panel!.webview.postMessage(message);
    }

    private postUpdatedConfiguration() {
        // Make sure to get the raw config, not from the container which has the modes mixed in
        const msg: SettingsChangedMessage = {
            type: 'settingsChanged',
            config: configuration.get<Config>()
        };
        return this.postMessage(msg);
    }
}
