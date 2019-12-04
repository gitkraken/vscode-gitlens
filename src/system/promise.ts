'use strict';
import { CancellationToken } from 'vscode';
import { Iterables } from './iterable';

export namespace Promises {
	export class CancellationError<TPromise = any> extends Error {
		constructor(public readonly promise: TPromise, message: string) {
			super(message);
		}
	}

	export class CancellationErrorWithId<T, TPromise = any> extends CancellationError<TPromise> {
		constructor(public readonly id: T, promise: TPromise, message: string) {
			super(promise, message);
		}
	}

	export function cancellable<T>(
		promise: Thenable<T>,
		timeoutOrToken: number | CancellationToken,
		options: {
			cancelMessage?: string;
			onDidCancel?(
				resolve: (value?: T | PromiseLike<T> | undefined) => void,
				reject: (reason?: any) => void
			): void;
		} = {}
	): Promise<T> {
		return new Promise((resolve, reject) => {
			let fulfilled = false;
			let timer: NodeJS.Timer | undefined;
			if (typeof timeoutOrToken === 'number') {
				timer = global.setTimeout(() => {
					if (typeof options.onDidCancel === 'function') {
						options.onDidCancel(resolve, reject);
					} else {
						reject(new CancellationError(promise, options.cancelMessage || 'TIMED OUT'));
					}
				}, timeoutOrToken);
			} else {
				timeoutOrToken.onCancellationRequested(() => {
					if (fulfilled) return;

					if (typeof options.onDidCancel === 'function') {
						options.onDidCancel(resolve, reject);
					} else {
						reject(new CancellationError(promise, options.cancelMessage || 'CANCELLED'));
					}
				});
			}

			promise.then(
				() => {
					fulfilled = true;
					if (timer !== undefined) {
						clearTimeout(timer);
					}
					resolve(promise);
				},
				ex => {
					fulfilled = true;
					if (timer !== undefined) {
						clearTimeout(timer);
					}
					reject(ex);
				}
			);
		});
	}

	export function first<T>(promises: Promise<T>[], predicate: (value: T) => boolean): Promise<T | undefined> {
		const newPromises: Promise<T | undefined>[] = promises.map(
			p =>
				new Promise<T>((resolve, reject) =>
					p.then(value => {
						if (predicate(value)) {
							resolve(value);
						}
					}, reject)
				)
		);
		newPromises.push(Promise.all(promises).then(() => undefined));
		return Promise.race(newPromises);
	}

	export function is<T>(obj: T | Promise<T>): obj is Promise<T> {
		return obj != null && typeof (obj as Promise<T>).then === 'function';
	}

	export function raceAll<TPromise>(
		promises: Promise<TPromise>[],
		timeout?: number
	): Promise<(TPromise | Promises.CancellationError<Promise<TPromise>>)[]>;
	export function raceAll<TPromise, T>(
		promises: Map<T, Promise<TPromise>>,
		timeout?: number
	): Promise<Map<T, TPromise | Promises.CancellationErrorWithId<T, Promise<TPromise>>>>;
	export function raceAll<TPromise, T>(
		ids: Iterable<T>,
		fn: (id: T) => Promise<TPromise>,
		timeout?: number
	): Promise<Map<T, TPromise | Promises.CancellationErrorWithId<T, Promise<TPromise>>>>;
	export async function raceAll<TPromise, T>(
		promisesOrIds: Promise<TPromise>[] | Map<T, Promise<TPromise>> | Iterable<T>,
		timeoutOrFn?: number | ((id: T) => Promise<TPromise>),
		timeout?: number
	) {
		let promises;
		if (timeoutOrFn != null && typeof timeoutOrFn !== 'number') {
			promises = new Map(
				Iterables.map<T, [T, Promise<TPromise>]>(promisesOrIds as Iterable<T>, id => [id, timeoutOrFn(id)])
			);
		} else {
			timeout = timeoutOrFn;
			promises = promisesOrIds as Promise<TPromise>[] | Map<T, Promise<TPromise>>;
		}

		if (promises instanceof Map) {
			return new Map(
				await Promise.all(
					Iterables.map<
						[T, Promise<TPromise>],
						Promise<[T, TPromise | CancellationErrorWithId<T, Promise<TPromise>>]>
					>(
						promises.entries(),
						timeout == null
							? ([id, promise]) => promise.then(p => [id, p])
							: ([id, promise]) =>
									Promise.race([
										promise,

										new Promise<CancellationErrorWithId<T, Promise<TPromise>>>(resolve =>
											setTimeout(
												() => resolve(new CancellationErrorWithId(id, promise, 'TIMED OUT')),
												timeout!
											)
										)
									]).then(p => [id, p])
					)
				)
			);
		}

		return Promise.all(
			timeout == null
				? promises
				: promises.map(p =>
						Promise.race([
							p,
							new Promise<CancellationError<Promise<TPromise>>>(resolve =>
								setTimeout(() => resolve(new CancellationError(p, 'TIMED OUT')), timeout!)
							)
						])
				  )
		);
	}
}
