'use strict';
import { ConfigurationChangeEvent, ExtensionContext, OutputChannel, window } from 'vscode';
import { configuration, LogLevel } from './configuration';
import { extensionOutputChannelName } from './constants';
// import { Telemetry } from './telemetry';

export { LogLevel } from './configuration';

const ConsolePrefix = `[${extensionOutputChannelName}]`;

const isDebuggingRegex = /\bgitlens\b/i;

export class Logger {
    static level: LogLevel = LogLevel.Silent;
    static output: OutputChannel | undefined;

    static configure(context: ExtensionContext) {
        context.subscriptions.push(configuration.onDidChange(this.onConfigurationChanged, this));
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    private static onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const section = configuration.name('outputLevel').value;
        if (initializing || configuration.changed(e, section)) {
            this.level = configuration.get<LogLevel>(section);

            if (this.level === LogLevel.Silent) {
                if (this.output !== undefined) {
                    this.output.dispose();
                    this.output = undefined;
                }
            }
            else {
                this.output = this.output || window.createOutputChannel(extensionOutputChannelName);
            }
        }
    }

    static debug(message?: any, ...params: any[]): void {
        if (this.level !== LogLevel.Debug && !Logger.isDebugging) return;

        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message, ...params);
        }

        if (this.output !== undefined) {
            this.output.appendLine(`${this.timestamp} ${message} ${this.toLoggableParams(true, params)}`);
        }
    }

    static error(ex: Error, message?: string, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.error(this.timestamp, ConsolePrefix, message, ...params, ex);
        }

        if (this.level === LogLevel.Silent) return;

        if (this.output !== undefined) {
            this.output.appendLine(`${this.timestamp} ${message} ${this.toLoggableParams(false, params)}\n${ex}`);
        }

        // Telemetry.trackException(ex);
    }

    static log(message?: any, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message, ...params);
        }

        if (this.level !== LogLevel.Verbose && this.level !== LogLevel.Debug) return;

        if (this.output !== undefined) {
            this.output.appendLine(`${this.timestamp} ${message} ${this.toLoggableParams(false, params)}`);
        }
    }

    static logWithDebugParams(message?: any, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message, ...params);
        }

        if (this.level !== LogLevel.Verbose && this.level !== LogLevel.Debug) return;

        if (this.output !== undefined) {
            this.output.appendLine(`${this.timestamp} ${message} ${this.toLoggableParams(true, params)}`);
        }
    }

    static warn(message?: any, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.warn(this.timestamp, ConsolePrefix, message, ...params);
        }

        if (this.level === LogLevel.Silent) return;

        if (this.output !== undefined) {
            this.output.appendLine(`${this.timestamp} ${message} ${this.toLoggableParams(false, params)}`);
        }
    }

    static showOutputChannel() {
        if (this.output !== undefined) {
            this.output.show();
        }
    }

    private static get timestamp(): string {
        const now = new Date();
        return `[${now
            .toISOString()
            .replace(/T/, ' ')
            .replace(/\..+/, '')}:${('00' + now.getUTCMilliseconds()).slice(-3)}]`;
    }

    static gitOutput: OutputChannel | undefined;

    static logGitCommand(command: string, ex?: Error): void {
        if (this.level !== LogLevel.Debug) return;

        if (this.gitOutput === undefined) {
            this.gitOutput = window.createOutputChannel(`${extensionOutputChannelName} (Git)`);
        }
        this.gitOutput.appendLine(`${this.timestamp} ${command}${ex != null ? `\n\n${ex.toString()}` : ''}`);
    }

    private static toLoggableParams(debugOnly: boolean, params: any[]) {
        if (params.length === 0 || (debugOnly && this.level !== LogLevel.Debug && !Logger.isDebugging)) {
            return '';
        }

        const loggableParams = params.map(p => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join(', ');
        return loggableParams || '';
    }

    private static _isDebugging: boolean | undefined;
    static get isDebugging() {
        if (this._isDebugging === undefined) {
            const env = process.env;
            this._isDebugging =
                env && env.VSCODE_DEBUGGING_EXTENSION ? isDebuggingRegex.test(env.VSCODE_DEBUGGING_EXTENSION) : false;
        }

        return this._isDebugging;
    }
}
