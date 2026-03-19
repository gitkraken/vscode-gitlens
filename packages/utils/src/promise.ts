import { map } from './iterable.js';
import type { Mutable } from './types.js';

export type PromiseOrValue<T> = Promise<T> | T;

export function any<T>(...promises: Promise<T>[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (promises.length === 0) {
			reject(new AggregateError([], 'All promises were rejected'));
			return;
		}

		let settled = false;
		const onFulfilled = (r: T) => {
			settled = true;
			resolve(r);
		};

		let errors: Error[];
		const onRejected = (ex: unknown) => {
			if (settled) return;

			let error: Error;
			if (ex instanceof Error) {
				error = ex;
			} else {
				debugger;
				error = new Error(String(ex));
			}

			errors ??= [];
			errors.push(error);

			if (promises.length - errors.length < 1) {
				reject(new AggregateError(errors));
			}
		};

		for (const promise of promises) {
			promise.then(onFulfilled, onRejected);
		}
	});
}

export async function* asSettled<T>(promises: Promise<T>[]): AsyncIterable<PromiseSettledResult<T>> {
	const map = new Map(
		promises.map(
			(promise, i) =>
				[
					i,
					promise.then(
						v =>
							({ index: i, value: v, status: 'fulfilled' }) as unknown as PromiseFulfilledResult<T> & {
								index: number;
							},
						(ex: unknown) =>
							({ index: i, reason: ex, status: 'rejected' }) as unknown as PromiseRejectedResult & {
								index: number;
							},
					),
				] as const,
		),
	);

	while (map.size) {
		const result = await Promise.race(map.values());
		map.delete(result.index);
		yield result;
	}
}

export async function batch<T>(items: T[], batchSize: number, task: (item: T) => Promise<void>): Promise<void> {
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		await Promise.allSettled(batch.map(item => task(item)));
	}
}

