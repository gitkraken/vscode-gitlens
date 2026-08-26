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
import type { Connection, Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { isErrorLike } from '@gitlens/utils/error.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { TelemetryService } from '../../../rpc/services/telemetry.js';
import type { WebviewViewService } from '../../../rpc/webviewViewService.js';
import { isConnectionClosedError, noop } from '../actions/rpc.js';
import { subscribeAll } from '../events/subscriptions.js';
import { getWebviewClientInfo } from '../hostApi.js';
import type { RpcClient, RpcClientOptions } from '../rpcClient.js';
import { createRpcClient } from '../rpcClient.js';
import type { TelemetrySendEventParams } from '../telemetry.js';

/**
 * The shared-core service groups this controller wires centrally.
 *
 * Every RPC-capable surface's services type extends `SharedWebviewServices`
 * (`rpc/services/common.ts`), so these groups are always present on the remote.
 */
interface CoreWebviewServices {
	readonly webview: Pick<
		WebviewViewService,
		'connect' | 'focusChanged' | 'onHostWindowFocusChanged' | 'onVisibilityChanged' | 'onWebviewFocusChanged'
	>;
	readonly telemetry: Pick<TelemetryService, 'sendEvent'>;
}

/**
 * The shared-core surface app bases drive directly. Implemented by {@link RpcController}; declared
 * separately so `appBase.ts` can hold a reference to a subclass's controller without knowing its
 * services type.
 */
export interface WebviewRpc {
	/** Sends a webview-emitted telemetry event to the host's pipeline (buffered until ready). */
	sendTelemetry(detail: TelemetrySendEventParams): void;

	/** Reports a debounced, re-verified focus change to the host (context keys). */
	sendFocusChanged(params: { focused: boolean; inputFocused: boolean }): void;
}

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
	 * Called when the host pushes a webview focus change. App-level overrides keep working through
	 * this hook.
	 */
	onWebviewFocusChanged?: (focused: boolean) => void;

	/**
	 * Called when the host pushes a visibility change. App-level overrides keep working through
	 * this hook.
	 */
	onWebviewVisibilityChanged?: (visible: boolean) => void;

	/**
	 * Called when the host window's focus state changes while the webview is visible. App-level overrides keep working through this hook.
	 */
	onHostWindowFocusChanged?: (focused: boolean) => void;

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
 * recreate their per-mount state in `connectedCallback` (state providers rebound to that mount,
 * actions) from the cached one-shot bootstrap/context attribute
 * (`consumeOneShotAttribute`), and their event subscriptions are released at disconnect and
 * recreated per ready — nothing may close over a previous mount's objects across a remount. A
 * genuinely new page (iframe reload) gets a fresh element, a fresh bootstrap, and a fresh session.
 */
/** Reasons tagged on `.abort()` calls during the webview lifecycle so unhandled rejections that escape
 * to the iframe's global handler are diagnosable instead of opaque "signal is aborted without reason". */
const abortReasonReconnect = new DOMException('rpc reconnect: host reconnected', 'AbortError');
const abortReasonHostDisconnected = new DOMException('rpc disconnect: host disconnected', 'AbortError');

export class RpcController<TServices extends object> implements ReactiveController, WebviewRpc {
	private _client?: RpcClient<TServices>;
	private _services?: Remote<TServices>;
	private _connectionAbort?: AbortController;

	/** Memoized `webview` group proxy for this session; undefined while no session is live. */
	private _webview?: Remote<CoreWebviewServices>['webview'];
	/** Memoized `telemetry` group proxy for this session; undefined while no session is live. */
	private _telemetry?: Remote<CoreWebviewServices>['telemetry'];

	/** Telemetry emitted before a session existed (startup churn, early emits) — flushed in order on ready. */
	private _pendingTelemetry: TelemetrySendEventParams[] = [];

	/** The shared-core event subscription — armed once per controller; supertalk re-runs its
	 *  subscriber on every successful handshake (including reconnects), so it never double-arms. */
	private _coreSubscription?: Subscription;

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
		// The per-session core proxies die with the session; sends made before the next handshake
		// buffer again. The event subscription stays armed on the long-lived connection.
		this._webview = undefined;
		this._telemetry = undefined;
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
		this._webview = undefined;
		this._telemetry = undefined;
		this._pendingTelemetry.length = 0;
		this._coreSubscription?.unsubscribe();
		this._coreSubscription = undefined;
		// `dispose()`, not `stop()` then `dispose()` — `close()` already settles in-flight work.
		this._client?.dispose();
		this._client = undefined;
	}

	sendTelemetry(detail: TelemetrySendEventParams): void {
		if (this._telemetry == null) {
			// No session yet — buffer so early emits (startup churn, pre-ready tracking) aren't dropped.
			this._pendingTelemetry.push(detail);
			return;
		}

		void this._telemetry
			.then(telemetry => telemetry.sendEvent(detail.name, detail.data, detail.source))
			.catch(noop);
	}

	sendFocusChanged(params: { focused: boolean; inputFocused: boolean }): void {
		if (this._webview == null) {
			// Pre-session focus reports are ignorable: the host re-seeds context keys on ready/show.
			Logger.debug('RpcController: dropping focus change reported before RPC session was ready');
			return;
		}

		void this._webview.then(webview => webview.focusChanged(params)).catch(noop);
	}

	private async _connect(client: RpcClient<TServices>, signal: AbortSignal): Promise<void> {
		try {
			const services = await client.connect(signal);

			if (signal.aborted) return;

			this._services = services;

			// Shared-core wiring — focus/visibility events, telemetry, and context-key focus reports
			// ride these groups on every RPC-capable surface. Memoized per session (the group proxies
			// are thenables resolved by the handshake); cleared in hostDisconnected.
			const core = services as unknown as Remote<CoreWebviewServices>;
			this._webview = core.webview;

			// Announce this client generation to the host — the RPC-native successor of the legacy
			// `WebviewReadyRequest` postMessage. Awaiting it keeps the old ordering guarantee: the
			// host has processed the connect (generation guard, `_ready`, provider.onReady/onReconnect)
			// before any app-level ready code runs. A rejection here (host torn down mid-connect) is
			// a real connection failure and falls through to the error handling below.
			await this._webview.then(webview => webview.connect(getWebviewClientInfo()));

			if (signal.aborted) return;

			this._armCoreSubscription();

			// Assigned only now, immediately before the buffer flush below: a `gl-telemetry-fired`
			// event landing anywhere earlier in this connect path (including the `await` above) must
			// keep buffering in `_pendingTelemetry` rather than bypass it, or it could be delivered
			// ahead of the buffered pre-session events.
			this._telemetry = core.telemetry;

			// Deliver anything emitted before the session existed, in order, before app-level
			// `onReady` code runs.
			if (this._pendingTelemetry.length > 0) {
				const pending = this._pendingTelemetry.splice(0);
				for (const detail of pending) {
					this.sendTelemetry(detail);
				}
			}

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

	/**
	 * Arms the shared-core event subscription once per controller. Supertalk re-runs the subscriber
	 * on every successful handshake on the long-lived connection (including reconnects), so each
	 * session re-subscribes exactly once and nothing double-dispatches.
	 */
	private _armCoreSubscription(): void {
		if (this._coreSubscription != null) return;

		const connection = this._client?.connection;
		if (connection == null) return;

		this._coreSubscription = subscribe<CoreWebviewServices>(connection, async services => {
			const webview = await services.webview;

			return subscribeAll([
				// Dispatched here — the only source — so shared overlays (e.g. popovers closing on
				// `webview-blur`) keep working unchanged; app-level overrides ride the options callbacks.
				() =>
					webview.onWebviewFocusChanged(({ focused }) => {
						this.options?.onWebviewFocusChanged?.(focused);
						window.dispatchEvent(new CustomEvent(focused ? 'webview-focus' : 'webview-blur'));
					}),
				() =>
					webview.onVisibilityChanged(({ visible }) => {
						this.options?.onWebviewVisibilityChanged?.(visible);
						window.dispatchEvent(new CustomEvent(visible ? 'webview-visible' : 'webview-hidden'));
					}),
				() =>
					webview.onHostWindowFocusChanged(({ focused }) => {
						// No window event: only the Graph consumes host-window focus, via its app-level
						// override through the options callback.
						this.options?.onHostWindowFocusChanged?.(focused);
					}),
			]);
		});
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
