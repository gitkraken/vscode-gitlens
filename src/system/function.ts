import type { Disposable } from 'vscode';

const comma = ',';
const equals = '=';
const openBrace = '{';
const openParen = '(';
const closeParen = ')';

const fnBodyRegex = /\(([\s\S]*)\)/;
const fnBodyStripCommentsRegex = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/gm;
const fnBodyStripParamDefaultValueRegex = /\s?=.*$/;

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getParameters(fn: Function): string[] {
	if (typeof fn !== 'function') throw new Error('Not supported');

	if (fn.length === 0) return [];

	let fnBody: string = Function.prototype.toString.call(fn);
	fnBody = fnBody.replace(fnBodyStripCommentsRegex, '') || fnBody;
	fnBody = fnBody.slice(0, fnBody.indexOf(openBrace));

	let open = fnBody.indexOf(openParen);
	let close = fnBody.indexOf(closeParen);

	open = open >= 0 ? open + 1 : 0;
	close = close > 0 ? close : fnBody.indexOf(equals);

	fnBody = fnBody.slice(open, close);
	fnBody = `(${fnBody})`;

	const match = fnBodyRegex.exec(fnBody);
	return match != null
		? match[1].split(comma).map(param => param.trim().replace(fnBodyStripParamDefaultValueRegex, ''))
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

export function once<T extends (...args: any[]) => unknown>(fn: T): T {
	let result: ReturnType<T>;
	let called = false;

	return function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
		if (!called) {
			called = true;
			result = fn.apply(this, args) as ReturnType<T>;
			fn = undefined!;
		}

		return result;
	} as T;
}

type PartialArgs<T extends any[], P extends any[]> = {
	[K in keyof P]: K extends keyof T ? T[K] : never;
};

type DropFirstN<T extends any[], N extends number, I extends any[] = []> = {
	0: T;
	1: T extends [infer _, ...infer R] ? DropFirstN<R, N, [any, ...I]> : T;
}[I['length'] extends N ? 0 : 1];

export function partial<T extends (...args: any[]) => any, P extends any[]>(
	fn: T,
	...partialArgs: PartialArgs<Parameters<T>, P>
): (...rest: DropFirstN<Parameters<T>, P['length']>) => ReturnType<T> {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return
	return (...rest) => fn(...partialArgs, ...rest);
}

// export function propOf<T, K extends Extract<keyof T, string>>(o: T, key: K) {
// 	const propOfCore = <T, K extends Extract<keyof T, string>>(o: T, key: K) => {
// 		const value: string =
// 			(propOfCore as PropOfValue).value === undefined ? key : `${(propOfCore as PropOfValue).value}.${key}`;
// 		(propOfCore as PropOfValue).value = value;
// 		const fn = <Y extends Extract<keyof T[K], string>>(k: Y) => propOfCore(o[key], k);
// 		return Object.assign(fn, { value: value });
// 	};
// 	return propOfCore(o, key);
// }

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

export async function runSequentially<T extends (...args: any[]) => unknown>(
	fn: T,
	arrayOfArgs: Parameters<T>[],
	thisArg?: unknown,
): Promise<any> {
	for (const args of arrayOfArgs) {
		try {
			void (await fn.apply(thisArg, args));
		} catch {}
	}
}

export function sequentialize<T extends (...args: any[]) => Promise<any>>(fn: T): T {
	let promise: Promise<unknown> | undefined;

	return function (...args: any[]): Promise<any> {
		// eslint-disable-next-line no-return-await, @typescript-eslint/no-unsafe-return
		const run = async () => await fn(...args);
		if (promise == null) {
			promise = run();
		} else {
			promise = promise.then(run, run);
		}

		return promise;
	} as T;
}

/**
 * Szudzik elegant pairing function
 * http://szudzik.com/ElegantPairing.pdf
 */
export function szudzikPairing(x: number, y: number): number {
	return x >= y ? x * x + x + y : x + y * y;
}

export function throttle<T extends (...args: any[]) => ReturnType<T>>(fn: T, delay: number) {
	let waiting = false;
	let waitingArgs: Parameters<T> | undefined;

	return function (this: unknown, ...args: Parameters<T>): void {
		if (waiting) {
			waitingArgs = args;

			return;
		}

		waiting = true;
		fn.apply(this, args);

		setTimeout(() => {
			waiting = false;

			if (waitingArgs != null) {
				fn.apply(this, waitingArgs);
			}
		}, delay);
	};
}

//** Used to cause compile errors for exhaustive type checking */
export function typeCheck<T>(value: T): asserts value is T {}