export async function batchResults<T, R>(
	items: T[],
	batchSize: number,
	task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<Awaited<R>>[]> {
	const results: PromiseSettledResult<Awaited<R>>[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		results.push(...(await Promise.allSettled(batch.map(item => task(item)))));
	}

	return results;
}

export class PromiseCancelledError<T extends Promise<any> = Promise<any>> extends Error {
	constructor(
		public readonly promise: T,
		message: string,
	) {
		super(message);
	}
}

export function cancellable<T>(
	promise: Promise<T>,
	timeout?: number | AbortSignal,
	cancellation?: AbortSignal,
	options?: {
		cancelMessage?: string;
		onDidCancel?(
			resolve: (value: T | PromiseLike<T>) => void,
			reject: (reason?: any) => void,
			reason: 'cancelled' | 'timedout',
		): void;
	},
): Promise<T> {
	if (timeout == null && cancellation == null) return promise;

	return new Promise((resolve, reject) => {
		let fulfilled = false;
		let disposeCancellation: { dispose(): void } | undefined;
		let disposeTimeout: { dispose(): void } | undefined;

		const resolver = (reason: 'cancelled' | 'timedout') => {
			disposeCancellation?.dispose();
			disposeTimeout?.dispose();

			if (fulfilled) return;

			if (options?.onDidCancel != null) {
				options.onDidCancel(resolve, reject, reason);
			} else {
				reject(
					new PromiseCancelledError(
						promise,
						options?.cancelMessage ?? (reason === 'cancelled' ? 'CANCELLED' : 'TIMED OUT'),
					),
				);
			}
		};

		if (cancellation != null) {
			if (cancellation.aborted) {
				resolver('cancelled');
				return;
			}
			const handler = () => resolver('cancelled');
			cancellation.addEventListener('abort', handler);
			disposeCancellation = { dispose: () => cancellation.removeEventListener('abort', handler) };
		}
		if (timeout != null) {
			if (typeof timeout === 'number') {
				const timer = setTimeout(resolver, timeout, 'timedout');
				disposeTimeout = { dispose: () => clearTimeout(timer) };
			} else {
				if (timeout.aborted) {
					resolver('timedout');
					return;
				}
				const handler = () => resolver('timedout');
				timeout.addEventListener('abort', handler);
				disposeTimeout = { dispose: () => timeout.removeEventListener('abort', handler) };
			}
		}

		promise.then(
			() => {
				fulfilled = true;
				disposeCancellation?.dispose();
				disposeTimeout?.dispose();

				resolve(promise);
			},
			(ex: unknown) => {
				fulfilled = true;
				disposeCancellation?.dispose();
				disposeTimeout?.dispose();

				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
				reject(ex);
			},
		);
	});
}

export interface Deferred<T> {
	readonly pending: boolean;
	readonly promise: Promise<T>;
	fulfill: (value: T) => void;
	cancel(e?: Error): void;
}

export function defer<T>(): Deferred<T> {
	const deferred: Mutable<Deferred<T>> = {
		pending: true,
		promise: undefined!,
		fulfill: undefined!,
		cancel: undefined!,
	};
	deferred.promise = new Promise((resolve, reject) => {
		deferred.fulfill = function (value) {
			deferred.pending = false;
			resolve(value);
		};
		deferred.cancel = function (e?: Error) {
			deferred.pending = false;
			if (e != null) {
				reject(e);
			} else {
				reject();
			}
		};
	});
	return deferred;
}

export function getDeferredPromiseIfPending<T>(deferred: Deferred<T> | undefined): Promise<T> | undefined {
	return deferred?.pending ? deferred.promise : undefined;
}

export type MaybePromiseArr<T> = (Promise<T | undefined> | T | undefined)[];

export async function nonnullSettled<T>(arr: MaybePromiseArr<T>): Promise<T[]> {
	// eslint-disable-next-line @typescript-eslint/await-thenable
	const all = await Promise.allSettled(arr);
	return all.map(r => getSettledValue(r)).filter(v => v != null);
}

export async function flatSettled<T>(arr: MaybePromiseArr<(T | undefined)[]>): Promise<T[]> {
	const all = await nonnullSettled(arr);
	return all.flat().filter(v => v != null);
}

export function getSettledValue<T>(promise: PromiseSettledResult<T> | undefined): T | undefined;
export function getSettledValue<T>(
	promise: PromiseSettledResult<T> | undefined,
	defaultValue: NonNullable<T>,
): NonNullable<T>;
export function getSettledValue<T>(
	promise: PromiseSettledResult<T> | undefined,
	defaultValue?: T | undefined,
): T | typeof defaultValue {
	return promise?.status === 'fulfilled' ? promise.value : defaultValue;
}

export function getSettledValues<T extends string | number | boolean | symbol | bigint | object>(
	promises: readonly PromiseSettledResult<T>[],
): T[] {
	return promises.map(getSettledValue).filter((v): v is T => v != null);
}

export function isPromise<T>(obj: PromiseLike<T> | T): obj is Promise<T> {
	return obj != null && (obj instanceof Promise || typeof (obj as PromiseLike<T>)?.then === 'function');
}

type PausedResult<T> = {
	value: Promise<T>;
	paused: true;
	reason: 'cancelled' | 'timedout';
};

export type CompletedResult<T> = {
	value: T;
	paused: false;
};

export type MaybePausedResult<T> = PausedResult<T> | CompletedResult<T>;

export function pauseOnCancelOrTimeout<T>(
	promise: T | Promise<T>,
	cancellation?: undefined,
	timeout?: undefined,
): Promise<CompletedResult<T>>;
export function pauseOnCancelOrTimeout<T>(
	promise: T | Promise<T>,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<T>) => void | Promise<void>,
): Promise<MaybePausedResult<T>>;
export function pauseOnCancelOrTimeout<T>(
	promise: T | Promise<T>,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<T>) => void | Promise<void>,
): Promise<MaybePausedResult<T>> {
	if (!isPromise(promise)) {
		return Promise.resolve({ value: promise, paused: false } satisfies MaybePausedResult<T>);
	}

	if (cancellation == null && timeout == null) {
		return promise.then(value => ({ value: value, paused: false }) satisfies CompletedResult<T>);
	}

	let disposeCancellation: { dispose(): void } | undefined;
	let disposeTimeout: { dispose(): void } | undefined;

	const result = Promise.race([
		promise.then(value => {
			disposeCancellation?.dispose();
			disposeTimeout?.dispose();

			if (cancellation?.aborted) {
				return {
					value: Promise.resolve(value),
					paused: true,
					reason: 'cancelled',
				} satisfies MaybePausedResult<T>;
			}

			return { value: value, paused: false } satisfies MaybePausedResult<T>;
		}),
		new Promise<MaybePausedResult<T>>(resolve => {
			const resolver = (reason: 'cancelled' | 'timedout') => {
				disposeCancellation?.dispose();
				disposeTimeout?.dispose();

				resolve({
					value: promise,
					paused: true,
					reason: reason,
				} satisfies MaybePausedResult<T>);
			};

			if (cancellation != null) {
				if (cancellation.aborted) {
					resolver('cancelled');
				} else {
					const handler = () => resolver('cancelled');
					cancellation.addEventListener('abort', handler);
					disposeCancellation = { dispose: () => cancellation.removeEventListener('abort', handler) };
				}
			}
			if (timeout != null) {
				const signal = typeof timeout === 'number' ? AbortSignal.timeout(timeout) : timeout;

				if (signal.aborted) {
					resolver('timedout');
				} else {
					const handler = () => resolver('timedout');
					signal.addEventListener('abort', handler);
					disposeTimeout = { dispose: () => signal.removeEventListener('abort', handler) };
				}
			}
		}),
	]);

	return continuation == null
		? result
		: result.then(r => {
				if (r.paused) {
					setTimeout(continuation, 0, r);
				}
				return r;
			});
}

