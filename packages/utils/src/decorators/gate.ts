/* eslint-disable @typescript-eslint/no-unsafe-return */
import { CancellationError } from '../cancellation.js';
import type { UnifiedDisposable } from '../disposable.js';
import { createDisposable } from '../disposable.js';
import { Logger } from '../logger.js';
import { isPromise } from '../promise.js';
import { resolveProp } from './resolver.js';

export interface GateOptions {
	/** Timeout in milliseconds after which the gate is force-cleared and the promise resolves/rejects */
	timeout?: number;
	/** Whether to reject the promise on timeout (default: true) */
	rejectOnTimeout?: boolean;
	/** Optional callback invoked on deadlock warnings and timeout aborts */
	onDeadlock?: (info: { key: string; prop: string; timeout: number; status: 'warning' | 'aborted' }) => void;
}

// Warning thresholds in seconds for potential deadlock detection
const deadlockWarningThresholds = [90, 180]; // 1.5 min, 3 min

export function gate<T extends (...args: any[]) => any>(
	getGroupingKey?: (...args: Parameters<T>) => string,
	options?: GateOptions,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	let { timeout, rejectOnTimeout = true, onDeadlock } = options ?? {};

	// Use default timeout of 5 minutes if not specified
	timeout ??= 300000;

	return (_target: any, key: string, descriptor: PropertyDescriptor): void => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn == null) throw new Error('Not supported');

		const gateKey = `$gate$${key}`;

		descriptor.value = function (this: any, ...args: any[]) {
			const prop = resolveProp(gateKey, getGroupingKey, ...(args as Parameters<T>));
			if (!Object.hasOwn(this, prop)) {
				Object.defineProperty(this, prop, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			let promise = this[prop];
			if (promise === undefined) {
				const originalPromise = fn.apply(this, args);
				if (originalPromise == null || !isPromise(originalPromise)) {
					return originalPromise;
				}

				if (timeout > 0) {
					// Apply timeout if configured - this prevents indefinite hangs
					const timeoutPromise = new Promise((resolve, reject) => {
						const timeoutId = setTimeout(() => {
							Logger.warn(`[gate] ${key} timeout after ${timeout}ms, forcing gate clear`, `prop=${prop}`);
							onDeadlock?.({ key: key, prop: prop, timeout: timeout, status: 'aborted' });

							// Clear the gate to allow future calls
							this[prop] = undefined;

							if (rejectOnTimeout) {
								reject(new CancellationError(new Error(`Gate timeout: ${key} exceeded ${timeout}ms`)));
							} else {
								// Retry the operation now that the gate is cleared
								const retryResult = fn.apply(this, args);
								if (isPromise(retryResult)) {
									retryResult.then(resolve, reject);
								} else {
									resolve(retryResult);
								}
							}
						}, timeout);

						originalPromise.then(
							(result: any) => {
								clearTimeout(timeoutId);
								resolve(result);
							},
							(error: unknown) => {
								clearTimeout(timeoutId);
								reject(error instanceof Error ? error : new Error(String(error)));
							},
						);
					});
					promise = timeoutPromise;
				} else {
					promise = originalPromise;
				}

				this[prop] = promise;
				const p = promise;
				void p
					.finally(() => {
						if (this[prop] === p) {
							this[prop] = undefined;
						}
					})
					.catch(() => {});

				// Set up deadlock warning timeouts (only for warnings that would fire before the timeout)
				const warningsDisposable = scheduleDeadlockWarnings(key, prop, timeout, onDeadlock);
				void promise.finally(() => warningsDisposable.dispose()).catch(() => {});
			}

			return promise;
		};
	};
}

/**
 * Schedules escalating warning timeouts for potential deadlock detection.
 * Uses chained timers to minimize overhead - only one timer active at a time.
 * Returns a Disposable to cancel any pending timer.
 */
function scheduleDeadlockWarnings(
	key: string,
	prop: string,
	abortTimeoutMs?: number,
	onDeadlock?: GateOptions['onDeadlock'],
): UnifiedDisposable {
	// Filter to only warnings that would fire before the abort timeout
	const thresholds =
		abortTimeoutMs != null
			? deadlockWarningThresholds.filter(t => t * 1000 < abortTimeoutMs)
			: deadlockWarningThresholds;
	if (!thresholds.length) return createDisposable(() => {});

	let currentTimeout: ReturnType<typeof setTimeout> | undefined;
	let thresholdIndex = 0;

	function scheduleNext(delayMs: number): void {
		currentTimeout = setTimeout(() => {
			const thresholdSecs = thresholds[thresholdIndex];
			Logger.warn(
				`[gate] ${key} has been pending for ${thresholdSecs}+ seconds (possible deadlock)`,
				`prop=${prop}`,
			);
			onDeadlock?.({ key: key, prop: prop, timeout: thresholdSecs * 1000, status: 'warning' });

			// Schedule next warning if there are more thresholds
			thresholdIndex++;
			if (thresholdIndex < thresholds.length) {
				const nextDelayMs = (thresholds[thresholdIndex] - thresholdSecs) * 1000;
				scheduleNext(nextDelayMs);
			}
		}, delayMs);
	}

	// Start with the first threshold
	scheduleNext(thresholds[0] * 1000);

	return createDisposable(() => {
		if (currentTimeout != null) {
			clearTimeout(currentTimeout);
			currentTimeout = undefined;
		}
	});
}
