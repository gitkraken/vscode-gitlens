/**
 * RPC controller for webview apps.
 *
 * Implements Lit's ReactiveController pattern for managing the RPC lifecycle:
 * - A single long-lived supertalk Connection, built on the first hostConnected
 * - A fresh RPC session per hostConnected (component mount)
 * - The session ended, but the connection kept, on hostDisconnected (component unmount)
 *
 * Usage:
 * ```typescript
 * import { RpcController } from '../shared/rpc/rpcController.js';
 *
 * @customElement('my-app')
 * export class MyApp extends SignalWatcher(LitElement) {
 *   private _rpc = new RpcController<MyServices>(this, {
 *     onReady: services => this._onRpcReady(services),
 *     onError: error => console.error(error),
 *   });
 *
 *   private async _onRpcReady(services: Remote<MyServices>): Promise<void> {
 *     // Called when RPC connection is established
 *     // Set up subscriptions, fetch initial state, etc.
 *   }
 * }
 * ```
 */
import type { Connection, Remote } from '@eamodio/supertalk';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { isErrorLike } from '@gitlens/utils/error.js';
import { Logger } from '@gitlens/utils/logger.js';
import { isConnectionClosedError } from '../actions/rpc.js';
import type { RpcClient, RpcClientOptions } from '../rpcClient.js';
import { createRpcClient } from '../rpcClient.js';

export interface RpcControllerOptions<TServices extends object> {
	/**
	 * Called when RPC connection is established.
	 * Set up subscriptions, fetch initial state, etc.
	 *
	 * @param services - The RPC services proxy
	 */
	onReady?: (services: Remote<TServices>) => void | Promise<void>;

	/**
	 * Called when RPC connection fails.
	 *
	 * @param error - The error that occurred
	 */
	onError?: (error: Error) => void;

	/**
	 * Options passed to the underlying RPC client.
	 */
	rpcOptions?: RpcClientOptions;
}

/**
 * Lit ReactiveController that manages the RPC connection lifecycle.
 *
 * The controller:
 * - Establishes an RPC session in hostConnected, on a connection that outlives every mount
 * - Ends the session — without closing the connection — in hostDisconnected
 * - Calls onReady when the session is established
 * - Calls onError if the session fails
 *
 * Lifecycle contract: the remount tolerance here covers VS Code's repeated mount/unmount churn
 * during startup (before any session succeeds) and the reconnect handshakes that follow. Roots
 * recreate their per-mount state in `connectedCallback` (state providers rebound to that mount's
 * `HostIpc`, actions) from the cached one-shot bootstrap/context attribute
 * (`consumeOneShotAttribute`), and their event subscriptions are released at disconnect and
 * recreated per ready — nothing may close over a previous mount's objects across a remount. A
 * genuinely new page (iframe reload) gets a fresh element, a fresh bootstrap, and a fresh session.
 */
/** Reasons tagged on `.abort()` calls during the webview lifecycle so unhandled rejections that escape
 * to the iframe's global handler are diagnosable instead of opaque "signal is aborted without reason". */
const abortReasonReconnect = new DOMException('rpc reconnect: host reconnected', 'AbortError');
const abortReasonHostDisconnected = new DOMException('rpc disconnect: host disconnected', 'AbortError');

export class RpcController<TServices extends object> implements ReactiveController {
	private _client?: RpcClient<TServices>;
	private _services?: Remote<TServices>;
	private _connectionAbort?: AbortController;

	/**
	 * The RPC services proxy. Available after connection is established.
	 */
	get services(): Remote<TServices> | undefined {
		return this._services;
	}

	/**
	 * The long-lived supertalk connection, or undefined before the first `hostConnected`.
	 *
	 * Stable across element remounts, so it is the legal anchor for `subscribe()` — pass this, not
	 * {@link services}, which is wrapped for property caching and fails supertalk's root-proxy check.
	 */
	get connection(): Connection | undefined {
		return this._client?.connection;
	}

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options?: RpcControllerOptions<TServices>,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		// Skip the abort entirely when there is no prior cycle to tear down. VS Code mounts/unmounts
		// sidebar webview elements repeatedly during startup before the extension is even active; an
		// abort with no consumer to receive it manifests as a stack-traceless unhandled rejection in
		// the iframe's global handler. Only abort when there's an actual in-flight connection or a
		// completed-but-not-yet-disposed services bag.
		if (this._connectionAbort != null) {
			this._connectionAbort.abort(abortReasonReconnect);
		}
		this._connectionAbort = new AbortController();
		// Built on the first mount and kept for every later one — the endpoint, the handlers, and the
		// Connection must be the same instances across remounts for `subscribe()` to resubscribe.
		this._client ??= createRpcClient<TServices>(this.options?.rpcOptions);
		void this._connect(this._client, this._connectionAbort.signal);
	}

	hostDisconnected(): void {
		this._connectionAbort?.abort(abortReasonHostDisconnected);
		this._connectionAbort = undefined;
		// Ends the session — settles in-flight work — but leaves the connection listening and re-armed
		// for the next mount. Closing here would defeat the whole point of the long-lived connection.
		this._client?.stop();
		this._services = undefined;
	}

	/**
	 * Closes the long-lived connection and disposes its endpoint.
	 *
	 * Nothing calls this in production: Lit has no "destroyed for good" hook — `disconnectedCallback`
	 * fires on a plain remount too — so the connection lives until VS Code tears down the webview's
	 * iframe, which takes the whole JS realm (window listeners included) with it. Provided for hosts
	 * and tests that can prove a final teardown.
	 */
	dispose(): void {
		this._connectionAbort?.abort(abortReasonHostDisconnected);
		this._connectionAbort = undefined;
		this._services = undefined;
		// `dispose()`, not `stop()` then `dispose()` — `close()` already settles in-flight work.
		this._client?.dispose();
		this._client = undefined;
	}

	private async _connect(client: RpcClient<TServices>, signal: AbortSignal): Promise<void> {
		try {
			const services = await client.connect(signal);

			if (signal.aborted) return;

			this._services = services;

			if (this.options?.onReady != null) {
				try {
					await this.options.onReady(services);
				} catch (ex) {
					client.stop();
					this._services = undefined;
					throw ex;
				}
			}
		} catch (ex) {
			if (signal.aborted) return;

			const error = toError(ex);
			const idOpt = this.options?.rpcOptions?.webviewId;
			const instanceOpt = this.options?.rpcOptions?.webviewInstanceId;
			const id = typeof idOpt === 'function' ? idOpt() : idOpt;
			const instance = typeof instanceOpt === 'function' ? instanceOpt() : instanceOpt;
			const tag = instance != null ? `${id ?? '?'}|${instance}` : (id ?? '?');
			if (isConnectionClosedError(error)) {
				Logger.debug(`RpcController(${tag}): connect dropped by deliberate connection teardown`);
			} else {
				Logger.error(error, `RpcController(${tag}): Failed to connect`);
			}

			if (this.options?.onError != null) {
				this.options.onError(error);
			}
		}
	}
}

/**
 * Normalize an unknown thrown value into a real Error while preserving the original
 * as `cause`. Uses `isErrorLike` so DOMException / cross-realm Errors (which fail
 * `instanceof Error`) surface their `name`/`message` instead of `"[object Object]"`.
 */
function toError(ex: unknown): Error {
	if (ex instanceof Error) return ex;
	if (isErrorLike(ex)) {
		const err = new Error(`${ex.name}: ${ex.message}`);
		(err as { cause?: unknown }).cause = ex;
		return err;
	}
	return new Error(String(ex));
}
