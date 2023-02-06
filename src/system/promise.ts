import type { CancellationToken, Disposable } from 'vscode';
import { map } from './iterable';

export type PromiseOrValue<T> = Promise<T> | T;

export function any<T>(...promises: Promise<T>[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const errors: Error[] = [];
		let settled = false;

		for (const promise of promises) {
			// eslint-disable-next-line no-loop-func
			void (async () => {
				try {
					const result = await promise;
					if (settled) return;

					resolve(result);
					settled = true;
				} catch (ex) {
					errors.push(ex);
				} finally {
					if (!settled) {
						if (promises.length - errors.length < 1) {
							reject(new AggregateError(errors));
							settled = true;
						}
					}
				}
			})();
		}
	});
}

export async function* fastestSettled<T>(promises: Promise<T>[]): AsyncIterable<PromiseSettledResult<T>> {
	const map = new Map(
		promises.map((promise, i) => [
			i,
			promise.then(
				v =>
					({ index: i, value: v, status: 'fulfilled' } as unknown as PromiseFulfilledResult<T> & {
						index: number;
					}),
				e =>
					({ index: i, reason: e, status: 'rejected' } as unknown as PromiseRejectedResult & {
						index: number;
					}),
			),
		]),
	);

	while (map.size) {
		const result = await Promise.race(map.values());
		map.delete(result.index);
		yield result;
	}
}

export class PromiseCancelledError<T extends Promise<any> = Promise<any>> extends Error {
	constructor(public readonly promise: T, message: string) {
		super(message);
	}
}

export class PromiseCancelledErrorWithId<TKey, T extends Promise<any> = Promise<any>> extends PromiseCancelledError<T> {
	constructor(public readonly id: TKey, promise: T, message: string) {
		super(promise, message);
	}
}

export function cancellable<T>(
	promise: Promise<T>,
	timeoutOrToken?: number | CancellationToken,
	options: {
		cancelMessage?: string;
		onDidCancel?(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void): void;
	} = {},
): Promise<T> {
	if (timeoutOrToken == null || (typeof timeoutOrToken === 'number' && timeoutOrToken <= 0)) return promise;

	return new Promise((resolve, reject) => {
		let fulfilled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let disposable: Disposable | undefined;

		if (typeof timeoutOrToken === 'number') {
			timer = setTimeout(() => {
				if (typeof options.onDidCancel === 'function') {
					options.onDidCancel(resolve, reject);
				} else {
					reject(new PromiseCancelledError(promise, options.cancelMessage ?? 'TIMED OUT'));
				}
			}, timeoutOrToken);
		} else {
			disposable = timeoutOrToken.onCancellationRequested(() => {
				disposable?.dispose();
				if (fulfilled) return;

				if (typeof options.onDidCancel === 'function') {
					options.onDidCancel(resolve, reject);
				} else {
					reject(new PromiseCancelledError(promise, options.cancelMessage ?? 'CANCELLED'));
				}
			});
		}

		promise.then(
			() => {
				fulfilled = true;
				if (timer != null) {
					clearTimeout(timer);
				}
				disposable?.dispose();
				resolve(promise);
			},
			ex => {
				fulfilled = true;
				if (timer != null) {
					clearTimeout(timer);
				}
				disposable?.dispose();
				reject(ex);
			},
		);
	});
}

export interface Deferred<T> {
	promise: Promise<T>;
	fulfill: (value: T) => void;
	cancel(): void;
}

export function defer<T>(): Deferred<T> {
	const deferred: Deferred<T> = { promise: undefined!, fulfill: undefined!, cancel: undefined! };
	deferred.promise = new Promise((resolve, reject) => {
		deferred.fulfill = resolve;
		deferred.cancel = reject;
	});
	return deferred;
}

