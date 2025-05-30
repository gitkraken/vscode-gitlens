import type { CancellationToken, Disposable } from 'vscode';

export type PromiseOrValue<T> = Promise<T> | T;

export function any<T>(...promises: Promise<T>[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const onFullfilled = (r: T) => {
			settled = true;
			resolve(r);
		};

		let errors: Error[];
		const onRejected = (ex: Error) => {
			if (settled) return;

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
			ex => {
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
