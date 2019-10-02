'use strict';
import { debounce as _debounce, once as _once } from 'lodash-es';
import { CancellationToken, Disposable } from 'vscode';

export interface Deferrable {
	cancel(): void;
	flush(...args: any[]): void;
	pending?(): boolean;
}

interface PropOfValue {
	(): any;
	value: string | undefined;
}

export namespace Functions {
	export function cachedOnce<T>(fn: (...args: any[]) => Promise<T>, seed: T): (...args: any[]) => Promise<T> {
		let cached: T | undefined = seed;
		return (...args: any[]) => {
			if (cached !== undefined) {
				const promise = Promise.resolve(cached);
				cached = undefined;

				return promise;
			}
			return fn(...args);
		};
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
				timer = setTimeout(() => {
					if (typeof options.onDidCancel === 'function') {
						options.onDidCancel(resolve, reject);
					} else {
						reject(new Error(options.cancelMessage || 'TIMED OUT'));
					}
				}, timeoutOrToken);
			} else {
				timeoutOrToken.onCancellationRequested(() => {
					if (fulfilled) return;

					if (typeof options.onDidCancel === 'function') {
						options.onDidCancel(resolve, reject);
					} else {
						reject(new Error(options.cancelMessage || 'CANCELLED'));
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

	export interface DebounceOptions {
		leading?: boolean;
		maxWait?: number;
		track?: boolean;
		trailing?: boolean;
	}

	export function debounce<T extends (...args: any[]) => any>(
		fn: T,
		wait?: number,
		options?: DebounceOptions
	): T & Deferrable {
		const { track, ...opts }: DebounceOptions = {
			track: false,
			...(options || {})
		};

		if (track !== true) return _debounce(fn, wait, opts);

		let pending = false;

		const debounced = _debounce(
			(function(this: any, ...args: any[]) {
				pending = false;
				return fn.apply(this, args);
			} as any) as T,
			wait,
			options
		) as T & Deferrable;

		const tracked = (function(this: any, ...args: any[]) {
			pending = true;
			return debounced.apply(this, args);
		} as any) as T & Deferrable;

		tracked.pending = function() {
			return pending;
		};
		tracked.cancel = function() {
			return debounced.cancel.apply(debounced);
		};
		tracked.flush = function(...args: any[]) {
			// eslint-disable-next-line prefer-spread
			return debounced.flush.apply(debounced, args);
		};

		return tracked;
	}

	// export function debounceMemoized<T extends (...args: any[]) => any>(
	// 	fn: T,
	// 	wait?: number,
	// 	options?: DebounceOptions & { resolver?(...args: any[]): any }
	// ): T {
	// 	const { resolver, ...opts } = options || ({} as DebounceOptions & { resolver?: T });

	// 	const memo = _memoize(() => {
	// 		return debounce(fn, wait, opts);
	// 	}, resolver);

	// 	return function(this: any, ...args: []) {
	// 		return memo.apply(this, args).apply(this, args);
	// 	} as T;
	// }

	const comma = ',';
	const emptyStr = '';
	const equals = '=';
	const openBrace = '{';
	const openParen = '(';
	const closeParen = ')';

	const fnBodyRegex = /\(([\s\S]*)\)/;
	const fnBodyStripCommentsRegex = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/gm;
	const fnBodyStripParamDefaultValueRegex = /\s?=.*$/;

	export function getParameters(fn: Function): string[] {
		if (typeof fn !== 'function') throw new Error('Not supported');

		if (fn.length === 0) return [];

		let fnBody: string = Function.prototype.toString.call(fn);
		fnBody = fnBody.replace(fnBodyStripCommentsRegex, emptyStr) || fnBody;
		fnBody = fnBody.slice(0, fnBody.indexOf(openBrace));

		let open = fnBody.indexOf(openParen);
		let close = fnBody.indexOf(closeParen);

		open = open >= 0 ? open + 1 : 0;
		close = close > 0 ? close : fnBody.indexOf(equals);

		fnBody = fnBody.slice(open, close);
		fnBody = `(${fnBody})`;

		const match = fnBodyRegex.exec(fnBody);
		return match != null
			? match[1].split(comma).map(param => param.trim().replace(fnBodyStripParamDefaultValueRegex, emptyStr))
			: [];
	}

	export function is<T extends object>(o: T | null | undefined): o is T;
	export function is<T extends object>(o: object, prop: keyof T, value?: any): o is T;
	export function is<T extends object>(o: object, matcher: (o: object) => boolean): o is T;
	export function is<T extends object>(
		o: object,
		propOrMatcher?: keyof T | ((o: any) => boolean),
		value?: any
	): o is T {
		if (propOrMatcher == null) return o != null;
		if (typeof propOrMatcher === 'function') return propOrMatcher(o);

		return value === undefined ? (o as any)[propOrMatcher] !== undefined : (o as any)[propOrMatcher] === value;
	}

	export function once<T extends (...args: any[]) => any>(fn: T): T {
		return _once(fn);
	}

	export function propOf<T, K extends Extract<keyof T, string>>(o: T, key: K) {
		const propOfCore = <T, K extends Extract<keyof T, string>>(o: T, key: K) => {
			const value: string =
				(propOfCore as PropOfValue).value === undefined ? key : `${(propOfCore as PropOfValue).value}.${key}`;
			(propOfCore as PropOfValue).value = value;
			const fn = <Y extends Extract<keyof T[K], string>>(k: Y) => propOfCore(o[key], k);
			return Object.assign(fn, { value: value });
		};
		return propOfCore(o, key);
	}

	export function interval(fn: (...args: any[]) => void, ms: number): Disposable {
		let timer: NodeJS.Timer | undefined;
		const disposable = {
			dispose: () => {
				if (timer !== undefined) {
					clearInterval(timer);
					timer = undefined;
				}
			}
		};
		timer = setInterval(fn, ms);

		return disposable;
	}

	export function progress<T>(promise: Promise<T>, intervalMs: number, onProgress: () => boolean): Promise<T> {
		return new Promise((resolve, reject) => {
			let timer: NodeJS.Timer | undefined;
			timer = setInterval(() => {
				if (onProgress()) {
					if (timer !== undefined) {
						clearInterval(timer);
						timer = undefined;
					}
				}
			}, intervalMs);

			promise.then(
				() => {
					if (timer !== undefined) {
						clearInterval(timer);
						timer = undefined;
					}

					resolve(promise);
				},
				ex => {
					if (timer !== undefined) {
						clearInterval(timer);
						timer = undefined;
					}

					reject(ex);
				}
			);
		});
	}

	export async function wait(ms: number) {
		await new Promise(resolve => setTimeout(resolve, ms));
	}

	export async function waitUntil(fn: (...args: any[]) => boolean, timeout: number): Promise<boolean> {
		const max = Math.round(timeout / 100);
		let counter = 0;
		while (true) {
			if (fn()) return true;
			if (counter > max) return false;

			await wait(100);
			counter++;
		}
	}
}
