'use strict';
import { ExtensionContext, OutputChannel, window, workspace } from 'vscode';
import { IConfig } from './configuration';
import { ExtensionKey, ExtensionOutputChannelName } from './constants';
import { Telemetry } from './telemetry';

const ConsolePrefix = `[${ExtensionOutputChannelName}]`;

export type OutputLevel = 'silent' | 'errors' | 'verbose';
export const OutputLevel = {
    Silent: 'silent' as OutputLevel,
    Errors: 'errors' as OutputLevel,
    Verbose: 'verbose' as OutputLevel
};

let debug = false;
let level: OutputLevel = OutputLevel.Silent;
let output: OutputChannel;

function onConfigurationChanged() {
    const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey);
    if (cfg === undefined) return;

    if (cfg.debug !== debug || cfg.outputLevel !== level) {
        debug = cfg.debug;
        level = cfg.outputLevel;

        if (level === OutputLevel.Silent) {
            output && output.dispose();
        }
        else {
            output = output || window.createOutputChannel(ExtensionOutputChannelName);
        }
    }
}

export class Logger {

    static configure(context: ExtensionContext) {
        context.subscriptions.push(workspace.onDidChangeConfiguration(onConfigurationChanged));
        onConfigurationChanged();
    }

    static log(message?: any, ...params: any[]): void {
        if (debug && level !== OutputLevel.Silent) {
            console.log(ConsolePrefix, message, ...params);
        }

        if (level === OutputLevel.Verbose) {
            output.appendLine([message, ...params].join(' '));
        }
    }

    static error(ex: Error, classOrMethod?: string, ...params: any[]): void {
        if (debug) {
            console.error(ConsolePrefix, classOrMethod, ex, ...params);
        }

        if (level !== OutputLevel.Silent) {
            output.appendLine([classOrMethod, ex, ...params].join(' '));
        }

        Telemetry.trackException(ex);
    }

    static warn(message?: any, ...params: any[]): void {
        if (debug) {
            console.warn(ConsolePrefix, message, ...params);
        }

        if (level !== OutputLevel.Silent) {
            output.appendLine([message, ...params].join(' '));
        }
    }
}