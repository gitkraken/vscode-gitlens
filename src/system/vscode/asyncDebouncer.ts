import type { CancellationToken, Disposable } from 'vscode';
import { CancellationTokenSource } from 'vscode';
import { CancellationError } from '../../errors';
import type { Deferrable } from '../function';
import type { Deferred } from '../promise';
import { defer } from '../promise';

export interface AsyncTask<T> {
	(cancelationToken: CancellationToken): T | Promise<T>;
}

export function createAsyncDebouncer<T>(delay: number): Disposable & Deferrable<(task: AsyncTask<T>) => Promise<T>> {
	let lastTask: AsyncTask<T> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let curDeferred: Deferred<T> | undefined;
	let curCancellation: CancellationTokenSource | undefined;
	//let lastResult: Promise<T>;

	/**
	 * cancesl the timer without cancelling the promise
	 */
	function cancelCurrentExecution(): void {
		if (timer != null) {
			clearTimeout(timer);
			timer = undefined;
		}
		if (curCancellation != null) {
			curCancellation.cancel();
			curCancellation = undefined;
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
		curCancellation?.dispose();
		curCancellation = undefined;
		cancel();
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
		timer = undefined;
		if (curDeferred == null || lastTask == null) {
			return;
		}
		if (curCancellation != null) {
			curCancellation.cancel();
		}

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
	debounce.flush = flush;
	debounce.pending = pending;
	return debounce;
}
