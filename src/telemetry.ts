'use strict';
import { Disposable, workspace } from 'vscode';
import * as vscode from 'vscode';
import * as appInsights from 'applicationinsights';
import * as os from 'os';

let _reporter: TelemetryReporter;

export class Telemetry extends Disposable {

    static configure(key: string) {
        _reporter = new TelemetryReporter(key);
    }

    static setContext(context?: { [key: string]: string }) {
        _reporter && _reporter.setContext(context);
    }

    static trackEvent(name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number; }) {
        _reporter && _reporter.trackEvent(name, properties, measurements);
    }

    static trackException(ex: Error) {
        _reporter && _reporter.trackException(ex);
    }
}

export class TelemetryReporter extends Disposable {

    private _client: typeof appInsights.client;
    private _context: { [key: string]: string };
    private _disposable: Disposable;
    private _enabled: boolean;

    constructor(key: string) {
        super(() => this.dispose());

        appInsights.setup(key)
            .setAutoCollectConsole(false)
            .setAutoCollectExceptions(false)
            .setAutoCollectPerformance(false)
            .setAutoCollectRequests(false);

        (appInsights as any).setAutoCollectDependencies(false)
            .setOfflineMode(true);

        this._client = appInsights.start().client;

        this.setContext();
        this._stripPII(appInsights.client);

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    setContext(context?: { [key: string]: string }) {
        if (!this._context) {
            this._context = Object.create(null);

            // Add vscode properties
            this._context.code_language = vscode.env.language;
            this._context.code_version = vscode.version;

            // Add os properties
            this._context.os = os.platform();
            this._context.os_version = os.release();
        }

        if (context) {
            Object.assign(this._context, context);
        }

        Object.assign(this._client.commonProperties, this._context);
    }

    trackEvent(name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number; }) {
        if (!this._enabled) return;
        this._client.trackEvent(name, properties, measurements);
    }

    trackException(ex: Error) {
        if (!this._enabled) return;
        this._client.trackException(ex);
    }

    private _onConfigurationChanged() {
        this._enabled = workspace.getConfiguration('telemetry').get<boolean>('enableTelemetry', true);
    }

    private _stripPII(client: typeof appInsights.client) {
        if (client && client.context && client.context.keys && client.context.tags) {
            const machineNameKey = client.context.keys.deviceMachineName;
            client.context.tags[machineNameKey] = '';
        }
    }
}