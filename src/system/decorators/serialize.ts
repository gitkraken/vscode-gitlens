'use strict';
import { Uri } from 'vscode';

const emptyStr = '';

function defaultResolver(...args: any[]): string {
	if (args.length === 1) {
		const arg0 = args[0];
		if (arg0 === undefined) return emptyStr;
		if (typeof arg0 === 'string') return arg0;
		if (typeof arg0 === 'number' || typeof arg0 === 'boolean' || arg0 instanceof Error) return String(arg0);
		if (arg0 instanceof Uri) return arg0.toString();

		return JSON.stringify(arg0);
	}

	return JSON.stringify(args);
}

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
			const prop =
				args.length === 0
					? serializeKey
					: `${serializeKey}$${(resolver ?? defaultResolver)(...(args as Parameters<T>))}`;

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
