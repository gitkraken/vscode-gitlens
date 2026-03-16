/**
 * RPC Client helper for webview apps.
 *
 * This module provides a helper to wrap RPC services in webview apps.
 *
 * Uses a deferred handshake: creates the Connection first (sets up listener),
 * then sends an "rpc/connect" signal to the host to trigger expose().
 * The host's expose() sends the ready signal back, which resolves waitForReady().
 */
import type { Handler, Options, Remote } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { AbortSignalHandler } from '@eamodio/supertalk-core/handlers/abort-signal.js';
import { SignalHandler } from '@eamodio/supertalk-signals';
import { Logger } from '../../../system/logger.js';
import { rpcHandlers } from '../../../system/rpc/handlers.js';
import { supertalkLogger } from '../../../system/rpc/logger.js';
import { RpcConnectCommand } from '../../protocol.js';
import { getHost } from './host/context.js';
import { getHostIpcApi } from './ipc.js';
import type { DisposableEndpoint } from './webviewEndpoint.js';

export interface RpcClientOptions {
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
	 * @default 10000 (10 seconds)
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
		logger: supertalkLogger,
	};

	// Create Connection (sets up message listener FIRST)
	const connection = new Connection(endpoint, connectionOptions);

	const timeoutMs = options?.timeout ?? 10_000;
	let warnTimer: ReturnType<typeof setTimeout> | undefined;
	let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
	let abortListener: (() => void) | undefined;

	const clearSetup = () => {
		if (warnTimer != null) {
			clearTimeout(warnTimer);
			warnTimer = undefined;
		}
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

		Logger.debug('RpcClient: Connecting to host...');

		// Tell the host we're ready: the Connection listener is set up,
		// so the host can now safely call expose() and we'll receive the ready signal.
		// Sent as a standard IpcCommand so the host's onMessageReceivedCore handles it.
		getHostIpcApi().postMessage({
			id: 'rpc-connect',
			scope: RpcConnectCommand.scope,
			method: RpcConnectCommand.method,
			params: undefined,
			compressed: false,
			timestamp: Date.now(),
		});

		// Wait for the host to expose() services and send the ready signal
		warnTimer = setTimeout(
			() => Logger.warn(`RpcClient: Connection still pending after ${timeoutMs / 2}ms`),
			timeoutMs / 2,
		);
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
		Logger.debug('RpcClient: Connected to host successfully');
		return {
			services: services,
			dispose: () => {
				Logger.debug('RpcClient: Disposing connection...');
				disposeConnection();
			},
		};
	} catch (ex) {
		disposeConnection();
		Logger.error(ex, 'RpcClient: Failed to connect to host');
		throw ex;
	}
}
