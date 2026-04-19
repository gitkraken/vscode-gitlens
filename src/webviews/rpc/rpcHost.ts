/**
 * RPC Host helper for webview providers.
 *
 * This module provides a helper class that webview providers can use to
 * expose services via Supertalk RPC alongside existing IPC.
 *
 * Uses a deferred handshake: the Connection is created immediately (starts
 * listening for messages), but expose() is NOT called until the webview
 * signals readiness via WebviewReadyRequest. This avoids the timing issue
 * where expose()'s ready signal is sent before the webview scripts load.
 */
import type { Handler, Options } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { AbortSignalHandler } from '@eamodio/supertalk-core/handlers/abort-signal.js';
import { SignalHandler } from '@eamodio/supertalk-signals';
import type { Disposable, Webview } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { WebviewIds } from '../../constants.views.js';
import { rpcHandlers } from '../../system/rpc/handlers.js';
import { createSupertalkLogger, formatWebviewLogTag } from '../../system/rpc/logger.js';
import type { SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createHostEndpoint } from './hostEndpoint.js';

export interface RpcHostOptions {
	/**
	 * Webview identifier used to tag log lines produced by this RPC channel.
	 * Example: `gitlens.views.home`.
	 */
	webviewId?: WebviewIds;

	/**
	 * Webview instance identifier appended to the log tag, matching the existing
	 * `WebviewController(id|instance)` convention. Helpful when multiple instances
	 * of the same webview (e.g. multiple Timeline panels) are active at once.
	 */
	webviewInstanceId?: string;

	/**
	 * Additional handlers beyond the default rpcHandlers.
	 * The default handlers (Date, Map, Set, RegExp) and SignalHandler are always included.
	 */
	handlers?: Handler[];

	/**
	 * Enable nested proxy mode for deep traversal of arguments and return values.
	 *
	 * Required for GitLens webviews: GetOverviewBranch has six Promise<> lazy
	 * fields that rely on Supertalk's Promise proxying, and the JSON transport
	 * (encodeRpcPayload) destroys nested Dates without the DateHandler traversal.
	 *
	 * When true (default): full recursive traversal — auto-proxies functions/promises
	 * nested inside objects, runs handlers on nested values (e.g. Date, Map, Set).
	 *
	 * When false: only top-level values are processed. Breaks nested Promises and
	 * nested Dates in VS Code webviews due to JSON serialization transport.
	 *
	 * @default true
	 */
	nestedProxies?: boolean;

	/**
	 * Enable debug mode for better error messages.
	 * @default false
	 */
	debug?: boolean;

	/**
	 * Enable automatic signal watching (eager mode).
	 * When true, signals are watched immediately when sent, updates always flow.
	 * When false (default), signals are only watched when receiver observes reactively.
	 * @default false
	 */
	autoWatchSignals?: boolean;
}

/**
 * Manages RPC services for a webview.
 *
 * Creates a Supertalk Connection and defers expose() until the webview
 * signals readiness. Supports reconnection on webview refresh — supertalk's
 * Connection doesn't support re-exposure, so a fresh Connection + endpoint
 * is created on each subsequent expose() call.
 *
 * Usage in a webview provider:
 * ```typescript
 * class MyWebviewProvider {
 *   private rpcHost?: RpcHost;
 *
 *   constructor(host: WebviewHost) {
 *     const services = { echo: (msg: string) => `Echo: ${msg}` };
 *     this.rpcHost = new RpcHost(host.webview, services);
 *   }
 *
 *   // Called when WebviewReadyRequest is received:
 *   onWebviewReady() {
 *     this.rpcHost?.expose();
 *   }
 *
 *   dispose() {
 *     this.rpcHost?.dispose();
 *   }
 * }
 * ```
 */
export class RpcHost<TServices extends object> implements Disposable {
	private readonly webview: Webview;
	private readonly services: TServices;
	private readonly options: RpcHostOptions | undefined;
	private readonly tracker: SubscriptionTracker | undefined;
	private readonly logPrefix: string;
	private _exposed = false;
	private endpoint: ReturnType<typeof createHostEndpoint>;
	private connection: Connection;

