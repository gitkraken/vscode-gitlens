/**
 * RPC Client helper for webview apps.
 *
 * This module provides a helper to wrap RPC services in webview apps.
 *
 * Creates the Connection (sets up listener) and waits for the host to call
 * expose(). The host calls expose() when it receives WebviewReadyRequest,
 * which is the unified readiness signal for all webviews.
 */
import type { Handler, Options, Remote } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { AbortSignalHandler } from '@eamodio/supertalk-core/handlers/abort-signal.js';
import { SignalHandler } from '@eamodio/supertalk-signals';
import { Logger } from '@gitlens/utils/logger.js';
import type { WebviewIds } from '../../../constants.views.js';
import { rpcHandlers } from '../../../system/rpc/handlers.js';
import { createSupertalkLogger, formatWebviewLogTag } from '../../../system/rpc/logger.js';
import { getHost } from './host/context.js';
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

	/**
	 * Optional abort signal for cancelling connection setup.
	 * If aborted before the handshake completes, the connection is cleaned up immediately.
	 */
	signal?: AbortSignal;
}

/**
 * Result of wrapping RPC services.
 * Includes both the services proxy and a dispose function for cleanup.
 */
export interface RpcConnection<TServices extends object> {
	/**
	 * Proxy for calling the exposed services.
	 */
	services: Remote<TServices>;

	/**
	 * Disposes the RPC connection, removing all event listeners.
	 * Call this when the component unmounts to prevent memory leaks.
	 */
	dispose: () => void;
}

/**
 * Wraps the RPC services exposed by the extension host.
 *
 * This function creates a connection to the host and returns a proxy
 * for calling the exposed services, along with a dispose function.
 *
 * Usage in a webview app:
 * ```typescript
 * interface IServices {
 *   echo(msg: string): string;
 *   add(a: number, b: number): number;
 * }
 *
 * // In your app initialization:
 * const { services, dispose } = await wrapServices<IServices>();
 *
 * // Use the services:
 * const result = await services.echo('hello');
 * const sum = await services.add(1, 2);
 *
 * // In disconnectedCallback or cleanup:
 * dispose();
 * ```
 *
 * @returns A promise that resolves to an RpcConnection with services and dispose
 */
export async function wrapServices<TServices extends object>(
	options?: RpcClientOptions,
): Promise<RpcConnection<TServices>> {
	const webviewId = typeof options?.webviewId === 'function' ? options.webviewId() : options?.webviewId;
	const webviewInstanceId =
		typeof options?.webviewInstanceId === 'function' ? options.webviewInstanceId() : options?.webviewInstanceId;
	const webviewTag = formatWebviewLogTag(webviewId, webviewInstanceId);
	const logPrefix = `RpcClient(${webviewTag})`;

	const endpoint = options?.endpoint?.() ?? getHost().createEndpoint();

	// Create SignalHandler for reactive state synchronization
	const signalHandler = new SignalHandler({ autoWatch: options?.autoWatchSignals });

	// Merge default handlers with SignalHandler, AbortSignalHandler, and any additional handlers
	const handlers: Handler[] = [...rpcHandlers, signalHandler, new AbortSignalHandler(), ...(options?.handlers ?? [])];

	const connectionOptions: Options = {
		handlers: handlers,
		// Required: GetOverviewBranch has six Promise<> lazy fields that rely
		// on Supertalk's nested Promise proxying, and the JSON transport
		// (encodeRpcPayload) requires DateHandler traversal for nested Dates.
		nestedProxies: options?.nestedProxies ?? true,
		debug: options?.debug,
		// Coalesce synchronous calls into a single postMessage
		batching: true,
		logger: createSupertalkLogger(`client(${webviewTag})`),
	};

	// Create Connection (sets up message listener FIRST)
	const connection = new Connection(endpoint, connectionOptions);

	const timeoutMs = options?.timeout ?? 60_000;
	// Fixed (not timeout-relative) warn markers. At 20s we suspect extension-host
	// slowness; at 40s we suspect a stuck peer. Only scheduled if timeout is long
	// enough that they fire strictly before the timeout would.
	const firstWarnMs = 20_000;
	const secondWarnMs = 40_000;
	const warnTimers: Array<ReturnType<typeof setTimeout>> = [];
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
	let abortListener: (() => void) | undefined;

	const clearSetup = () => {
		for (const t of warnTimers) {
			clearTimeout(t);
		}
		warnTimers.length = 0;
		if (timeoutTimer != null) {
			clearTimeout(timeoutTimer);
			timeoutTimer = undefined;
		}
		if (abortListener != null) {
			options?.signal?.removeEventListener('abort', abortListener);
			abortListener = undefined;
		}
	};

	const disposeConnection = () => {
		clearSetup();
		connection.close();
		endpoint.dispose();
	};

	const getAbortError = () => {
		const reason = options?.signal?.reason;
		return reason instanceof Error ? reason : new Error('RPC connection aborted');
	};

	try {
		if (options?.signal?.aborted) {
			throw getAbortError();
		}

		Logger.debug(`${logPrefix}: Connecting to host...`);

		// Wait for the host to call expose() (triggered by WebviewReadyRequest)
		// and send the ready signal. The Connection listener is already set up,
		// so we just wait for the signal to arrive.
		if (firstWarnMs < timeoutMs) {
			warnTimers.push(
				setTimeout(
					() => Logger.warn(`${logPrefix}: Connection still pending after ${firstWarnMs}ms`),
					firstWarnMs,
				),
			);
		}
		if (secondWarnMs < timeoutMs) {
			warnTimers.push(
				setTimeout(
					() =>
						Logger.warn(
							`${logPrefix}: Connection still pending after ${secondWarnMs}ms — peer may be stuck`,
						),
					secondWarnMs,
				),
			);
		}
		const services = (await Promise.race([
			connection.waitForReady(),
			new Promise<never>(
				(_resolve, reject) =>
					(timeoutTimer = setTimeout(
						() => reject(new Error(`RPC connection timed out after ${timeoutMs}ms`)),
						timeoutMs,
					)),
			),
			...(options?.signal != null
				? [
						new Promise<never>((_resolve, reject) => {
							abortListener = () => reject(getAbortError());
							options.signal!.addEventListener('abort', abortListener, { once: true });
						}),
					]
				: []),
		])) as Remote<TServices>;
		clearSetup();
		Logger.debug(`${logPrefix}: Connected to host successfully`);
		return {
			services: services,
			dispose: () => {
				Logger.debug(`${logPrefix}: Disposing connection...`);
				disposeConnection();
			},
		};
	} catch (ex) {
		disposeConnection();
		Logger.error(ex, `${logPrefix}: Failed to connect to host`);
		throw ex;
	}
}
