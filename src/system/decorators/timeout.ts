'use strict';
import { Promises } from '../promise';
// import { Logger } from '../../logger';
// import { Strings } from '../string';
// import { GlyphChars } from '../../constants';

export function timeout<T extends (...arg: any) => any>(timeout: number): any;
export function timeout<T extends (...arg: any) => any>(timeoutFromLastArg: true, defaultTimeout?: number): any;
export function timeout<T extends (...arg: any) => any>(
	timeoutOrTimeoutFromLastArg: number | boolean,
	defaultTimeout?: number,
): any {
	let timeout: number | undefined;
	let timeoutFromLastArg = false;
	if (typeof timeoutOrTimeoutFromLastArg === 'boolean') {
		timeoutFromLastArg = timeoutOrTimeoutFromLastArg;
	} else {
		timeout = timeoutOrTimeoutFromLastArg;
	}

	return (target: any, key: string, descriptor: PropertyDescriptor) => {
		// eslint-disable-next-line @typescript-eslint/ban-types
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
			if (timeout == null || timeout < 1 || !Promises.is(result)) return result;

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
				new Promise((resolve, reject) => {
					const id = setTimeout(() => {
						clearTimeout(id);
						reject(new Promises.CancellationError(result, `Timed out after ${timeout} ms`));
					}, timeout!);
				}),
			]);
		};
	};
}
