import type { Disposable, Event } from 'vscode';
import type { Deferred } from './promise';

export function once<T>(event: Event<T>): Event<T> {
	return take<T>(event, 1);
}

export function take<T>(event: Event<T>, count: number): Event<T> {
	return (listener: (e: T) => unknown, thisArgs?: unknown) => {
		let i = 0;
		const result = event(e => {
			if (++i >= count) {
				result.dispose();
			}
			return listener.call(thisArgs, e);
		});

		return result;
	};
}

export function promisify<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(resolve => once(event)(resolve));
}

export function takeUntil<T>(event: Event<T>, predicate: (e: T) => boolean): Event<T> {
	return (listener: (e: T) => unknown, thisArgs?: unknown) => {
		const result = event(e => {
			if (predicate(e)) {
				result.dispose();
			}
			return listener.call(thisArgs, e);
		});

		return result;
	};
}

export type DeferredEvent<T> = Omit<Deferred<T>, 'fulfill'>;

export type DeferredEventExecutor<T, U> = (
	value: T,
	resolve: (value: U | PromiseLike<U>) => void,
	reject: (reason: any) => void,
) => any;

const resolveExecutor = (value: any, resolve: (value?: any) => void) => resolve(value);

/**
 * Return a promise that resolves with the next emitted event, or with some future
 * event as decided by an executor.
 *
 * If specified, the executor is a function that will be called with `(value, resolve, reject)`.
 * It will be called once per event until it resolves or rejects.
 *
 * The default executor just resolves with the value.
 *
 * @param event the event
 * @param executor controls resolution of the returned promise
 * @returns a cancellable deferred promise that resolves or rejects as specified by the executor
 */
export function promisifyDeferred<T, U>(
	event: Event<T>,
	executor: DeferredEventExecutor<T, U> = resolveExecutor,
): DeferredEvent<U> {
	let cancel: ((reason?: any) => void) | undefined;
	let disposable: Disposable;

	let pending = true;
	const promise = new Promise<U>((resolve, reject) => {
		cancel = () => {
			pending = false;
			cancel = undefined;
			reject();
		};

		disposable = event(async (value: T) => {
			try {
				await executor(value, resolve, reject);
				pending = false;
			} catch (ex) {
				pending = false;
				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
				reject(ex);
			}
		});
	}).then(
		(value: U) => {
			disposable.dispose();
			return value;
		},
		(reason: unknown) => {
			disposable.dispose();
			throw reason;
		},
	);

	return {
		get pending() {
			return pending;
		},
		promise: promise,
		cancel: () => cancel?.(),
	};
}

export function weakEvent<T, U extends object>(
	event: Event<T>,
	listener: (e: T) => any,
	thisArg: U,
	alsoDisposeOnReleaseOrDispose?: Disposable[],
): Disposable {
	const ref = new WeakRef<U>(thisArg);

	let disposable: Disposable;

	const d = event((e: T) => {
		const obj = ref.deref();
		if (obj != null) {
			listener.call(obj, e);
		} else {
			disposable.dispose();
		}
	});

	if (alsoDisposeOnReleaseOrDispose == null) {
		disposable = d;
	} else {
		disposable = disposableFrom(d, ...alsoDisposeOnReleaseOrDispose);
	}
	return disposable;
}

function disposableFrom(...inDisposables: { dispose(): any }[]): Disposable {
	let disposables: ReadonlyArray<{ dispose(): any }> | undefined = inDisposables;
	return {
		dispose: function () {
			if (disposables) {
				for (const disposable of disposables) {
					if (disposable && typeof disposable.dispose === 'function') {
						disposable.dispose();
					}
				}
				disposables = undefined;
			}
		},
	};
}
