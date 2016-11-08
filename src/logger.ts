'use strict';
import { Objects } from './system';
import { OutputChannel, window, workspace } from 'vscode';
import { IAdvancedConfig, OutputLevel } from './configuration';

let config: IAdvancedConfig;
let output: OutputChannel;

workspace.onDidChangeConfiguration(onConfigurationChange);
onConfigurationChange();

function onConfigurationChange() {
    const cfg = workspace.getConfiguration('gitlens').get<IAdvancedConfig>('advanced');

    if (!Objects.areEquivalent(cfg.output, config && config.output)) {
        if (cfg.output.level === OutputLevel.Silent) {
            output && output.dispose();
        }
        else if (!output) {
            output = window.createOutputChannel('GitLens');
        }
    }

    config = cfg;
}

export class Logger {
    static log(message?: any, ...params: any[]): void {
        if (config.output.debug) {
            console.log('[GitLens]', message, ...params);
        }

        if (config.output.level === OutputLevel.Verbose) {
            output.appendLine([message, ...params].join(' '));
        }
    }

    static error(message?: any, ...params: any[]): void {
        if (config.output.debug) {
            console.error('[GitLens]', message, ...params);
        }

        if (config.output.level !== OutputLevel.Silent) {
            output.appendLine([message, ...params].join(' '));
        }
    }

    static warn(message?: any, ...params: any[]): void {
        if (config.output.debug) {
            console.warn('[GitLens]', message, ...params);
        }

        if (config.output.level !== OutputLevel.Silent) {
            output.appendLine([message, ...params].join(' '));
        }
    }
}
