'use strict';
const _debounce = require('lodash.debounce');
const _once = require('lodash.once');

export interface IDeferred {
    cancel(): void;
    flush(...args: any[]): void;
}

interface IPropOfValue {
    (): any;
    value: string | undefined;
}

export namespace Functions {
    export function debounce<T extends Function>(fn: T, wait?: number, options?: { leading?: boolean, maxWait?: number, trailing?: boolean }): T & IDeferred {
        return _debounce(fn, wait, options);
    }

    export function propOf<T, K extends keyof T>(o: T, key: K) {
        const propOfCore = <T, K extends keyof T>(o: T, key: K) => {
            const value: string = (propOfCore as IPropOfValue).value === undefined
                ? key
                : `${(propOfCore as IPropOfValue).value}.${key}`;
            (propOfCore as IPropOfValue).value = value;
            const fn = <Y extends keyof T[K]>(k: Y) => propOfCore(o[key], k);
            return Object.assign(fn, { value: value });
        };
        return propOfCore(o, key);
    }

    export function once<T extends Function>(fn: T): T {
        return _once(fn);
    }

    export async function wait(ms: number) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
}