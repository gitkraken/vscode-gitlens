'use strict';
const _debounce = require('lodash.debounce');
const _once = require('lodash.once');

export interface IDeferred {
    cancel(): void;
    flush(...args: any[]): void;
}

export namespace Functions {
    export function debounce<T extends Function>(fn: T, wait?: number, options?: { leading?: boolean, maxWait?: number, trailing?: boolean }): T & IDeferred {
        return _debounce(fn, wait, options);
    }

    export function once<T extends Function>(fn: T): T {
        return _once(fn);
    }

    export async function wait(ms: number) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
}