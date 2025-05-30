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

export function debounce<T extends (...args: any[]) => ReturnType<T>>(fn: T, wait: number): Deferrable<T> {
	let lastArgs: Parameters<T>;
	let lastCallTime: number | undefined;
	let lastThis: ThisType<T>;
	let result: ReturnType<T> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function invoke(): ReturnType<T> | undefined {
		const args = lastArgs;
		const thisArg = lastThis;

		lastArgs = lastThis = undefined!;
		result = fn.apply(thisArg, args);
		return result;
	}

	function shouldInvoke(time: number) {
		const timeSinceLastCall = time - (lastCallTime ?? 0);

		// Either this is the first call, activity has stopped and we're at the
		// trailing edge, the system time has gone backwards and we're treating
		// it as the trailing edge
		return lastCallTime == null || timeSinceLastCall >= wait || timeSinceLastCall < 0;
	}

	function timerExpired() {
		const time = Date.now();
		if (shouldInvoke(time)) {
			trailingEdge();
		} else {
			// Restart the timer
			const timeSinceLastCall = time - (lastCallTime ?? 0);
			timer = setTimeout(timerExpired, wait - timeSinceLastCall);
		}
	}

	function trailingEdge() {
		timer = undefined;

		// Only invoke if we have `lastArgs` which means `fn` has been debounced at least once
		if (lastArgs) return invoke();
		lastArgs = lastThis = undefined!;

		return result;
	}

	function cancel() {
		if (timer != null) {
			clearTimeout(timer);
		}
		lastArgs = lastCallTime = lastThis = timer = undefined!;
	}

	function flush() {
		return timer != null ? trailingEdge() : result;
	}

	function pending() {
		return timer != null;
	}

	function debounced(this: any, ...args: Parameters<T>) {
		const time = Date.now();
		const isInvoking = shouldInvoke(time);

		lastArgs = args;
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		lastThis = this;
		lastCallTime = time;

		if (isInvoking) {
			if (timer == null) {
				// Start the timer for the trailing edge.
				timer = setTimeout(timerExpired, wait);
				return result;
			}
		}
		if (timer == null) {
			timer = setTimeout(timerExpired, wait);
		}

		return result;
	}

	debounced.cancel = cancel;
	debounced.flush = flush;
	debounced.pending = pending;
	return debounced;
}

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
	let result: ReturnType<T>;
	let called = false;

	return function (this: any, ...args: Parameters<T>): ReturnType<T> {
		if (!called) {
			called = true;
			result = fn.apply(this, args);
			fn = undefined!;
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return result;
	} as T;
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
