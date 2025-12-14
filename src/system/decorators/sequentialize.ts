import { defaultResolver } from '@env/resolver';

interface SequentializeState {
	promise: Promise<any>;
	waiting?: {
		key: string;
		promise: Promise<any>;
	};
}

interface SequentializeOptions<T extends (...arg: any) => any> {
	/**
	 * Optional function to resolve arguments into a deduplication key.
	 * Consecutive duplicate calls (same deduplication key) that haven't started yet are deduplicated and share the same result.
	 * If omitted, uses the default resolver which deduplicates based on argument values.
	 */
	getDedupingKey?: (...args: Parameters<T>) => string;

	/**
	 * Optional function to resolve arguments into a queue key.
	 * Calls with the same queue key execute sequentially in that queue.
	 * Calls with different queue keys execute in parallel (different queues).
	 * If omitted, all calls share a single queue.
	 */
	getQueueKey?: (...args: Parameters<T>) => string;
}

/**
 * Method decorator that ensures all calls to the decorated async method are executed sequentially.
 * If the method is called multiple times before a previous invocation completes, subsequent calls are queued and executed one after another.
 *
 * Consecutive duplicate calls (same arguments) that haven't started yet are deduplicated and share the same result.
 *
 * @param options Optional options object:
 *   - getQueueKey: Groups calls into parallel queues
 *   - getDedupingKey: Deduplicates consecutive calls within each queue
 *   - If omitted: Uses default resolver for deduplication, single queue for all calls
 */
export function sequentialize<T extends (...arg: any) => any>(
	options?: SequentializeOptions<T>,
): (target: any, key: string, descriptor: PropertyDescriptor) => void {
	const getQueueKey = options?.getQueueKey;
	const getDedupingKey = options?.getDedupingKey;

	return (_target: any, key: string, descriptor: PropertyDescriptor) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn === undefined) throw new Error('Not supported');

		const serializeKey = `$sequentialize$${key}`;

		descriptor.value = function (this: any, ...args: any[]) {
			// Compute queue key (if getQueueKey provided, otherwise use default queue)
			const queueKey = getQueueKey?.(...(args as Parameters<T>)) ?? '';
			const prop = queueKey ? `${serializeKey}$${queueKey}` : serializeKey;

			if (!Object.prototype.hasOwnProperty.call(this, prop)) {
				Object.defineProperty(this, prop, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			const state: SequentializeState | undefined = this[prop];
			// eslint-disable-next-line no-return-await, @typescript-eslint/no-unsafe-return
			const run = async () => await fn.apply(this, args);

			// Compute the dedupe key once
			const dedupeKey = getDedupingKey?.(...(args as Parameters<T>)) ?? defaultResolver(...(args as any));

			// If there's a waiting call, check if we can deduplicate with it and return the same promise as the waiting call
			if (state?.waiting?.key === dedupeKey) return state.waiting.promise;

			// Chain this call after the current promise (or start fresh if no state)
			let promise: Promise<any>;
			if (state == null) {
				// No existing state, start fresh and don't set waiting (it starts immediately)
				promise = run();
				this[prop] = { promise: promise };
			} else {
				// Chain after existing promise with a single handler for both success and error
				const clearWaitingAndRun = () => {
					// Clear waiting status when this call starts running
					const s = this[prop];
					if (s?.waiting?.promise === promise) {
						s.waiting = undefined;
					}
					return run();
				};

				promise = state.promise.then(clearWaitingAndRun, clearWaitingAndRun);

				// Update state with this call as the new waiting call
				state.promise = promise;
				state.waiting = { key: dedupeKey, promise: promise };
			}

			// Cleanup when done
			void promise.finally(() => {
				const s = this[prop];
				if (s?.promise === promise && s.waiting == null) {
					this[prop] = undefined;
				}
			});

			return promise;
		};
	};
}
