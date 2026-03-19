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
import type { Signal } from '@lit-labs/signals';
import { Logger } from '@gitlens/utils/logger.js';
import type { Resource } from '../state/resource.js';

/**
 * Lightweight rejection handler for `.then(onFulfilled, noop)` patterns.
 * Logs the error at trace level so it's not silently swallowed, but does
 * NOT set the shared error signal (use `fireRpc` for that).
 */
export const noop = (ex?: unknown): void => {
	if (ex != null) {
		const msg = ex instanceof Error ? ex.message : 'unknown error';
		Logger.warn(`RPC call rejected (noop handler): ${msg}`);
	}
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
		Logger.error(ex, `RPC call failed${errorContext ? ` (${errorContext})` : ''}, rolled back`);
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
 * Fire-and-forget RPC call where the backend handles user feedback
 * (opens UI dialogs, shows notifications, etc.).
 * Logs errors but does NOT set state.error.
 */
export function fireAndForget(promise: Promise<unknown>, errorContext?: string): void {
	promise.catch((ex: unknown) => {
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
		Logger.error(ex, `RPC call failed${errorContext ? ` (${errorContext})` : ''}`);
		errorSignal.set(ex instanceof Error ? ex.message : 'RPC call failed');
	});
}
