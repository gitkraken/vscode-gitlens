import { resolveProp } from './resolver';

export function serialize<T extends (...arg: any) => any>(
	resolver?: (...args: Parameters<T>) => string,
): (target: any, key: string, descriptor: PropertyDescriptor) => void {
	return (target: any, key: string, descriptor: PropertyDescriptor) => {
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn === undefined) throw new Error('Not supported');

		const serializeKey = `$serialize$${key}`;

		descriptor.value = function (this: any, ...args: any[]) {
			const prop = resolveProp(serializeKey, resolver, ...(args as Parameters<T>));
			if (!Object.prototype.hasOwnProperty.call(this, prop)) {
				Object.defineProperty(this, prop, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			let promise = this[prop];
			const run = () => fn!.apply(this, args);
			if (promise === undefined) {
				promise = run();
			} else {
				promise = promise.then(run, run);
			}

			this[prop] = promise;
			return promise;
		};
	};
}
