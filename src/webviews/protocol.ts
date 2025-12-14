import type { TimeInput } from '@opentelemetry/api';
import type { Config } from '../config';
import type { GlCommands } from '../constants.commands';
import type { Source, TelemetryEvents, TelemetryEventsFromWebviewApp } from '../constants.telemetry';
import type {
	CustomEditorIds,
	CustomEditorTypes,
	WebviewIds,
	WebviewTypes,
	WebviewViewIds,
	WebviewViewTypes,
} from '../constants.views';
import type { Promo, PromoLocation, PromoPlans } from '../plus/gk/models/promo';
import type { ConfigPath, ConfigPathValue, Path, PathValue } from '../system/-webview/configuration';

export type IpcScope = 'core' | CustomEditorTypes | WebviewTypes | WebviewViewTypes;

type IpcCompression = 'deflate' | 'utf8' | false;
export interface IpcMessage<T = unknown> {
	id: string;
	scope: IpcScope;
	method: string;
	params: T;
	compressed: IpcCompression;
	timestamp: number;

	completionId?: string;
}

abstract class IpcCall<Params> {
	public readonly method: string;

	constructor(
		public readonly scope: IpcScope,
		method: string,
		public readonly reset: boolean = false,
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

	constructor(scope: IpcScope, method: string, reset?: boolean) {
		super(scope, method, reset);

		this.response = new IpcNotification<ResponseParams>(this.scope, `${method}/completion`, this.reset);
	}
}

/**
 * Notifications are sent from the extension to the webview
 */
export class IpcNotification<Params = void> extends IpcCall<Params> {}

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

export interface TelemetrySendEventParams<T extends keyof TelemetryEvents = keyof TelemetryEvents> {
	name: T;
	data: TelemetryEventsFromWebviewApp[T];
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

export interface WebviewState<Id extends WebviewIds | WebviewViewIds | CustomEditorIds> {
	webviewId: Id;
	webviewInstanceId: string | undefined;
	timestamp: number;
}
