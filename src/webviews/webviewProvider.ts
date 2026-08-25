import type { Handler } from '@eamodio/supertalk';
import type { Disposable, Event, Uri, ViewBadge, ViewColumn } from 'vscode';
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
import type { WebviewState } from './protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './rpc/eventVisibilityBuffer.js';
import type { WebviewClientConnectParams } from './rpc/webviewViewService.js';
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
	/**
	 * Called when the webview iframe sends `core/webview/ready` while the host already considered the controller ready —
	 * i.e., the iframe was reloaded under us (e.g., panel layout settle, editor-tab webview restored after a window reload).
	 * The host re-exposes RPC (cycling the connection, so resubscription re-seeds state) and providers usually do NOT need to re-push state.
	 * Use this hook only for things outside that plane: re-deriving non-RPC state, telemetry, or one-shot reconnect side effects.
	 */
	onReconnect?(): void | Promise<void>;
	onRefresh?(force?: boolean): void;
	onReloaded?(): void;
	onActiveChanged?(active: boolean): void;
	onFocusChanged?(focused: boolean): void;
	onVisibilityChanged?(visible: boolean): void;
	onWindowFocusChanged?(focused: boolean): void;

	/**
	 * Returns services to expose via RPC (Supertalk).
	 *
	 * If provided, these services will be exposed to the webview and can be
	 * called via `RpcController` / `createRpcClient<T>()` from the webview side. This enables a
	 * service-oriented architecture alongside or instead of IPC messages.
	 *
	 * @example
	 * ```typescript
	 * getRpcServices() {
	 *   return {
	 *     getCommit: (sha: string) => this.getCommitDetails(sha),
	 *     search: (query: string) => this.performSearch(query),
	 *   };
	 * }
	 * ```
	 */
	getRpcServices?(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): object;

	/**
	 * Returns additional Supertalk handlers to register on the RPC connection, beyond
	 * the defaults `RpcHost` always includes (Date/Map/Set/RegExp, SignalHandler,
	 * GlAbortSignalHandler). Use this for provider-specific handlers such as a
	 * `SequencedChannel` for a streamed surface (e.g. the Graph rows channel).
	 */
	getRpcHandlers?(): Handler[];
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

	/** Fired when the containing editor/view/tab's visibility changes. */
	readonly onDidChangeVisibility: Event<boolean>;
	/** Fired when the webview's focus state changes — including echoes of the webview's own reports. */
	readonly onDidChangeFocus: Event<boolean>;
	/** Fired when the host window's focus state changes (only while the webview is visible). */
	readonly onDidChangeWindowFocus: Event<boolean>;

	/**
	 * Applies a webview-reported focus change: updates context keys, notifies the provider, and
	 * fires {@link onDidChangeFocus} (the echo that lets the webview dispatch its focus events).
	 */
	focusChanged(focused: boolean, inputFocused: boolean): void;

	/**
	 * Marks the announcing client generation as ready — invoked by the webview's `RpcController`
	 * over the RPC `webview` service group after each successful handshake. Successor of the
	 * legacy `WebviewReadyRequest` handshake.
	 */
	connect(params: WebviewClientConnectParams): Promise<void>;

	getWebRoot(): string;
	asWebviewUri(uri: Uri): Uri;

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

	refresh(force?: boolean): Promise<void>;
	registerWebviewCommand<T extends Partial<WebviewContext>>(
		command: GlWebviewCommands,
		callback: WebviewCommandCallback<T>,
	): Disposable;
	registerWebviewCommandForId<T extends Partial<WebviewContext>>(
		webviewId: string,
		command: GlWebviewCommands,
		callback: WebviewCommandCallback<T>,
	): Disposable;
	show(loading: boolean, options?: WebviewShowOptions, ...args: unknown[]): Promise<void>;
}
