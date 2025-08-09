import type { CancellationToken, Disposable } from 'vscode';
import { map } from './iterable';

export type PromiseOrValue<T> = Promise<T> | T;

export function any<T>(...promises: Promise<T>[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const onFullfilled = (r: T) => {
			settled = true;
			resolve(r);
		};

		let errors: Error[];
		const onRejected = (ex: unknown) => {
			if (settled) return;
			if (!(ex instanceof Error)) {
				debugger;
				return;
			}

			if (errors == null) {
				errors = [ex];
			} else {
				errors.push(ex);
			}

			if (promises.length - errors.length < 1) {
				reject(new AggregateError(errors));
			}
		};

		for (const promise of promises) {
			promise.then(onFullfilled, onRejected);
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
	timeout?: number | CancellationToken,
	cancellation?: CancellationToken,
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
		let disposeCancellation: Disposable | undefined;
		let disposeTimeout: Disposable | undefined;

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

		disposeCancellation = cancellation?.onCancellationRequested(() => resolver('cancelled'));
		if (timeout != null) {
			if (typeof timeout === 'number') {
				const timer = setTimeout(() => resolver('timedout'), timeout);
				disposeTimeout = { dispose: () => clearTimeout(timer) };
			} else {
				disposeTimeout = timeout.onCancellationRequested(() => resolver('timedout'));
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
	defaultValue: T | undefined = undefined,
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
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<T>) => void | Promise<void>,
): Promise<MaybePausedResult<T>>;
export function pauseOnCancelOrTimeout<T>(
	promise: T | Promise<T>,
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<T>) => void | Promise<void>,
): Promise<MaybePausedResult<T>> {
	if (!isPromise(promise)) {
		return Promise.resolve({ value: promise, paused: false } satisfies MaybePausedResult<T>);
	}

	if (cancellation == null && timeout == null) {
		return promise.then(value => ({ value: value, paused: false }) satisfies CompletedResult<T>);
	}

	let disposeCancellation: Disposable | undefined;
	let disposeTimeout: Disposable | undefined;

	const result = Promise.race([
		promise.then(value => {
			disposeCancellation?.dispose();
			disposeTimeout?.dispose();

			if (cancellation?.isCancellationRequested) {
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

			disposeCancellation = cancellation?.onCancellationRequested(() => resolver('cancelled'));
			if (timeout != null) {
				const signal = typeof timeout === 'number' ? AbortSignal.timeout(timeout) : timeout;

				const handler = () => resolver('timedout');
				signal.addEventListener('abort', handler);
				disposeTimeout = { dispose: () => signal.removeEventListener('abort', handler) };
			}
		}),
	]);

	return continuation == null
		? result
		: result.then(r => {
				if (r.paused) {
					setTimeout(() => continuation(r), 0);
				}
				return r;
			});
}

export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors: true,
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined>>>;
export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined | Error>>>;
export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
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
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined>> | undefined>>;
export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined | Error>> | undefined>>;
export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
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
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]>>;
export async function pauseOnCancelOrTimeoutMapTuple<Id, T, U extends unknown[]>(
	source: Map<Id, [Promise<T> | undefined, ...U]>,
	cancellation?: CancellationToken,
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
	cancellation?: CancellationToken,
	timeout?: number | AbortSignal,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]> | undefined>>;
export async function pauseOnCancelOrTimeoutMapTuplePromise<Id, T, U extends unknown[]>(
	source: Promise<Map<Id, [Promise<T> | undefined, ...U]> | undefined>,
	cancellation?: CancellationToken,
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

// type PromiseKeys<T> = {
// 	[K in keyof T]: T[K] extends Promise<any> | undefined ? K : never;
// }[keyof T];
// type WithCompletedResult<T, U extends PromiseKeys<T>> = Omit<T, U> & {
// 	[K in U]: CompletedResult<Awaited<T[U]> | undefined> | undefined;
// };
// type WithMaybePausedResult<T, U extends PromiseKeys<T>> = Omit<T, U> & {
// 	[K in U]: MaybePausedResult<Awaited<T[U]> | undefined> | undefined;
// };

// export async function pauseOnCancelOrTimeoutMapOnProp<Id, T, U extends PromiseKeys<T>>(
// 	source: Map<Id, T>,
// 	prop: U,
// 	cancellation?: undefined,
// 	timeout?: undefined,
// ): Promise<Map<Id, WithCompletedResult<T, U>>>;
// export async function pauseOnCancelOrTimeoutMapOnProp<Id, T, U extends PromiseKeys<T>>(
// 	source: Map<Id, T>,
// 	prop: U,
// 	cancellation?: CancellationToken,
// 	timeout?: number | AbortSignal,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<Map<Id, WithMaybePausedResult<T, U>>>;
// export async function pauseOnCancelOrTimeoutMapOnProp<Id, T, U extends PromiseKeys<T>>(
// 	source: Map<Id, T>,
// 	prop: U,
// 	cancellation?: CancellationToken,
// 	timeout?: number | AbortSignal,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<Map<Id, WithMaybePausedResult<T, U>>> {
// 	if (source.size === 0) {
// 		return source as unknown as Map<Id, WithMaybePausedResult<T, U>>;
// 	}

// 	// Change the timeout to an AbortSignal if it is a number to avoid creating lots of timers
// 	if (timeout != null && typeof timeout === 'number') {
// 		timeout = AbortSignal.timeout(timeout);
// 	}

// 	const results = await Promise.all(
// 		map(source, ([id, item]) =>
// 			item[prop] == null
// 				? ([id, item as WithMaybePausedResult<T, U>] as const)
// 				: pauseOnCancelOrTimeout(
// 						(item[prop] as Promise<any>).catch(() => undefined),
// 						cancellation,
// 						timeout,
// 				  ).then(result => {
// 						(item as any)[prop] = result;
// 						return [id, item as WithMaybePausedResult<T, U>] as const;
// 				  }),
// 		),
// 	);

// 	if (continuation != null) {
// 		if (results.some(([, r]) => (r as any)[prop]?.paused ?? false)) {
// 			async function getContinuationValue() {
// 				const completed = new Map<Id, WithCompletedResult<T, U>>();

// 				for (const [id, result] of results) {
// 					const r = result[prop]; // as MaybePausedResult<Awaited<T[U]>> | undefined;
// 					(result as /*WithCompletedResult<T, U>*/ any)[prop] = r?.paused ? await r.value : r?.value;
// 					completed.set(id, result as WithCompletedResult<T, U>);
// 				}

// 				return completed;
// 			}

// 			const cancelled = results.some(([, result]) => {
// 				const r = result[prop];
// 				return r?.paused && r.reason === 'cancelled';
// 			});

// 			void continuation({
// 				value: getContinuationValue(),
// 				paused: true,
// 				reason: cancelled ? 'cancelled' : 'timedout',
// 			});
// 		}
// 	}

// 	return new Map<Id, WithMaybePausedResult<T, U>>(results);
// }

// export async function pauseOnCancelOrTimeoutMapOnPropPromise<Id, T, U extends PromiseKeys<T>>(
// 	source: Promise<Map<Id, T> | undefined>,
// 	prop: U,
// 	cancellation?: undefined,
// 	timeout?: undefined,
// ): Promise<CompletedResult<Map<Id, WithCompletedResult<T, U>> | undefined>>;
// export async function pauseOnCancelOrTimeoutMapOnPropPromise<Id, T, U extends PromiseKeys<T>>(
// 	source: Promise<Map<Id, T> | undefined>,
// 	prop: U,
// 	cancellation?: CancellationToken,
// 	timeout?: number | AbortSignal,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<MaybePausedResult<Map<Id, WithMaybePausedResult<T, U>> | undefined>>;
// export async function pauseOnCancelOrTimeoutMapOnPropPromise<Id, T, U extends PromiseKeys<T>>(
// 	source: Promise<Map<Id, T> | undefined>,
// 	prop: U,
// 	cancellation?: CancellationToken,
// 	timeout?: number | AbortSignal,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<MaybePausedResult<Map<Id, WithMaybePausedResult<T, U>> | undefined>> {
// 	// Change the timeout to an AbortSignal if it is a number to avoid creating lots of timers
// 	if (timeout != null && typeof timeout === 'number') {
// 		timeout = AbortSignal.timeout(timeout);
// 	}

// 	const mapPromise = source.then(m =>
// 		m == null ? m : pauseOnCancelOrTimeoutMapOnProp(m, prop, cancellation, timeout, continuation),
// 	);

// 	const result = await pauseOnCancelOrTimeout(source, cancellation, timeout);
// 	return result.paused
// 		? { value: mapPromise, paused: result.paused, reason: result.reason }
// 		: { value: await mapPromise, paused: false };
// }

// export function progress<T>(promise: Promise<T>, intervalMs: number, onProgress: () => boolean): Promise<T> {
// 	return new Promise((resolve, reject) => {
// 		let timer: ReturnType<typeof setInterval> | undefined;
// 		timer = setInterval(() => {
// 			if (onProgress()) {
// 				if (timer != null) {
// 					clearInterval(timer);
// 					timer = undefined;
// 				}
// 			}
// 		}, intervalMs);

// 		promise.then(
// 			() => {
// 				if (timer != null) {
// 					clearInterval(timer);
// 					timer = undefined;
// 				}

// 				resolve(promise);
// 			},
// 			ex => {
// 				if (timer != null) {
// 					clearInterval(timer);
// 					timer = undefined;
// 				}

// 				reject(ex);
// 			},
// 		);
// 	});
// }

// export async function resolveMap<Id, T>(
// 	source: Map<Id, Promise<T>>,
// 	ignoreErrors?: false,
// ): Promise<Map<Id, T | undefined | Error>>;
// export async function resolveMap<Id, T>(
// 	source: Promise<Map<Id, Promise<T>> | undefined>,
// 	ignoreErrors?: false,
// ): Promise<Map<Id, T | undefined | Error> | undefined>;
// export async function resolveMap<Id, T>(
// 	source: Map<Id, Promise<T>>,
// 	ignoreErrors: true,
// ): Promise<Map<Id, T | undefined> | undefined>;
// export async function resolveMap<Id, T>(
// 	source: Promise<Map<Id, Promise<T>> | undefined>,
// 	ignoreErrors: true,
// ): Promise<Map<Id, T | undefined>>;
// export async function resolveMap<Id, T>(
// 	source: Map<Id, Promise<T>> | Promise<Map<Id, Promise<T>> | undefined>,
// 	ignoreErrors?: boolean,
// ): Promise<Map<Id, T | undefined | Error> | undefined> {
// 	if (isPromise(source)) {
// 		const map = await source;
// 		if (map == null) return undefined;

// 		source = map;
// 	}

// 	const promises = map(source, ([id, promise]) =>
// 		promise.then(
// 			p => [id, p as T | Error | undefined] as const,
// 			ex => [id, (ignoreErrors || !(ex instanceof Error) ? undefined : ex) as T | Error | undefined] as const,
// 		),
// 	);
// 	return new Map(await Promise.all(promises));
// }

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

export class AggregateError extends Error {
	constructor(readonly errors: Error[]) {
		super(`AggregateError(${errors.length})\n${errors.map(e => `\t${String(e)}`).join('\n')}`);

		Error.captureStackTrace?.(this, AggregateError);
	}
}
