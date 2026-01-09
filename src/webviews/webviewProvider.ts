import type { Disposable, Uri, ViewBadge, ViewColumn } from 'vscode';
import type { GlWebviewCommands } from '../constants.commands.js';
import type {
	Source,
	TelemetryEvents,
	WebviewTelemetryContext,
	WebviewTelemetryEvents,
} from '../constants.telemetry.js';
import type {
	CustomEditorIds,
	WebviewIds,
	WebviewPanelIds,
	WebviewTypeFromId,
	WebviewViewIds,
} from '../constants.views.js';
import type { WebviewContext } from '../system/webview.js';
import type {
	IpcCallMessageType,
	IpcCallParamsType,
	IpcCallResponseParamsType,
	IpcMessage,
	IpcNotification,
	IpcRequest,
} from './ipc/models/ipc.js';
import type { WebviewState } from './protocol.js';
import type { WebviewCommandCallback } from './webviewCommandRegistrar.js';
import type { WebviewShowOptions } from './webviewsController.js';

export type WebviewShowingArgs<T extends unknown[], SerializedState> = T | [{ state: Partial<SerializedState> }] | [];

export interface WebviewProvider<
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
> extends Disposable {
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

	includeBootstrap?(deferrable?: boolean): SerializedState | Promise<SerializedState>;
	includeHead?(): string | Promise<string>;
	includeBody?(): string | Promise<string>;
	includeEndOfBody?(): string | Promise<string>;

	onReady?(): void | Promise<void>;
	onRefresh?(force?: boolean): void;
	onReloaded?(): void;
	onMessageReceived?(e: IpcMessage): void;
	onActiveChanged?(active: boolean): void;
	onFocusChanged?(focused: boolean): void;
	onVisibilityChanged?(visible: boolean): void;
	onWindowFocusChanged?(focused: boolean): void;
}

export interface WebviewStateProvier<
	State,
	SerializedState,
	ShowingArgs extends unknown[] = unknown[],
> extends WebviewProvider<State, SerializedState, ShowingArgs> {
	canReceiveMessage?(e: IpcMessage): boolean;
}

export interface WebviewHost<ID extends WebviewIds | CustomEditorIds> {
	readonly id: ID;
	readonly instanceId: string;
	readonly type: WebviewTypeFromId<ID>;
	readonly originalTitle: string;
	title: string;
	description: string | undefined;
	badge: ViewBadge | undefined;

	readonly active: boolean | undefined;
	readonly ready: boolean;
	readonly viewColumn: ViewColumn | undefined;
	readonly visible: boolean;
	readonly baseWebviewState: WebviewState<ID>;
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
	/**
	 * Sends a telemetry event, automatically merging the provider's telemetry context
	 * @param name The event name
	 * @param data The event data (excluding properties provided by the provider's getTelemetryContext)
	 */
	sendTelemetryEvent<T extends keyof TelemetryEvents>(
		name: T,
		...args: [keyof WebviewTelemetryEvents[T]] extends [never]
			? [data?: never, source?: Source]
			: [data: WebviewTelemetryEvents[T], source?: Source]
	): void;
	is(type: 'editor'): this is WebviewHost<ID & (WebviewPanelIds | CustomEditorIds)>;
	is(type: 'view'): this is WebviewHost<ID & WebviewViewIds>;

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
		command: GlWebviewCommands,
		callback: WebviewCommandCallback<T>,
	): Disposable;
	show(loading: boolean, options?: WebviewShowOptions, ...args: unknown[]): Promise<void>;
}
