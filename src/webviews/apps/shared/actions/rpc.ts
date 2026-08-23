/**
 * Shared utilities for fire-and-forget RPC calls, optimistic updates,
 * and error handling in webview action modules.
 *
 * These utilities standardize common patterns:
 * - `noop`: Logs rejected promises at warn level (used as second arg to `.then(onFulfilled, noop)`)
 * - `fireAndForget`: Logs errors but does not set state.error
 * - `fireRpc`: Logs errors AND sets state.error for UI feedback
 * - `optimisticFireAndForget` / `optimisticBatchFireAndForget`: Optimistic signal updates with rollback
 * - `entry`: Type-safe factory for OptimisticEntry
 */
import { ConnectionClosedError, notify } from '@eamodio/supertalk';
import type { Notify } from '@eamodio/supertalk';
import type { Signal } from '@lit-labs/signals';
import { Logger } from '@gitlens/utils/logger.js';
import type { Resource } from '../state/resource.js';

/**
 * True for a Supertalk `ConnectionClosedError` — an in-flight call or promise rejected because
 * the connection was torn down deliberately (`close()`/`reset()`, e.g. a hard refresh), not by a
 * real failure. Use to keep expected teardown noise out of the error log.
 */
export function isConnectionClosedError(ex: unknown): ex is ConnectionClosedError {
	return ex instanceof ConnectionClosedError;
}

/**
 * Lightweight rejection handler for `.then(onFulfilled, noop)` patterns.
 * Logs the error at trace level so it's not silently swallowed, but does
 * NOT set the shared error signal (use `fireRpc` for that).
 */
export const noop = (ex?: unknown): void => {
	if (ex == null || isConnectionClosedError(ex)) return;

	const msg = ex instanceof Error ? ex.message : 'unknown error';
	Logger.warn(`RPC call rejected (noop handler): ${msg}`);
};

/**
 * True for AbortError-shaped rejections — covers both DOMException-based aborts and
 * Supertalk-deserialized errors (which preserve `name` but not the DOMException class
 * across the wire). Use to suppress expected cancellation rejections without hiding
 * real failures.
 */
export function isAbortError(ex: unknown): boolean {
	return ex instanceof Error && ex.name === 'AbortError';
}

/**
 * Like {@link noop}, but silent on cancellation/abort rejections (which are expected
 * when an in-flight enrichment is aborted by `signal?.throwIfAborted()` host-side).
 * Real errors still log at warn level.
 *
 * Use as the rejection arg of `.then(onFulfilled, noopUnlessReal)` for any RPC call
 * that accepts an AbortSignal — otherwise expected cancellations spam the log.
 */
export const noopUnlessReal = (ex?: unknown): void => {
	if (ex == null || isAbortError(ex) || isConnectionClosedError(ex)) return;

	const msg = ex instanceof Error ? ex.message : 'unknown error';
	Logger.warn(`RPC call rejected (noopUnlessReal handler): ${msg}`);
};

/**
 * Per-signal version counter for optimistic rollback safety.
 * Prevents stale rollbacks when multiple optimistic updates overlap on the same signal.
 */
const signalVersions = new WeakMap<Signal.State<unknown>, number>();
function bumpSignalVersion(signal: Signal.State<unknown>): number {
	const next = (signalVersions.get(signal) ?? 0) + 1;
	signalVersions.set(signal, next);
	return next;
}

/** Entry for a single signal optimistic update. */
export interface OptimisticEntry<T = unknown> {
	signal: Signal.State<T>;
	value: T;
}

/**
 * Type-safe helper to create an OptimisticEntry (avoids manual generic annotations).
 */
export function entry<T>(signal: Signal.State<T>, value: T): OptimisticEntry<T> {
	return { signal: signal, value: value };
}

/**
 * Fire-and-forget RPC call with optimistic update and rollback on error.
 * Use this for non-critical updates where the user expects instant feedback.
 *
 * @param signal - The signal to update optimistically
 * @param newValue - The new value to set immediately
 * @param rpcCall - The RPC call promise
 * @param errorContext - Context string for error logging
 */
