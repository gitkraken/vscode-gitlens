/* eslint-disable @typescript-eslint/no-unsafe-return */
import { resolveProp } from './resolver';

export function memoize<T extends (...arg: any) => any>(resolver?: (...args: Parameters<T>) => string) {
	return (_target: any, key: string, descriptor: PropertyDescriptor & Record<string, any>) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		let fnKey: string | undefined;

		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
			fnKey = 'value';
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
			fnKey = 'get';
		} else {
			throw new Error('Not supported');
		}

		if (fn == null) throw new Error('Not supported');

		const memoizeKey = `$memoize$${key}`;

		let result;
		descriptor[fnKey] = function (...args: any[]) {
			const prop = resolveProp(memoizeKey, resolver, ...(args as Parameters<T>));
			if (Object.prototype.hasOwnProperty.call(this, prop)) {
				result = this[prop];

				return result;
			}

			result = fn.apply(this, args);
			Object.defineProperty(this, prop, {
				configurable: false,
				enumerable: false,
				writable: false,
				value: result,
			});

			return result;
		};
	};
}
