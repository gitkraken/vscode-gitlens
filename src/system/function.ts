/* eslint-disable @typescript-eslint/no-unsafe-return */
// eslint-disable-next-line no-restricted-imports
import { debounce as _debounce, once as _once } from 'lodash-es';
import type { Disposable } from 'vscode';

export interface Deferrable<T extends (...args: any[]) => any> {
	(...args: Parameters<T>): ReturnType<T> | undefined;
	cancel(): void;
	flush(): ReturnType<T> | undefined;
	pending?(): boolean;
}

interface PropOfValue {
	(): any;
	value: string | undefined;
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
	options?: DebounceOptions,
): Deferrable<T> {
	const { track, ...opts }: DebounceOptions = {
		track: false,
		...(options ?? {}),
	};

	if (track !== true) return _debounce(fn, wait, opts);

	let pending = false;

	const debounced = _debounce(
		function (this: any, ...args: any[]) {
			pending = false;
			return fn.apply(this, args);
		} as any as T,
		wait,
		options,
	);

	const tracked: Deferrable<T> = function (this: any, ...args: Parameters<T>) {
		pending = true;
		return debounced.apply(this, args);
	} as any;

	tracked.pending = function () {
		return pending;
	};
	tracked.cancel = function () {
		return debounced.cancel.apply(debounced);
	};
	tracked.flush = function () {
		return debounced.flush.apply(debounced);
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
export function is<T extends object>(o: object, propOrMatcher?: keyof T | ((o: any) => boolean), value?: any): o is T {
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

export function disposableInterval(fn: (...args: any[]) => void, ms: number): Disposable {
	let timer: ReturnType<typeof setInterval> | undefined;
	const disposable = {
		dispose: () => {
			if (timer != null) {
				clearInterval(timer);
				timer = undefined;
			}
		},
	};
	timer = setInterval(fn, ms);

	return disposable;
}

export async function sequentialize<T extends (...args: any[]) => unknown>(
	fn: T,
	argArray: Parameters<T>[],
	thisArg?: unknown,
): Promise<any> {
	for (const args of argArray) {
		try {
			void (await fn.apply(thisArg, args));
		} catch {}
	}
}

/**
 * Szudzik elegant pairing function
 * http://szudzik.com/ElegantPairing.pdf
 */
export function szudzikPairing(x: number, y: number): number {
	return x >= y ? x * x + x + y : x + y * y;
}

export async function wait(ms: number) {
	await new Promise(resolve => setTimeout(resolve, ms));
}
