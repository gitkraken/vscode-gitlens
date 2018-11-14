'use strict';
import { ConfigurationChangeEvent, ExtensionContext, OutputChannel, Uri, window } from 'vscode';
import { configuration, LogLevel } from './configuration';
import { extensionOutputChannelName } from './constants';
import { getCorrelationContext } from './system';
// import { Telemetry } from './telemetry';

export { LogLevel } from './configuration';

const ConsolePrefix = `[${extensionOutputChannelName}]`;

const isDebuggingRegex = /\bgitlens\b/i;

export interface LogCorrelationContext {
    correlationId?: number;
    prefix: string;
}

export class Logger {
    static level: LogLevel = LogLevel.Silent;
    static output: OutputChannel | undefined;
    static customLoggableFn: ((o: object) => string | undefined) | undefined;

    static configure(context: ExtensionContext, loggableFn?: (o: any) => string | undefined) {
        this.customLoggableFn = loggableFn;

        context.subscriptions.push(configuration.onDidChange(this.onConfigurationChanged, this));
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    private static onConfigurationChanged(e: ConfigurationChangeEvent) {
        const section = configuration.name('outputLevel').value;
        if (configuration.changed(e, section)) {
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

    static debug(message: string, ...params: any[]): void;
    static debug(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
    static debug(callerOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
        if (this.level !== LogLevel.Debug && !Logger.isDebugging) return;

        let message;
        if (typeof callerOrMessage === 'string') {
            message = callerOrMessage;
        }
        else {
            message = params.shift();

            if (callerOrMessage !== undefined) {
                message = `${callerOrMessage.prefix} ${message || ''}`;
            }
        }

        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message || '', ...params);
        }

        if (this.output !== undefined && this.level === LogLevel.Debug) {
            this.output.appendLine(`${this.timestamp} ${message || ''} ${this.toLoggableParams(true, params)}`);
        }
    }

    static error(ex: Error, message?: string, ...params: any[]): void;
    static error(ex: Error, context?: LogCorrelationContext, message?: string, ...params: any[]): void;
    static error(ex: Error, callerOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
        if (this.level === LogLevel.Silent && !Logger.isDebugging) return;

        let message;
        if (callerOrMessage === undefined || typeof callerOrMessage === 'string') {
            message = callerOrMessage;
        }
        else {
            message = params.shift();

            if (callerOrMessage !== undefined) {
                message = `${callerOrMessage.prefix} ${message || ''}`;
            }
        }

        if (message === undefined) {
            const stack = ex.stack;
            if (stack) {
                const match = /.*\s*?at\s(.+?)\s/.exec(stack);
                if (match != null) {
                    message = match[1];
                }
            }
        }

        if (Logger.isDebugging) {
            console.error(this.timestamp, ConsolePrefix, message || '', ...params, ex);
        }

        if (this.output !== undefined && this.level !== LogLevel.Silent) {
            this.output.appendLine(`${this.timestamp} ${message || ''} ${this.toLoggableParams(false, params)}\n${ex}`);
        }

        // Telemetry.trackException(ex);
    }

    static getCorrelationContext() {
        return getCorrelationContext();
    }

    static log(message: string, ...params: any[]): void;
    static log(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
    static log(callerOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
        if (this.level !== LogLevel.Verbose && this.level !== LogLevel.Debug && !Logger.isDebugging) {
            return;
        }

        let message;
        if (typeof callerOrMessage === 'string') {
            message = callerOrMessage;
        }
        else {
            message = params.shift();

            if (callerOrMessage !== undefined) {
                message = `${callerOrMessage.prefix} ${message || ''}`;
            }
        }

        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message || '', ...params);
        }

        if (this.output !== undefined && (this.level === LogLevel.Verbose || this.level === LogLevel.Debug)) {
            this.output.appendLine(`${this.timestamp} ${message || ''} ${this.toLoggableParams(false, params)}`);
        }
    }

    static logWithDebugParams(message: string, ...params: any[]): void;
    static logWithDebugParams(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
    static logWithDebugParams(callerOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
        if (this.level !== LogLevel.Verbose && this.level !== LogLevel.Debug && !Logger.isDebugging) {
            return;
        }

        let message;
        if (typeof callerOrMessage === 'string') {
            message = callerOrMessage;
        }
        else {
            message = params.shift();

            if (callerOrMessage !== undefined) {
                message = `${callerOrMessage.prefix} ${message || ''}`;
            }
        }

        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message || '', ...params);
        }

        if (this.output !== undefined && (this.level === LogLevel.Verbose || this.level === LogLevel.Debug)) {
            this.output.appendLine(`${this.timestamp} ${message || ''} ${this.toLoggableParams(true, params)}`);
        }
    }

    static warn(message: string, ...params: any[]): void;
    static warn(context: LogCorrelationContext | undefined, message: string, ...params: any[]): void;
    static warn(callerOrMessage: LogCorrelationContext | string | undefined, ...params: any[]): void {
        if (this.level === LogLevel.Silent && !Logger.isDebugging) return;

        let message;
        if (typeof callerOrMessage === 'string') {
            message = callerOrMessage;
        }
        else {
            message = params.shift();

            if (callerOrMessage !== undefined) {
                message = `${callerOrMessage.prefix} ${message || ''}`;
            }
        }

        if (Logger.isDebugging) {
            console.warn(this.timestamp, ConsolePrefix, message || '', ...params);
        }

        if (this.output !== undefined && this.level !== LogLevel.Silent) {
            this.output.appendLine(`${this.timestamp} ${message || ''} ${this.toLoggableParams(false, params)}`);
        }
    }

    static showOutputChannel() {
        if (this.output === undefined) return;

        this.output.show();
    }

    static toLoggable(p: any, sanitize?: ((key: string, value: any) => any) | undefined) {
        if (typeof p !== 'object') return String(p);
        if (this.customLoggableFn !== undefined) {
            const loggable = this.customLoggableFn(p);
            if (loggable != null) return loggable;
        }
        if (p instanceof Uri) return `Uri(${p.toString(true)})`;

        try {
            return JSON.stringify(p, sanitize);
        }
        catch {
            return `<error>`;
        }
    }

    static toLoggableName(instance: Function | object) {
        if (typeof instance === 'function') {
            return instance.name;
        }

        const name = instance.constructor != null ? instance.constructor.name : '';
        // Strip webpack module name (since I never name classes with an _)
        const index = name.indexOf('_');
        return index === -1 ? name : name.substr(index + 1);
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

        const loggableParams = params.map(p => this.toLoggable(p)).join(', ');
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
