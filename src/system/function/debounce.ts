interface DebounceOptions<F extends (...args: unknown[]) => ReturnType<F>> {
	/**
	 * An optional AbortSignal to cancel the debounced function.
	 */
	signal?: AbortSignal;

	/**
	 * Specifies whether the function should be invoked on the leading edge, trailing edge, or both.
	 * If set to "leading", the function will be invoked at the start of the delay period.
	 * If set to "trailing", the function will be invoked at the end of the delay period.
	 * If set to "both", the function will be invoked at both the start and end of the delay period.
	 * @default "trailing"
	 */
	edges?: 'leading' | 'trailing' | 'both';

	/**
	 * Maximum time to wait before forcing execution, regardless of subsequent calls.
	 * When specified, the function will be called after this amount of time has passed
	 * since the initial call, even if the debounce timeout hasn't finished.
	 */
	maxWait?: number;

	/**
	 * An optional function to aggregate arguments from multiple calls.
	 * When specified, instead of using just the latest arguments, this function will be called
	 * with the previous and current arguments to produce a new set of arguments to pass to the debounced function.
	 */
	aggregator?: (prevArgs: Parameters<F>, nextArgs: Parameters<F>) => Parameters<F>;
}

export interface Deferrable<F extends (...args: any[]) => unknown> {
	(...args: Parameters<F>): ReturnType<F> | undefined;

	/**
	 * Cancels any pending execution of the debounced function.
	 * This method clears the active timer and resets any stored context or arguments.
	 */
	cancel: () => void;

	/**
	 * Immediately invokes the debounced function if there is a pending execution.
	 * This method also cancels the current timer, ensuring that the function executes right away.
	 *
	 * @returns The result of the invoked function, or undefined if there was no pending execution.
	 */
	flush: () => ReturnType<F> | undefined;

	/**
	 * Checks if there's a pending execution of the debounced function.
	 *
	 * @returns {boolean} True if the debounced function has a pending execution, false otherwise.
	 */
	pending: () => boolean;
}

/**
 * Creates a debounced function that delays invoking the provided function until after `wait` milliseconds
 * have elapsed since the last time the debounced function was invoked. The debounced function also has `cancel`,
 * `flush`, and `pending` methods to control its behavior.
 *
 * @template F - The type of function.
 * @param {F} fn - The function to debounce.
 * @param {number} wait - The number of milliseconds to delay.
 * @param {DebounceOptions} options - The options object
 * @param {AbortSignal} options.signal - An optional AbortSignal to cancel the debounced function.
 * @param {Array<'leading' | 'trailing'>} options.edges - When to invoke the debounced function.
 * @param {number} options.maxWait - Maximum time to wait before forcing execution.
 * @param {Function} options.aggregator - Optional function to aggregate arguments from multiple calls.
 * @returns A new debounced function with additional control methods.
 *
 * @example
 * const debouncedFunction = debounce(() => {
 *   console.log('Function executed');
 *   return 'result';
 * }, 1000, { maxWait: 5000 });
 *
 * // Will log 'Function executed' after 1 second if not called again in that time
 * const result = debouncedFunction();
 *
 * // Check if there's a pending execution
 * if (debouncedFunction.pending()) {
 *   console.log('Function execution is pending');
 * }
 *
 * // Will not log anything as the previous call is cancelled
 * debouncedFunction.cancel();
 *
 * // With AbortSignal
 * const controller = new AbortController();
 * const signal = controller.signal;
 * const debouncedWithSignal = debounce(() => {
 *  console.log('Function executed');
 * }, 1000, { signal });
 *
 * debouncedWithSignal();
 *
 * // Will cancel the debounced function call
 * controller.abort();
 *
 * // With argument aggregation
 * const debouncedSum = debounce(
 *   (numbers: number[]) => console.log(`Sum: ${numbers.reduce((a, b) => a + b, 0)}`),
 *   1000,
 *   {
 *     aggregator: (prev: [number[]], next: [number[]]) => {
 *       return [[...prev[0], ...next[0]]];
 *     }
 *   }
 * );
 *
 * debouncedSum([1, 2]);
 * debouncedSum([3, 4]);
 * // After 1 second, will log: "Sum: 10"
 */
