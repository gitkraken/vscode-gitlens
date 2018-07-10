'use strict';
import { IConfig } from './config';

export interface Bootstrap {
    config: IConfig;
}

export interface SettingsBootstrap extends Bootstrap {
    scope: 'user' | 'workspace';
    scopes: ['user' | 'workspace', string][];
}

export interface WelcomeBootstrap extends Bootstrap {}

export interface SaveSettingsMessage {
    type: 'saveSettings';
    changes: {
        [key: string]: any;
    };
    removes: string[];
    scope: 'user' | 'workspace';
    uri: string;
}

export interface SettingsChangedMessage {
    type: 'settingsChanged';
    config: IConfig;
}

export type Message = SaveSettingsMessage | SettingsChangedMessage;
