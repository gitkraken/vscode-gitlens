'use strict';

const emptyStr = '';

function defaultResolver(...args: any[]): string {
    if (args.length === 1) {
        const arg0 = args[0];
        if (arg0 == null) return emptyStr;
        if (typeof arg0 === 'string') return arg0;
        if (typeof arg0 === 'number' || typeof arg0 === 'boolean') {
            return String(arg0);
        }

        return JSON.stringify(arg0);
    }

    return JSON.stringify(args);
}

export function memoize<T extends (...arg: any) => any>(resolver?: (...args: Parameters<T>) => string) {
    return (target: any, key: string, descriptor: PropertyDescriptor & { [key: string]: any }) => {
        let fn: Function | undefined;
        let fnKey: string | undefined;

        if (typeof descriptor.value === 'function') {
            fn = descriptor.value;
            fnKey = 'value';
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

        let result;
        descriptor[fnKey] = function(...args: any[]) {
            const prop =
                fnKey === 'get' || args.length === 0
                    ? memoizeKey
                    : `${memoizeKey}$${(resolver || defaultResolver)(...(args as Parameters<T>))}`;

            if (this.hasOwnProperty(prop)) {
                result = this[prop];

                return result;
            }

            result = fn!.apply(this, args);
            Object.defineProperty(this, prop, {
                configurable: false,
                enumerable: false,
                writable: false,
                value: result
            });

            return result;
        };
    };
}
