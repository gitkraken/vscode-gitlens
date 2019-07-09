'use strict';
import { Functions } from '../function';

export function gate() {
    return (target: any, key: string, descriptor: PropertyDescriptor) => {
        let fn: Function | undefined;
        if (typeof descriptor.value === 'function') {
            fn = descriptor.value;
        }
        else if (typeof descriptor.get === 'function') {
            fn = descriptor.get;
        }
        if (fn == null) throw new Error('Not supported');

        const gateKey = `$gate$${key}`;

        descriptor.value = function(this: any, ...args: any[]) {
            if (!Object.prototype.hasOwnProperty.call(this, gateKey)) {
                Object.defineProperty(this, gateKey, {
                    configurable: false,
                    enumerable: false,
                    writable: true,
                    value: undefined
                });
            }

            let promise = this[gateKey];
            if (promise === undefined) {
                const result = fn!.apply(this, args);
                if (result == null || !Functions.isPromise(result)) {
                    return result;
                }

                this[gateKey] = promise = result.then((r: any) => {
                    this[gateKey] = undefined;
                    return r;
                });
            }

            return promise;
        };
    };
}
