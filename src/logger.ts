'use strict';
import { ConfigurationChangeEvent, ExtensionContext, OutputChannel, window } from 'vscode';
import { configuration, OutputLevel } from './configuration';
import { extensionOutputChannelName } from './extension';
// import { Telemetry } from './telemetry';

const ConsolePrefix = `[${extensionOutputChannelName}]`;

const isDebuggingRegex = /^--inspect(-brk)?=?/;

export class Logger {

    static level: OutputLevel = OutputLevel.Silent;
    static output: OutputChannel | undefined;

    static configure(context: ExtensionContext) {
        context.subscriptions.push(configuration.onDidChange(this.onConfigurationChanged, this));
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    private static onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const section = configuration.name('outputLevel').value;
        if (initializing || configuration.changed(e, section)) {
            this.level = configuration.get<OutputLevel>(section);

            if (this.level === OutputLevel.Silent) {
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

    static log(message?: any, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.log(this.timestamp, ConsolePrefix, message, ...params);
        }

        if (this.output !== undefined && (this.level === OutputLevel.Verbose || this.level === OutputLevel.Debug)) {
            this.output.appendLine((Logger.isDebugging ? [this.timestamp, message, ...params] : [message, ...params]).join(' '));
        }
    }

    static error(ex: Error, classOrMethod?: string, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.error(this.timestamp, ConsolePrefix, classOrMethod, ...params, ex);
        }

        if (this.output !== undefined && this.level !== OutputLevel.Silent) {
            this.output.appendLine((Logger.isDebugging ? [this.timestamp, classOrMethod, ...params, ex] : [classOrMethod, ...params, ex]).join(' '));
        }

        // Telemetry.trackException(ex);
    }

    static warn(message?: any, ...params: any[]): void {
        if (Logger.isDebugging) {
            console.warn(this.timestamp, ConsolePrefix, message, ...params);
        }

        if (this.output !== undefined && this.level !== OutputLevel.Silent) {
            this.output.appendLine((Logger.isDebugging ? [this.timestamp, message, ...params] : [message, ...params]).join(' '));
        }
    }

    private static get timestamp(): string {
        const now = new Date();
        return `[${now.toISOString().replace(/T/, ' ').replace(/\..+/, '')}:${('00' + now.getUTCMilliseconds()).slice(-3)}]`;
    }

    static gitOutput: OutputChannel | undefined;

    static logGitCommand(command: string, cwd: string, ex?: Error): void {
        if (this.level !== OutputLevel.Debug) return;

        if (this.gitOutput === undefined) {
            this.gitOutput = window.createOutputChannel(`${extensionOutputChannelName} (Git)`);
        }
        this.gitOutput.appendLine(`${this.timestamp} ${command} (${cwd})${ex === undefined ? '' : `\n\n${ex.toString()}`}`);
    }

    private static _isDebugging: boolean | undefined;
    static get isDebugging() {
        if (this._isDebugging === undefined) {
            const args = process.execArgv;

            this._isDebugging = args
                ? args.some(arg => isDebuggingRegex.test(arg))
                : false;
        }

        return this._isDebugging;
    }
}