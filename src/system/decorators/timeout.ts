/* eslint-disable @typescript-eslint/no-unsafe-return */
import { cancellable, isPromise } from '../promise';

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

			return cancellable(result, timeout, { onDidCancel: resolve => resolve(undefined) });
		};
	};
}
