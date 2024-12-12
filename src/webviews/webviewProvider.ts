import type { Disposable, Uri, ViewBadge } from 'vscode';
import type { WebviewCommands, WebviewViewCommands } from '../constants.commands';
import type { WebviewTelemetryContext } from '../constants.telemetry';
import type { WebviewIds, WebviewViewIds } from '../constants.views';
import type { WebviewContext } from '../system/webview';
import type {
	IpcCallMessageType,
	IpcCallParamsType,
	IpcCallResponseParamsType,
	IpcMessage,
	IpcNotification,
	IpcRequest,
	WebviewState,
} from './protocol';
import type { WebviewCommandCallback } from './webviewCommandRegistrar';
import type { WebviewShowOptions } from './webviewsController';

export type WebviewShowingArgs<T extends unknown[], SerializedState> = T | [{ state: Partial<SerializedState> }] | [];

export interface WebviewProvider<State, SerializedState = State, ShowingArgs extends unknown[] = unknown[]>
	extends Disposable {
	/**
	 * Determines whether the webview instance can be reused
	 * @returns `true` if the webview should be reused, `false` if it should NOT be reused, and `undefined` if it *could* be reused but not ideal
	 */
	canReuseInstance?(...args: WebviewShowingArgs<ShowingArgs, SerializedState>): boolean | undefined;
	getSplitArgs?(): WebviewShowingArgs<ShowingArgs, SerializedState>;
	getTelemetryContext(): Record<`context.${string}`, string | number | boolean | undefined> & WebviewTelemetryContext;
	onShowing?(
		loading: boolean,
		options: WebviewShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	):
		| [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined]
		| Promise<[boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined]>;
	registerCommands?(): Disposable[];

	includeBootstrap?(): SerializedState | Promise<SerializedState>;
	includeHead?(): string | Promise<string>;
	includeBody?(): string | Promise<string>;
	includeEndOfBody?(): string | Promise<string>;

	onReady?(): void;
	onRefresh?(force?: boolean): void;
	onReloaded?(): void;
	onMessageReceived?(e: IpcMessage): void;
	onActiveChanged?(active: boolean): void;
	onFocusChanged?(focused: boolean): void;
	onVisibilityChanged?(visible: boolean): void;
	onWindowFocusChanged?(focused: boolean): void;
}

export interface WebviewStateProvier<State, SerializedState, ShowingArgs extends unknown[] = unknown[]>
	extends WebviewProvider<State, SerializedState, ShowingArgs> {
	canReceiveMessage?(e: IpcMessage): boolean;
}

export interface WebviewHost<ID extends WebviewIds | WebviewViewIds> {
	readonly id: ID;

	readonly originalTitle: string;
	title: string;
	description: string | undefined;
	badge: ViewBadge | undefined;

	readonly active: boolean | undefined;
	readonly ready: boolean;
	readonly visible: boolean;
	readonly baseWebviewState: WebviewState;
	readonly cspNonce: string;

	getWebRoot(): string;
	asWebviewUri(uri: Uri): Uri;

	addPendingIpcNotification(
		type: IpcNotification<any>,
		mapping: Map<IpcNotification<any>, () => Promise<boolean>>,
		thisArg: any,
	): void;
	clearPendingIpcNotifications(): void;
	sendPendingIpcNotifications(): void;

	getTelemetryContext(): WebviewTelemetryContext;
	isHost(type: 'editor'): this is WebviewHost<ID extends WebviewIds ? ID : never>;
	isHost(type: 'view'): this is WebviewHost<ID extends WebviewViewIds ? ID : never>;

	notify<T extends IpcNotification<unknown>>(
		notificationType: T,
		params: IpcCallParamsType<T>,
		completionId?: string,
	): Promise<boolean>;
	refresh(force?: boolean): Promise<void>;
	respond<T extends IpcRequest<unknown, unknown>>(
		responseType: T,
		msg: IpcCallMessageType<T>,
		params: IpcCallResponseParamsType<T>,
	): Promise<boolean>;
	registerWebviewCommand<T extends Partial<WebviewContext>>(
		command: WebviewCommands | WebviewViewCommands,
		callback: WebviewCommandCallback<T>,
	): Disposable;
	show(loading: boolean, options?: WebviewShowOptions, ...args: unknown[]): Promise<void>;
}