export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors: true,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined>>>;
export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors?: boolean,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined | Error>>>;
export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors?: boolean,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined | Error>>> {
	if (source.size === 0) return source as unknown as Map<Id, MaybePausedResult<T | undefined | Error>>;

	// Change the timeout to an AbortSignal if it is a number to avoid creating lots of timers
	if (timeout != null && typeof timeout === 'number') {
		timeout = AbortSignal.timeout(timeout);
	}

	const results = await Promise.all(
		map(source, ([id, promise]) =>
			pauseOnCancelOrTimeout(
				promise.catch((ex: unknown) => (ignoreErrors || !(ex instanceof Error) ? undefined : ex)),
				cancellation,
				timeout,
			).then(result => [id, result] as const),
		),
	);

	if (continuation != null) {
		if (results.some(([, r]) => r.paused)) {
			async function getContinuationValue() {
				const completed = new Map<Id, CompletedResult<T | undefined | Error>>();

				for (const [id, result] of results) {
					completed.set(id, { value: result.paused ? await result.value : result.value, paused: false });
				}

				return completed;
			}

			const cancelled = results.some(([, r]) => r.paused && r.reason === 'cancelled');

			void continuation({
				value: getContinuationValue(),
				paused: true,
				reason: cancelled ? 'cancelled' : 'timedout',
			});
		}
	}

	return new Map<Id, MaybePausedResult<T | undefined | Error>>(results);
}

export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors: true,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined>> | undefined>>;
export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors?: boolean,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined | Error>> | undefined>>;
export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors?: boolean,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined | Error>> | undefined>> {
	// Change the timeout to an AbortSignal if it is a number to avoid creating lots of timers
	if (timeout != null && typeof timeout === 'number') {
		timeout = AbortSignal.timeout(timeout);
	}

	const mapPromise = source.then(m =>
		m == null ? m : pauseOnCancelOrTimeoutMap(m, ignoreErrors, cancellation, timeout, continuation),
	);

	const result = await pauseOnCancelOrTimeout(source, cancellation, timeout);
	return result.paused
		? { value: mapPromise, paused: result.paused, reason: result.reason }
		: { value: await mapPromise, paused: false };
}

export async function pauseOnCancelOrTimeoutMapTuple<Id, T, U extends unknown[]>(
	source: Map<Id, [Promise<T> | undefined, ...U]>,
	cancellation?: undefined,
	timeout?: undefined,
): Promise<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>;
export async function pauseOnCancelOrTimeoutMapTuple<Id, T, U extends unknown[]>(
	source: Map<Id, [Promise<T> | undefined, ...U]>,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]>>;
