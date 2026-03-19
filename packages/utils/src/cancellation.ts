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
	private readonly cleanups = new Map<AbortSignal, () => void>();

	/** The aggregate signal — only fires when all callers have cancelled. */
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	/**
	 * Register a caller.
	 * - If `cancellation` is provided, the caller is auto-removed when it fires.
	 * - If `cancellation` is `undefined`, the caller is "permanent" — the aggregate
	 *   can never fire while it's active. Call the returned cleanup on promise settle.
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

		const onAbort = () => {
			this.cleanups.delete(cancellation);
			this.activeCount--;
			this.checkAbort();
		};
		cancellation.addEventListener('abort', onAbort, { once: true });
		this.cleanups.set(cancellation, () => cancellation.removeEventListener('abort', onAbort));

		return () => {
			this.cleanups.get(cancellation)?.();
			this.cleanups.delete(cancellation);
		};
	}

	private checkAbort(): void {
		if (this.activeCount <= 0 && !this.controller.signal.aborted) {
			this.controller.abort();
		}
	}

	/** Remove all abort listeners. Call when the cached promise settles. */
	dispose(): void {
		for (const cleanup of this.cleanups.values()) {
			cleanup();
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