export function optimisticFireAndForget<T>(
	signal: Signal.State<T>,
	newValue: T,
	rpcCall: Promise<unknown>,
	errorContext?: string,
): void {
	optimisticBatchFireAndForget([entry(signal, newValue)], rpcCall, errorContext);
}

/**
 * Fire-and-forget RPC call with optimistic update of multiple signals and
 * rollback of all on error. Use this when a single RPC call corresponds to
 * updates across more than one signal.
 *
 * @param entries - Array of `{ signal, value }` pairs to update optimistically
 * @param rpcCall - The RPC call promise
 * @param errorContext - Context string for error logging
 * @param errorSignal - If provided, sets this signal on failure for UI feedback
 */
export function optimisticBatchFireAndForget(
	entries: OptimisticEntry[],
	rpcCall: Promise<unknown>,
	errorContext?: string,
	errorSignal?: Signal.State<string | undefined>,
): void {
	// Capture previous values, bump version counters, and apply optimistic updates
	const rollbacks = entries.map(e => {
		const previous = e.signal.get();
		const version = bumpSignalVersion(e.signal);
		e.signal.set(e.value);
		return { signal: e.signal, optimistic: e.value, previous: previous, version: version };
	});

	rpcCall.catch((ex: unknown) => {
		// Rollback only signals whose version still matches and whose current value
		// is still the optimistic write we applied.
		for (const r of rollbacks) {
			if (signalVersions.get(r.signal) === r.version && r.signal.get() === r.optimistic) {
				r.signal.set(r.previous);
			}
		}
		if (isConnectionClosedError(ex)) {
			Logger.debug(
				`RPC call dropped by deliberate connection teardown${errorContext ? ` (${errorContext})` : ''}, rolled back`,
			);
		} else {
			Logger.error(ex, `RPC call failed${errorContext ? ` (${errorContext})` : ''}, rolled back`);
		}
		errorSignal?.set(ex instanceof Error ? ex.message : 'RPC call failed');
	});
}

/**
 * Creates a guarded callback that only fires if the resource's generation ID
 * hasn't changed since the guard was created. Prevents stale enrichment
 * callbacks (autolinks, PRs, signatures) from writing data for a commit/WIP
 * that has since been replaced by a newer fetch.
 *
 * Usage:
 * ```ts
 * void service.getAutolinks(repoPath, sha).then(
 *   enrichmentGuard(resources.commit, r => { state.autolinks.set(r); }),
 *   noop,
 * );
 * ```
 */
export function enrichmentGuard<T>(
	resource: Pick<Resource<unknown>, 'generationId'>,
	onResult: (value: T) => void,
): (value: T) => void {
	const gen = resource.generationId.get();
	return (value: T) => {
		if (gen === resource.generationId.get()) {
			onResult(value);
		}
	};
}

/**
 * Fire-and-forget chip-enrichment helper. Wraps the standard pattern of an enrichment RPC
 * call: generation guard (drops stale callbacks for resources that have moved on), abort
 * guard (drops callbacks once the panel-level enrichment signal aborts), cancellation-aware
 * rejection (suppresses expected `AbortError` rejections silently while still logging real
 * failures via `noopUnlessReal`), and an optional pre-fetch skip predicate (e.g., when
 * autolinks are disabled).
 *
 * Cache writes and state writes stay local to each call site — those are genuinely
 * different per enrichment and the helper deliberately doesn't try to abstract them.
 */
export function guardedEnrich<T>(
	resource: Pick<Resource<unknown>, 'generationId'>,
	signal: AbortSignal,
	fetcher: () => Promise<T>,
	apply: (value: T) => void,
	options?: { skipIf?: () => boolean },
): void {
	if (options?.skipIf?.()) return;

	void fetcher().then(
		enrichmentGuard(resource, value => {
			if (signal.aborted) return;

			apply(value);
		}),
		noopUnlessReal,
	);
}

/**
 * Fire-and-forget RPC call where the backend handles user feedback
 * (opens UI dialogs, shows notifications, etc.).
 * Logs errors but does NOT set state.error.
 */