export function debounce<F extends (...args: any[]) => ReturnType<F>>(
	fn: F,
	wait: number,
	options?: DebounceOptions<F>,
): Deferrable<F> {
	let lastThis: unknown = undefined;
	let lastArgs: Parameters<F> | undefined;
	let lastCallTime: number | undefined;
	let lastInvokeTime = 0;

	let result: ReturnType<F> | undefined;

	let timer: ReturnType<typeof setTimeout> | undefined;
	let maxTimer: ReturnType<typeof setTimeout> | undefined;

	let edges: DebounceOptions<F>['edges'];
	let maxWait: DebounceOptions<F>['maxWait'];
	let signal: DebounceOptions<F>['signal'];
	let aggregator: DebounceOptions<F>['aggregator'];

	if (options != null) {
		({ edges, maxWait, signal, aggregator } = options);
	}

	edges ??= 'trailing';
	const leading = edges === 'leading' || edges === 'both';
	const trailing = edges === 'trailing' || edges === 'both';

	function invoke(): ReturnType<F> | undefined {
		if (lastArgs != null) {
			lastInvokeTime = Date.now();
			const args = lastArgs;
			const thisArg = lastThis;

			lastThis = undefined;
			lastArgs = undefined;

			result = fn.apply(thisArg, args);
			return result;
		}
		return undefined;
	}

	function shouldInvoke(time: number): boolean {
		const timeSinceLastCall = time - (lastCallTime ?? 0);
		const timeSinceLastInvoke = time - lastInvokeTime;

		// Either this is the first call, activity has stopped and we're at the
		// trailing edge, the system time has gone backwards and we're treating
		// it as the trailing edge, or we've hit the maxWait limit
		return (
			lastCallTime == null ||
			timeSinceLastCall >= wait ||
			timeSinceLastCall < 0 ||
			(maxWait != null && timeSinceLastInvoke >= maxWait)
		);
	}

	function timerExpired() {
		const time = Date.now();

		if (shouldInvoke(time) && trailing) {
			invoke();
		}

		cancel();
	}

	function schedule() {
		cancelTimer();

		const time = Date.now();
		lastCallTime = time;

		// Set up regular debounce timer
		timer = setTimeout(() => {
			timer = undefined;
			timerExpired();
		}, wait);

		// Set up maxWait timer if needed
		if (maxWait != null && !maxTimer) {
			const timeWaiting = maxWait - (time - lastInvokeTime);

			if (timeWaiting > 0) {
				maxTimer = setTimeout(() => {
					maxTimer = undefined;
					if (trailing && lastArgs != null) {
						invoke();
					}
					// Don't call cancel() here - just reset the maxTimer
					lastInvokeTime = Date.now();
				}, timeWaiting);
			} else {
				// If we've already exceeded maxWait, invoke immediately
				if (trailing && lastArgs != null) {
					invoke();
				}
				cancel();
			}
		}
	}

	function cancelTimer() {
		if (timer != null) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	function cancelMaxTimer() {
		if (maxTimer != null) {
			clearTimeout(maxTimer);
			maxTimer = undefined;
		}
	}

	function cancel() {
		cancelTimer();
		cancelMaxTimer();

		lastThis = undefined;
		lastArgs = undefined;
		lastCallTime = undefined;
		lastInvokeTime = 0;
	}

	function flush(): ReturnType<F> | undefined {
		cancelTimer();
		cancelMaxTimer();
		return invoke();
	}

	function pending(): boolean {
		return timer != null || maxTimer != null;
	}

	function debounced(this: any, ...args: Parameters<F>): ReturnType<F> | undefined {
		if (signal?.aborted) return undefined;

		const time = Date.now();

		// Handle argument aggregation if provided
		if (aggregator != null && lastArgs != null) {
			lastArgs = aggregator(lastArgs, args);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-this-alias
			lastThis = this;
			lastArgs = args;
		}

		const isFirstCall = timer == null && maxTimer == null;

		lastCallTime = time;
		schedule();

		if (leading && isFirstCall) {
			return invoke();
		}

		return result;
	}

	debounced.cancel = cancel;
	debounced.flush = flush;
	debounced.pending = pending;

	signal?.addEventListener('abort', cancel, { once: true });

	return debounced;
}
