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
    export function debounce<T extends Function>(fn: T, wait?: number, options?: { leading?: boolean, maxWait?: number, track?: boolean, trailing?: boolean }): T & IDeferred & { pending?: () => boolean } {
        const { track, ...opts } = { track: false, ...(options || {}) } as { leading?: boolean, maxWait?: number, track?: boolean, trailing?: boolean };

        if (track !== true) return _debounce(fn, wait, opts);

        let pending = false;

        const debounced = _debounce(function() {
            pending = false;
            return fn.apply(null, arguments);
        } as any as T, wait, options) as T & IDeferred;

        const tracked = function() {
            pending = true;
            return debounced.apply(null, arguments);
        } as any as T & IDeferred & { pending(): boolean};

        tracked.pending = function() { return pending; };
        tracked.cancel = function() { return debounced.cancel.apply(debounced, arguments); };
        tracked.flush = function(...args: any[]) { return debounced.flush.apply(debounced, arguments); };

        return tracked;
    }

    export function once<T extends Function>(fn: T): T {
        return _once(fn);
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

    export function seeded<T>(fn: (...args: any[]) => Promise<T>, seed: T): (...args: any[]) => Promise<T> {
        let cached: T | undefined = seed;
        return (...args: any[]) => {
            if (cached !== undefined) {
                const promise = Promise.resolve(cached);
                cached = undefined;

                return promise;
            }
            return fn(...args);
        };
    }

    export async function wait(ms: number) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
}