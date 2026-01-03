import type { TimeInput } from '@opentelemetry/api';
import type { Config } from '../config.js';
import type { GlCommands } from '../constants.commands.js';
import type { Source, WebviewTelemetryEvents } from '../constants.telemetry.js';
import type { WebviewIds } from '../constants.views.js';
import type { Promo, PromoLocation, PromoPlans } from '../plus/gk/models/promo.js';
import type { ConfigPath, ConfigPathValue, Path, PathValue } from '../system/-webview/configuration.js';
import { IpcCommand, IpcNotification, IpcRequest } from './ipc/models/ipc.js';

// COMMANDS & REQUESTS

export interface WebviewReadyParams {
	bootstrap?: boolean;
}

export interface WebviewReadyResponse {
	state?: unknown | Promise<unknown>;
}
export const WebviewReadyRequest = new IpcRequest<WebviewReadyParams, WebviewReadyResponse>('core', 'webview/ready');

export interface WebviewFocusChangedParams {
	focused: boolean;
	inputFocused: boolean;
}
export const WebviewFocusChangedCommand = new IpcCommand<WebviewFocusChangedParams>('core', 'webview/focus/changed');

export interface ExecuteCommandParams {
	command: GlCommands;
	args?: unknown[];
}
export const ExecuteCommand = new IpcCommand<ExecuteCommandParams>('core', 'command/execute');

export interface ApplicablePromoRequestParams {
	plan?: PromoPlans;
	location?: PromoLocation;
}
export interface ApplicablePromoResponse {
	promo: Promo | undefined;
}
export const ApplicablePromoRequest = new IpcRequest<ApplicablePromoRequestParams, ApplicablePromoResponse>(
	'core',
	'promos/applicable',
);

export interface UpdateConfigurationParams {
	changes: {
		[key in ConfigPath | CustomConfigPath]?: ConfigPathValue<ConfigPath> | CustomConfigPathValue<CustomConfigPath>;
	};
	removes: (keyof { [key in ConfigPath | CustomConfigPath]?: ConfigPathValue<ConfigPath> })[];
	scope?: 'user' | 'workspace';
	uri?: string;
}
export const UpdateConfigurationCommand = new IpcCommand<UpdateConfigurationParams>('core', 'configuration/update');

export interface TelemetrySendEventParams<T extends keyof WebviewTelemetryEvents = keyof WebviewTelemetryEvents> {
	name: T;
	data: WebviewTelemetryEvents[T];
	source?: Source;
	startTime?: TimeInput;
	endTime?: TimeInput;
}
export const TelemetrySendEventCommand = new IpcCommand<TelemetrySendEventParams>('core', 'telemetry/sendEvent');

// NOTIFICATIONS

export const IpcPromiseSettled = new IpcNotification<PromiseSettledResult<unknown>>('core', 'ipc/promise/settled');

export interface DidChangeHostWindowFocusParams {
	focused: boolean;
}
export const DidChangeHostWindowFocusNotification = new IpcNotification<DidChangeHostWindowFocusParams>(
	'core',
	'window/focus/didChange',
);

export interface DidChangeWebviewFocusParams {
	focused: boolean;
}
export const DidChangeWebviewFocusNotification = new IpcCommand<DidChangeWebviewFocusParams>(
	'core',
	'webview/focus/didChange',
);

export interface DidChangeWebviewVisibilityParams {
	visible: boolean;
}
export const DidChangeWebviewVisibilityNotification = new IpcNotification<DidChangeWebviewVisibilityParams>(
	'core',
	'webview/visibility/didChange',
);

export interface DidChangeConfigurationParams {
	config: Config;
	customSettings: Record<string, boolean>;
}
export const DidChangeConfigurationNotification = new IpcNotification<DidChangeConfigurationParams>(
	'core',
	'configuration/didChange',
);

interface CustomConfig {
	rebaseEditor: {
		enabled: boolean;
	};
	currentLine: {
		useUncommittedChangesFormat: boolean;
	};
}

export type CustomConfigPath = Path<CustomConfig>;
export type CustomConfigPathValue<P extends CustomConfigPath> = PathValue<CustomConfig, P>;

const customConfigKeys: readonly CustomConfigPath[] = [
	'rebaseEditor.enabled',
	'currentLine.useUncommittedChangesFormat',
];

export function isCustomConfigKey(key: string): key is CustomConfigPath {
	return customConfigKeys.includes(key as CustomConfigPath);
}

export function assertsConfigKeyValue<T extends ConfigPath>(
	_key: T,
	value: unknown,
): asserts value is ConfigPathValue<T> {
	// Noop
}

export interface WebviewState<Id extends WebviewIds> {
	webviewId: Id;
	webviewInstanceId: string | undefined;
	timestamp: number;
}
