/**
 * Per-session handshake for a webview app's long-lived RPC connection.
 *
 * The `Connection` outlives element remounts (see `createRpcClient`); each mount
 * re-arms it, announces the session to the host (which exposes in response), and
 * waits for the host's ready signal. Kept free of DOM references so the
 * Node-hosted unit tests can drive it directly.
 */
import type { Connection, Remote } from '@eamodio/supertalk';
import { ConnectionClosedError } from '@eamodio/supertalk';
import { Logger } from '@gitlens/utils/logger.js';
import { isAbortError } from '../actions/rpc.js';
import { cacheRemoteServices } from './cachedRemote.js';

/** Fixed (not timeout-relative) warn markers: at 20s suspect extension-host slowness, at 40s a stuck peer. */
const firstWarnMs = 20_000;
const secondWarnMs = 40_000;

export interface RpcSessionOptions {
	/** Prefix for this session's log lines, e.g. `RpcClient(gitlens.views.commitDetails)`. */
	logPrefix: string;

	/**
	 * Connection timeout in milliseconds. If the host doesn't respond within this time,
	 * the session fails.
	 * @default 60000 (60 seconds — allows for slow cold starts; warnings fire at 20s and 40s)
	 */
	timeout?: number;

	/**
	 * Aborts the pending handshake when the element unmounts or reconnects.
	 * If already aborted, the session fails without touching the connection.
	 */
	signal?: AbortSignal;
}

/**
 * Re-arms `connection`, announces the session to the host, and waits for the host's handshake,
 * resolving this session's services proxy.
 *
 * Always resets before waiting: `waitForReady()` overwrites the connection's single handshake slot,
 * so an aborted prior attempt's promise would otherwise never settle. Reset also cycles the handlers
 * (disconnect + connect), which is what gives `SignalHandler` and `SequencedChannel` a clean session.
 */
export async function connectRpcSession<TServices extends object>(
	connection: Connection,
	options: RpcSessionOptions,
): Promise<Remote<TServices>> {
	const { logPrefix, signal } = options;
	const timeoutMs = options.timeout ?? 60_000;

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
			signal?.removeEventListener('abort', abortListener);
			abortListener = undefined;
		}
	};

	const getAbortError = () => {
		const reason = signal?.reason;
		return reason instanceof Error ? reason : new Error('RPC connection aborted');
	};

	try {
		if (signal?.aborted) {
			throw getAbortError();
		}

		Logger.debug(`${logPrefix}: Connecting to host...`);

		// Re-arm before every handshake — mandatory, see the doc comment above.
		connection.reset();

		// Register the handshake pending FIRST: `waitForReady()` resets this side's id allocation to
		// odd, so the placeholder root exposed below is registered at local id 1 instead of 0.
		// Supertalk resolves incoming proxy wires against the LOCAL registry before creating remote
		// proxies — with expose-first our placeholder (like the host's real root) would sit at id 0,
		// and the host's handshake wire (also id 0) would resolve to it locally, handing this session
		// its own empty object instead of the host's services. Waiting first keeps the two sides'
		// registries disjoint (client: odd ids incl. its root; host: even ids) and preserves the
		// call-id parity that has always separated them.
		const ready = connection.waitForReady();

		// Announce this session to the host — the RPC-native successor of the legacy
		// `WebviewReadyRequest` postMessage. The host watches for this announcement frame
		// and exposes its services in response, so its ready signal can never be sent
		// before we're listening. The empty root is a placeholder; all real services flow
		// host → webview via the handshake above.
		connection.expose({});

		// Wait for the host's expose() (triggered by our announcement above) and its ready
		// signal. The Connection listener is already set up, so we just wait for it to arrive.
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
			ready,
			new Promise<never>(
				(_resolve, reject) =>
					(timeoutTimer = setTimeout(
						() => reject(new Error(`RPC connection timed out after ${timeoutMs}ms`)),
						timeoutMs,
					)),
			),
			...(signal != null
				? [
						new Promise<never>((_resolve, reject) => {
							abortListener = () => reject(getAbortError());
							signal.addEventListener('abort', abortListener, { once: true });
						}),
					]
				: []),
		])) as Remote<TServices>;
		clearSetup();
		Logger.debug(`${logPrefix}: Connected to host successfully`);

		// Wrap so each non-method property's thenable resolves at most once per session — see the
		// comment on `cacheRemoteServices` for the supertalk-side rationale. Every webview app reaches
		// its services through this function (via `RpcController`), so this is the single choke point
		// that makes `await services.X` safe in repeated callbacks for our stable-handle service bags.
		// Producers must expose only methods and stable sub-service handles (a property whose value
		// never changes for a given session); dynamic-value getters that allocate a different object
		// per access would break under memoization and are not safe here. A fresh cache per session
		// keeps the previous session's dead proxies from leaking into this one.
		return cacheRemoteServices(services);
	} catch (ex) {
		clearSetup();
		if (ex instanceof ConnectionClosedError) {
			Logger.debug(`${logPrefix}: connect dropped by deliberate connection teardown`);
		} else if (isAbortError(ex)) {
			// A tagged abort from the controller's own lifecycle (unmount, superseding reconnect) —
			// normal teardown, not a connection failure.
			Logger.debug(`${logPrefix}: connect aborted (${ex.message})`);
		} else {
			Logger.error(ex, `${logPrefix}: Failed to connect to host`);
		}
		throw ex;
	}
}
