import { getScopedCounter } from './counter.js';

const cancellationErrorBrand = Symbol.for('CancellationError');

/**
 * A standalone CancellationError for use in the library.
 * Uses a symbol brand so that both this class and the extension's
 * CancellationError (which extends vscode.CancellationError) are
 * recognized by `isCancellationError`.
 */
export class CancellationError extends Error {
	readonly [cancellationErrorBrand] = true;

	constructor(public readonly original?: Error) {
		super();
		this.name = 'CancellationError';

		if (this.original) {
			if (this.original.message.startsWith('Operation cancelled')) {
				this.message = this.original.message;
			} else {
				this.message = `Operation cancelled; ${this.original.message}`;
			}
		} else {
			this.message = 'Operation cancelled';
		}
		Error.captureStackTrace?.(this, new.target);
	}
}

export function isCancellationError(ex: unknown): ex is CancellationError {
	return (
		(ex instanceof Error && (cancellationErrorBrand in ex || ex.name === 'CancellationError')) ||
		(ex instanceof DOMException && ex.name === 'AbortError')
	);
}

/**
 * Races a promise against an `AbortSignal`. If the signal fires before
 * the promise settles, the returned promise rejects with `CancellationError`.
 * If the promise settles first, the signal listener is cleaned up.
 */
export function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(new CancellationError());

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new CancellationError());
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			v => {
				signal.removeEventListener('abort', onAbort);
				resolve(v);
			},
			(e: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(e instanceof Error ? e : new Error(String(e)));
			},
		);
	});
}

/**
 * Races a promise against a timeout. If `ms` elapses before the promise settles, the returned promise
 * rejects with `CancellationError`. If the promise settles first, the timer is cleared. Parallels
 * `raceWithSignal`, with a timer standing in for the signal.
 *
 * When `abortOnTimeout` is provided, it is aborted on timeout — so a caller can link the underlying operation to
 * it (e.g. via `AbortSignal.any`) and have it torn down instead of orphaned. Abort is best-effort (a truly-stuck
 * op may ignore it); the returned promise rejects on timeout regardless of whether the underlying op settles.
 */
export function raceWithTimeout<T>(promise: Promise<T>, ms: number, abortOnTimeout?: AbortController): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			const error = new CancellationError(new Error(`Timed out after ${ms}ms`));
			abortOnTimeout?.abort(error);
			reject(error);
		}, ms);
		// Don't let the timeout timer keep a (Node) process alive on its own — a still-pending promise shouldn't
		// hold the event loop open just for its backstop (no-op in the browser, where setTimeout returns a number).
		if (typeof timer !== 'number') {
			timer.unref();
		}
		promise.then(
			v => {
				clearTimeout(timer);
				resolve(v);
			},
			(e: unknown) => {
				clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			},
		);
	});
}

/**
 * Aggregates multiple caller `AbortSignal`s into a single signal that
 * only fires when **all** callers have cancelled (the inverse of `AbortSignal.any()`).
 *
 * Designed for shared-promise caching: each caller registers their signal,
 * and the underlying operation receives the aggregate signal. Individual callers
 * can cancel early (via `raceWithSignal`), but the operation continues as long
 * as at least one caller is still active.
 */
export class AbortAggregate {
	private readonly controller = new AbortController();
	private activeCount = 0;
	/** One listener-remover per registration (NOT keyed by signal), so adding the same signal twice is safe. */
	private readonly cleanups = new Set<() => void>();

	/** The aggregate signal — only fires when all callers have cancelled. */
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	/**
	 * Register a caller.
	 * - If `cancellation` is provided, the caller is auto-removed when it fires.
	 * - If `cancellation` is `undefined`, the caller is "permanent" — the aggregate
	 *   can never fire while it's active. Call the returned cleanup on promise settle.
	 * - The same signal instance may safely be added more than once — each registration is tracked and cleaned up
	 *   independently, so no listener leaks.
	 * @returns A cleanup function to unregister the caller.
	 */
	add(cancellation?: AbortSignal): () => void {
		this.activeCount++;

		if (cancellation == null) {
			return () => {
				this.activeCount--;
				this.checkAbort();
			};
		}

		if (cancellation.aborted) {
			this.activeCount--;
			this.checkAbort();
			return () => {};
		}

		// Track this registration's listener removal individually (a Set of removers, NOT keyed by the signal) so
		// adding the same signal twice can't overwrite the other's cleanup. `settled` keeps both exit paths (abort
		// vs. manual cleanup) idempotent and preserves the accounting: only `onAbort` decrements `activeCount`.
		let settled = false;
		let remove: () => void;
		const onAbort = () => {
			if (settled) return;

			settled = true;
			this.cleanups.delete(remove);
			this.activeCount--;
			this.checkAbort();
		};
		remove = () => cancellation.removeEventListener('abort', onAbort);
		cancellation.addEventListener('abort', onAbort, { once: true });
		this.cleanups.add(remove);

		return () => {
			if (settled) return;

			settled = true;
			this.cleanups.delete(remove);
			remove();
		};
	}

	private checkAbort(): void {
		if (this.activeCount <= 0 && !this.controller.signal.aborted) {
			this.controller.abort();
		}
	}

	/** Remove all abort listeners. Call when the cached promise settles. */
	dispose(): void {
		for (const remove of this.cleanups) {
			remove();
		}
		this.cleanups.clear();
	}
}

const signalIds = new WeakMap<AbortSignal, number>();
const signalIdCounter = getScopedCounter();

/**
 * Returns a stable, unique numeric ID for the given AbortSignal.
 * Used to differentiate concurrent git commands that have different
 * cancellation signals, so one caller aborting doesn't cancel another.
 */
export function getAbortSignalId(signal: AbortSignal | undefined): string {
	if (signal == null) return '';

	let id = signalIds.get(signal);
	if (id == null) {
		id = signalIdCounter.next();
		signalIds.set(signal, id);
	}
	return String(id);
}
