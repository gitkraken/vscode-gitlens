import type { CancellationToken, Disposable } from 'vscode';
import { CancellationTokenSource } from 'vscode';
import { map } from './iterable';
import { isPromise } from './promise';

export class TimedCancellationSource implements CancellationTokenSource, Disposable {
	private readonly cancellation = new CancellationTokenSource();
	private readonly timer: ReturnType<typeof setTimeout>;

	constructor(timeout: number) {
		this.timer = setTimeout(() => this.cancellation.cancel(), timeout);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.cancellation.dispose();
	}

	cancel(): void {
		clearTimeout(this.timer);
		this.cancellation.cancel();
	}

	get token(): CancellationToken {
		return this.cancellation.token;
	}
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
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<T>) => void | Promise<void>,
): Promise<MaybePausedResult<T>>;
export function pauseOnCancelOrTimeout<T>(
	promise: T | Promise<T>,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
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
				if (typeof timeout === 'number') {
					const timer = setTimeout(() => resolver('timedout'), timeout);
					disposeTimeout = { dispose: () => clearTimeout(timer) };
				} else {
					disposeTimeout = timeout.onCancellationRequested(() => resolver('timedout'));
				}
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
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined>>>;
export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined | Error>>>;
export async function pauseOnCancelOrTimeoutMap<Id, T>(
	source: Map<Id, Promise<T>>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<Map<Id, MaybePausedResult<T | undefined | Error>>> {
	if (source.size === 0) return source as unknown as Map<Id, MaybePausedResult<T | undefined | Error>>;

	// Change the timeout to a cancellation token if it is a number to avoid creating lots of timers
	let timeoutCancellation: CancellationTokenSource | undefined;
	if (timeout != null && typeof timeout === 'number') {
		timeoutCancellation = new TimedCancellationSource(timeout);
		timeout = timeoutCancellation.token;
	}

	const results = await Promise.all(
		map(source, ([id, promise]) =>
			pauseOnCancelOrTimeout(
				promise.catch(ex => (ignoreErrors || !(ex instanceof Error) ? undefined : ex)),
				cancellation,
				timeout,
			).then(result => [id, result] as const),
		),
	);

	timeoutCancellation?.dispose();

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
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined>> | undefined>>;
export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined | Error>> | undefined>>;
export async function pauseOnCancelOrTimeoutMapPromise<Id, T>(
	source: Promise<Map<Id, Promise<T>> | undefined>,
	ignoreErrors?: boolean,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
	continuation?: (result: PausedResult<Map<Id, CompletedResult<T | undefined | Error>>>) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, MaybePausedResult<T | undefined | Error>> | undefined>> {
	// Change the timeout to a cancellation token if it is a number to avoid creating lots of timers
	let timeoutCancellation: CancellationTokenSource | undefined;
	if (timeout != null && typeof timeout === 'number') {
		timeoutCancellation = new TimedCancellationSource(timeout);
		timeout = timeoutCancellation.token;
	}

	const mapPromise = source.then(m =>
		m == null ? m : pauseOnCancelOrTimeoutMap(m, ignoreErrors, cancellation, timeout, continuation),
	);

	void mapPromise.then(() => timeoutCancellation?.dispose());

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
	timeout?: number | CancellationToken,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]>>;
export async function pauseOnCancelOrTimeoutMapTuple<Id, T, U extends unknown[]>(
	source: Map<Id, [Promise<T> | undefined, ...U]>,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]>> {
	if (source.size === 0) {
		return source as unknown as Map<Id, [CompletedResult<T | undefined> | undefined, ...U]>;
	}

	// Change the timeout to a cancellation token if it is a number to avoid creating lots of timers
	let timeoutCancellation: CancellationTokenSource | undefined;
	if (timeout != null && typeof timeout === 'number') {
		timeoutCancellation = new TimedCancellationSource(timeout);
		timeout = timeoutCancellation.token;
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

	timeoutCancellation?.dispose();

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
	timeout?: number | CancellationToken,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]> | undefined>>;
export async function pauseOnCancelOrTimeoutMapTuplePromise<Id, T, U extends unknown[]>(
	source: Promise<Map<Id, [Promise<T> | undefined, ...U]> | undefined>,
	cancellation?: CancellationToken,
	timeout?: number | CancellationToken,
	continuation?: (
		result: PausedResult<Map<Id, readonly [CompletedResult<T | undefined> | undefined, ...U]>>,
	) => void | Promise<void>,
): Promise<MaybePausedResult<Map<Id, readonly [MaybePausedResult<T | undefined> | undefined, ...U]> | undefined>> {
	// Change the timeout to a cancellation token if it is a number to avoid creating lots of timers
	let timeoutCancellation: CancellationTokenSource | undefined;
	if (timeout != null && typeof timeout === 'number') {
		timeoutCancellation = new TimedCancellationSource(timeout);
		timeout = timeoutCancellation.token;
	}

	const mapPromise = source.then(m =>
		m == null ? m : pauseOnCancelOrTimeoutMapTuple(m, cancellation, timeout, continuation),
	);

	void mapPromise.then(() => timeoutCancellation?.dispose());

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
// 	timeout?: number | CancellationToken,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<Map<Id, WithMaybePausedResult<T, U>>>;
// export async function pauseOnCancelOrTimeoutMapOnProp<Id, T, U extends PromiseKeys<T>>(
// 	source: Map<Id, T>,
// 	prop: U,
// 	cancellation?: CancellationToken,
// 	timeout?: number | CancellationToken,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<Map<Id, WithMaybePausedResult<T, U>>> {
// 	if (source.size === 0) {
// 		return source as unknown as Map<Id, WithMaybePausedResult<T, U>>;
// 	}

// 	// Change the timeout to a cancellation token if it is a number to avoid creating lots of timers
// 	let timeoutCancellation: CancellationTokenSource | undefined;
// 	if (timeout != null && typeof timeout === 'number') {
// 		timeoutCancellation = new TimedCancellationSource(timeout);
// 		timeout = timeoutCancellation.token;
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

// 	timeoutCancellation?.dispose();

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
// 	timeout?: number | CancellationToken,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<MaybePausedResult<Map<Id, WithMaybePausedResult<T, U>> | undefined>>;
// export async function pauseOnCancelOrTimeoutMapOnPropPromise<Id, T, U extends PromiseKeys<T>>(
// 	source: Promise<Map<Id, T> | undefined>,
// 	prop: U,
// 	cancellation?: CancellationToken,
// 	timeout?: number | CancellationToken,
// 	continuation?: (result: PausedResult<Map<Id, WithCompletedResult<T, U>>>) => void | Promise<void>,
// ): Promise<MaybePausedResult<Map<Id, WithMaybePausedResult<T, U>> | undefined>> {
// 	// Change the timeout to a cancellation token if it is a number to avoid creating lots of timers
// 	let timeoutCancellation: CancellationTokenSource | undefined;
// 	if (timeout != null && typeof timeout === 'number') {
// 		timeoutCancellation = new TimedCancellationSource(timeout);
// 		timeout = timeoutCancellation.token;
// 	}

// 	const mapPromise = source.then(m =>
// 		m == null ? m : pauseOnCancelOrTimeoutMapOnProp(m, prop, cancellation, timeout, continuation),
// 	);

// 	void mapPromise.then(() => timeoutCancellation?.dispose());

// 	const result = await pauseOnCancelOrTimeout(source, cancellation, timeout);
// 	return result.paused
// 		? { value: mapPromise, paused: result.paused, reason: result.reason }
// 		: { value: await mapPromise, paused: false };
// }
