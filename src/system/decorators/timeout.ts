'use strict';
import { CancellationError, is as isPromise } from '../promise';

export function timeout(timeout: number): any;
export function timeout(timeoutFromLastArg: true, defaultTimeout?: number): any;
export function timeout(timeoutOrTimeoutFromLastArg: number | boolean, defaultTimeout?: number): any {
	let timeout: number | undefined;
	let timeoutFromLastArg = false;
	if (typeof timeoutOrTimeoutFromLastArg === 'boolean') {
		timeoutFromLastArg = timeoutOrTimeoutFromLastArg;
	} else {
		timeout = timeoutOrTimeoutFromLastArg;
	}

	return (target: any, key: string, descriptor: PropertyDescriptor) => {
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		}
		if (fn == null) throw new Error('Not supported');

		descriptor.value = function (this: any, ...args: any[]) {
			if (timeoutFromLastArg) {
				const lastArg = args[args.length - 1];
				if (lastArg != null && typeof lastArg === 'number') {
					timeout = lastArg;
				} else {
					timeout = defaultTimeout;
				}
			}

			const result = fn?.apply(this, args);
			if (timeout == null || timeout < 1 || !isPromise(result)) return result;

			// const cc = Logger.getCorrelationContext();

			// const start = process.hrtime();

			return Promise.race([
				result,
				// result.then(r => {
				// 	Logger.debug(
				// 		cc,
				// 		`${GlyphChars.Dash} timed out, but completed after ${Strings.getDurationMilliseconds(start)} ms`
				// 	);
				// 	return r;
				// }),
				new Promise((_, reject) => {
					const id = setTimeout(() => {
						clearTimeout(id);
						reject(new CancellationError(result, `Timed out after ${timeout} ms`));
					}, timeout!);
				}),
			]);
		};
	};
}
