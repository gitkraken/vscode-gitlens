/**
 * RPC Host helper for webview providers.
 *
 * This module provides a helper class that webview providers can use to
 * expose services over the webview's Supertalk RPC pipe.
 *
 * Uses an announcement-driven handshake: the Connection is created immediately
 * (starts listening for messages) but nothing is exposed until the webview's
 * session announces itself over RPC — see {@link RpcHostOptions.onClientSession}.
 * Supertalk's `expose()` sends its ready signal exactly once, so exposing before
 * the webview's scripts are listening would strand the client's `waitForReady()`
 * forever (the library has no retry/re-announce). Instead each client session
 * announces itself (`reset()` + `expose()` from `connectRpcSession`), and this
 * side detects that announcement frame and exposes immediately — the announcement
 * can then never be missed.
 */
import type { Handler, Options } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { SignalHandler } from '@eamodio/supertalk-signals';
import type { Disposable, Webview } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { WebviewIds } from '../../constants.views.js';
import { GlAbortSignalHandler } from '../../system/rpc/abortSignalHandler.js';
import { rpcHandlers } from '../../system/rpc/handlers.js';
import { createSupertalkLogger, formatWebviewLogTag } from '../../system/rpc/logger.js';
import type { SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createHostEndpoint } from './hostEndpoint.js';

export interface RpcHostOptions {
	/**
	 * Webview identifier used to tag log lines produced by this RPC channel.
	 * Example: `gitlens.views.commitDetails`.
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
	 * Called whenever a client session announces itself — first boot, iframe reload,
	 * or element remount alike — just after this host has (re-)exposed its services to it.
	 *
	 * This is the readiness signal: it replaces the legacy `WebviewReadyRequest`
	 * postMessage as the moment the host learns a live webview generation exists.
	 */
	onClientSession?: () => void;