export function getSettledValue<T>(promise: PromiseSettledResult<T>): T | undefined;
export function getSettledValue<T>(promise: PromiseSettledResult<T>, defaultValue: NonNullable<T>): NonNullable<T>;
export function getSettledValue<T>(
	promise: PromiseSettledResult<T>,
	defaultValue: T | undefined = undefined,
): T | typeof defaultValue {
	return promise.status === 'fulfilled' ? promise.value : defaultValue;
}

export function isPromise<T>(obj: PromiseLike<T> | T): obj is Promise<T> {
	return obj instanceof Promise || typeof (obj as PromiseLike<T>)?.then === 'function';
}

export function progress<T>(promise: Promise<T>, intervalMs: number, onProgress: () => boolean): Promise<T> {
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setInterval> | undefined;
		timer = setInterval(() => {
			if (onProgress()) {
				if (timer != null) {
					clearInterval(timer);
					timer = undefined;
				}
			}
		}, intervalMs);

		promise.then(
			() => {
				if (timer != null) {
					clearInterval(timer);
					timer = undefined;
				}

				resolve(promise);
			},
			ex => {
				if (timer != null) {
					clearInterval(timer);
					timer = undefined;
				}

				reject(ex);
			},
		);
	});
}

export function raceAll<TPromise>(
	promises: Promise<TPromise>[],
	timeout?: number,
): Promise<(TPromise | PromiseCancelledError<Promise<TPromise>>)[]>;
export function raceAll<TPromise, T>(
	promises: Map<T, Promise<TPromise>>,
	timeout?: number,
): Promise<Map<T, TPromise | PromiseCancelledErrorWithId<T, Promise<TPromise>>>>;
export function raceAll<TPromise, T>(
	ids: Iterable<T>,
	fn: (id: T) => Promise<TPromise>,
	timeout?: number,
): Promise<Map<T, TPromise | PromiseCancelledErrorWithId<T, Promise<TPromise>>>>;
export async function raceAll<TPromise, T>(
	promisesOrIds: Promise<TPromise>[] | Map<T, Promise<TPromise>> | Iterable<T>,
	timeoutOrFn?: number | ((id: T) => Promise<TPromise>),
	timeout?: number,
) {
	let promises;
	if (timeoutOrFn != null && typeof timeoutOrFn !== 'number') {
		promises = new Map(map<T, [T, Promise<TPromise>]>(promisesOrIds as Iterable<T>, id => [id, timeoutOrFn(id)]));
	} else {
		timeout = timeoutOrFn;
		promises = promisesOrIds as Promise<TPromise>[] | Map<T, Promise<TPromise>>;
	}

	if (promises instanceof Map) {
		return new Map(
			await Promise.all(
				map<[T, Promise<TPromise>], Promise<[T, TPromise | PromiseCancelledErrorWithId<T, Promise<TPromise>>]>>(
					promises.entries(),
					timeout == null
						? ([id, promise]) => promise.then(p => [id, p])
						: ([id, promise]) =>
								Promise.race([
									promise,

									new Promise<PromiseCancelledErrorWithId<T, Promise<TPromise>>>(resolve =>
										setTimeout(
											() => resolve(new PromiseCancelledErrorWithId(id, promise, 'TIMED OUT')),
											timeout,
										),
									),
								]).then(p => [id, p]),
				),
			),
		);
	}

	return Promise.all(
		timeout == null
			? promises
			: promises.map(p =>
					Promise.race([
						p,
						new Promise<PromiseCancelledError<Promise<TPromise>>>(resolve =>
							setTimeout(() => resolve(new PromiseCancelledError(p, 'TIMED OUT')), timeout),
						),
					]),
			  ),
	);
}

export async function wait(ms: number): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, ms));
}

export async function waitUntilNextTick(): Promise<void> {
	await new Promise<void>(resolve => queueMicrotask(resolve));
}

export class AggregateError extends Error {
	constructor(readonly errors: Error[]) {
		super(`AggregateError(${errors.length})\n${errors.map(e => `\t${String(e)}`).join('\n')}`);

		Error.captureStackTrace?.(this, AggregateError);
	}
}
