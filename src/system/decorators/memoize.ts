'use strict';

export function memoize(target: any, key: string, descriptor: any) {
    let fn: Function | undefined;
    let fnKey: string | undefined;

    if (typeof descriptor.value === 'function') {
        fn = descriptor.value;
        fnKey = 'value';

        if (fn!.length !== 0) {
            console.warn('Memoize should only be used in functions with no parameters');
        }
    }
    else if (typeof descriptor.get === 'function') {
        fn = descriptor.get;
        fnKey = 'get';
    }
    else {
        throw new Error('Not supported');
    }

    if (!fn || !fnKey) throw new Error('Not supported');

    const memoizeKey = `$memoize$${key}`;

    descriptor[fnKey] = function(...args: any[]) {
        if (!this.hasOwnProperty(memoizeKey)) {
            Object.defineProperty(this, memoizeKey, {
                configurable: false,
                enumerable: false,
                writable: false,
                value: fn!.apply(this, args)
            });
        }

        return this[memoizeKey];
    };
}