	/**
	 * Consulted BEFORE serving an announcement (which resets tracked subscriptions and swaps the
	 * exposed connection). `false` — a validated session is already live — skips the swap so the
	 * live session's subscriptions survive, re-posting the captured handshake so a genuine waiter
	 * still unblocks. The full session state machine lives on `WebviewController._sessionState`.
	 */
	shouldServeSession?: () => boolean;

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
 * Wire shape needed to recognize supertalk's handshake announcement. A session
 * announcement is a `return` frame carrying the reserved handshake id (`0` —
 * supertalk's `HANDSHAKE_ID`, which it does not export) and the announcing
 * peer's own session id; with batching enabled it may ride inside a `batch`
 * wrapper alongside other frames.
 */
interface AnnouncementFrame {
	type?: unknown;
	id?: unknown;
	messages?: unknown[];
	session?: unknown;
}

/** Returns the handshake announcement frame — unwrapping batches — or `undefined`. */
function extractAnnounceMessage(data: unknown): AnnouncementFrame | undefined {
	if (typeof data !== 'object' || data == null) return undefined;

	const msg = data as AnnouncementFrame;
	if (msg.type === 'batch' && Array.isArray(msg.messages)) {
		for (const inner of msg.messages) {
			const found = extractAnnounceMessage(inner);
			if (found != null) return found;
		}
		return undefined;
	}

	return msg.type === 'return' && msg.id === 0 ? msg : undefined;
}

/**
 * Manages RPC services for a webview.
 *
 * Creates a Supertalk Connection up front and exposes its services as soon as a
 * client session announces itself. Each announcement swaps in a fresh exposed
 * Connection — supertalk's `Connection` doesn't support re-exposure, so a new
 * one is created per client generation (first boot, reload, or remount).
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
	/** Whether any client session has announced itself (and thus been served an expose()). */
	private _clientSessionSeen = false;
	/** Last visibility passed to {@link setVisible}; reseeded into fresh endpoints on reconnect. */
	private _visible = true;
	private _disposed = false;
	private endpoint: ReturnType<typeof createHostEndpoint>;
	/** The exact handshake frame this host last posted (extracted from any batch) — replayed,
	 *  verbatim and side-effect-free, when an announcement is ignored so a waiting client's
	 *  pending handshake still resolves without re-running expose() (which would double-register
	 *  the services root and duplicate every subsequent dispatch). */
	private _lastAnnounceMessage: unknown;
	/** The caller session of the announcement most recently SERVED (exposed, awaiting its
	 *  `connect()` to validate) — extracted from that announcement's own handshake frame (see
	 *  {@link armAnnouncementTap}). `WebviewController.connect()` checks its own caller session
	 *  against this to accept only the client this host actually served, not merely whichever
	 *  caller's `connect()` lands first. */
	private _pendingServedSession: number | undefined;
	private connection: Connection;
	private detachAnnouncementTap: (() => void) | undefined;

	private _connectTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(webview: Webview, services: TServices, options?: RpcHostOptions, tracker?: SubscriptionTracker) {
		this.webview = webview;
		this.services = services;
		this.options = options;
		this.tracker = tracker;
		this.logPrefix = `RpcHost(${formatWebviewLogTag(options?.webviewId, options?.webviewInstanceId)})`;
		this.endpoint = this.createEndpoint(webview);

		// Create the Connection (sets up message listener) but DON'T expose yet — the webview's
		// session announcement (detected by the tap below) is what triggers the expose.
		this.connection = new Connection(this.endpoint, this.buildConnectionOptions());
		Logger.debug(`${this.logPrefix}: Connection created, awaiting client session announcement`);
		// Bound once: the closure reads `this.connection` live, so it keeps resolving against
		// whichever Connection is currently exposed across every reconnect swap below.
		this.tracker?.bindCallerSession(() => this.connection.callerSession);
		this.armAnnouncementTap();

		// Diagnostic: warn if no client ever announces
		this._connectTimer = setTimeout(() => {
			this._connectTimer = undefined;
			if (!this._clientSessionSeen) {
				Logger.warn(
					`${this.logPrefix}: no client session announcement after 30s — may indicate a load failure`,
				);
			}
		}, 30_000);
	}

	/**
	 * Wraps the endpoint's outgoing post to capture the exact handshake frame this host sends,
	 * so the ignore path can re-post it verbatim for waiting clients (see {@link armAnnouncementTap}).
	 */
	private createEndpoint(webview: Webview): ReturnType<typeof createHostEndpoint> {
		const endpoint = createHostEndpoint(webview);
		const rawPost = endpoint.postMessage.bind(endpoint);
		endpoint.postMessage = (message: unknown, transfer?: unknown[]): void => {
			const announce = extractAnnounceMessage(message);
			if (announce != null) {
				this._lastAnnounceMessage = announce;
			}
			rawPost(message, transfer);
		};
		return endpoint;
	}

	/**
	 * Arms a listener that watches inbound frames for client session announcements. Stays armed
	 * across ignored announcements; re-armed on every connection swap, so exactly one
	 * announcement per client generation triggers exactly one serve.
	 */
	private armAnnouncementTap(): void {
		const onTap = (event: MessageEvent): void => {
			const announce = extractAnnounceMessage(event.data);
			if (announce == null) return;

			// A validated session is already live (see `WebviewController._sessionState`): this
			// announcement is a same-connection re-boot — an element remount or an in-place iframe
			// reload — so this path swaps nothing and `_pendingServedSession` is left untouched;
			// the re-booted client is validated (and its predecessor superseded) by its own
			// `connect()`. Re-post the captured handshake frame so the announcer's pending wait
			// resolves against the live services.
			if (this.options?.shouldServeSession?.() === false) {
				Logger.debug(`${this.logPrefix}: session announcement ignored — re-announcing on live connection`);
				if (this._lastAnnounceMessage != null) {
					this.endpoint.postMessage(this._lastAnnounceMessage);
				}
				return;
			}

			// Record the announcing peer's own session — carried on the handshake frame by every
			// current-version peer (absent only for one that predates the `session` wire field).
			// This is the identity `WebviewController.connect()` checks its own caller session
			// against, so only the client this host actually served can validate.
			this._pendingServedSession = typeof announce.session === 'number' ? announce.session : undefined;

			// Detach before serving — the swap below replaces the endpoint this listener lives on.
			this.detachAnnouncementTap?.();
			this.detachAnnouncementTap = undefined;
			this.onClientSession();
		};
		this.endpoint.addEventListener('message', onTap);
		this.detachAnnouncementTap = () => this.endpoint.removeEventListener('message', onTap);
	}

	/**
	 * Serves the announcing client generation: resets tracked subscriptions from any
	 * previous session, tears down the current Connection, and exposes a fresh one —
	 * the same work the ready-triggered reconnect path has always done.
	 *
	 * The fresh endpoint seeds the last known visibility so messages sent before the
	 * next visibility event aren't dropped by VS Code while hidden; during a reload-mute
	 * window they buffer until the controller lifts the mute.
	 */
	private onClientSession(): void {
		if (this._disposed) return;

		if (this._connectTimer != null) {
			clearTimeout(this._connectTimer);
			this._connectTimer = undefined;
		}

		const reconnecting = this._clientSessionSeen;
		this._clientSessionSeen = true;

		try {
			if (reconnecting) {
				// Fresh start for the served generation: dispose every subscription tracked from
				// the previous one. The new generation's subscriptions (registered once the
				// swapped-in connection is exposed below) attach fresh VS Code listeners.
				this.tracker?.reset();
				Logger.debug(`${this.logPrefix}: Reconnecting — resetting tracked subscriptions`);
			}

			this.connection.close();
			this.endpoint.dispose();
			this.endpoint = this.createEndpoint(this.webview);
			this.endpoint.setVisible(this._visible);
			this.connection = new Connection(this.endpoint, this.buildConnectionOptions());
			this.connection.expose(this.services);
			this.armAnnouncementTap();

			Logger.debug(`${this.logPrefix}: Client session ${reconnecting ? 're-' : ''}announced — services exposed`);
		} finally {
			// Fired after the expose so anything posted by the hook (e.g. lifting the controller's
			// reload-window mute) reaches the wire ahead of buffered traffic.
			this.options?.onClientSession?.();
		}
	}

	/** See {@link _pendingServedSession}. */
	get pendingServedSession(): number | undefined {
		return this._pendingServedSession;
	}

	/**
	 * Clears the pending served session. Called by `WebviewController` on every invalidation
	 * (dispose, html reload, non-retain hide) — without this, a late `connect()` from the
	 * previously served client would still match `pendingServedSession` and could validate against
	 * an already-invalidated controller.
	 */
	invalidatePendingSession(): void {
		this._pendingServedSession = undefined;
	}

	/**
	 * Update visibility state for the endpoint's message buffer.
	 * When hidden, outgoing messages are buffered instead of being sent
	 * (VS Code silently drops postMessage while hidden). On visibility
	 * restore, buffered messages are flushed with dedup.
	 */
	setVisible(visible: boolean): void {
		this._visible = visible;
		this.endpoint.setVisible(visible);
	}

	dispose(): void {
		this._disposed = true;
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
			new GlAbortSignalHandler(),
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
