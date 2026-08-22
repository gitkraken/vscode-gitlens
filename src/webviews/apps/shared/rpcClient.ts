/**
 * RPC client helper for webview apps.
 *
 * Owns the long-lived pieces of a webview's RPC link — the endpoint, the handlers, and the
 * supertalk `Connection` — and hands out one session per mount.
 *
 * The `Connection` is created ONCE and survives element remounts. Each mount re-arms it
 * (`reset()`) and waits for the host to call `expose()`, which the host does when it receives
 * `WebviewReadyRequest` — the unified readiness signal for all webviews. Reusing the instance is
 * what makes supertalk's `subscribe()` resubscription work: it fans out on `_onReady` per
 * successful handshake on the SAME connection, so a connection thrown away per mount would never
 * resubscribe.
 */
import type { Handler, Options, Remote } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { SignalHandler } from '@eamodio/supertalk-signals';
import type { WebviewIds } from '../../../constants.views.js';
import { GlAbortSignalHandler } from '../../../system/rpc/abortSignalHandler.js';
import { rpcHandlers } from '../../../system/rpc/handlers.js';
import { createSupertalkLogger, formatWebviewLogTag } from '../../../system/rpc/logger.js';
import { getHost } from './host/context.js';
import { connectRpcSession } from './rpc/session.js';
import type { DisposableEndpoint } from './webviewEndpoint.js';

export interface RpcClientOptions {
	/**
	 * Webview identifier used to tag log lines produced by this RPC channel.
	 * Example: `gitlens.views.home`. Falls back to `?` when not provided.
	 *
	 * Accepts a function to defer resolution for cases where the id isn't known
	 * at `RpcController` construction time (e.g. Timeline serves both panel and
	 * view modes and resolves its id during `connectedCallback`).
	 */
	webviewId?: WebviewIds | (() => WebviewIds | undefined);

	/**
	 * Webview instance identifier appended to the log tag, matching the existing
	 * `WebviewController(id|instance)` convention. Same thunk support as {@link webviewId}.
	 */
	webviewInstanceId?: string | (() => string | undefined);

	/**
	 * Additional handlers beyond the default rpcHandlers.
	 * The default handlers (Date, Map, Set, RegExp) and SignalHandler are always included.
	 *
	 * Handlers are constructed once per client, not per session — pass instances the app owns for
	 * its whole lifetime (e.g. the Graph's rows `SequencedChannel`).
	 */
	handlers?: Handler[];

	/**
	 * Optional endpoint factory. Defaults to `getHost().createEndpoint()`.
	 * Allows callers to inject a custom endpoint (e.g., for testing or non-VS Code hosts).
	 */
	endpoint?: () => DisposableEndpoint;

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
	 * When true, signals are watched immediately when received, updates always flow.
	 * When false (default), signals are only watched when receiver observes reactively.
	 * @default false
	 */
	autoWatchSignals?: boolean;

	/**
	 * Connection timeout in milliseconds.
	 * If the host doesn't respond within this time, the connection attempt fails.
	 * @default 60000 (60 seconds — allows for slow cold starts; warnings fire at 20s and 40s)
	 */
	timeout?: number;
}

/**
 * A webview app's RPC link. The connection and its handlers live for the client's lifetime;
 * {@link RpcClient.connect} starts one session per mount.
 */
export interface RpcClient<TServices extends object> {
	/**
	 * The supertalk connection, stable across element remounts. Use it as the anchor for
	 * `subscribe()` — pass this, never the services proxy, which is wrapped for property caching
	 * and so fails supertalk's root-proxy check.
	 */
	readonly connection: Connection;

	/** Re-arms the connection and waits for the host handshake, resolving this session's services. */
	connect(signal?: AbortSignal): Promise<Remote<TServices>>;

	/**
	 * Ends the current session: settles in-flight calls with `ConnectionClosedError('reset')` and
	 * re-arms the connection. The connection keeps listening, so the next {@link connect} resumes
	 * on the same instance.
	 */
	stop(): void;

	/** Closes the connection and disposes the endpoint. Final teardown only — see `RpcController.dispose`. */
	dispose(): void;
}

/**
 * Creates a webview app's RPC client: one endpoint, one handler set, one `Connection`.
 *
 * Usage in a webview app (normally via `RpcController`, which drives the lifecycle):
 * ```typescript
 * const client = createRpcClient<IServices>();
 * const services = await client.connect();
 * const result = await services.echo('hello');
 * ```
 */
export function createRpcClient<TServices extends object>(options?: RpcClientOptions): RpcClient<TServices> {
	const resolveTag = (): string => {
		const webviewId = typeof options?.webviewId === 'function' ? options.webviewId() : options?.webviewId;
		const webviewInstanceId =
			typeof options?.webviewInstanceId === 'function' ? options.webviewInstanceId() : options?.webviewInstanceId;
		return formatWebviewLogTag(webviewId, webviewInstanceId);
	};

	// One endpoint for the connection's lifetime. `createWebviewEndpoint` is a stateless adapter over
	// the iframe's `window` and the persistent `acquireVsCodeApi()` handle, both of which outlive any
	// element, so it needs no per-session replacement. Disposing it per session would also strip the
	// Connection's own message listener, which `reset()` re-adds only when the connection was closed.
	const endpoint = options?.endpoint?.() ?? getHost().createEndpoint();

	// Create SignalHandler for reactive state synchronization
	const signalHandler = new SignalHandler({ autoWatch: options?.autoWatchSignals });

	// Merge default handlers with SignalHandler, AbortSignalHandler, and any additional handlers
	const handlers: Handler[] = [
		...rpcHandlers,
		signalHandler,
		new GlAbortSignalHandler(),
		...(options?.handlers ?? []),
	];

	const connectionOptions: Options = {
		handlers: handlers,
		// Required: GetOverviewBranch has six Promise<> lazy fields that rely
		// on Supertalk's nested Promise proxying, and the JSON transport
		// (encodeRpcPayload) requires DateHandler traversal for nested Dates.
		nestedProxies: options?.nestedProxies ?? true,
		debug: options?.debug,
		// Coalesce synchronous calls into a single postMessage
		batching: true,
		// Resolved per line, not per connection — Timeline learns its webview id after the first mount.
		logger: createSupertalkLogger(() => `client(${resolveTag()})`),
	};

	// Create Connection (sets up message listener FIRST)
	const connection = new Connection(endpoint, connectionOptions);

	return {
		connection: connection,
		connect: (signal?: AbortSignal): Promise<Remote<TServices>> =>
			connectRpcSession<TServices>(connection, {
				logPrefix: `RpcClient(${resolveTag()})`,
				timeout: options?.timeout,
				signal: signal,
			}),
		stop: (): void => connection.reset(),
		dispose: (): void => {
			connection.close();
			endpoint.dispose();
		},
	};
}