	private _connectTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(webview: Webview, services: TServices, options?: RpcHostOptions, tracker?: SubscriptionTracker) {
		this.webview = webview;
		this.services = services;
		this.options = options;
		this.tracker = tracker;
		this.logPrefix = `RpcHost(${formatWebviewLogTag(options?.webviewId, options?.webviewInstanceId)})`;
		this.endpoint = createHostEndpoint(webview);

		// Create the Connection (sets up message listener) but DON'T expose yet.
		// The host will call expose() when WebviewReadyRequest is received.
		this.connection = new Connection(this.endpoint, this.buildConnectionOptions());
		Logger.debug(`${this.logPrefix}: Connection created, awaiting WebviewReadyRequest`);

		// Diagnostic: warn if expose() is never called
		this._connectTimer = setTimeout(() => {
			this._connectTimer = undefined;
			if (!this._exposed) {
				Logger.warn(`${this.logPrefix}: expose() has not been called after 30s — may indicate a load failure`);
			}
		}, 30_000);
	}

	/**
	 * Expose services and send the ready signal to the webview.
	 * Called by the WebviewController when WebviewReadyRequest is received,
	 * indicating the webview's Connection listener is set up and ready.
	 *
	 * On reconnection (e.g. webview refresh), the old Connection is
	 * closed and a fresh one is created — supertalk's Connection doesn't
	 * support re-exposure.
	 */
	expose(): void {
		if (this._connectTimer != null) {
			clearTimeout(this._connectTimer);
			this._connectTimer = undefined;
		}

		if (this._exposed) {
			// Reconnection: clean up outstanding event subscriptions from the
			// previous webview session, then tear down the old connection.
			Logger.debug(
				`${this.logPrefix}: Reconnecting — disposing tracked subscriptions and creating fresh connection`,
			);
			this.tracker?.dispose();
			this.connection.close();
			this.endpoint.dispose();
			this.endpoint = createHostEndpoint(this.webview);
			this.connection = new Connection(this.endpoint, this.buildConnectionOptions());
		}
		this._exposed = true;

		this.connection.expose(this.services);
		Logger.debug(`${this.logPrefix}: Services exposed successfully`);
	}

	/**
	 * Update visibility state for the endpoint's message buffer.
	 * When hidden, outgoing messages are buffered instead of being sent
	 * (VS Code silently drops postMessage while hidden). On visibility
	 * restore, buffered messages are flushed with dedup.
	 */
	setVisible(visible: boolean): void {
		this.endpoint.setVisible(visible);
	}

	dispose(): void {
		if (this._connectTimer != null) {
			clearTimeout(this._connectTimer);
			this._connectTimer = undefined;
		}
		this.tracker?.dispose();
		this.connection.close();
		this.endpoint.dispose();
	}

	private buildConnectionOptions(): Options {
		// Create SignalHandler for reactive state synchronization
		const signalHandler = new SignalHandler({ autoWatch: this.options?.autoWatchSignals });

		// Merge default handlers with SignalHandler, AbortSignalHandler, and any additional handlers
		const handlers: Handler[] = [
			...rpcHandlers,
			signalHandler,
			new AbortSignalHandler(),
			...(this.options?.handlers ?? []),
		];

		return {
			handlers: handlers,
			// Required: GetOverviewBranch has six Promise<> lazy fields that rely
			// on Supertalk's nested Promise proxying, and the JSON transport
			// (encodeRpcPayload) requires DateHandler traversal for nested Dates.
			nestedProxies: this.options?.nestedProxies ?? true,
			debug: this.options?.debug,
			// Coalesce synchronous calls into a single postMessage
			batching: true,
			logger: createSupertalkLogger(
				`host(${formatWebviewLogTag(this.options?.webviewId, this.options?.webviewInstanceId)})`,
			),
		};
	}
}

/**
 * Creates an RPC host for a webview.
 *
 * This is a convenience function that creates an RpcHost instance.
 * Use this when you don't need to hold a reference to the host.
 *
 * @param webview - The VS Code Webview instance
 * @param services - The services to expose
 * @param options - Optional configuration
 * @returns A disposable that cleans up when disposed
 */
export function createRpcHost<TServices extends object>(
	webview: Webview,
	services: TServices,
	options?: RpcHostOptions,
): RpcHost<TServices> {
	return new RpcHost(webview, services, options);
}
