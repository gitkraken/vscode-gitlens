import type { TimeInput } from '@opentelemetry/api';
import type { Config } from '../config';
import type { Commands } from '../constants.commands';
import type { Source, TelemetryEvents, TelemetryEventsFromWebviewApp } from '../constants.telemetry';
import type {
	CustomEditorIds,
	CustomEditorTypes,
	WebviewIds,
	WebviewTypes,
	WebviewViewIds,
	WebviewViewTypes,
} from '../constants.views';
import type { ConfigPath, ConfigPathValue, Path, PathValue } from '../system/vscode/configuration';

export type IpcScope = 'core' | CustomEditorTypes | WebviewTypes | WebviewViewTypes;

export interface IpcMessage<T = unknown> {
	id: string;
	scope: IpcScope;
	method: string;
	packed?: boolean;
	params: T;
	completionId?: string;
}

abstract class IpcCall<Params> {
	public readonly method: string;

	constructor(
		public readonly scope: IpcScope,
		method: string,
		public readonly reset: boolean = false,
		public readonly pack: boolean = false,
	) {
		this.method = `${scope}/${method}`;
	}

	is(msg: IpcMessage): msg is IpcMessage<Params> {
		return msg.method === this.method;
	}
}

export type IpcCallMessageType<T> = T extends IpcCall<infer P> ? IpcMessage<P> : never;
export type IpcCallParamsType<T> = IpcCallMessageType<T>['params'];
export type IpcCallResponseType<T> = T extends IpcRequest<infer _, infer _> ? T['response'] : never;
export type IpcCallResponseMessageType<T> = IpcCallMessageType<IpcCallResponseType<T>>;
export type IpcCallResponseParamsType<T> = IpcCallResponseMessageType<T>['params'];

/**
 * Commands are sent from the webview to the extension
 */
export class IpcCommand<Params = void> extends IpcCall<Params> {}

/**
 * Requests are sent from the webview to the extension and expect a response back
 */
export class IpcRequest<Params = void, ResponseParams = void> extends IpcCall<Params> {
	public readonly response: IpcNotification<ResponseParams>;

	constructor(scope: IpcScope, method: string, reset?: boolean, pack?: boolean) {
		super(scope, method, reset, pack);

		this.response = new IpcNotification<ResponseParams>(this.scope, `${method}/completion`, this.reset, this.pack);
	}
}

/**
 * Notifications are sent from the extension to the webview
 */
export class IpcNotification<Params = void> extends IpcCall<Params> {}

// COMMANDS

export const WebviewReadyCommand = new IpcCommand('core', 'webview/ready');

export interface WebviewFocusChangedParams {
	focused: boolean;
	inputFocused: boolean;
}
export const WebviewFocusChangedCommand = new IpcCommand<WebviewFocusChangedParams>('core', 'webview/focus/changed');

export interface ExecuteCommandParams {
	command: Commands;
	args?: [];
}
export const ExecuteCommand = new IpcCommand<ExecuteCommandParams>('core', 'command/execute');

export interface UpdateConfigurationParams {
	changes: {
		[key in ConfigPath | CustomConfigPath]?: ConfigPathValue<ConfigPath> | CustomConfigPathValue<CustomConfigPath>;
	};
	removes: (keyof { [key in ConfigPath | CustomConfigPath]?: ConfigPathValue<ConfigPath> })[];
	scope?: 'user' | 'workspace';
	uri?: string;
}
export const UpdateConfigurationCommand = new IpcCommand<UpdateConfigurationParams>('core', 'configuration/update');

export interface TelemetrySendEventParams<T extends keyof TelemetryEvents = keyof TelemetryEvents> {
	name: T;
	data: TelemetryEventsFromWebviewApp[T];
	source?: Source;
	startTime?: TimeInput;
	endTime?: TimeInput;
}
export const TelemetrySendEventCommand = new IpcCommand<TelemetrySendEventParams>('core', 'telemetry/sendEvent');

// NOTIFICATIONS

export interface IpcPromise {
	__ipc: 'promise';
	id: string;
	method: string;
}

export function isIpcPromise(value: unknown): value is IpcPromise {
	return (
		value != null &&
		typeof value === 'object' &&
		'__ipc' in value &&
		value.__ipc === 'promise' &&
		'id' in value &&
		typeof value.id === 'string' &&
		'method' in value &&
		typeof value.method === 'string'
	);
}

export const ipcPromiseSettled = new IpcNotification<PromiseSettledResult<unknown>>('core', 'ipc/promise/settled');

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

export interface WebviewState<Id extends WebviewIds | WebviewViewIds | CustomEditorIds = WebviewIds | WebviewViewIds> {
	webviewId: Id;
	webviewInstanceId: string | undefined;
	timestamp: number;
}