export async function pauseOnCancelOrTimeoutMapTuple<Id, T, U extends unknown[]>(
	source: Map<Id, [Promise<T> | undefined, ...U]>,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]>> {
	if (source.size === 0) {
		return source as unknown as Map<Id, [CompletedResult<T | undefined> | undefined, ...U]>;
	}

	// Change the timeout to an AbortSignal if it is a number to avoid creating lots of timers
	if (timeout != null && typeof timeout === 'number') {
		timeout = AbortSignal.timeout(timeout);
	}

	const results = await Promise.all(
		// eslint-disable-next-line @typescript-eslint/await-thenable
		map(source, ([id, [promise, ...rest]]) =>
			promise == null
				? ([id, [undefined, ...rest]] as const)
				: pauseOnCancelOrTimeout(
						promise.catch(() => undefined),
						cancellation,
						timeout,
					).then(result => [id, [result as MaybePausedResult<T | undefined> | undefined, ...rest]] as const),
		),
	);

	if (continuation != null) {
		if (results.some(([, [r]]) => r?.paused ?? false)) {
			async function getContinuationValue() {
				const completed = new Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>();

				for (const [id, [r, ...rest]] of results) {
					completed.set(id, [
						{ value: r?.paused ? await r.value : r?.value, paused: false },
						...rest,
					] as const);
				}

				return completed;
			}

			const cancelled = results.some(([, [r]]) => r?.paused && r.reason === 'cancelled');

			void continuation({
				value: getContinuationValue(),
				paused: true,
				reason: cancelled ? 'cancelled' : 'timedout',
			});
		}
	}

	return new Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]>(results);
}

export async function pauseOnCancelOrTimeoutMapTuplePromise<Id, T, U extends unknown[]>(
	source: Promise<Map<Id, [Promise<T> | undefined, ...U]> | undefined>,
	cancellation?: undefined,
	timeout?: undefined,
): Promise<CompletedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]> | undefined>>;
export async function pauseOnCancelOrTimeoutMapTuplePromise<Id, T, U extends unknown[]>(
	source: Promise<Map<Id, [Promise<T> | undefined, ...U]> | undefined>,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]> | undefined>>;
export async function pauseOnCancelOrTimeoutMapTuplePromise<Id, T, U extends unknown[]>(
	source: Promise<Map<Id, [Promise<T> | undefined, ...U]> | undefined>,
	cancellation?: AbortSignal,
	timeout?: number | AbortSignal,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]> | undefined>> {
	// Change the timeout to an AbortSignal if it is a number to avoid creating lots of timers
	if (timeout != null && typeof timeout === 'number') {
		timeout = AbortSignal.timeout(timeout);
	}

	const mapPromise = source.then(m =>
		m == null ? m : pauseOnCancelOrTimeoutMapTuple(m, cancellation, timeout, continuation),
	);

	const result = await pauseOnCancelOrTimeout(source, cancellation, timeout);
	return result.paused
		? { value: mapPromise, paused: result.paused, reason: result.reason }
		: { value: await mapPromise, paused: false };
}

export type TimedResult<T> = { readonly value: T; readonly duration: number };
export async function timed<T>(promise: Promise<T>): Promise<TimedResult<T>> {
	const start = Date.now();
	const value = await promise;
	return { value: value, duration: Date.now() - start };
}

export async function timedWithSlowThreshold<T>(
	promise: Promise<T>,
	slowThreshold: { timeout: number; onSlow: (duration: number) => void },
): Promise<TimedResult<T>> {
	const start = Date.now();

	const result = await pauseOnCancelOrTimeout(promise, undefined, slowThreshold.timeout);

	const value = result.paused
		? await result.value.finally(() => slowThreshold.onSlow(Date.now() - start))
		: result.value;

	return { value: value, duration: Date.now() - start };
}

export function wait(ms: number): Promise<void> {
	return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export function waitUntilNextTick(): Promise<void> {
	return new Promise<void>(resolve => queueMicrotask(resolve));
}
