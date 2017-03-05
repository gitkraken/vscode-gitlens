'use strict';
import { ExtensionContext, OutputChannel, window, workspace } from 'vscode';
import { IAdvancedConfig } from './configuration';

const ConfigurationName = 'gitlens';
const OutputChannelName = 'GitLens';
const ConsolePrefix = `[${OutputChannelName}]`;

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
    const cfg = workspace.getConfiguration(ConfigurationName).get<IAdvancedConfig>('advanced');

    if (cfg.debug !== debug || cfg.output.level !== level) {
        debug = cfg.debug;
        level = cfg.output.level;

        if (level === OutputLevel.Silent) {
            output && output.dispose();
        }
        else {
            output = output || window.createOutputChannel(OutputChannelName);
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

    static error(message?: any, ...params: any[]): void {
        if (debug) {
            console.error(ConsolePrefix, message, ...params);
        }

        if (level !== OutputLevel.Silent) {
            output.appendLine([message, ...params].join(' '));
        }
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