import type { UnifiedDisposable } from './disposable.js';
import { createDisposable } from './disposable.js';
import { Logger } from './logger.js';
import type { Deferred } from './promise.js';

export interface Event<T> {
	(listener: (e: T) => any, thisArgs?: unknown, disposables?: { dispose(): void }[]): UnifiedDisposable;
}

export class Emitter<T> {
	private _listeners?: { callback: (e: T) => any; thisArgs?: unknown }[];
	private _event?: Event<T>;
	private _disposed: boolean = false;

	/**
	 * For the public to allow to subscribe
	 * to events from this Emitter
	 */
	get event(): Event<T> {
		if (!this._event) {
			this._event = (listener: (e: T) => any, thisArgs?: unknown, disposables?: { dispose(): void }[]) => {
				if (this._disposed) {
					return createDisposable(() => {});
				}

				if (!this._listeners) {
					this._listeners = [];
				}

				this._listeners.push({ callback: listener, thisArgs: thisArgs });

				const result = createDisposable(() => {
					if (!this._disposed && this._listeners) {
						const index = this._listeners.findIndex(
							l => l.callback === listener && l.thisArgs === thisArgs,
						);
						if (index > -1) {
							this._listeners.splice(index, 1);
						}
					}
				});

				if (disposables instanceof Array) {
					disposables.push(result);
				}

				return result;
			};
		}
		return this._event;
	}

	/**
	 * To be kept private to fire an event to
	 * subscribers
	 */
	fire(event: T): void {
		if (this._listeners) {
			// put all [listener,event] pairs into delivery queue
			// then emit
			// for now, just sync emit
			for (const listener of this._listeners.slice()) {
				try {
					listener.callback.call(listener.thisArgs, event);
				} catch (e) {
					Logger.error(e);
				}
			}
		}
	}

	dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._listeners = undefined;
		}
	}

	[Symbol.dispose](): void {
		this.dispose();
	}
}

/**
 * Minimal event type compatible with both VS Code's `Event<T>` and `@gitlens/utils` `Event<T>`.
 * Use this as the parameter type when a function should accept events from either source.
 */
export type EventLike<T> = (listener: (e: T) => any, thisArgs?: any, ...args: any[]) => { dispose(): void };

export function once<T>(event: EventLike<T>, disposables?: { dispose(): void }[]): EventLike<T> {
	return take<T>(event, 1, disposables);
}

export function take<T>(event: EventLike<T>, count: number, disposables?: { dispose(): void }[]): EventLike<T> {
	return (listener: (e: T) => unknown, thisArgs?: unknown) => {
		let i = 0;
		const result = event(e => {
			const shouldDispose = ++i >= count;
			if (shouldDispose) {
				result.dispose();
			}
			return listener.call(thisArgs, e);
		});

		if (disposables instanceof Array) {
			disposables.push(result);
		}

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
	event: EventLike<T>,
	executor: DeferredEventExecutor<T, U> = resolveExecutor,
): DeferredEvent<U> {
	let cancel: ((reason?: any) => void) | undefined;
	let disposable: { dispose(): void };

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
	event: EventLike<T>,
	listener: (e: T) => any,
	thisArg: U,
	alsoDisposeOnReleaseOrDispose?: { dispose(): void }[],
): { dispose(): void } {
	const ref = new WeakRef<U>(thisArg);

	let disposed = false;
	let disposable: { dispose(): void };

	const d = event((e: T) => {
		const obj = ref.deref();
		if (obj != null) {
			listener.call(obj, e);
		} else if (!disposed) {
			Logger.warn(`weakEvent GC'd; disposing listener`);
			disposable.dispose();
		}
	});

	if (alsoDisposeOnReleaseOrDispose == null) {
		disposable = {
			dispose: () => {
				disposed = true;
				d.dispose();
			},
		};
	} else {
		const wrapped = disposableFrom(d, ...alsoDisposeOnReleaseOrDispose);
		disposable = {
			dispose: () => {
				disposed = true;
				wrapped.dispose();
			},
		};
	}
	return disposable;
}

function disposableFrom(...inDisposables: { dispose(): any }[]): { dispose(): void } {
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
