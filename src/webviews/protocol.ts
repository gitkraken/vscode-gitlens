'use strict';
import { Config } from '../config';

export interface IpcMessage {
    id: string;
    method: string;
    params?: any;
}

export type IpcNotificationParamsOf<NT> = NT extends IpcNotificationType<infer P> ? P : never;
export class IpcNotificationType<P = any> {
    constructor(public readonly method: string) {}
}

export type IpcCommandParamsOf<CT> = CT extends IpcCommandType<infer P> ? P : never;
export class IpcCommandType<P = any> {
    constructor(public readonly method: string) {}
}

export function onIpcCommand<CT extends IpcCommandType>(
    type: CT,
    command: IpcMessage,
    fn: (params: IpcCommandParamsOf<CT>) => void
) {
    fn(command.params);
}

export function onIpcNotification<NT extends IpcNotificationType>(
    type: NT,
    notification: IpcMessage,
    fn: (params: IpcNotificationParamsOf<NT>) => void
) {
    fn(notification.params);
}

export interface DidChangeConfigurationNotificationParams {
    config: Config;
}
export const DidChangeConfigurationNotificationType = new IpcNotificationType<DidChangeConfigurationNotificationParams>(
    'configuration/didChange'
);

export interface UpdateConfigurationCommandParams {
    changes: {
        [key: string]: any;
    };
    removes: string[];
    scope: 'user' | 'workspace';
    uri?: string;
}
export const UpdateConfigurationCommandType = new IpcCommandType<UpdateConfigurationCommandParams>(
    'configuration/update'
);

export interface AppBootstrap {}

export interface AppWithConfigBootstrap {
    config: Config;
}

export interface SettingsBootstrap extends AppWithConfigBootstrap {
    scope: 'user' | 'workspace';
    scopes: ['user' | 'workspace', string][];
}

export interface WelcomeBootstrap extends AppWithConfigBootstrap {}

export interface HistoryBootstrap {}
