import type { CancellationToken, Disposable as CodeDisposable } from 'vscode';
import { CancellationTokenSource } from 'vscode';
import { CancellationError } from '../../errors';
import type { Deferrable } from '../function';
import type { Deferred } from '../promise';
import { defer } from '../promise';

export interface AsyncTask<T> {
	(cancelationToken: CancellationToken): T | Promise<T>;
}

/**
 * This is similar to `src/system/function.ts: debounce` but it's for async tasks.
 * The old `debounce` function does not awaits for promises, so it's not suitable for async tasks.
 *
 * This function cannot be part of `src/system/function.ts` because it relies on `CancellationTokenSource` from `vscode`.
 *
 * Here the debouncer returns a promise that awaits task for completion.
 * Also we can let tasks know if they are cancelled by passing a cancellation token.
 *
 * Despite being able to accept synchronous tasks, we always return a promise here. It's implemeted this way for simplicity.
 */
export function createAsyncDebouncer<T>(
	delay: number,
): Disposable & CodeDisposable & Deferrable<(task: AsyncTask<T>) => Promise<T>> {
	let lastTask: AsyncTask<T> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let curDeferred: Deferred<T> | undefined;
	let curCancellation: CancellationTokenSource | undefined;

	/**
	 * Cancels the timer and current execution without cancelling the promise
	 */
	function cancelCurrentExecution(): void {
		if (timer != null) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (curCancellation != null && !curCancellation.token.isCancellationRequested) {
			curCancellation.cancel();
		}
	}

	function cancel() {
		cancelCurrentExecution();
		if (curDeferred?.pending) {
			curDeferred.cancel(new CancellationError());
		}
		lastTask = undefined;
	}

	function dispose() {
		cancel();
		curCancellation?.dispose();
		curCancellation = undefined;
	}

	function flush(): Promise<T> | undefined {
		if (lastTask != null) {
			cancelCurrentExecution();
			void invoke();
		}
		if (timer != null) {
			clearTimeout(timer);
		}
		return curDeferred?.promise;
	}

	function pending(): boolean {
		return curDeferred?.pending ?? false;
	}

	async function invoke(): Promise<void> {
		if (curDeferred == null || lastTask == null) {
			return;
		}
		cancelCurrentExecution();

		const task = lastTask;
		const deferred = curDeferred;
		lastTask = undefined;
		const cancellation = (curCancellation = new CancellationTokenSource());

		try {
			const result = await task(cancellation.token);
			if (!cancellation.token.isCancellationRequested) {
				// Default successful line: current task has completed without interruptions by another task
				if (deferred !== curDeferred && deferred.pending) {
					deferred.fulfill(result);
				}
				if (curDeferred.pending) {
					curDeferred.fulfill(result);
				}
			} else {
				throw new CancellationError();
			}
		} catch (e) {
			if (cancellation.token.isCancellationRequested) {
				// The current execution has been cancelled so we don't want to reject the main promise,
				// because that's expected that it can be fullfilled by the next task.
				// (If the whole task is cancelled, the main promise will be rejected in the cancel() method)
				if (curDeferred !== deferred && deferred.pending) {
					// Unlikely we get here, but if the local `deferred` is different from the main one, then we cancel it to not let the clients hang.
					deferred.cancel(e);
				}
			} else {
				// The current execution hasn't been cancelled, so just reject the promise with the error
				if (deferred !== curDeferred && deferred.pending) {
					deferred.cancel(e);
				}
				if (curDeferred?.pending) {
					curDeferred.cancel(e);
				}
			}
		} finally {
			cancellation.dispose();
		}
	}

	function debounce(this: any, task: AsyncTask<T>): Promise<T> {
		lastTask = task;
		cancelCurrentExecution(); // cancelling the timer or current execution without cancelling the promise

		if (!curDeferred?.pending) {
			curDeferred = defer<T>();
		}

		timer = setTimeout(invoke, delay);

		return curDeferred.promise;
	}

	debounce.cancel = cancel;
	debounce.dispose = dispose;
	debounce[Symbol.dispose] = dispose;
	debounce.flush = flush;
	debounce.pending = pending;
	return debounce;
}
