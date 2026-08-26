/**
 * Webview view service — host-pushed focus/visibility events, webview-reported focus changes,
 * and the RPC session handshake.
 *
 * The sole transport for these pushes since the legacy core IPC notifications (and the
 * `WebviewReadyRequest` they rode alongside) were removed.
 */

import type { Disposable, Event } from 'vscode';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEventSubscription } from './eventVisibilityBuffer.js';
import type { RpcEventSubscription } from './services/types.js';

/** Identity of the webview client generation reporting a session, from `getWebviewClientInfo()`. */
export interface WebviewClientConnectParams {
	/** Stable id generated once per JS module evaluation on the webview side. Same `clientId` across two connects means the iframe was NOT reloaded. */
	clientId?: string;
	/** `Date.now()` captured at module evaluation time on the webview side. */
	clientLoadedAt?: number;
}

/**
 * The subset of `WebviewHost` this service needs.
 *
 * The controller owns the underlying emitters.
 */
export interface WebviewViewServiceHost {
	/** Fired when the containing editor/view/tab's visibility changes. */
	readonly onDidChangeVisibility: Event<boolean>;
	/** Fired when the webview's focus state changes — including echoes of the webview's own reports. */
	readonly onDidChangeFocus: Event<boolean>;
	/** Fired when the host window's focus state changes (only while the webview is visible). */
	readonly onDidChangeWindowFocus: Event<boolean>;
	/** Applies a webview-reported focus change: context keys, provider callback, and focus event. */
	focusChanged(focused: boolean, inputFocused: boolean): void;
	/**
	 * Marks the announcing client generation as ready — the successor of the legacy
	 * `WebviewReadyRequest` handler (generation guard, reconnect classification,
	 * `provider.onReady`/`onReconnect`).
	 */
	connect(params: WebviewClientConnectParams): Promise<void>;
}

export class WebviewViewService {
	/** Save-last: a hidden/muted webview replays only the newest visibility — always authoritative. */
	readonly onVisibilityChanged: RpcEventSubscription<{ visible: boolean }>;
	/** Save-last: focus is boolean state, so the latest report is the only one that matters. */
	readonly onWebviewFocusChanged: RpcEventSubscription<{ focused: boolean }>;
	/** Save-last: same reasoning as {@link onWebviewFocusChanged}. */
	readonly onHostWindowFocusChanged: RpcEventSubscription<{ focused: boolean }>;

	constructor(
		private readonly host: WebviewViewServiceHost,
		buffer?: EventVisibilityBuffer,
		tracker?: SubscriptionTracker,
	) {
		/** Fixes the `buffer`/mode/`tracker` that are identical for all three subscriptions below, leaving
		 *  only what actually differs between them: the key, the host event, and the payload mapping. */
		function subscribeSaveLast<T>(
			key: string,
			subscribe: (buffered: (data: T) => void) => Disposable,
		): RpcEventSubscription<T> {
			return createRpcEventSubscription<T>(buffer, key, 'save-last', subscribe, undefined, tracker);
		}

		this.onVisibilityChanged = subscribeSaveLast<{ visible: boolean }>('visibilityChanged', buffered =>
			host.onDidChangeVisibility(visible => buffered({ visible: visible })),
		);
		this.onWebviewFocusChanged = subscribeSaveLast<{ focused: boolean }>('webviewFocusChanged', buffered =>
			host.onDidChangeFocus(focused => buffered({ focused: focused })),
		);
		this.onHostWindowFocusChanged = subscribeSaveLast<{ focused: boolean }>('hostWindowFocusChanged', buffered =>
			host.onDidChangeWindowFocus(focused => buffered({ focused: focused })),
		);
	}

	/**
	 * Applies a webview-reported focus change on the host (context keys and downstream fans-out).
	 * The resulting echo rides {@link onWebviewFocusChanged} back to the webview.
	 */
	focusChanged(params: { focused: boolean; inputFocused: boolean }): Promise<void> {
		this.host.focusChanged(params.focused, params.inputFocused);
		return Promise.resolve();
	}

	/**
	 * Marks this client generation as ready on the host. Invoked by `RpcController`
	 * immediately after each successful handshake, carrying the session's
	 * `getWebviewClientInfo()` — the RPC-native successor of `WebviewReadyRequest`.
	 */
	connect(params: WebviewClientConnectParams): Promise<void> {
		return this.host.connect(params);
	}
}
