/* eslint-disable @typescript-eslint/no-unsafe-return */
import { isPromise } from '../promise';
import { resolveProp } from './resolver';

export function gate<T extends (...arg: any) => any>(resolver?: (...args: Parameters<T>) => string) {
	return (_target: any, key: string, descriptor: PropertyDescriptor) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn == null) throw new Error('Not supported');

		const gateKey = `$gate$${key}`;

		descriptor.value = function (this: any, ...args: any[]) {
			const prop = resolveProp(gateKey, resolver, ...(args as Parameters<T>));
			if (!Object.prototype.hasOwnProperty.call(this, prop)) {
				Object.defineProperty(this, prop, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			let promise = this[prop];
			if (promise === undefined) {
				let result;
				try {
					result = fn.apply(this, args);
					if (result == null || !isPromise(result)) {
						return result;
					}

					this[prop] = promise = result
						.then((r: any) => {
							this[prop] = undefined;
							return r;
						})
						.catch((ex: unknown) => {
							this[prop] = undefined;
							throw ex;
						});
				} catch (ex) {
					this[prop] = undefined;
					throw ex;
				}
			}

			return promise;
		};
	};
}
