/* eslint-disable @typescript-eslint/no-unsafe-return */
import { getTelementryService } from '@env/providers';
import { Logger } from '../logger';
import { isPromise } from '../promise';
import { resolveProp } from './resolver';

export function gate<T extends (...arg: any) => any>(getGroupingKey?: (...args: Parameters<T>) => string) {
	return (_target: any, key: string, descriptor: PropertyDescriptor): void => {
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
			const prop = resolveProp(gateKey, getGroupingKey, ...(args as Parameters<T>));
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
				promise = fn.apply(this, args);
				if (promise == null || !isPromise(promise)) {
					return promise;
				}

				this[prop] = promise;
				void promise.finally(() => (this[prop] = undefined));

				// Log if gate takes too long to resolve
				let timeout = setTimeout(() => {
					Logger.warn(`[gate] ${key} has been pending for 120+ seconds (possible deadlock)`, `prop=${prop}`);
					getTelementryService()?.sendEvent('op/gate/deadlock', { key: key, prop: prop, timeout: 60000 });

					timeout = setTimeout(() => {
						Logger.warn(
							`[gate] ${key} has still been pending for 420+ seconds (possible deadlock)`,
							`prop=${prop}`,
						);
						getTelementryService()?.sendEvent('op/gate/deadlock', {
							key: key,
							prop: prop,
							timeout: 420000,
						});

						timeout = setTimeout(() => {
							Logger.warn(
								`[gate] ${key} has still been pending for 900+ seconds (possible deadlock)`,
								`prop=${prop}`,
							);
							getTelementryService()?.sendEvent('op/gate/deadlock', {
								key: key,
								prop: prop,
								timeout: 900000,
							});
						}, 480000);
					}, 300000);
				}, 120000);
				void promise.finally(() => clearTimeout(timeout));
			}

			return promise;
		};
	};
}
