'use strict';
import { Disposable, env, version, workspace } from 'vscode';
import * as os from 'os';

let _reporter: TelemetryReporter;

export class Telemetry extends Disposable {

    static configure(key: string) {
        if (!workspace.getConfiguration('telemetry').get<boolean>('enableTelemetry', true)) return;

        _reporter = new TelemetryReporter(key);
    }

    static setContext(context?: { [key: string]: string }) {
        if (_reporter === undefined) return;

        _reporter.setContext(context);
    }

    static trackEvent(name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number; }) {
        if (_reporter === undefined) return;

        _reporter.trackEvent(name, properties, measurements);
    }

    static trackException(ex: Error) {
        if (_reporter === undefined) return;

        _reporter.trackException(ex);
    }
}

export class TelemetryReporter {

    private appInsights: ApplicationInsights;
    private _client: Client;
    private _context: { [key: string]: string };

    constructor(key: string) {
        const diagChannelState = process.env['APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL'];
        process.env['APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL'] = true;
        this.appInsights = require('applicationinsights') as ApplicationInsights;
        process.env['APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL'] = diagChannelState;

        if (this.appInsights.client) {
            this._client = this.appInsights.getClient(key);
            // no other way to enable offline mode
            this._client.channel.setOfflineMode(true);
        }
        else {
            this._client = this.appInsights.setup(key)
                .setAutoCollectRequests(false)
                .setAutoCollectPerformance(false)
                .setAutoCollectExceptions(false)
                .setAutoCollectDependencies(false)
                .setAutoCollectConsole(false)
                .setAutoDependencyCorrelation(false)
                .setOfflineMode(true)
                .start()
                .client;
        }

        this.setContext();
        this._stripPII(this._client);
    }

    setContext(context?: { [key: string]: string }) {
        if (!this._context) {
            this._context = Object.create(null);

            // Add vscode properties
            this._context['code.language'] = env.language;
            this._context['code.version'] = version;
            this._context[this._client.context.keys.sessionId] = env.sessionId;

            // Add os properties
            this._context['os.platform'] = os.platform();
            this._context['os.version'] = os.release();
        }

        if (context) {
            Object.assign(this._context, context);
        }

        Object.assign(this._client.commonProperties, this._context);
    }

    trackEvent(name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number; }) {
        this._client.trackEvent(name, properties, measurements);
    }

    trackException(ex: Error) {
        this._client.trackException(ex);
    }

    private _stripPII(client: Client) {
        if (client && client.context && client.context.keys && client.context.tags) {
            const machineNameKey = client.context.keys.deviceMachineName;
            client.context.tags[machineNameKey] = '';
        }
    }
}