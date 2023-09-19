import type { CancellationToken, Disposable } from 'vscode';

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
						e =>
							({ index: i, reason: e, status: 'rejected' }) as unknown as PromiseRejectedResult & {
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
	readonly pending: boolean;
	readonly promise: Promise<T>;
	fulfill: (value: T) => void;
	cancel(): void;
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
		deferred.cancel = function () {
			deferred.pending = false;
			reject();
		};
	});
	return deferred;
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

export function isPromise<T>(obj: PromiseLike<T> | T): obj is Promise<T> {
	return obj != null && (obj instanceof Promise || typeof (obj as PromiseLike<T>)?.then === 'function');
}

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