export function fireAndForget(promise: Promise<unknown>, errorContext?: string): void {
	promise.catch((ex: unknown) => {
		if (isConnectionClosedError(ex)) {
			Logger.debug(
				`RPC call dropped by deliberate connection teardown${errorContext ? ` (${errorContext})` : ''}`,
			);
			return;
		}

		Logger.error(ex, `RPC call failed${errorContext ? ` (${errorContext})` : ''}`);
	});
}

/**
 * RPC call where the webview should know about errors.
 * Sets the provided error signal on failure so the UI can display feedback.
 */
export function fireRpc(
	errorSignal: Signal.State<string | undefined>,
	promise: Promise<unknown>,
	errorContext?: string,
): void {
	promise.catch((ex: unknown) => {
		if (isConnectionClosedError(ex)) {
			Logger.debug(
				`RPC call dropped by deliberate connection teardown${errorContext ? ` (${errorContext})` : ''}`,
			);
		} else {
			Logger.error(ex, `RPC call failed${errorContext ? ` (${errorContext})` : ''}`);
		}
		errorSignal.set(ex instanceof Error ? ex.message : 'RPC call failed');
	});
}

/**
 * Per-session cache of `notify()` wrappers, keyed on the RESOLVED sub-service proxy identity —
 * `notify()` only works on a resolved remote proxy (it throws on the thenable that wraps it), and
 * a reconnect yields a new proxy, which naturally falls out of the `WeakMap` and rebuilds its
 * notifier. Mirrors the memo pattern in graph-wrapper.ts's `_selectionNotifier`, generalized so
 * every one-way call site shares one cache instead of hand-rolling its own.
 */
class NotifierCache {
	private readonly cache = new WeakMap<object, unknown>();

	get<T extends object>(resolvedService: T): Notify<T> {
		let notifier = this.cache.get(resolvedService) as Notify<T> | undefined;
		if (notifier == null) {
			try {
				notifier = notify(resolvedService);
			} catch {
				// Not a remote proxy (an in-process service or a test stub) — invoke directly,
				// discarding the result to keep the one-way shape.
				notifier = new Proxy(resolvedService, {
					get: (target, prop) => {
						const member = (target as Record<PropertyKey, unknown>)[prop];
						if (typeof member !== 'function') return undefined;

						return (...args: unknown[]): void => void member.apply(target, args);
					},
				}) as unknown as Notify<T>;
			}
			this.cache.set(resolvedService, notifier);
		}
		return notifier;
	}
}

const notifierCache = new NotifierCache();

/**
 * One-way fire-and-forget RPC call via supertalk `notify()`. `service` can be an already-resolved
 * sub-service proxy or a promise for one (e.g. a `cacheRemoteServices`-cached property, which costs
 * at most one 'get prop' RPC per session); once resolved, `send` gets its memoized notifier to call
 * through. The notify write itself never rejects — only the resolution can (e.g. a torn-down
 * connection), and that's routed through {@link fireAndForget}'s `isConnectionClosedError`-aware
 * logging, tagged with `errorContext`.
 *
 * Do not use this for a call whose result is read, awaited for sequencing, or that passes an
 * `AbortSignal` — `notify()` never settles, so there's nothing to await and no signal-release hook.
 */
export function notifyService<T extends object>(
	service: T | Promise<T>,
	errorContext: string,
	send: (notifier: Notify<T>) => void,
): void {
	// An already-resolved service (no thenable surface) sends synchronously — matching the direct
	// method call this replaces; only unresolved thenables (e.g. cached root properties) defer.
	if (typeof (service as { then?: unknown }).then !== 'function') {
		try {
			send(notifierCache.get(service as T));
		} catch (ex) {
			if (!isConnectionClosedError(ex)) {
				Logger.error(ex, `RPC notify failed${errorContext ? ` (${errorContext})` : ''}`);
			}
		}
		return;
	}

	fireAndForget(
		Promise.resolve(service).then(resolved => send(notifierCache.get(resolved))),
		errorContext,
	);
}
