/* eslint-disable @typescript-eslint/no-unsafe-return */
import { isPromise } from '../promise';
import { resolveProp } from './resolver';

/**
 * A decorator that gates the execution of a method or getter.
 * It ensures that the decorated method is executed only once at a time
 * by forcing subsequent calls to wait for the previous execution to complete.
 */
export function gate<T extends (...arg: any) => any>(resolver?: (...args: Parameters<T>) => string) {
	return (target: any, key: string, descriptor: PropertyDescriptor) => {
		// Stores the original method or getter function in fn variable
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn == null) throw new Error('Not supported');

		// Creates a unique gate key
		const gateKey = `$gate$${key}`;

		// Replaces the descriptor value with a new function
		descriptor.value = function (this: any, ...args: any[]) {
			// Resolves the gate key using the resolver function
			const prop = resolveProp(gateKey, resolver, ...(args as Parameters<T>));

			// Checks if a promise has already been created for the method
			if (!Object.prototype.hasOwnProperty.call(this, prop)) {
				Object.defineProperty(this, prop, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			// If a promise exists, return it
			let promise = this[prop];
			if (promise === undefined) {
				let result;
				try {
					// Call the original method
					result = fn!.apply(this, args);

					// If the result is not a promise, return it
					if (result == null || !isPromise(result)) {
						return result;
					}

					// If the result is a promise, set up .then and .catch
					// handlers to clear the promise on completion
					this[prop] = promise = result
						.then((r: any) => {
							this[prop] = undefined;
							return r;
						})
						.catch(ex => {
							this[prop] = undefined;
							throw ex;
						});
				} catch (ex) {
					this[prop] = undefined;
					throw ex;
				}
			}

			// Return the ongoing promise
			return promise;
		};
	};
}
